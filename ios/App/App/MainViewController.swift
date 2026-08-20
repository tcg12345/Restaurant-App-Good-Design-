import Capacitor
import QuartzCore
import UIKit
import WebKit

// Capacitor 7's runtime auto-discovery of app-target Swift plugins is
// unreliable: the class can be in the binary yet still not register, which
// surfaces in JS as `"PhotoLibrary" plugin is not implemented on ios`.
// Registering through `capacitorDidLoad` is the supported escape hatch.
class MainViewController: CAPBridgeViewController {
    // The app's page background. iOS leaves the window / host view / WKWebView
    // on a black backing, which shows through as a black strip — most visibly
    // in the rounded top corners of the on-screen keyboard, which cut out and
    // reveal the layer behind the keyboard. Painting every native surface
    // (window, view, web view, scroll view) with the app's own background and
    // keeping the web view opaque means there's no black layer left to peek
    // through. Trait-aware, and the trait itself is driven by the app's own
    // dark-mode toggle: the AppTheme plugin below overrides the window's
    // interface style whenever the user flips the in-app switch, so these
    // colors follow the app theme, not the OS appearance.
    private let appBackground = UIColor { traits in
        traits.userInterfaceStyle == .dark
            ? UIColor(red: 19.0 / 255.0, green: 19.0 / 255.0, blue: 20.0 / 255.0, alpha: 1.0)   // #131314
            : UIColor(red: 1.0, green: 1.0, blue: 1.0, alpha: 1.0)                              // #FFFFFF
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = appBackground
    }

    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(PhotoLibraryPlugin())
        bridge?.registerPluginInstance(AppThemePlugin())
        bridge?.registerPluginInstance(LiquidGlassPlugin())

        if let webView = self.webView {
            // Opaque + app-colored so the web view's own backing is never black
            // (a transparent web view let the black window show through the
            // keyboard's corner cut-outs).
            webView.isOpaque = true
            webView.backgroundColor = appBackground
            webView.scrollView.backgroundColor = appBackground
            // Kill the WKWebView's document-level rubber-band entirely. With
            // bounces on, the whole page (chrome included) could be dragged up
            // or down past its content, exposing the black backing above the
            // header and below the bottom nav — and CSS `overscroll-behavior`
            // is not honored for the top-level document scroll on iOS, so it
            // has to be turned off here. This only affects the page scroll
            // view; inner overflow-scroll containers keep their own momentum.
            webView.scrollView.alwaysBounceHorizontal = false
            webView.scrollView.alwaysBounceVertical = false
            webView.scrollView.bounces = false
        }
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        // The window only exists once the view is in the hierarchy. Painting it
        // is what actually kills the black in the keyboard's rounded corners,
        // since that area reveals the window behind the keyboard.
        view.window?.backgroundColor = appBackground
        // Re-apply any theme override the web app pushed before the window
        // attached (setTheme can fire during boot, ahead of viewDidAppear).
        if let style = AppThemePlugin.pendingStyle {
            view.window?.overrideUserInterfaceStyle = style
        }
    }
}

// The web app's dark mode is a manual toggle (a `.dark` class on <html>),
// deliberately independent of the OS appearance. This plugin lets JS flip
// the native window's interface style to match, which re-resolves every
// trait-aware UIColor (the backgrounds above), the keyboard appearance and
// the default status-bar style in one shot — so native chrome can never
// disagree with the page theme.
//
// Lives in this file on purpose: MainViewController.swift is already a
// member of the App target, so no Xcode project edits are needed.
@objc(AppThemePlugin)
public class AppThemePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "AppThemePlugin"
    public let jsName = "AppTheme"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "setTheme", returnType: CAPPluginReturnPromise),
    ]

    /// Last style requested from JS. Re-applied in viewDidAppear in case
    /// setTheme ran before the window existed.
    static var pendingStyle: UIUserInterfaceStyle?

    @objc func setTheme(_ call: CAPPluginCall) {
        let dark = call.getBool("dark") ?? false
        DispatchQueue.main.async {
            let style: UIUserInterfaceStyle = dark ? .dark : .light
            AppThemePlugin.pendingStyle = style
            let window = self.bridge?.viewController?.view.window
                ?? UIApplication.shared.connectedScenes
                    .compactMap { ($0 as? UIWindowScene)?.keyWindow }
                    .first
            window?.overrideUserInterfaceStyle = style
            call.resolve()
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// LiquidGlass — a real iOS 26 Liquid Glass tab bar, layered over the WebView.
//
// Why native at all: Liquid Glass is a UIKit material. It refracts and lenses
// what's behind it, carries specular highlights that track device motion, and
// re-tints itself from the content underneath. CSS `backdrop-filter` is a
// Gaussian blur with a saturation boost — it can look *like* glass in a still
// screenshot, but none of the above is available to web content, and there is
// no CSS or JS API that exposes the material.
//
// So the tab bar moves out of the page. A UIVisualEffectView with a
// UIGlassEffect sits above the WKWebView, which means the thing it refracts is
// the live web content scrolling beneath it. The web BottomNav stands down
// while this owns the screen (see src/components/BottomNav.tsx).
//
// Deliberately scoped to the tab bar. Mirroring arbitrary in-page buttons into
// native views would mean re-syncing frames every frame against a scrolling
// document (a frame of lag reads as broken), and native views always draw
// above the WebView — every mirrored button would float on top of the
// composer sheets and modals. Apple puts Liquid Glass on the navigation
// layer, not on in-content controls; the app's own buttons use the
// `.glass-control` CSS material instead.
//
// Methods (window.Capacitor.Plugins.LiquidGlass):
//   - isSupported()                          → { supported, reason }
//   - configureTabBar({ items, variant })    → install / replace the bar
//   - setActiveTab({ path })                 → move the selection
//   - setMinimized({ minimized, animated })  → shrink / restore on scroll
//   - setBarStyle({ dark })                  → dark chrome over dark pages
//   - setVisible({ visible, animated })      → hide for keyboard / overlays
//   - removeTabBar()                         → tear down, hand back to web
// Events:
//   - "tabSelected" { path }                 → JS routes
//   - "minimizedChanged" { minimized }       → the bar shrank or grew itself
//   - "supportChanged" { supported }         → Reduce Transparency toggled
//
// Setup in Xcode: none. This file is already a member of the App target, and
// MainViewController.capacitorDidLoad registers the instance explicitly. That
// is also why everything below — bar, content, cells, shadow, lens — lives in
// this one file rather than being split up: a new Swift file would need a
// project edit, and the project isn't checked in.
//
// VERIFY ON DEVICE (the material does not render meaningfully in the
// simulator, so none of this can be checked from a build alone):
//   1. How the material actually looks. The iOS 26 *names* are settled — a
//      build resolved `UIGlassEffect`, `UIGlassContainerEffect` and
//      `UIVisualEffectView.cornerConfiguration = .capsule()` against the SDK,
//      so they are no longer the open question they were when this was
//      written blind. What a build cannot tell you is whether the specular
//      rim, the shadow and the lens read right at a glance. Every iOS 26
//      symbol is still reached through one of three small factories
//      (`makeBarEffect`, `makeLensEffect`, `makeContainerEffect`) plus
//      `applyShape`, so a signature change stays a one-function fix, and
//      every older OS already takes the UIBlurEffect path.
//   2. `glassMerge`. Nesting the bar and the lens in a UIGlassContainerEffect
//      is what makes two pieces of glass merge and morph into one another as
//      the lens slides, and that merge is most of what separates a stretching
//      capsule from a liquid one. It ships on `.full`. The worry that made an
//      earlier pass ship it off — that two fully-overlapping glass elements
//      would collapse into one and the lens would vanish — is real but
//      untested, so `.lensOnly` is there as a one-line escape hatch, and
//      `.none` restores the plain stacked-glass version.
//   3. Tap targets: the bar is added to the bridge view controller's view, so
//      it sits above the WebView and swallows taps in its own bounds only.
//
// That the backdrop samples WKWebView content at all was the open question in
// the first pass, and it is settled: it does. Scroll a colourful grid
// (Lists → Collections) under the bar and the tint moves with it.
// ─────────────────────────────────────────────────────────────────────────────

/// Springs, drag stretch and symbol bounces all stand down under Reduce
/// Motion. The selection still moves and still changes — it just moves
/// plainly, without overshoot.
private var glassReduceMotion: Bool { UIAccessibility.isReduceMotionEnabled }

@objc(LiquidGlassPlugin)
public class LiquidGlassPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "LiquidGlassPlugin"
    public let jsName = "LiquidGlass"
    // Every method has to appear here as well as being @objc — a method
    // missing from this array surfaces in JS as the same
    // `"LiquidGlass" plugin is not implemented on ios` that the explicit
    // registration above exists to avoid.
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "isSupported", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "configureTabBar", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setActiveTab", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setMinimized", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setBarStyle", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setVisible", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "removeTabBar", returnType: CAPPluginReturnPromise),
    ]

    private var tabBar: GlassTabBar?
    private var observingAccessibility = false
    /// Bumped by every install and every dismissal, so a dismissal that has
    /// been overtaken by a reinstall knows to do nothing when its animation
    /// finishes.
    private var teardownGeneration = 0

    // MARK: - Support

    /// Liquid Glass needs iOS 26, and it needs Reduce Transparency off — with
    /// that switch on the system flattens the material to an opaque fill,
    /// which is strictly worse than the web bar it would be replacing. Report
    /// unsupported and let the page keep its own nav.
    /// Call on the main thread — UIAccessibility flags are main-actor state.
    private var supportReason: String? {
        guard #available(iOS 26.0, *) else { return "requiresIOS26" }
        if UIAccessibility.isReduceTransparencyEnabled { return "reduceTransparency" }
        return nil
    }

    @objc func isSupported(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.startObservingAccessibilityIfNeeded()
            let reason = self.supportReason
            call.resolve(["supported": reason == nil, "reason": reason ?? ""])
        }
    }

    private func startObservingAccessibilityIfNeeded() {
        guard !observingAccessibility else { return }
        observingAccessibility = true
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(reduceTransparencyChanged),
            name: UIAccessibility.reduceTransparencyStatusDidChangeNotification,
            object: nil
        )
    }

    @objc private func reduceTransparencyChanged() {
        DispatchQueue.main.async {
            let supported = self.supportReason == nil
            // The page decides what to do about it; we only stop drawing.
            if !supported { self.teardown() }
            self.notifyListeners("supportChanged", data: ["supported": supported])
        }
    }

    // MARK: - Tab bar

    @objc func configureTabBar(_ call: CAPPluginCall) {
        let rawItems = call.getArray("items", JSObject.self) ?? []
        let items: [GlassTabBar.Item] = rawItems.compactMap { entry in
            guard let path = entry["path"] as? String,
                  let symbol = entry["symbol"] as? String else { return nil }
            return GlassTabBar.Item(
                path: path,
                symbol: symbol,
                selectedSymbol: entry["selectedSymbol"] as? String,
                label: entry["label"] as? String ?? "",
                avatarInitial: entry["avatarInitial"] as? String,
                avatarUrl: entry["avatarUrl"] as? String
            )
        }
        guard !items.isEmpty else {
            call.reject("configureTabBar needs at least one item")
            return
        }
        // "capsule" is the iOS 26 shape — a floating pill inset from the
        // edges, with page content visible underneath for the glass to
        // refract. "bar" is the flush full-width fallback, matching the
        // web nav's existing footprint.
        let variant = call.getString("variant") ?? "capsule"
        // May legitimately be "" — several routes show a tab bar without any
        // tab owning them (/experts, /admin/*). See `applySelection`.
        let activePath = call.getString("activePath")

        DispatchQueue.main.async {
            guard self.supportReason == nil else {
                call.reject("Liquid Glass is not available on this device")
                return
            }
            guard let host = self.bridge?.viewController?.view else {
                call.reject("No host view")
                return
            }
            // A dismissal may still be fading out (route bounced away and
            // straight back). Invalidate its completion or it would tear
            // down the bar we are about to install.
            self.teardownGeneration += 1

            let bar: GlassTabBar
            if let existing = self.tabBar {
                bar = existing
            } else {
                let created = GlassTabBar()
                created.onSelect = { [weak self] path in
                    self?.notifyListeners("tabSelected", data: ["path": path])
                }
                // The bar shrinks and grows itself in two cases JS cannot
                // predict — a touch on a collapsed bar, and coming back from
                // hidden. Tell JS, or its "what does native believe"
                // bookkeeping drifts and it starts swallowing real collapses.
                created.onCollapsedChange = { [weak self] collapsed in
                    self?.notifyListeners("minimizedChanged", data: ["minimized": collapsed])
                }
                self.tabBar = created
                bar = created
            }
            bar.install(in: host, variant: variant == "bar" ? .bar : .capsule)
            bar.setItems(items, activePath: activePath)
            // A route change lands at the top of the new page, so whatever
            // the previous page's scroll left behind doesn't apply. The JS
            // side mirrors this reset — see `useGlassScrollMinimize`.
            bar.setCollapsed(false, animated: false)
            call.resolve()
        }
    }

    @objc func setActiveTab(_ call: CAPPluginCall) {
        let path = call.getString("path") ?? ""
        DispatchQueue.main.async {
            self.tabBar?.setActive(path: path)
            call.resolve()
        }
    }

    /// Shrink-on-scroll, driven from JS.
    ///
    /// This used to be KVO on the WebView's own scroll view, which was wrong
    /// on two of the five tabs: Home and Reels scroll an inner
    /// `overflow-y: auto` container, so the document offset those observers
    /// watched sat at 0 for the whole session and the bar simply never
    /// collapsed there. The page already has a listener that catches every
    /// scroller (capture-phase on `document`), so the signal comes from there
    /// now — one source of truth, and one that can actually see all five.
    @objc func setMinimized(_ call: CAPPluginCall) {
        let minimized = call.getBool("minimized") ?? false
        let animated = call.getBool("animated") ?? true
        DispatchQueue.main.async {
            self.tabBar?.setCollapsed(minimized, animated: animated)
            call.resolve()
        }
    }

    /// The bar's chrome resolves by *trait*, not by what's behind it — so over
    /// the always-black Reels page a light-themed app gets a light warm fog
    /// with charcoal icons that vanish against dark video. Instagram flips to
    /// near-black chrome with white icons there. JS knows which routes are
    /// dark; this lets it say so. `dark: false` returns to following the
    /// window, which already follows the app theme via AppTheme.
    @objc func setBarStyle(_ call: CAPPluginCall) {
        let dark = call.getBool("dark") ?? false
        DispatchQueue.main.async {
            self.tabBar?.setStyle(dark: dark)
            call.resolve()
        }
    }

    @objc func setVisible(_ call: CAPPluginCall) {
        let visible = call.getBool("visible") ?? true
        let animated = call.getBool("animated") ?? true
        DispatchQueue.main.async {
            self.tabBar?.setVisible(visible, animated: animated)
            call.resolve()
        }
    }

    @objc func removeTabBar(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            // Fade out first: JS tears the bar down when the route stops
            // showing a tab bar, and a hard cut there reads as a glitch
            // against the web nav's slide-out on every other platform.
            self.teardownGeneration += 1
            let generation = self.teardownGeneration
            self.tabBar?.dismiss { [weak self] in
                guard let self, self.teardownGeneration == generation else { return }
                self.teardown()
            }
            call.resolve()
        }
    }

    private func teardown() {
        tabBar?.removeFromHost()
        tabBar = nil
    }

    deinit {
        NotificationCenter.default.removeObserver(self)
    }
}

