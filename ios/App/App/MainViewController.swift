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
//   1. How the material actually looks. The iOS 26 *names* are settled — the
//      compiler resolves `UIGlassEffect.tintColor`, `UIGlassContainerEffect`
//      and `UIVisualEffectView.cornerConfiguration = .capsule()` against the
//      SDK, so they are no longer the open question they were when this was
//      written blind. What a build cannot tell you is whether the specular
//      rim, the shadow and the lens read right. Every iOS 26 symbol is still
//      reached through one of three small factories (`makeBarEffect`,
//      `makeLensEffect`, `makeContainerEffect`) plus `applyShape`, so a
//      signature change stays a one-function fix, and every older OS already
//      takes the UIBlurEffect path.
//   2. `usesGlassContainer`. Nesting the bar and the lens in a
//      UIGlassContainerEffect is what makes two pieces of glass merge and
//      morph into one another as the lens slides. It ships **off**, because
//      the lens is not merely near the bar, it is entirely inside it, and a
//      container exists to merge nearby glass — the likely result is the lens
//      dissolving into the bar and disappearing. Flip the flag, look at it,
//      keep whichever wins.
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
                label: entry["label"] as? String ?? ""
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
///        └─ [container: UIGlassContainerEffect]   ← optional, see the flag
///           ├─ barGlass: GlassSurfaceView    ← the material slab
///           ├─ lens:     GlassSurfaceView    ← the sliding selection glass
///           └─ content:  GlassTabBarContent  ← cells + gestures, transparent
///
/// `content` sits *above* the lens rather than inside the bar's contentView,
/// which is the one place this departs from the obvious arrangement. Two
/// reasons. The icons have to draw on top of the lens or the tint washes them
/// out. And it keeps `content.superview === lens.superview` whichever way the
/// container flag goes, so the coordinate conversion between the two is
/// provably the identity in both layouts instead of only one.
final class GlassTabBar {
    struct Item {
        let path: String
        let symbol: String
        /// Filled counterpart drawn when the item is selected. Optional —
        /// several symbols (magnifyingglass, list.bullet) have no fill
        /// variant, and there the tint change carries it.
        let selectedSymbol: String?
        let label: String
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

    /// Merge the bar and the lens into one piece of glass via
    /// UIGlassContainerEffect, so they morph into each other as the lens
    /// slides. Off by default: the lens is not merely within `spacing` of the
    /// bar, it is entirely inside it, and merging nearby glass is precisely
    /// what a container does — the likely on-device result is the lens
    /// dissolving into the bar and vanishing. One line to flip once you have
    /// seen both on a device. Being a constant, it cannot change between
    /// installs, which is why `install`'s early-return identity check below
    /// doesn't have to consider it.
    private static let usesGlassContainer = false

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

    /// Expanded vs. shrunk geometry. The shrunk bar drops its labels and a
    /// quarter of its height, so it reads as having got out of the way.
    private enum Metrics {
        static let expandedHeight: CGFloat = 64
        static let collapsedHeight: CGFloat = 48
        static let expandedInset: CGFloat = 16
        /// Deliberately equal to `expandedInset`. Pulling the edges in to 44
        /// as well squeezed five tabs into a narrow pill, which read as
        /// cramped rather than tidy — and it changed every cell's width
        /// mid-animation, which is a whole class of lens-resize bugs bought
        /// for no visual gain. The collapse is a height-and-labels change now.
        static let collapsedInset: CGFloat = 16
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
            // No glass to tint below 26, so the brand colour goes on as a
            // fill behind the blur — exactly the material the bar had before.
            // On 26 the tint is on the material itself; see `makeLensEffect`.
            lens.contentView.backgroundColor = GlassTabBarContent.primary.withAlphaComponent(0.13)
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
        // Where the glass actually lives — inside the container when it's on,
        // directly in the wrapper when it isn't. Either way the three views
        // are siblings, in this order, so the lens draws over the material
        // and the icons draw over the lens.
        var glassParent: UIView = wrapper
        if Self.usesGlassContainer, let effect = Self.makeContainerEffect() {
            let containerView = UIVisualEffectView(effect: effect)
            containerView.translatesAutoresizingMaskIntoConstraints = false
            wrapper.addSubview(containerView)
            constraints += Self.pin(containerView, to: wrapper)
            self.container = containerView
            glassParent = containerView.contentView
        }
        glassParent.addSubview(barGlass)
        glassParent.addSubview(lens)
        glassParent.addSubview(content)
        constraints += Self.pin(barGlass, to: glassParent)
        constraints += Self.pin(content, to: glassParent)

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
                wrapper.bottomAnchor.constraint(equalTo: guide.bottomAnchor, constant: -8),
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
        resetPresentation()
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
        content?.setLabelsHidden(next, animated: animated)

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
    /// The brand colour arrives as a *tint on glass* rather than as the flat
    /// 13%-alpha fill this replaces. A plain view cannot refract or magnify;
    /// that flat pink blob behind the selected icon was the whole reason there
    /// was no lensing anywhere in the bar.
    private static func makeLensEffect() -> UIVisualEffect {
        if #available(iOS 26.0, *) {
            let effect = UIGlassEffect()
            effect.isInteractive = true
            effect.tintColor = GlassTabBarContent.primary.withAlphaComponent(0.55)
            return effect
        }
        // Pre-26 there is no glass to tint, so the lens stays what it always
        // was: a soft blurred capsule. `GlassTabBarContent` paints the brand
        // colour behind it in that case.
        return UIBlurEffect(style: .systemThinMaterial)
    }