// MARK: - Views

/// Carries the bar's ambient shadow, and everything about how the bar is
/// presented — alpha, transform, position, height.
///
/// It exists because the effect views must not clip: on iOS 26 a glass
/// material draws a specular rim and an ambient shadow *outside* its own
/// bounds, and `clipsToBounds = true` cuts both off. That single line is most
/// of why the first version read as a frosted rectangle rather than a lens.
/// With clipping gone the shadow has to live on a plain view that owns the
/// geometry instead.
final class GlassShadowView: UIView {
    /// Capsule (the floating pill) vs. square (the flush `bar` variant).
    var isCapsule = true
    /// Non-zero only while a collapse/expand animation is in flight.
    var shadowAnimationDuration: CFTimeInterval = 0

    override func layoutSubviews() {
        super.layoutSubviews()
        guard bounds.width > 0, bounds.height > 0 else { return }
        let radius = isCapsule ? bounds.height / 2 : 0
        let path = UIBezierPath(roundedRect: bounds, cornerRadius: radius).cgPath
        let previous = layer.shadowPath
        layer.shadowPath = path
        // `shadowPath` is a CALayer property, so it does not ride
        // `UIView.animate` the way `alpha` or `frame` do. Without this the
        // shadow snaps to the collapsed capsule on the first frame while the
        // glass above it is still interpolating, which reads as the shadow
        // detaching from the bar.
        guard shadowAnimationDuration > 0, let previous, previous != path else { return }
        let animation = CABasicAnimation(keyPath: "shadowPath")
        animation.fromValue = previous
        animation.toValue = path
        animation.duration = shadowAnimationDuration
        animation.timingFunction = CAMediaTimingFunction(name: .easeInEaseOut)
        layer.add(animation, forKey: "shadowPath")
    }
}

/// A glass surface that keeps its own corner radius in step with its height
/// on systems older than iOS 26.
///
/// On iOS 26 the shape comes from `cornerConfiguration`, applied once at
/// install, and this does nothing — deliberately, because rounding glass by
/// clipping is exactly the thing that flattens it. Below 26 there is no such
/// API and the material is an ordinary blur, where clipping is the only way
/// to round anything, so the pre-26 treatment stays.
final class GlassSurfaceView: UIVisualEffectView {
    var isCapsule = true

    override func layoutSubviews() {
        super.layoutSubviews()
        if #available(iOS 26.0, *) { return }
        layer.cornerRadius = isCapsule ? min(bounds.height, bounds.width) / 2 : 0
    }
}

/// The bar itself. Kept free of Capacitor types so it stays readable as plain
/// UIKit — the plugin above is only a transport.
///
/// Shape notes, because the first pass read as "glass-ish" rather than
/// native: an iOS 26 tab bar is icon *over label*, the selected item sits
/// under a second piece of glass that lenses the content behind it and slides
/// between positions rather than appearing in place, you can drag along the
/// bar to move the selection continuously, a touch on a shrunk bar brings it
/// back instead of switching tab, and the whole thing shrinks out of the way
/// as you scroll down. All of that is here.
///
/// View hierarchy:
///
///     host
///     └─ shadowWrapper: GlassShadowView      ← geometry, alpha, shadow
///        └─ [container: UIGlassContainerEffect]   ← optional, see `glassMerge`
///           ├─ barGlass: GlassSurfaceView    ← the material slab
///           ├─ lens:     GlassSurfaceView    ← the sliding selection glass
///           └─ content:  GlassTabBarContent  ← cells + gestures, transparent
///
/// `content` sits *above* the lens rather than inside the bar's contentView,
/// which is the one place this departs from the obvious arrangement: the icons
/// have to draw on top of the lens, or the material washes them out.
///
/// Every write to the lens converts out of `content`'s space first
/// (`setLens`), so none of the three `glassMerge` layouts can put the lens off
/// by an inset even though only two of them leave the two views as siblings.
final class GlassTabBar {
    struct Item {
        let path: String
        let symbol: String
        /// Filled counterpart drawn when the item is selected. Optional —
        /// several symbols (magnifyingglass, list.bullet) have no fill
        /// variant, and there the sliding pill carries it alone.
        let selectedSymbol: String?
        let label: String
        /// Instagram draws the profile tab as the user, not as a person
        /// glyph. This app has no avatar photos, so its version of "the
        /// user" is the initial-letter circle the profile page draws;
        /// `avatarUrl` is honoured first if the data model ever grows one.
        let avatarInitial: String?
        let avatarUrl: String?
    }

    enum Variant {
        /// iOS 26's floating pill, inset from the screen edges.
        case capsule
        /// Flush full-width bar — the web nav's existing footprint.
        case bar
    }

    var onSelect: ((String) -> Void)?
    /// Fired whenever the bar shrinks or grows, including the times it does so
    /// on its own initiative. The plugin forwards it to JS.
    var onCollapsedChange: ((Bool) -> Void)?

    /// How much of the bar goes inside a UIGlassContainerEffect. A container
    /// renders its glass children as one combined shape, so they merge and
    /// morph into each other rather than one sitting on the other — which is
    /// what turns a stretching capsule into a liquid one.
    ///
    /// Ships on `.full`. If two fully-overlapping glass elements turn out to
    /// collapse into a single shape and the lens disappears into the slab,
    /// `.lensOnly` is the fix; `.none` is the plain stacked-glass version this
    /// replaces. Being a constant it cannot change between installs, which is
    /// why `install`'s early-return identity check below doesn't consider it.
    private enum GlassMerge {
        /// Slab and lens both inside one container: they blend into each other.
        case full
        /// Only the lens is contained; the slab is plain glass beneath it.
        case lensOnly
        /// No container at all.
        case none
    }
    private static let glassMerge: GlassMerge = .full

    private var shadowWrapper: GlassShadowView?
    private var container: UIVisualEffectView?
    private var barGlass: GlassSurfaceView?
    private var lens: GlassSurfaceView?
    private var content: GlassTabBarContent?
    private var heightConstraint: NSLayoutConstraint?
    private var leadingConstraint: NSLayoutConstraint?
    private var trailingConstraint: NSLayoutConstraint?
    private var variant: Variant = .capsule
    private var visible = true
    private var collapsed = false
    /// Dark chrome forced by JS for dark pages (Reels). Kept here, not just on
    /// the view, so a teardown/reinstall cycle can't lose it.
    private var darkStyle = false

    /// Expanded vs. shrunk geometry. The shrunk bar loses a quarter of its
    /// height, so it reads as having got out of the way.
    ///
    /// 63/15/+13 are not taste — they're measured off a frame-by-frame capture
    /// of Instagram's bar on the same screen (1206×2622 @3x): slab 187px tall
    /// = 62.3pt, side insets 44px = 14.7pt, bottom edge 63px = 21pt above the
    /// screen bottom. A 50pt bar 43pt off the bottom read as small and
    /// floating too high next to it.
    private enum Metrics {
        static let expandedHeight: CGFloat = 63
        static let collapsedHeight: CGFloat = 48
        static let expandedInset: CGFloat = 15
        /// Deliberately equal to `expandedInset`. Pulling the edges in to 44
        /// as well squeezed five tabs into a narrow pill, which read as
        /// cramped rather than tidy — and it changed every cell's width
        /// mid-animation, which is a whole class of lens-resize bugs bought
        /// for no visual gain. The collapse is a height-and-labels change now.
        static let collapsedInset: CGFloat = 15
    }

    // MARK: Install

    func install(in host: UIView, variant: Variant) {
        if let existing = shadowWrapper, existing.superview === host, self.variant == variant {
            host.bringSubviewToFront(existing)
            // A cancelled dismissal leaves it faded out and non-interactive.
            resetPresentation()
            return
        }
        removeFromHost()
        self.variant = variant
        let isCapsule = variant == .capsule

        let wrapper = GlassShadowView(frame: .zero)
        wrapper.translatesAutoresizingMaskIntoConstraints = false
        wrapper.isCapsule = isCapsule
        wrapper.layer.shadowColor = UIColor.black.cgColor
        // The flush bar sits on the screen edge, where a drop shadow has
        // nowhere to fall — only the floating pill gets one.
        wrapper.layer.shadowOpacity = isCapsule ? 0.12 : 0
        wrapper.layer.shadowRadius = 20
        wrapper.layer.shadowOffset = CGSize(width: 0, height: 6)

        let barGlass = GlassSurfaceView(effect: Self.makeBarEffect())
        barGlass.translatesAutoresizingMaskIntoConstraints = false
        Self.applyShape(to: barGlass, capsule: isCapsule)

        let lens = GlassSurfaceView(effect: Self.makeLensEffect())
        // Frame-driven, on purpose: the drag writes its centre every frame,
        // and any constraint on it would be re-applied by the next layout
        // pass and wipe those writes.
        lens.translatesAutoresizingMaskIntoConstraints = true
        lens.alpha = 0
        lens.isUserInteractionEnabled = false
        // Not a thing VoiceOver should stop on — it's decoration behind the
        // cells, which are the real elements.
        lens.isAccessibilityElement = false
        Self.applyShape(to: lens, capsule: true)
        if #unavailable(iOS 26.0) {
            // A blur over a blur is invisible, so below 26 the lens needs a
            // fill of its own to read as a selection at all. Neutral, matching
            // the untinted glass on 26 — see `makeLensEffect`.
            lens.contentView.backgroundColor = UIColor.label.withAlphaComponent(0.08)
        }

        let content = GlassTabBarContent(frame: .zero)
        content.translatesAutoresizingMaskIntoConstraints = false
        content.onSelect = { [weak self] path in self?.onSelect?(path) }
        content.isCollapsed = { [weak self] in self?.collapsed ?? false }
        content.onRequestExpand = { [weak self] in self?.setCollapsed(false, animated: true) }

        host.addSubview(wrapper)
        // Above the WebView, below anything the shell presents modally.
        host.bringSubviewToFront(wrapper)

        var constraints: [NSLayoutConstraint] = []
        // Where the glass actually lives. Whichever branch runs, the paint
        // order is the same — slab, then lens, then cells — so the lens draws
        // over the material and the icons draw over the lens.
        let containerEffect: UIVisualEffect? = Self.glassMerge == .none ? nil : Self.makeContainerEffect()
        switch (Self.glassMerge, containerEffect) {
        case (.full, .some(let effect)):
            // Apple: "the glass container will render all glass elements in
            // one combined view, behind the visual effect view's contentView."
            // Both pieces of glass go in, so the lens and the slab blend into
            // each other as the lens slides; `content` is a plain view, so it
            // stays in front of the combined render where the icons belong.
            let containerView = UIVisualEffectView(effect: effect)
            containerView.translatesAutoresizingMaskIntoConstraints = false
            wrapper.addSubview(containerView)
            constraints += Self.pin(containerView, to: wrapper)
            self.container = containerView
            let inner = containerView.contentView
            inner.addSubview(barGlass)
            inner.addSubview(lens)
            inner.addSubview(content)
            constraints += Self.pin(barGlass, to: inner)
            constraints += Self.pin(content, to: inner)
        case (.lensOnly, .some(let effect)):
            // The escape hatch if `.full` dissolves the lens into the slab:
            // the container gets the lens and nothing else, so there is no
            // second glass element for it to merge with.
            let containerView = UIVisualEffectView(effect: effect)
            containerView.translatesAutoresizingMaskIntoConstraints = false
            // A bare container sitting between the slab and the cells would
            // otherwise eat every touch on its way past.
            containerView.isUserInteractionEnabled = false
            wrapper.addSubview(barGlass)
            wrapper.addSubview(containerView)
            wrapper.addSubview(content)
            constraints += Self.pin(barGlass, to: wrapper)
            constraints += Self.pin(containerView, to: wrapper)
            constraints += Self.pin(content, to: wrapper)
            self.container = containerView
            containerView.contentView.addSubview(lens)
        default:
            // `.none`, and every system too old to have a container effect.
            wrapper.addSubview(barGlass)
            wrapper.addSubview(lens)
            wrapper.addSubview(content)
            constraints += Self.pin(barGlass, to: wrapper)
            constraints += Self.pin(content, to: wrapper)
        }

        let guide = host.safeAreaLayoutGuide
        switch variant {
        case .capsule:
            let leading = wrapper.leadingAnchor.constraint(equalTo: guide.leadingAnchor, constant: Metrics.expandedInset)
            let trailing = wrapper.trailingAnchor.constraint(equalTo: guide.trailingAnchor, constant: -Metrics.expandedInset)
            let height = wrapper.heightAnchor.constraint(equalToConstant: Metrics.expandedHeight)
            leadingConstraint = leading
            trailingConstraint = trailing
            heightConstraint = height
            constraints += [
                leading,
                trailing,
                // *Below* the safe-area line, deliberately: Instagram's bar
                // bottom sits 21pt off the screen edge, 13pt into the
                // home-indicator zone, and that low seat is a lot of why it
                // reads anchored rather than floating. (Measured; see Metrics.)
                wrapper.bottomAnchor.constraint(equalTo: guide.bottomAnchor, constant: 13),
                height,
            ]
        case .bar:
            // Currently unreachable — JS hardcodes `variant: 'capsule'` (see
            // native-glass.ts). Kept whole, and shaped explicitly rather than
            // inheriting the capsule's geometry, so it still works if the
            // flush footprint is ever wanted back.
            constraints += [
                wrapper.leadingAnchor.constraint(equalTo: host.leadingAnchor),
                wrapper.trailingAnchor.constraint(equalTo: host.trailingAnchor),
                wrapper.bottomAnchor.constraint(equalTo: host.bottomAnchor),
                wrapper.topAnchor.constraint(equalTo: guide.bottomAnchor, constant: -Metrics.expandedHeight),
            ]
        }
        NSLayoutConstraint.activate(constraints)