    /// Nil below iOS 26, and never consulted at all while `usesGlassContainer`
    /// is off. `spacing` is the distance at which nested glass starts to blend.
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
    /// Drag speed (points/second) that produces the full stretch, and how much
    /// stretch that is.
    private static let stretchVelocity: CGFloat = 2400
    private static let maxStretch: CGFloat = 0.12

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
    private var labelsHidden = false
    /// Last size the lens was anchored against. Guards `layoutSubviews` from
    /// re-snapping it mid-spring — `moveLens` calls `layoutIfNeeded()`, and
    /// without this the snap would land the lens on its target before the
    /// animation block ever ran, so nothing moved.
    private var lastBounds: CGRect = .zero
    private let dragFeedback = UISelectionFeedbackGenerator()

    // Live drag state.
    private var isDragging = false
    /// Where the lens is being held, in this view's space. Nil when not
    /// dragging.
    private var dragCenterX: CGFloat?
    private var lastDragX: CGFloat = 0
    private var lastDragTime: CFTimeInterval = 0
    private var dragVelocity: CGFloat = 0
    /// Set when the touch that began was spent expanding a collapsed bar. It
    /// must not also select, and neither must its release.
    private var swallowedForExpand = false

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
    /// `bounds` and `center` rather than `frame` because the drag applies a
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
    func reanchor() {
        if isDragging, let x = dragCenterX, let index = draggingIndex {
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
            view.setLabelHidden(labelsHidden, animated: false)
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

    func setActive(path: String, animated: Bool) {
        let index = items.firstIndex(where: { $0.path == path })
        guard index != activeIndex else { return }
        applySelection(index: index, animated: animated)
    }

    func setLabelsHidden(_ hidden: Bool, animated: Bool) {
        guard hidden != labelsHidden else { return }
        labelsHidden = hidden
        itemViews.forEach { $0.setLabelHidden(hidden, animated: animated) }
    }

    /// `index` is optional because several routes show a tab bar without any
    /// tab owning them. Passing nil deselects everything and fades the lens
    /// out, which is honest; the previous behaviour was to leave whichever tab
    /// was last lit still lit, on a page it had nothing to do with.
    private func applySelection(index: Int?, animated: Bool) {
        activeIndex = index
        highlight(index: index, animated: animated)
        guard let index else {
            // Unwrapped before the closure rather than chained inside it:
            // `lens?.alpha = 0` is an expression of type `Void?`, so a closure
            // bound to a `let` infers `() -> Void?` and won't pass as UIKit's
            // `() -> Void`. (An inline closure literal gets away with it —
            // the contextual type discards the result — but a named one has
            // no context to be inferred from.)
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
        moveLens(to: index, animated: animated)
    }

    private func highlight(index: Int?, animated: Bool) {
        for (i, view) in itemViews.enumerated() {
            view.setSelected(i == index, animated: animated)
        }
    }

    /// Slide the lens to sit behind `index`. Springy and interruptible, so a
    /// drag that reverses mid-flight tracks the finger instead of finishing
    /// the old animation first.
    private func moveLens(to index: Int, animated: Bool) {
        guard index >= 0, index < itemViews.count else { return }
        layoutIfNeeded()
        guard let target = selectionFrame(for: index) else { return }
        let apply = {
            self.setLens(rect: target)
            self.lens?.alpha = 1
            self.lens?.transform = .identity
        }
        if animated && !glassReduceMotion {
            UIView.animate(
                withDuration: 0.38,
                delay: 0,
                usingSpringWithDamping: 0.82,
                initialSpringVelocity: 0,
                options: [.beginFromCurrentState, .allowUserInteraction],
                animations: apply
            )
        } else if animated {
            UIView.animate(withDuration: 0.2, delay: 0, options: [.beginFromCurrentState], animations: apply)
        } else {
            apply()
        }
    }

    /// The cell rect, converted out of the stack's coordinate space, inset so
    /// the lens hugs the item rather than filling its cell. Nil before the
    /// first real layout, when every frame is still zero.
    private func selectionFrame(for index: Int) -> CGRect? {
        guard index >= 0, index < itemViews.count else { return nil }
        let view = itemViews[index]
        let cell = view.convert(view.bounds, to: self)
        guard cell.width > 1, cell.height > 1 else { return nil }
        return cell.insetBy(dx: min(6, cell.width * 0.08), dy: 6)
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        // Only on a genuine size change. Called on every `layoutIfNeeded()`
        // otherwise, which would pre-empt the selection spring.
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

    private func beginDrag(at x: CGFloat) {
        dragFeedback.prepare()
        isDragging = true
        dragVelocity = 0
        lastDragX = x
        lastDragTime = CACurrentMediaTime()
        let index = index(atX: x)
        draggingIndex = index
        let centerX = clampedCenterX(x)
        dragCenterX = centerX
        guard let index else { return }
        highlight(index: index, animated: true)
        itemViews[index].setPressed(true, animated: true)
        // A short catch-up rather than a jump: on a plain tap this is the
        // whole animation, and on a drag it's over before the finger has moved
        // far enough to notice.
        guard var rect = selectionFrame(for: index) else { return }
        rect.origin.x = centerX - rect.width / 2
        UIView.animate(withDuration: 0.18, delay: 0, options: [.beginFromCurrentState, .allowUserInteraction]) {
            self.setLens(rect: rect)
            self.lens?.alpha = 1
        }
    }

    private func updateDrag(to x: CGFloat) {
        guard isDragging else { return }
        let now = CACurrentMediaTime()
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
            // rectangle following a finger.
            dragFeedback.selectionChanged()
            dragFeedback.prepare()
            itemViews.indices.forEach { itemViews[$0].setPressed($0 == hovered, animated: true) }
            draggingIndex = hovered
            highlight(index: hovered, animated: true)
        }
        // Written directly, with no animation: this is what makes the lens
        // track the finger instead of chasing it through a queue of springs.
        guard let index = draggingIndex, var rect = selectionFrame(for: index) else { return }
        rect.origin.x = centerX - rect.width / 2
        setLens(rect: rect)
        applyStretch()
    }

    /// Stretch toward the direction of travel and relax on release. Along with
    /// the glass container this is the "liquid" part — the lens reads as being
    /// pulled rather than moved.
    private func applyStretch() {
        guard let lens, !glassReduceMotion else { return }
        let speed = min(abs(dragVelocity), Self.stretchVelocity)
        let stretch = 1 + (speed / Self.stretchVelocity) * Self.maxStretch
        lens.transform = CGAffineTransform(scaleX: stretch, y: 1 - (stretch - 1) * 0.4)
    }

    /// Let the stretch settle back to a circle-ended capsule. Separate from
    /// the snap so it still happens when the release resolves to no selection
    /// at all — a stray release, or a route no tab owns.
    private func relaxStretch() {
        guard let lens, lens.transform != .identity else { return }
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
        let index = draggingIndex
        // Released well clear of the bar: treat it as backing out, the way
        // sliding off a button before lifting has always worked.
        let strayed = point.y < -Self.cancelBand || point.y > bounds.height + Self.cancelBand
        isDragging = false
        dragCenterX = nil
        draggingIndex = nil
        dragVelocity = 0
        itemViews.forEach { $0.setPressed(false, animated: true) }
        relaxStretch()
        guard !cancelled, !strayed, let index else {
            // Put the selection back where the route actually is.
            applySelection(index: activeIndex, animated: true)
            return
        }
        commit(index: index)
    }

    private func commit(index: Int) {
        guard index >= 0, index < items.count else { return }
        let alreadyActive = index == activeIndex
        applySelection(index: index, animated: true)
        itemViews[index].playSelectionBounce()
        // Re-tapping the current tab is a no-op for the router, but the
        // selection animation above still plays, which is the right feedback.
        guard !alreadyActive else { return }
        UIImpactFeedbackGenerator(style: .light).impactOccurred()
        onSelect?(items[index].path)
    }
}

/// One tab: symbol over label, both animating between selected states.
///
/// Metrics follow Apple's tab bars rather than being tuned by eye: a constant
/// 25pt `.regular` symbol and a constant 10pt `.medium` label, with selection
/// carried by fill and tint alone. The previous version flipped the symbol to
/// `.semibold` and the label to `.bold` when selected, which made the selected
/// glyph read as chunkier and slightly blurrier than its neighbours — most of
/// why the icons looked off.
final class GlassTabItemView: UIView {
    private static let iconPointSize: CGFloat = 25
    private static let stackSpacing: CGFloat = 2

    private let icon = UIImageView()
    private let title = UILabel()
    private let stack = UIStackView()
    private var stackCenterY: NSLayoutConstraint?
    private var item: GlassTabBar.Item?
    private var tint: UIColor = .label

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
        stack.addArrangedSubview(title)
        addSubview(stack)

        let centerY = stack.centerYAnchor.constraint(equalTo: centerYAnchor)
        stackCenterY = centerY
        NSLayoutConstraint.activate([
            stack.centerXAnchor.constraint(equalTo: centerXAnchor),
            centerY,
            title.widthAnchor.constraint(lessThanOrEqualTo: widthAnchor, constant: -4),
        ])
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    func configure(item: GlassTabBar.Item, selected: Bool, tint: UIColor) {
        self.item = item
        self.tint = tint
        title.text = item.label
        accessibilityLabel = item.label
        setSelected(selected, animated: false)
    }

    /// VoiceOver sends this on a double-tap. Returning true stops UIKit
    /// synthesising a touch that the bar's recognizer wouldn't act on anyway.
    override func accessibilityActivate() -> Bool {
        guard let onActivate else { return false }
        onActivate()
        return true
    }

    func setSelected(_ next: Bool, animated: Bool) {
        guard let item else { return }
        accessibilityTraits = next ? [.button, .selected] : [.button]
        let name = next ? (item.selectedSymbol ?? item.symbol) : item.symbol
        let config = UIImage.SymbolConfiguration(pointSize: Self.iconPointSize, weight: .regular)
        // A symbol name that doesn't resolve yields nil, which would leave a
        // blank tab. Fall back through the unfilled name to a shape that
        // always exists, so a typo costs an icon and not the whole bar.
        let image = UIImage(systemName: name, withConfiguration: config)
            ?? UIImage(systemName: item.symbol, withConfiguration: config)
            ?? UIImage(systemName: "circle", withConfiguration: config)
        let color: UIColor = next ? tint : .secondaryLabel
        icon.tintColor = color
        title.textColor = color
        setIcon(image, animated: animated)
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
        if #available(iOS 17.0, *) {
            icon.addSymbolEffect(.bounce.down, options: .nonRepeating)
        }
    }

    /// Under the finger during a drag. Hand-animated because the cells sit
    /// above the lens, so they — not the glass — are what the touch lands on.
    func setPressed(_ pressed: Bool, animated: Bool) {
        let scale: CGFloat = pressed && !glassReduceMotion ? 1.06 : 1
        let apply = { self.stack.transform = CGAffineTransform(scaleX: scale, y: scale) }
        if animated {
            UIView.animate(withDuration: 0.16, delay: 0, options: [.beginFromCurrentState, .allowUserInteraction], animations: apply)
        } else {
            apply()
        }
    }

    func setLabelHidden(_ hidden: Bool, animated: Bool) {
        // The stack stays one centred block, so fading the label out would
        // leave the icon sitting high in a 48pt bar with dead space beneath
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