        self.shadowWrapper = wrapper
        self.barGlass = barGlass
        self.lens = lens
        self.content = content
        content.attachLens(lens)
        collapsed = false
        applyStyle()
        resetPresentation()
    }

    /// Dark chrome on dark pages. One trait override on the wrapper reaches
    /// everything — both pieces of glass render their dark variant and every
    /// `.label` (the icons) re-resolves to white — which is exactly the flip
    /// Instagram's bar makes over dark content. `.unspecified` hands control
    /// back to the window, which already follows the app theme.
    func setStyle(dark: Bool) {
        guard dark != darkStyle else { return }
        darkStyle = dark
        applyStyle()
    }

    private func applyStyle() {
        shadowWrapper?.overrideUserInterfaceStyle = darkStyle ? .dark : .unspecified
    }

    private static func pin(_ view: UIView, to parent: UIView) -> [NSLayoutConstraint] {
        [
            view.topAnchor.constraint(equalTo: parent.topAnchor),
            view.bottomAnchor.constraint(equalTo: parent.bottomAnchor),
            view.leadingAnchor.constraint(equalTo: parent.leadingAnchor),
            view.trailingAnchor.constraint(equalTo: parent.trailingAnchor),
        ]
    }

    /// Back to fully shown, whatever a half-finished animation left behind.
    /// Operates on the wrapper, not on the glass: the lens is a sibling of the
    /// bar now, so fading only the bar would leave a tinted capsule stranded
    /// on screen after a dismissal.
    private func resetPresentation() {
        visible = true
        guard let wrapper = shadowWrapper else { return }
        wrapper.layer.removeAllAnimations()
        wrapper.alpha = 1
        wrapper.transform = .identity
        wrapper.isUserInteractionEnabled = true
    }

    func removeFromHost() {
        // The wrapper owns everything, but nil the rest too — a stale
        // reference to a detached lens or content view would otherwise keep
        // taking drag updates that go nowhere.
        shadowWrapper?.removeFromSuperview()
        shadowWrapper = nil
        container = nil
        barGlass = nil
        lens = nil
        content = nil
        heightConstraint = nil
        leadingConstraint = nil
        trailingConstraint = nil
    }

    // MARK: Items

    func setItems(_ items: [Item], activePath: String?) {
        content?.setItems(items, activePath: activePath)
    }

    func setActive(path: String) {
        content?.setActive(path: path, animated: true)
    }

    // MARK: Collapse on scroll

    /// Shrink (scrolling down) or restore (scrolling up / back at the top).
    /// A no-op for the flush `bar` variant, which has no room to shrink into.
    func setCollapsed(_ next: Bool, animated: Bool) {
        guard variant == .capsule, next != collapsed else { return }
        guard let wrapper = shadowWrapper, let height = heightConstraint,
              let leading = leadingConstraint, let trailing = trailingConstraint else {
            collapsed = next
            return
        }
        collapsed = next
        height.constant = next ? Metrics.collapsedHeight : Metrics.expandedHeight
        leading.constant = next ? Metrics.collapsedInset : Metrics.expandedInset
        trailing.constant = next ? -Metrics.collapsedInset : -Metrics.expandedInset
        content?.setCompact(next, animated: animated)

        let duration = 0.42
        let animate = animated && !glassReduceMotion
        wrapper.shadowAnimationDuration = animate ? duration : 0
        let apply = {
            wrapper.superview?.layoutIfNeeded()
            // The lens is frame-driven, so it doesn't ride the constraint
            // change the way the rest of the bar does. Re-anchoring it inside
            // the block makes it interpolate along with the height instead of
            // jumping when the animation lands. `content.reanchor()` knows to
            // keep it under the finger if a drag is live — a scroll event can
            // easily arrive one frame after touch-down.
            self.content?.reanchor()
        }
        if animate {
            UIView.animate(
                withDuration: duration,
                delay: 0,
                usingSpringWithDamping: 0.86,
                initialSpringVelocity: 0,
                options: [.beginFromCurrentState, .allowUserInteraction],
                animations: apply,
                completion: { _ in wrapper.shadowAnimationDuration = 0 }
            )
        } else {
            apply()
            wrapper.shadowAnimationDuration = 0
        }
        onCollapsedChange?(next)
    }

    // MARK: Visibility

    /// Mirrors the web nav's hide animation (fade + 20px drop) so the two
    /// implementations are indistinguishable when one replaces the other.
    func setVisible(_ next: Bool, animated: Bool) {
        // A bar that left collapsed must not come back collapsed. Whatever
        // hid it — the keyboard, a modal — also swallowed the scrolling that
        // shrank it, and the page underneath is no longer where it was left.
        if next { setCollapsed(false, animated: false) }
        guard next != visible, let wrapper = shadowWrapper else {
            visible = next
            return
        }
        visible = next
        let apply = {
            wrapper.alpha = next ? 1 : 0
            wrapper.transform = next ? .identity : CGAffineTransform(translationX: 0, y: 20)
        }
        wrapper.isUserInteractionEnabled = next
        if animated {
            UIView.animate(withDuration: 0.2, delay: 0, options: [.beginFromCurrentState, .curveEaseOut], animations: apply)
        } else {
            apply()
        }
    }

    /// Animate out, then hand back for removal. Matches the web nav's
    /// 200ms fade + 20px drop.
    func dismiss(completion: @escaping () -> Void) {
        guard let wrapper = shadowWrapper else {
            completion()
            return
        }
        wrapper.isUserInteractionEnabled = false
        UIView.animate(
            withDuration: 0.2,
            delay: 0,
            options: [.beginFromCurrentState, .curveEaseOut],
            animations: {
                wrapper.alpha = 0
                wrapper.transform = CGAffineTransform(translationX: 0, y: 20)
            },
            completion: { _ in completion() }
        )
    }

    // MARK: Material

    /// The three places the iOS 26 material API is touched, plus `applyShape`
    /// below. Everything older — and any future signature change — lands on
    /// the blur fallback, which is the same material system chrome used
    /// before Liquid Glass.

    /// The bar's own slab. Not interactive: `isInteractive` is meant for a
    /// single glass *control*, and on a full-width bar it means a touch
    /// anywhere makes the whole thing do the press highlight, which reads as
    /// a bug rather than as feedback.
    ///
    /// The default `.regular` glass, and that choice is measured rather than
    /// guessed: Instagram's slab over black content lifts the blacks by only
    /// ~+11 luminance while passing white text through at ~94% — a gentle fog
    /// with high transmission, which is what regular glass is. A `.clear`
    /// build of this bar was tried and read as muddy and washed over the
    /// Reels page. The bigger lever on color is the appearance override in
    /// `setStyle` — the material resolves by *trait*, so over a dark page it
    /// must be told to render its dark variant or it stays a light warm fog.
    private static func makeBarEffect() -> UIVisualEffect {
        if #available(iOS 26.0, *) {
            let effect = UIGlassEffect()
            effect.isInteractive = false
            return effect
        }
        return UIBlurEffect(style: .systemChromeMaterial)
    }

    /// The sliding selection. This is the individual control, so this is where
    /// interactive glass belongs — though note the cells sit above it, so the
    /// lens is not the hit-test view and the flag may well be inert. The press
    /// feel is hand-animated in `GlassTabBarContent` for exactly that reason;
    /// if `isInteractive` does fire on device the two simply agree.
    ///
    /// Untinted, deliberately. An earlier pass put the brand rust on the
    /// material at 55% alpha, which read as an opaque painted blob — the least
    /// iOS-26 thing in the bar. Apple's selection indicator is neutral glass
    /// that picks up its colour from whatever is behind it; the brand colour
    /// belongs on the selected *glyph*, which is where it now lives (see
    /// `GlassTabItemView.setSelected`). If neutral reads as too plain on
    /// device, `primary.withAlphaComponent(0.15)` is the ceiling — past that
    /// it stops looking like glass again.
    private static func makeLensEffect() -> UIVisualEffect {
        if #available(iOS 26.0, *) {
            let effect = UIGlassEffect()
            effect.isInteractive = true
            return effect
        }
        // Pre-26 there is no glass at all, so the lens stays what it always
        // was: a soft blurred capsule. `install` paints a neutral fill behind
        // it in that case, since a blur alone over a blur is invisible.
        return UIBlurEffect(style: .systemThinMaterial)
    }

    /// Nil below iOS 26, and never consulted at all under `glassMerge == .none`.
    /// `spacing` is the distance at which nested glass starts to blend.
    private static func makeContainerEffect() -> UIVisualEffect? {
        if #available(iOS 26.0, *) {
            let effect = UIGlassContainerEffect()
            effect.spacing = 12
            return effect
        }
        return nil
    }

    /// Corner shaping, in the one place the choice is made.
    ///
    /// iOS 26 has a real API for it — `cornerConfiguration` — and on that path
    /// the effect view must **not** clip. Clipping is what cut the specular
    /// rim and the ambient shadow off the first version and left it reading as
    /// a frosted rectangle; `layer.cornerRadius` is ignored by glass anyway.
    /// Older systems have no such API and the material is an ordinary blur,
    /// where clipping is the only way to round anything, so they keep the
    /// pre-26 treatment and `GlassSurfaceView` maintains the radius.
    private static func applyShape(to view: GlassSurfaceView, capsule: Bool) {
        view.isCapsule = capsule
        if #available(iOS 26.0, *) {
            view.clipsToBounds = false
            // The flush `bar` variant wants no shaping at all, so it keeps the
            // default configuration — one fewer iOS 26 factory name to get
            // wrong for a shape that is already square.
            if capsule { view.cornerConfiguration = .capsule() }
        } else {
            view.clipsToBounds = true
            view.layer.cornerCurve = .continuous
            view.setNeedsLayout()
        }
    }
}

/// Everything inside the glass: the cells, the gestures, and the positioning
/// of the selection lens (which is a sibling view, owned by `GlassTabBar` —
/// see the hierarchy note there). A UIView subclass so it can re-anchor the
/// lens on a real layout pass — rotation, collapse, safe-area change —
/// without the coordinator having to notice.
///
/// How the lens moves, spelled out because a frame-by-frame capture of the
/// previous pass found three separate faults and all three lived in here:
///
///   * **One animation per transition.** Touch-down no longer moves anything.
///     It used to fly the lens 0.18s to wherever inside the cell the finger
///     happened to land, and the release then sprang it 0.38s to the cell
///     centre — two animations with two different targets. That measured as a
///     stutter at the start of every tap (`+15.5, +2.8, +6.7` points per frame)
///     and as an outright reversal (`+20.1` then `-12.3`) whenever the finger
///     landed on the far side of a cell from its centre. The lens now moves
///     once, on release, unless the touch has actually travelled.
///   * **Distance sets duration.** A fixed `withDuration` gave a four-cell move
///     the same 0.17s as a one-cell move, so long moves read as teleports. The
///     spring's frequency is derived from the distance instead.
///   * **The spring carries the velocity it already had.** `initialSpringVelocity:
///     0` restarted every interrupted move from a dead stop, which is the
///     classic "chases you" feel.
///
/// And the lens stretches on the way, on a tap as well as on a drag — it
/// elongates toward the target, spans both cells around the midpoint, and
/// contracts as it lands. That elongate-and-settle is most of what reads as
/// liquid rather than as a rectangle being translated.
final class GlassTabBarContent: UIView, UIGestureRecognizerDelegate {
    /// #9f3012, the app's `--color-primary`. Duplicated here rather than read
    /// from the page: the bar has to draw before the WebView has told us
    /// anything, and this value is stable brand chrome.
    static let primary = UIColor(red: 0.624, green: 0.188, blue: 0.071, alpha: 1.0)

    /// Inset of the item row inside the glass. Every cell frame has to be
    /// converted out of the stack's space before it can position the lens or
    /// resolve a touch — they differ by exactly this.
    private static let rowInset: CGFloat = 6
    /// How far outside the bar a finger can stray before releasing counts as
    /// an abort rather than a selection. `minimumPressDuration = 0` makes
    /// `allowableMovement` dead, so without this there'd be no way to back out
    /// of a mis-tap — a regression from the plain tap recognizer this replaces.
    private static let cancelBand: CGFloat = 44
    /// How far a touch must travel before it counts as a drag rather than as a
    /// tap. Under this the lens does not move at all, which is the whole fix
    /// for a tap playing two animations against each other.
    private static let dragThreshold: CGFloat = 6

    // Lens geometry, measured off Instagram's pill on the same screen: 223px
    // wide inside a 223.6px cell (full cell width) and 137px tall inside a
    // 187px bar — a horizontal capsule filling the row with ~8pt of breathing
    // room. Explicit rather than derived from the cell, because deriving it
    // once produced a near-square that rounded into a circle blob.
    private static let lensHeight: CGFloat = 46
    private static let lensHeightCompact: CGFloat = 34
    private static let lensWidthRatio: CGFloat = 0.98

    // Move timing, matched to a frame-by-frame capture of Instagram's bar:
    // one-cell tap ≈ 0.25s, longer moves get a visibly longer glide, and the
    // pill lands with zero overshoot. Distance feeds the spring's frequency,
    // so it genuinely changes how long a move takes.
    private static let baseMoveDuration: TimeInterval = 0.25
    private static let perCellDuration: TimeInterval = 0.03
    private static let maxMoveDuration: TimeInterval = 0.45
    /// 0 is critically damped. Instagram's pill shows no overshoot at all —
    /// its centroid moves monotonically and settles with a smooth decel tail —
    /// so bounce stays at zero; even 0.18 read as springy next to it.
    private static let moveBounce: CGFloat = 0

    /// How much wider the lens gets at the midpoint of a move, per cell of
    /// distance travelled, and the ceiling on that. Deliberately a whisper:
    /// Instagram's pill was measured mid-flight at constant width ±5% — the
    /// "spans both cells at the midpoint" elongation this bar used to do
    /// turned out not to exist, and at 0.5/cell it read as un-IG. These
    /// amplitudes stay inside the measured envelope while keeping the
    /// material feeling faintly alive.
    private static let stretchPerCell: CGFloat = 0.06
    private static let maxFlightStretch: CGFloat = 0.12
    /// The pill's touch-down inflation — Instagram's pill grows ~12% on press
    /// and holds it through the drag, deflating only as the release settles.
    private static let pressInflateX: CGFloat = 1.10
    private static let pressInflateY: CGFloat = 1.06
    /// Drag speed (points/second) that produces the full extra drag stretch on
    /// top of the inflation, and how much that is. A whisper, same reasoning
    /// as `stretchPerCell`.
    private static let stretchVelocity: CGFloat = 2400
    private static let maxDragStretch: CGFloat = 0.06
    /// Squeeze on Y as the lens widens, so its area stays roughly constant.
    /// Without this it reads as a box getting wider rather than as a volume
    /// of liquid being pulled.
    private static let areaCompensation: CGFloat = 0.4

    var onSelect: ((String) -> Void)?
    /// Read back from the coordinator, so a touch can be handled differently
    /// while the bar is shrunk.
    var isCollapsed: (() -> Bool)?
    var onRequestExpand: (() -> Void)?

    /// The sliding selection glass. Lives in this view's superview rather than
    /// inside it, so the cells draw on top of it; positioned by frame, so
    /// every write here converts out of this view's space first.
    private weak var lens: GlassSurfaceView?
    private let stack = UIStackView()
    private var itemViews: [GlassTabItemView] = []
    private var items: [GlassTabBar.Item] = []
    /// Nil when no tab owns the current route (/experts, /admin/*) — the bar
    /// still shows, with nothing lit, rather than lying about being on Home.
    private var activeIndex: Int?
    /// Index under the finger mid-drag. The lens follows it live; the route
    /// only changes on release, so a swipe across the bar doesn't fire four
    /// navigations on its way past.
    private var draggingIndex: Int?
    /// Which cell the current touch landed in. Kept separately from
    /// `draggingIndex` because a tap must not count as a drag: this is set on
    /// touch-down, `draggingIndex` only once the finger has actually moved.
    private var touchDownIndex: Int?
    /// Collapsed geometry: shorter bar, shorter lens, labels gone (when there
    /// are labels at all).
    private var compact = false
    /// Last size the lens was anchored against. Guards `layoutSubviews` from
    /// re-snapping it mid-flight — `moveLens` calls `layoutIfNeeded()`, and
    /// without this the snap would land the lens on its target before the
    /// animation ever started, so nothing moved.
    private var lastBounds: CGRect = .zero
    private let dragFeedback = UISelectionFeedbackGenerator()

    // Live drag state.
    private var isDragging = false
    /// False until the touch has travelled `dragThreshold`. Everything that
    /// distinguishes a drag from a tap — moving the lens, the haptic, spinning
    /// up the Taptic Engine at all — hangs off this.
    private var hasMoved = false
    private var touchStartX: CGFloat = 0
    /// Where the lens is being held, in this view's space. Nil when not
    /// dragging.
    private var dragCenterX: CGFloat?
    private var lastDragX: CGFloat = 0
    private var lastDragTime: CFTimeInterval = 0
    private var dragVelocity: CGFloat = 0
    /// Set when the touch that began was spent expanding a collapsed bar. It
    /// must not also select, and neither must its release.
    private var swallowedForExpand = false

    // Settle flight: the animator that moves the lens, and the display link
    // that stretches it and samples its speed while it does.
    private var lensAnimator: UIViewPropertyAnimator?
    /// Bumped by every move, so a completion that has been overtaken knows to
    /// leave the current animator alone.
    private var flightGeneration = 0
    /// Retains `self` while it runs, which is why every exit path invalidates
    /// it — and why `onFlightTick` bails the moment the lens is gone.
    private var flightLink: CADisplayLink?
    private var flightStart: CFTimeInterval = 0
    private var flightDuration: CFTimeInterval = 0
    private var flightAmplitude: CGFloat = 0
    /// Stretch the lens already had when the flight began — a drag's release
    /// hands its press inflation over. Decays linearly across the flight so
    /// the first frame doesn't snap an inflated lens back to 1.0. X and Y
    /// kept separately; see `startFlight`.
    private var flightResidual: CGFloat = 0
    private var flightResidualY: CGFloat = 0
    private var flightVelocity: CGFloat = 0
    private var lastFlightX: CGFloat = 0
    private var lastFlightTime: CFTimeInterval = 0

    override init(frame: CGRect) {
        super.init(frame: frame)
        backgroundColor = .clear

        stack.axis = .horizontal
        stack.distribution = .fillEqually
        stack.alignment = .fill
        stack.translatesAutoresizingMaskIntoConstraints = false
        addSubview(stack)
        NSLayoutConstraint.activate([
            stack.topAnchor.constraint(equalTo: topAnchor),
            stack.bottomAnchor.constraint(equalTo: bottomAnchor),
            stack.leadingAnchor.constraint(equalTo: leadingAnchor, constant: Self.rowInset),
            stack.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -Self.rowInset),
        ])

        // One recognizer over the whole bar, rather than five buttons: buttons
        // would have to fight it for the touch, and dragging along the bar is
        // half the point.
        //
        // A long press with `minimumPressDuration = 0` rather than a tap plus
        // a pan. A pan doesn't reach `.began` until roughly 10pt of movement,
        // so the first third of a short drag did nothing and the lens then
        // jumped to catch up; this fires on touch-down, and handles the plain
        // tap as a began-and-ended at the same point, so there's no second
        // recognizer to arbitrate with.
        let drag = UILongPressGestureRecognizer(target: self, action: #selector(handleDrag(_:)))
        drag.minimumPressDuration = 0
        drag.numberOfTouchesRequired = 1
        drag.cancelsTouchesInView = false
        drag.delegate = self
        addGestureRecognizer(drag)
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    deinit {
        flightLink?.invalidate()
    }

    /// Interactive glass does its own touch handling; don't starve it.
    func gestureRecognizer(
        _ gestureRecognizer: UIGestureRecognizer,
        shouldRecognizeSimultaneouslyWith other: UIGestureRecognizer
    ) -> Bool {
        true
    }

    // MARK: Lens

    func attachLens(_ view: GlassSurfaceView) {
        lens = view
        // The lens's coordinate space just changed under us; force a
        // re-anchor on the next layout pass rather than trusting a stale size.
        lastBounds = .zero
        setNeedsLayout()
    }

    /// Move the lens to a rect expressed in *this* view's space. Writes
    /// `bounds` and `center` rather than `frame` because the stretch applies a
    /// transform, and `frame` is derived from the transform rather than
    /// independent of it.
    private func setLens(rect: CGRect) {
        guard let lens, let host = lens.superview else { return }
        let target = convert(rect, to: host)
        lens.bounds = CGRect(origin: .zero, size: target.size)
        lens.center = CGPoint(x: target.midX, y: target.midY)
    }

    /// Put the lens back where the current state says it belongs — on the
    /// active cell, or under the finger if a drag is live. Safe to call inside
    /// an animation block; the coordinator does exactly that while the bar
    /// collapses.
    ///
    /// Any flight in progress is aimed at a rect that a size change has just
    /// invalidated, so it is stopped rather than left to land somewhere stale.
    func reanchor() {
        stopFlight()
        if isDragging, hasMoved, let x = dragCenterX, let index = draggingIndex {
            guard var rect = selectionFrame(for: index) else { return }
            rect.origin.x = x - rect.width / 2
            setLens(rect: rect)
            return
        }
        guard let index = activeIndex, let rect = selectionFrame(for: index) else { return }
        setLens(rect: rect)
        lens?.alpha = 1
    }

    // MARK: Items

    func setItems(_ items: [GlassTabBar.Item], activePath: String?) {
        self.items = items
        itemViews.forEach { stack.removeArrangedSubview($0); $0.removeFromSuperview() }
        itemViews = items.enumerated().map { entry in
            let (index, item) = entry
            let view = GlassTabItemView(frame: .zero)
            view.configure(item: item, selected: false, tint: Self.primary)
            view.setLabelHidden(compact, animated: false)
            // VoiceOver's double-tap doesn't reach a gesture recognizer on the
            // parent, and the cells have interaction turned off so the drag
            // recognizer can own every touch. Without this route the tab bar
            // simply could not be operated with VoiceOver on.
            view.onActivate = { [weak self] in self?.commit(index: index) }
            stack.addArrangedSubview(view)
            return view
        }
        // Force a re-anchor on the next layout pass: the cells are new.
        lastBounds = .zero
        applySelection(index: items.firstIndex(where: { $0.path == activePath }), animated: false)
    }

    /// No same-index early return, deliberately: JS re-asserts the selection
    /// on every route change as a self-heal for desyncs (a capture showed
    /// Search lit while resting on Home), and the re-assert has to actually
    /// re-apply. It's cheap — `setSelected` early-returns per cell and
    /// `moveLens` no-ops under half a point of travel.
    func setActive(path: String, animated: Bool) {
        applySelection(index: items.firstIndex(where: { $0.path == path }), animated: animated)
    }

    /// Collapsed geometry. Named for what it does rather than for the labels,
    /// which are off by default now — it also drives the lens's height.
    func setCompact(_ next: Bool, animated: Bool) {
        guard next != compact else { return }
        compact = next
        itemViews.forEach { $0.setLabelHidden(next, animated: animated) }
    }

    /// `index` is optional because several routes show a tab bar without any
    /// tab owning them. Passing nil deselects everything and fades the lens
    /// out, which is honest; the previous behaviour was to leave whichever tab
    /// was last lit still lit, on a page it had nothing to do with.
    private func applySelection(index: Int?, animated: Bool, velocity: CGFloat = 0) {
        activeIndex = index
        guard let index else {
            stopFlight()
            highlight(index: nil, animated: animated)
            relaxStretch()
            guard let lens else { return }
            if animated {
                UIView.animate(withDuration: 0.2, delay: 0, options: [.beginFromCurrentState]) {
                    lens.alpha = 0
                }
            } else {
                lens.alpha = 0
            }
            return
        }
        moveLens(to: index, animated: animated, velocity: velocity)
        highlight(index: index, animated: animated)
    }

    /// Immediate, both directions. An earlier pass delayed the incoming fill
    /// until the lens was halfway there, which measured on video as ~9 frames
    /// of *no* tab selected on every tap — a blink Instagram never shows,
    /// because with no accent colour the outline→fill swap under the pill is
    /// quiet enough to just happen. Only the cells whose state actually
    /// changes animate — `setSelected` early-returns otherwise, which is what
    /// stopped a drag stacking `.replace.offUp` transitions on one image view
    /// until a glyph disappeared entirely between two of them.
    private func highlight(index: Int?, animated: Bool) {
        for (i, view) in itemViews.enumerated() {
            view.setSelected(i == index, animated: animated)
        }
    }

    /// Fly the lens to `index`. Returns the nominal duration of the move, or 0
    /// if it didn't animate.
    ///
    /// Interruptible: an in-flight move is stopped where it is *drawn* rather
    /// than where it was headed, and the speed it had is carried into the
    /// replacement, so re-tapping mid-move continues the motion instead of
    /// restarting it from a standstill.
    @discardableResult
    private func moveLens(to index: Int, animated: Bool, velocity: CGFloat = 0) -> TimeInterval {
        guard index >= 0, index < itemViews.count, let lens else { return 0 }
        layoutIfNeeded()
        guard let target = selectionFrame(for: index) else { return 0 }
        // Whatever was in flight is now aimed at the wrong place. Stopping it
        // writes its presentation values back, so `lens.center` below is where
        // the lens is actually drawn.
        let carried = stopFlight()

        guard animated else {
            setLens(rect: target)
            lens.alpha = 1
            relaxStretch()
            return 0
        }
        if lens.alpha < 0.5 {
            // Coming back from a route no tab owned. Appear where it belongs
            // rather than flying in from wherever the lens was last parked.
            relaxStretch()
            setLens(rect: target)
            lens.alpha = 0
            UIView.animate(withDuration: 0.2, delay: 0, options: [.beginFromCurrentState]) { lens.alpha = 1 }
            return 0
        }
        if glassReduceMotion {
            // Still a move, just a plain one: no spring, no overshoot, no
            // stretch. A jump cut would be a worse answer to Reduce Motion
            // than a short linear slide.
            relaxStretch()
            UIView.animate(withDuration: 0.2, delay: 0, options: [.beginFromCurrentState]) {
                self.setLens(rect: target)
                lens.alpha = 1
            }
            return 0
        }

        let host = lens.superview
        let currentX = host.map { convert(lens.center, from: $0).x } ?? target.midX
        let remaining = target.midX - currentX
        guard abs(remaining) > 0.5 else {
            setLens(rect: target)
            lens.alpha = 1
            relaxStretch()
            return 0
        }

        let apply = {
            self.setLens(rect: target)
            lens.alpha = 1
        }

        let cells = abs(remaining) / max(cellWidth, 1)
        let duration = min(Self.maxMoveDuration, Self.baseMoveDuration + TimeInterval(cells) * Self.perCellDuration)
        // UIKit wants the seed as a fraction of the remaining distance per
        // second, not as points per second — feeding it raw points launches the
        // lens clean off screen. The sign is kept rather than taken as a
        // magnitude: a negative ratio is the honest description of a lens still
        // travelling away from where it now has to go.
        let seed = velocity != 0 ? velocity : carried
        let normalized = max(-20, min(20, seed / remaining))

        let animator = UIViewPropertyAnimator(
            duration: duration,
            timingParameters: Self.spring(duration: duration, bounce: Self.moveBounce, velocity: normalized)
        )
        animator.isInterruptible = true
        animator.addAnimations(apply)
        // Generation rather than capturing `animator` to compare against: the
        // completion block is stored *on* the animator, so capturing it there
        // would be a retain cycle for as long as the block lives.
        flightGeneration += 1
        let generation = flightGeneration
        animator.addCompletion { [weak self] _ in
            guard let self, self.flightGeneration == generation else { return }
            self.lensAnimator = nil
        }
        lensAnimator = animator
        startFlight(duration: duration, cells: cells)
        animator.startAnimation()
        return duration
    }

    /// `UISpringTimingParameters(duration:bounce:initialVelocity:)` is iOS 17,
    /// and this file targets 15 — so the same spring is expressed in the
    /// mass/stiffness/damping form that has existed since iOS 10, using
    /// Apple's own mapping: ω = 2π/duration, ζ = 1 − bounce, and with unit mass
    /// that is stiffness = ω² and damping = 2ζω. One code path, no availability
    /// branch, and the physical parameters are what actually set the timing
    /// (a spring-timed animator ignores the `duration:` it is handed).
    private static func spring(duration: TimeInterval, bounce: CGFloat, velocity: CGFloat) -> UISpringTimingParameters {
        let omega = 2 * CGFloat.pi / CGFloat(max(duration, 0.05))
        let zeta = max(0.1, min(1, 1 - bounce))
        return UISpringTimingParameters(
            mass: 1,
            stiffness: omega * omega,
            damping: 2 * zeta * omega,
            initialVelocity: CGVector(dx: velocity, dy: 0)
        )
    }

    // MARK: Flight (stretch + velocity sampling)

    /// Runs for the length of a move. It does two jobs the animator can't: it
    /// stretches the lens on a curve that peaks mid-flight, and it samples the
    /// presentation layer so an interruption knows how fast the lens was
    /// actually going.
    private func startFlight(duration: TimeInterval, cells: CGFloat) {
        guard !glassReduceMotion, let lens else { return }
        flightStart = CACurrentMediaTime()
        flightDuration = duration
        flightAmplitude = min(Self.maxFlightStretch, cells * Self.stretchPerCell)
        flightResidual = lens.transform.a - 1
        // Y tracked separately: the press inflation *grows* Y (1.06) while the
        // arc's area compensation *shrinks* it, so deriving Y from X would pop
        // the pill from 1.06 to ~0.96 on the release frame.
        flightResidualY = lens.transform.d - 1
        flightVelocity = 0
        // Seeded in the lens's *own* space, the same space `onFlightTick`
        // samples in — not the caller's content space, which is only the same
        // view in two of the three `glassMerge` layouts. The animator hasn't
        // started yet, so `center` is still the position it is leaving.
        lastFlightX = lens.center.x
        lastFlightTime = flightStart
        flightLink?.invalidate()
        let link = CADisplayLink(target: self, selector: #selector(onFlightTick))
        link.add(to: .main, forMode: .common)
        flightLink = link
    }

    @objc private func onFlightTick() {
        guard let lens else {
            stopFlightLink()
            return
        }
        let now = CACurrentMediaTime()
        // The presentation layer, not the model value: the model already holds
        // the destination the moment the animator starts.
        let drawnX = lens.layer.presentation()?.position.x ?? lens.center.x
        let dt = now - lastFlightTime
        if dt > 0 {
            let sample = (drawnX - lastFlightX) / CGFloat(dt)
            // Low-passed, or one dropped frame would report a wild speed to
            // whatever interrupts next.
            flightVelocity = flightVelocity * 0.6 + sample * 0.4
        }
        lastFlightX = drawnX
        lastFlightTime = now

        let t = flightDuration > 0 ? min(1, (now - flightStart) / flightDuration) : 1
        // Elongate toward the target and contract as it lands, plus whatever
        // stretch a drag handed over, decaying linearly.
        let arc = flightAmplitude * CGFloat(sin(Double.pi * t))
        let fade = CGFloat(1 - t)
        let scaleX = 1 + flightResidual * fade + arc
        let scaleY = 1 + flightResidualY * fade - arc * Self.areaCompensation
        lens.transform = CGAffineTransform(scaleX: scaleX, y: scaleY)
        guard t >= 1 else { return }
        lens.transform = .identity
        stopFlightLink()
    }

    private func stopFlightLink() {
        flightLink?.invalidate()
        flightLink = nil
    }

    /// Stop any move in progress, leaving the lens exactly where it is drawn,
    /// and hand back the speed it had so the next move can continue from it.
    @discardableResult
    private func stopFlight() -> CGFloat {
        stopFlightLink()
        guard let animator = lensAnimator else { return 0 }
        lensAnimator = nil
        // `stopAnimation(true)` writes the presentation values back to the
        // model, so the lens keeps its visible position. The animator then has
        // to be finished explicitly or it stays parked in `.stopped`.
        animator.stopAnimation(true)
        if animator.state == .stopped { animator.finishAnimation(at: .current) }
        return flightVelocity
    }

    // MARK: Geometry

    /// Width of one cell, in this view's space — the unit both the move
    /// duration and the stretch amplitude are expressed in.
    private var cellWidth: CGFloat {
        guard let first = itemViews.first else { return bounds.width }
        let width = first.convert(first.bounds, to: self).width
        return width > 1 ? width : bounds.width
    }

    /// The lens rect for a cell, in this view's space. Explicit width and
    /// height rather than the inset cell it used to be: insetting a 64pt-tall
    /// cell produced a 62×52 near-square that rounded to a circle, where a tab
    /// bar's selection is a horizontal capsule. Nil before the first real
    /// layout, when every frame is still zero.
    private func selectionFrame(for index: Int) -> CGRect? {
        guard index >= 0, index < itemViews.count else { return nil }
        let view = itemViews[index]
        let cell = view.convert(view.bounds, to: self)
        guard cell.width > 1, cell.height > 1 else { return nil }
        let width = cell.width * Self.lensWidthRatio
        let height = min(compact ? Self.lensHeightCompact : Self.lensHeight, cell.height - 6)
        // Centred on the glyph rather than on the cell. With labels showing the
        // icon sits above the cell's centre, and a lens centred on the cell
        // would hang below it; with labels off the two coincide.
        let centre = view.iconCenter(in: self)
        return CGRect(x: centre.x - width / 2, y: centre.y - height / 2, width: width, height: height)
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        // Only on a genuine size change. Called on every `layoutIfNeeded()`
        // otherwise, which would pre-empt the move.
        guard bounds != lastBounds else { return }
        lastBounds = bounds
        reanchor()
    }

    // MARK: Gestures

    /// Which tab a touch at `x` (in this view's space) belongs to. Clamps
    /// past either end, so a drag that overshoots the bar lands on the
    /// outermost tab instead of losing the selection.
    private func index(atX x: CGFloat) -> Int? {
        guard !itemViews.isEmpty else { return nil }
        for (i, view) in itemViews.enumerated() {
            let cell = view.convert(view.bounds, to: self)
            if cell.minX <= x && x < cell.maxX { return i }
        }
        let firstMinX = itemViews[0].convert(itemViews[0].bounds, to: self).minX
        return x < firstMinX ? 0 : itemViews.count - 1
    }

    /// Both the touch and the cell centres it clamps against are read in this
    /// view's space, and the single conversion happens in `setLens`. Mixing
    /// the two spaces works only while the bar fills its parent exactly —
    /// which a glass container with `spacing` actively invites you to change.
    private func clampedCenterX(_ x: CGFloat) -> CGFloat {
        guard let first = itemViews.first, let last = itemViews.last else { return x }
        let low = first.convert(first.bounds, to: self).midX
        let high = last.convert(last.bounds, to: self).midX
        return min(max(x, low), high)
    }

    @objc private func handleDrag(_ gesture: UILongPressGestureRecognizer) {
        let point = gesture.location(in: self)
        switch gesture.state {
        case .began:
            // On a shrunk bar the first touch brings it back and does nothing
            // else — the iOS 26 behaviour, and the other half of the fix for a
            // bar that could previously stay collapsed indefinitely.
            if isCollapsed?() == true {
                swallowedForExpand = true
                onRequestExpand?()
                return
            }
            swallowedForExpand = false
            beginDrag(at: point.x)
        case .changed:
            guard !swallowedForExpand else { return }
            updateDrag(to: point.x)
        case .ended:
            guard !swallowedForExpand else {
                swallowedForExpand = false
                return
            }
            endDrag(at: point, cancelled: false)
        case .cancelled, .failed:
            swallowedForExpand = false
            endDrag(at: point, cancelled: true)
        default:
            break
        }
    }

    /// Touch-down. Deliberately moves nothing: a tap must produce exactly one
    /// animation, the settle on release. This used to fly the lens to the
    /// finger, which the release then had to correct — two animations with
    /// different targets, and the stutter and reversal that showed up in every
    /// frame-by-frame capture of a plain tap.
    ///
    /// It doesn't fill the glyph either, and it doesn't prepare the haptic
    /// engine; both wait until the touch has proved itself a drag.
    private func beginDrag(at x: CGFloat) {
        isDragging = true
        hasMoved = false
        touchStartX = x
        dragVelocity = 0
        lastDragX = x
        lastDragTime = CACurrentMediaTime()
        draggingIndex = nil
        dragCenterX = nil
        touchDownIndex = index(atX: x)
        // The one thing that does happen on touch-down: the pill inflates a
        // little under the finger — measured off Instagram, whose pill grows
        // ~12% on touch and stays inflated until the release settles. It's a
        // transform, not a position, so the one-animation-per-tap rule holds.
        // (An earlier pass scaled the tapped *icon* instead; Instagram's
        // icons never move.)
        guard let lens, !glassReduceMotion, lens.alpha > 0.5 else { return }
        UIView.animate(withDuration: 0.18, delay: 0, options: [.beginFromCurrentState, .allowUserInteraction, .curveEaseOut]) {
            lens.transform = CGAffineTransform(scaleX: Self.pressInflateX, y: Self.pressInflateY)
        }
    }

    private func updateDrag(to x: CGFloat) {
        guard isDragging else { return }
        let now = CACurrentMediaTime()

        if !hasMoved {
            guard abs(x - touchStartX) >= Self.dragThreshold else { return }
            hasMoved = true
            // Now, not on touch-down: spinning up the Taptic Engine for every
            // tap is how you get a thud on a gesture that should be silent.
            dragFeedback.prepare()
            draggingIndex = touchDownIndex ?? index(atX: x)
            // Take the lens over from wherever a settle left it, at the speed
            // it was going, so the handover has no seam.
            dragVelocity = stopFlight()
            lastDragX = x
            lastDragTime = now
        }

        let elapsed = max(now - lastDragTime, 1.0 / 240.0)
        let raw = (x - lastDragX) / CGFloat(elapsed)
        // Low-passed, or the per-frame jitter in a slow drag would make the
        // stretch flicker.
        dragVelocity = dragVelocity * 0.7 + raw * 0.3
        lastDragX = x
        lastDragTime = now

        let centerX = clampedCenterX(x)
        dragCenterX = centerX
        let hovered = index(atX: x)
        if let hovered, hovered != draggingIndex {
            // Tick as the selection crosses into a new tab — the feedback is
            // most of what makes the drag feel physical rather than like a
            // rectangle following a finger. Crossings only exist once the
            // touch has moved, so a tap can never reach this.
            dragFeedback.selectionChanged()
            dragFeedback.prepare()
            draggingIndex = hovered
            // No fill delay mid-drag: the glyph should light as the lens
            // passes over it, not half a move later.
            highlight(index: hovered, animated: true)
        }
        // Written directly, with no animation: this is what makes the lens
        // track the finger instead of chasing it through a queue of springs.
        guard let index = draggingIndex, var rect = selectionFrame(for: index) else { return }
        rect.origin.x = centerX - rect.width / 2
        setLens(rect: rect)
        applyDragStretch()
    }

    /// The pill's transform while the finger is down and moving: the press
    /// inflation as the base, plus a whisper of speed-proportional stretch.
    /// Written directly every frame — for the first ~0.18s this overlaps the
    /// touch-down inflate animation, which UIKit resolves by finishing that
    /// animation over these writes; both target the same base scale, so the
    /// seam is invisible. The settle flight picks the transform up from here
    /// on release (`flightResidual`), so the two never fight over it.
    private func applyDragStretch() {
        guard let lens, !glassReduceMotion else { return }
        let speed = min(abs(dragVelocity), Self.stretchVelocity)
        let extra = (speed / Self.stretchVelocity) * Self.maxDragStretch
        lens.transform = CGAffineTransform(scaleX: Self.pressInflateX + extra, y: Self.pressInflateY - extra * Self.areaCompensation)
    }

    /// Let the stretch settle back to a plain capsule. Only for the releases
    /// that start no flight — a stray release, a release on the cell it began
    /// on, or a route no tab owns. Everywhere else the flight's own curve
    /// carries the stretch home, and animating it here would be two things
    /// writing the same transform.
    private func relaxStretch() {
        guard let lens, lens.transform != .identity else { return }
        guard !glassReduceMotion else {
            lens.transform = .identity
            return
        }
        UIView.animate(
            withDuration: 0.32,
            delay: 0,
            usingSpringWithDamping: 0.7,
            initialSpringVelocity: 0,
            options: [.beginFromCurrentState, .allowUserInteraction],
            animations: { lens.transform = .identity }
        )
    }

    private func endDrag(at point: CGPoint, cancelled: Bool) {
        // A tap never set `draggingIndex`, so the cell it landed in is what
        // it selects.
        let index = draggingIndex ?? touchDownIndex
        // Released well clear of the bar: treat it as backing out, the way
        // sliding off a button before lifting has always worked.
        let strayed = point.y < -Self.cancelBand || point.y > bounds.height + Self.cancelBand
        let releaseVelocity = hasMoved ? dragVelocity : 0
        isDragging = false
        hasMoved = false
        dragCenterX = nil
        draggingIndex = nil
        touchDownIndex = nil
        dragVelocity = 0
        guard !cancelled, !strayed, let index else {
            // Put the selection back where the route actually is, carrying the
            // speed the finger had. A negative seed is correct here and the
            // spring handles it: on a stray release the lens is usually still
            // travelling away from where it has to end up.
            applySelection(index: activeIndex, animated: true, velocity: releaseVelocity)
            return
        }
        commit(index: index, velocity: releaseVelocity)
    }

    /// No haptic here, on purpose. Neither Instagram's tab bar nor Apple's own
    /// UITabBar fires one on selection, and the impact this used to play landed
    /// on top of the drag's last crossing tick as a double thud. Crossings
    /// still tick; arriving does not.
    private func commit(index: Int, velocity: CGFloat = 0) {
        guard index >= 0, index < items.count else { return }
        let alreadyActive = index == activeIndex
        applySelection(index: index, animated: true, velocity: velocity)
        // After applySelection, so the bounce plays on the already-filled
        // glyph rather than on the outline it's about to replace.
        itemViews[index].playSelectionBounce()
        // Re-tapping the current tab is a no-op for the router, but the
        // selection animation above still plays, which is the right feedback.
        guard !alreadyActive else { return }
        onSelect?(items[index].path)
    }
}

/// One tab: a symbol (or an avatar circle), optionally over a label.
///
/// Metrics are measured off Instagram's bar, not tuned by eye: a constant
/// 22pt `.medium` symbol (IG's glyphs are 22pt with a ~2.2pt stroke), the
/// same colour selected and unselected, both states full-strength `.label`.
/// Selection is carried by the outline→fill swap and the sliding pill —
/// there is no accent colour anywhere in Instagram's bar, and the rust
/// accent this used to paint was one of the louder tells.
final class GlassTabItemView: UIView {
    private static let iconPointSize: CGFloat = 22
    private static let stackSpacing: CGFloat = 2
    /// The avatar circle (profile tab). 24pt, a hair bigger than the glyphs,
    /// exactly as Instagram draws its profile photo relative to its icons.
    private static let avatarSize: CGFloat = 24
    private static let ringWidth: CGFloat = 2
    /// Instagram's tab bar has no labels, and that is what lets it be 50pt tall
    /// with a wide capsule lens instead of a nearly-square one. Apple's own
    /// apps do label theirs, so this is a style choice rather than a
    /// correctness one — one line to reverse, and `Metrics.expandedHeight`
    /// wants to go back to 64 with it. VoiceOver reads `accessibilityLabel`
    /// either way, so nothing is lost by hiding them visually.
    static let showsLabels = false

    private let icon = UIImageView()
    private let title = UILabel()
    private let stack = UIStackView()
    /// Instagram's fifth tab is *the user*, not a person glyph. This app's
    /// mark for the user is an initial in a tinted circle (see the profile
    /// page), so that's what an avatar item draws — or a fetched photo, if
    /// the data model ever grows one. Selected state is a `.label` ring, the
    /// same tell IG uses on its avatar tab.
    private let avatar = UIView()
    private let avatarLabel = UILabel()
    private let avatarImage = UIImageView()
    /// One shared cache so a bar reinstall (route bounce, theme flip) never
    /// refetches the photo.
    private static let avatarCache = NSCache<NSString, UIImage>()
    private var stackCenterY: NSLayoutConstraint?
    private var item: GlassTabBar.Item?
    private var tint: UIColor = .label
    /// Nil until the first `setSelected`, so the first call always applies.
    /// Its whole job is the early-return below.
    private var selected: Bool?

    /// VoiceOver's way in. See `setItems`.
    var onActivate: (() -> Void)?

    override init(frame: CGRect) {
        super.init(frame: frame)
        // Touches belong to the bar's own drag recognizer.
        isUserInteractionEnabled = false
        isAccessibilityElement = true
        accessibilityTraits = .button

        icon.contentMode = .center
        icon.setContentHuggingPriority(.required, for: .vertical)

        avatar.isHidden = true
        avatar.layer.cornerRadius = Self.avatarSize / 2
        avatar.clipsToBounds = false
        avatarLabel.font = .systemFont(ofSize: 13, weight: .bold)
        avatarLabel.textAlignment = .center
        avatarImage.contentMode = .scaleAspectFill
        avatarImage.layer.cornerRadius = Self.avatarSize / 2
        avatarImage.clipsToBounds = true
        avatarImage.isHidden = true
        avatar.addSubview(avatarLabel)
        avatar.addSubview(avatarImage)
        avatarLabel.translatesAutoresizingMaskIntoConstraints = false
        avatarImage.translatesAutoresizingMaskIntoConstraints = false
        avatar.translatesAutoresizingMaskIntoConstraints = false

        title.font = .systemFont(ofSize: 10, weight: .medium)
        title.textAlignment = .center
        title.adjustsFontSizeToFitWidth = true
        title.minimumScaleFactor = 0.8

        // A real centred stack, rather than the icon hanging off a magic -7
        // offset with the label constrained beneath it. That offset left the
        // block optically off-centre, and visibly so once the label faded on
        // collapse — at 48pt the icon sat high with dead space under it.
        stack.axis = .vertical
        stack.alignment = .center
        stack.spacing = Self.stackSpacing
        stack.translatesAutoresizingMaskIntoConstraints = false
        stack.addArrangedSubview(icon)
        stack.addArrangedSubview(avatar)
        if Self.showsLabels { stack.addArrangedSubview(title) }
        addSubview(stack)

        let centerY = stack.centerYAnchor.constraint(equalTo: centerYAnchor)
        stackCenterY = centerY
        var constraints = [
            stack.centerXAnchor.constraint(equalTo: centerXAnchor), centerY,
            avatar.widthAnchor.constraint(equalToConstant: Self.avatarSize),
            avatar.heightAnchor.constraint(equalToConstant: Self.avatarSize),
            avatarLabel.centerXAnchor.constraint(equalTo: avatar.centerXAnchor),
            avatarLabel.centerYAnchor.constraint(equalTo: avatar.centerYAnchor),
            avatarImage.topAnchor.constraint(equalTo: avatar.topAnchor),
            avatarImage.bottomAnchor.constraint(equalTo: avatar.bottomAnchor),
            avatarImage.leadingAnchor.constraint(equalTo: avatar.leadingAnchor),
            avatarImage.trailingAnchor.constraint(equalTo: avatar.trailingAnchor),
        ]
        // Only when the label is actually in the hierarchy: with `showsLabels`
        // off it has no superview, and a constraint between it and `self` has
        // no common ancestor to resolve against — which traps on activation
        // rather than being quietly ignored.
        if Self.showsLabels {
            constraints.append(title.widthAnchor.constraint(lessThanOrEqualTo: widthAnchor, constant: -4))
        }
        NSLayoutConstraint.activate(constraints)
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    func configure(item: GlassTabBar.Item, selected: Bool, tint: UIColor) {
        self.item = item
        self.tint = tint
        title.text = item.label
        accessibilityLabel = item.label
        let isAvatar = item.avatarInitial != nil || item.avatarUrl != nil
        avatar.isHidden = !isAvatar
        icon.isHidden = isAvatar
        if isAvatar {
            avatar.backgroundColor = tint.withAlphaComponent(0.25)
            avatarLabel.text = item.avatarInitial.map { String($0.prefix(1)).uppercased() }
            avatarLabel.textColor = .label
            loadAvatarIfNeeded(url: item.avatarUrl)
        }
        // The symbol and the tint both just changed, so the state cache has to
        // go or `setSelected` would early-return on a stale match.
        self.selected = nil
        setSelected(selected, animated: false)
    }

    /// Photo over initial, when the data model has one. Fetched once per URL
    /// per process; the initial-circle stays until it lands and on any failure.
    private func loadAvatarIfNeeded(url: String?) {
        avatarImage.isHidden = true
        avatarImage.image = nil
        guard let url, let parsed = URL(string: url) else { return }
        let key = url as NSString
        if let cached = Self.avatarCache.object(forKey: key) {
            avatarImage.image = cached
            avatarImage.isHidden = false
            return
        }
        URLSession.shared.dataTask(with: parsed) { [weak self] data, _, _ in
            guard let data, let image = UIImage(data: data) else { return }
            Self.avatarCache.setObject(image, forKey: key)
            DispatchQueue.main.async {
                guard let self, self.item?.avatarUrl == url else { return }
                self.avatarImage.image = image
                self.avatarImage.isHidden = false
            }
        }.resume()
    }

    /// Where the glyph actually sits, which is the cell's centre only when the
    /// labels are off. The lens centres on this so it stays a horizontal
    /// capsule around the icon either way.
    func iconCenter(in view: UIView) -> CGPoint {
        let mark: UIView = avatar.isHidden ? icon : avatar
        let rect = mark.convert(mark.bounds, to: view)
        guard rect.width > 0, rect.height > 0 else {
            let cell = convert(bounds, to: view)
            return CGPoint(x: cell.midX, y: cell.midY)
        }
        return CGPoint(x: rect.midX, y: rect.midY)
    }

    /// VoiceOver sends this on a double-tap. Returning true stops UIKit
    /// synthesising a touch that the bar's recognizer wouldn't act on anyway.
    override func accessibilityActivate() -> Bool {
        guard let onActivate else { return false }
        onActivate()
        return true
    }

    /// The early return is load-bearing, not an optimisation. `highlight`
    /// used to call this on all five cells on every drag crossing, which
    /// restarted a `.replace.offUp` transition on each of them; that
    /// transition has a phase where the outgoing glyph has lifted and the
    /// incoming one hasn't landed, so overlapping two of them left a cell
    /// visibly empty — the blank lens caught mid-transition in the recording.
    func setSelected(_ next: Bool, animated: Bool) {
        guard let item, selected != next else { return }
        selected = next
        accessibilityTraits = next ? [.button, .selected] : [.button]
        // Both states are full-strength `.label` — white over dark chrome,
        // black over light — exactly as Instagram draws every glyph. The
        // earlier `.secondaryLabel` / 75%-alpha dimming washed the unselected
        // row out, and the rust tint on the selected one was the loudest
        // not-Instagram thing in the bar. Selection reads from the pill and
        // the fill alone.
        icon.tintColor = .label
        title.textColor = .label
        if !avatar.isHidden {
            updateAvatarRing()
            return
        }
        let name = next ? (item.selectedSymbol ?? item.symbol) : item.symbol
        let config = UIImage.SymbolConfiguration(pointSize: Self.iconPointSize, weight: .medium)
        // A symbol name that doesn't resolve yields nil, which would leave a
        // blank tab. Fall back through the unfilled name to a shape that
        // always exists, so a typo costs an icon and not the whole bar.
        let image = UIImage(systemName: name, withConfiguration: config)
            ?? UIImage(systemName: item.symbol, withConfiguration: config)
            ?? UIImage(systemName: "circle", withConfiguration: config)
        setIcon(image, animated: animated)
    }

    /// The selected-avatar ring. `borderColor` is a CGColor, which does not
    /// re-resolve when the trait flips (dark pages force dark chrome), so
    /// `traitCollectionDidChange` below re-applies it.
    private func updateAvatarRing() {
        avatar.layer.borderWidth = selected == true ? Self.ringWidth : 0
        avatar.layer.borderColor = UIColor.label.resolvedColor(with: traitCollection).cgColor
    }

    override func traitCollectionDidChange(_ previousTraitCollection: UITraitCollection?) {
        super.traitCollectionDidChange(previousTraitCollection)
        if !avatar.isHidden { updateAvatarRing() }
    }

    private func setIcon(_ image: UIImage?, animated: Bool) {
        guard let image else {
            icon.image = nil
            return
        }
        guard animated, !glassReduceMotion else {
            icon.image = image
            return
        }
        if #available(iOS 17.0, *) {
            // The purpose-built symbol swap: the outline lifts away as the
            // fill arrives, instead of the two ghosting through each other
            // the way a generic cross-dissolve leaves them.
            icon.setSymbolImage(image, contentTransition: .replace.offUp)
        } else {
            UIView.transition(with: icon, duration: 0.18, options: [.transitionCrossDissolve, .allowUserInteraction]) {
                self.icon.image = image
            }
        }
    }

    /// Fired on commit only — not on every `setSelected`, or it would also go
    /// off for each tab a drag passes over.
    func playSelectionBounce() {
        guard !glassReduceMotion else { return }
        if avatar.isHidden {
            if #available(iOS 17.0, *) {
                icon.addSymbolEffect(.bounce.down, options: .nonRepeating)
            }
            return
        }
        // The avatar circle is not a symbol, so it gets the same dip by hand.
        UIView.animate(withDuration: 0.12, delay: 0, options: [.beginFromCurrentState, .curveEaseOut], animations: {
            self.avatar.transform = CGAffineTransform(translationX: 0, y: 2)
        }, completion: { _ in
            UIView.animate(withDuration: 0.2, delay: 0, options: [.beginFromCurrentState, .curveEaseOut]) {
                self.avatar.transform = .identity
            }
        })
    }


    func setLabelHidden(_ hidden: Bool, animated: Bool) {
        guard Self.showsLabels else { return }
        // The stack stays one centred block, so fading the label out would
        // leave the icon sitting high in a short bar with dead space beneath
        // it. Sliding the block down by half the label's footprint lands the
        // icon dead centre — the honest version of the -7 magic constant this
        // replaces, and it re-derives itself if the label font ever changes.
        // The constant rides the coordinator's collapse animation, which calls
        // `layoutIfNeeded()` on an ancestor inside its block.
        let drop = (Self.stackSpacing + title.intrinsicContentSize.height) / 2
        stackCenterY?.constant = hidden ? drop : 0
        let apply = { self.title.alpha = hidden ? 0 : 1 }
        if animated {
            UIView.animate(withDuration: 0.2, delay: 0, options: [.beginFromCurrentState], animations: apply)
        } else {
            apply()
            setNeedsLayout()
        }
    }
}
