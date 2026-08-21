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
// So the tab bar moves out of the page — and, since the third pass, stops
// being a reproduction of one. It is a standalone `UITabBar`: no
// `UITabBarController`, no restructuring of the app, just the system control
// hosted above the WKWebView, which means the thing it refracts is the live
// web content scrolling beneath it. The web BottomNav stands down while this
// owns the screen (see src/components/BottomNav.tsx). `GlassTabBar` below is
// only the adapter between this plugin and that control, and the comment
// there records what the earlier hand-built version could never reach.
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
//   - setBarStyle({ dark })                  → lift the accent on dark pages
//   - setVisible({ visible, animated })      → hide for keyboard / overlays
//   - removeTabBar()                         → tear down, hand back to web
//   - setGlassButtons({ buttons })           → mirror the page's chrome buttons
//   - clearGlassButtons()                    → drop them all
// Events:
//   - "tabSelected" { path }                 → JS routes
//   - "glassButtonTapped" { id }             → JS runs the button's handler
//   - "minimizedChanged" { minimized }       → the bar shrank or grew itself
//   - "supportChanged" { supported }         → Reduce Transparency toggled
//
// Setup in Xcode: none. This file is already a member of the App target, and
// MainViewController.capacitorDidLoad registers the instance explicitly. That
// is also why the plugin and its adapter live in one file rather than being
// split up: a new Swift file would need a project edit, and the project isn't
// checked in.
//
// VERIFYING IT: **in the simulator**. The three earlier passes were tuned
// blind against screen recordings because this comment used to say the
// material doesn't render there. It does — `UIGlassEffect`, the platter, the
// lens and the backdrop sampling of WKWebView content all render correctly on
// an iOS 26 simulator, verified on 26.5. Build, `xcrun simctl install`,
// `xcrun simctl launch`, `xcrun simctl io <udid> screenshot`, and measure the
// screenshot rather than arguing about it. What still wants a device is the
// specular highlight that tracks device motion, which has no simulator gyro.
//
// Two things worth keeping in mind while looking at it:
//   1. The scroll edge effect. `UIScrollEdgeElementContainerInteraction` is
//      wired to the WebView's scroll view in `install`. An Apple engineer
//      (Forums 791643) confirms this is what the "blur behind the bar" in
//      system chrome actually is — an effect owned by the scroll view, which
//      UITabBarController wires up for you and a bar hosted by hand gets none
//      of. It only moves on the tabs that scroll the document, so content
//      dissolves into the bar on Search / Lists / Profile and does not on Home
//      or Reels, which scroll inner containers. Making those two scroll the
//      document is what would fix it.
//   2. Tap targets: the bar is added to the bridge view controller's view, so
//      it sits above the WebView and swallows taps in its own bounds only.
//
// That the backdrop samples WKWebView content at all was the open question in
// the first pass, and it is settled: it does.
// ─────────────────────────────────────────────────────────────────────────────

/// Whether to skip the collapse animation. The bar's own motion — the lens
/// flying between cells, the platter resizing, the symbol swap — is UIKit's
/// now and stands down under Reduce Motion without being asked.
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
        CAPPluginMethod(name: "setGlassButtons", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clearGlassButtons", returnType: CAPPluginReturnPromise),
    ]

    private var tabBar: GlassTabBar?
    private let buttonLayer = GlassButtonLayer()
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
            if !supported {
                self.teardown()
                self.teardownButtons()
            }
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
        // Kept for the JS contract's sake; it no longer selects between two
        // geometries. `UITabBar` draws the iOS 26 floating platter and insets
        // and seats it itself, which is most of the reason for using it.
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
            bar.install(in: host, variant: variant == "bar" ? .bar : .capsule, scrollView: self.bridge?.webView?.scrollView)
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

    /// Mostly obsolete: the real material re-chromes itself from the backdrop,
    /// so the platter goes charcoal with white glyphs over the black Reels page
    /// with nothing asked of it. All this still does is lift the brand accent,
    /// which is a fixed rust and reads dim on that charcoal. See
    /// `GlassTabBar.setStyle`.
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

    // MARK: - Glass buttons

    /// Declarative and idempotent: JS sends the full set every time it changes
    /// and the layer diffs by id. That is deliberately not an incremental API —
    /// the page's own header decides which buttons exist on every render, and a
    /// create/update/destroy protocol across the bridge would just be a second
    /// copy of that decision, kept in sync by hand.
    @objc func setGlassButtons(_ call: CAPPluginCall) {
        let raw = call.getArray("buttons", JSObject.self) ?? []
        DispatchQueue.main.async {
            guard self.supportReason == nil else {
                // Not an error: the page keeps its CSS controls and simply
                // never sees native ones.
                call.resolve()
                return
            }
            let specs: [GlassButtonSpec] = raw.compactMap { entry in
                guard let id = entry["id"] as? String,
                      let symbol = entry["symbol"] as? String,
                      let x = entry["x"] as? Double, let y = entry["y"] as? Double,
                      let w = entry["width"] as? Double, let h = entry["height"] as? Double
                else { return nil }
                let badge = entry["badge"] as? String
                let segments: [GlassSegmentSpec] = (entry["segments"] as? [JSObject] ?? []).compactMap { seg in
                    guard let segId = seg["id"] as? String,
                          let segSymbol = seg["symbol"] as? String else { return nil }
                    return GlassSegmentSpec(
                        id: segId,
                        symbol: segSymbol,
                        title: seg["title"] as? String ?? "",
                        active: seg["active"] as? Bool ?? false,
                        tint: Self.color(named: seg["tint"] as? String),
                        badge: seg["badge"] as? String,
                        badgeTone: seg["badgeTone"] as? String ?? "primary",
                        label: seg["label"] as? String ?? ""
                    )
                }
                return GlassButtonSpec(
                    id: id,
                    frame: CGRect(x: x, y: y, width: w, height: h),
                    symbol: symbol,
                    title: entry["title"] as? String ?? "",
                    tint: Self.color(named: entry["tint"] as? String),
                    alpha: CGFloat(entry["alpha"] as? Double ?? 1),
                    badge: badge,
                    badgeTone: entry["badgeTone"] as? String ?? "primary",
                    label: entry["label"] as? String ?? "",
                    segments: segments
                )
            }
            self.buttonLayer.setHost(self.bridge?.viewController?.view)
            self.buttonLayer.onTap = { [weak self] id in
                self?.notifyListeners("glassButtonTapped", data: ["id": id])
            }
            self.buttonLayer.apply(specs)
            call.resolve()
        }
    }

    @objc func clearGlassButtons(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.buttonLayer.clear()
            call.resolve()
        }
    }

    /// The page names tints rather than sending hex, so the two sides can't
    /// drift on what the brand colour is.
    private static func color(named: String?) -> UIColor {
        switch named {
        case "primary": return GlassTabBar.primary
        case "white": return .white
        default: return .label
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

    /// Reduce Transparency turning on has to take the buttons with it, or the
    /// page would keep its invisible placeholders under a layer of glass the
    /// setting is asking us not to draw.
    private func teardownButtons() {
        buttonLayer.clear()
    }

    deinit {
        NotificationCenter.default.removeObserver(self)
    }
}

// MARK: - Views

/// The bar — a **real `UITabBar`**, not a replica of one.
///
/// Three earlier passes hand-built it: a `UIVisualEffectView` carrying a
/// `UIGlassEffect`, a flat capsule for the selection, a row of image views
/// sitting above the glass, and hand-written springs sliding the capsule
/// between them. It kept reading as glass-ish rather than as system chrome,
/// and a side-by-side probe on an iOS 26 simulator showed why. Apple's own
/// tab bar is this:
///
///     UITabBar
///       _UITabBarPlatterView       ← the glass slab, 360×62, 21pt insets
///         SelectedContentView      ← a SECOND full copy of every tab, drawn selected
///           _UITabButton ×5
///         _UILiquidLensView        ← the lens, exactly one cell: 77×54
///           _UITabSelectionView
///           ClearGlassView         ← *clear* glass, not regular
///             SDFView              ← signed-distance-field shape (the fluid morph)
///             _UIPortalView        ← a live portal onto SelectedContentView
///         ContentView              ← every tab again, drawn unselected
///           _UITabButton ×5
///         DestOutView              ← punches the unselected row out under the lens
///
/// So the selection is not a pill sliding beneath a static row of icons. It is
/// a clear-glass lens holding a live portal onto a second, selected-styled copy
/// of the whole row, with a destination-out mask erasing the unselected row
/// underneath it, and an SDF driving the shape. That single fact is why the
/// replica could never land: it cannot magnify the glyph under the pill,
/// it has to crossfade outline→fill where Apple never crossfades (the portal
/// simply reveals the already-filled copy), and it has to hand-animate a
/// stretch that Apple gets free from the shape system.
///
/// Measured against it, the replica's *material* was already close — colour
/// transmission 70.3 vs Apple's 68.4 over the same backdrop — but its slab ran
/// ~19 luminance units foggier and its selection indicator was less than half
/// as present (−29.5 vs −62.5 luminance, isolated by diffing two frames where
/// only the selection moved). None of that is reachable by tuning constants.
///
/// A standalone `UITabBar` — no `UITabBarController`, no restructuring of the
/// app — renders that entire hierarchy, over a WKWebView, verified on iOS 26.5.
/// So the bar is the system control now and this class is only the adapter the
/// plugin talks to. Everything the old one hand-rolled comes from UIKit:
/// the lens and its portal, the fluid move between cells, drag-along-the-bar,
/// the outline→fill swap, the press behaviour, the absence of a tap haptic,
/// Reduce Motion, Dynamic Type and VoiceOver.
///
/// Two things are still ours, because a bare `UITabBar` has no API for them:
/// which items are shown (that is how `setCollapsed` works — see there), and
/// visibility.
final class GlassTabBar: NSObject, UITabBarDelegate {
    struct Item {
        let path: String
        let symbol: String
        /// Filled counterpart drawn when the item is selected. Optional —
        /// several symbols (magnifyingglass, list.bullet) have no fill
        /// variant, and there `UITabBarItem` reuses `image`, which is right:
        /// the lens carries the selection on its own.
        let selectedSymbol: String?
        let label: String
        /// Instagram draws the fifth tab as the user rather than as a person
        /// glyph. This app's mark for the user is an initial in a tinted
        /// circle (the profile page draws the same), so that is what an avatar
        /// item renders; `avatarUrl` wins if the data model ever grows one.
        let avatarInitial: String?
        let avatarUrl: String?
    }

    /// Kept so the plugin's JS contract doesn't change. It no longer selects
    /// between two geometries: `UITabBar` draws the iOS 26 floating platter
    /// and sizes and insets it itself, which is the whole point of using it.
    enum Variant {
        case capsule
        case bar
    }

    /// #9f3012, the app's `--color-primary`. Duplicated here rather than read
    /// from the page: the bar has to draw before the WebView has told us
    /// anything, and this is stable brand chrome. It tints the *selected
    /// glyph* only — the lens stays neutral glass, which is what Apple's does.
    static let primary = UIColor(red: 0.624, green: 0.188, blue: 0.071, alpha: 1.0)

    /// The same rust lifted until it reads against the charcoal the platter
    /// adapts to over a black page. See `setStyle`.
    static let primaryOnDark = UIColor(red: 0.925, green: 0.435, blue: 0.267, alpha: 1.0)

    /// Avatar photos are drawn at the size UIKit gives a tab bar glyph.
    private static let avatarSize: CGFloat = 27

    /// Condensed geometry. The platter is inset 21pt inside the bar on every
    /// side, so these map straight onto it: 26pt of side inset takes a 360pt
    /// platter to 308, and a 71pt bar takes a 62pt platter to 50. It shrinks
    /// in both directions and keeps every tab — which is what Instagram's bar
    /// does, and what collapsing to the single selected tab did not.
    private static let condensedSideInset: CGFloat = 26
    private static let condensedBarHeight: CGFloat = 71

    var onSelect: ((String) -> Void)?
    /// Fired whenever the bar shrinks or grows, including when it does so on
    /// its own initiative (a touch on a minimized bar). The plugin forwards it
    /// to JS, whose "what does native believe" bookkeeping would otherwise
    /// drift and start swallowing real collapses.
    var onCollapsedChange: ((Bool) -> Void)?

    private var bar: UITabBar?
    /// Held so the condense can drive them. The platter is laid out inside the
    /// bar with a fixed 21pt inset on every side, so it follows the bar's own
    /// width and height exactly: measured 360x62 at full width, 280x62 with
    /// 40pt side insets, 280x49 with the height pinned to 70. That is the only
    /// lever a standalone `UITabBar` gives, and it is enough.
    private var leading: NSLayoutConstraint?
    private var trailing: NSLayoutConstraint?
    private var heightPin: NSLayoutConstraint?
    private var items: [Item] = []
    private var barItems: [UITabBarItem] = []
    /// Title-less twins of `barItems`. The system's minimized pill shows the
    /// selected tab's icon and no label, and a `UITabBarItem`'s title is what
    /// decides that — so the minimized state needs its own items rather than a
    /// mutation of the expanded ones.
    private var compactItems: [UITabBarItem] = []
    /// May legitimately be "" — several routes show a tab bar without any tab
    /// owning them (/experts, /admin/*). Nothing is lit there, rather than
    /// Home being lit on a page it has nothing to do with.
    private var activePath = ""
    private var collapsed = false
    private var visible = true
    /// Dark chrome forced by JS for dark pages (Reels). Held here, not just on
    /// the view, so a teardown/reinstall cycle can't lose it.
    private var darkStyle = false
    /// One shared cache, so a bar reinstall (route bounce, theme flip) never
    /// refetches an avatar photo.
    private static let avatarCache = NSCache<NSString, UIImage>()
    /// Non-zero while a selection change of *our* making is in flight. See
    /// `applyingSelection`.
    private var programmaticDepth = 0

    private var selectedIndex: Int? {
        items.firstIndex { $0.path == activePath }
    }

    // MARK: Install

    func install(in host: UIView, variant: Variant, scrollView: UIScrollView?) {
        if let existing = bar, existing.superview === host {
            host.bringSubviewToFront(existing)
            // A cancelled dismissal leaves it faded out and non-interactive.
            resetPresentation()
            return
        }
        removeFromHost()

        let bar = UITabBar()
        bar.translatesAutoresizingMaskIntoConstraints = false
        bar.delegate = self
        bar.tintColor = Self.primary
        host.addSubview(bar)
        // Above the WebView, below anything the shell presents modally.
        host.bringSubviewToFront(bar)
        let leading = bar.leadingAnchor.constraint(equalTo: host.leadingAnchor)
        let trailing = bar.trailingAnchor.constraint(equalTo: host.trailingAnchor)
        // Inactive while expanded, so the bar keeps its natural height — 49pt
        // of content plus whatever the bottom safe area is on this device —
        // rather than having a number guessed for it.
        heightPin = bar.heightAnchor.constraint(equalToConstant: Self.condensedBarHeight)
        self.leading = leading
        self.trailing = trailing
        NSLayoutConstraint.activate([
            leading,
            trailing,
            // Flush to the bottom edge. The bar reads the host's safe area and
            // seats the platter itself — 21pt in from the sides and 21pt above
            // the screen bottom, which is where the hand-built one was trying
            // to get to with measured constants.
            bar.bottomAnchor.constraint(equalTo: host.bottomAnchor),
        ])

        // The dissolve where scrolling content meets the bar. An Apple engineer
        // (Forums 791643) confirms this is what the "blur behind the bar" in
        // system chrome actually is: an effect owned by the *scroll view*,
        // which `UITabBarController` wires up for you and a bar hosted by hand
        // gets none of.
        //
        // It tracks the WKWebView's own scroll view, so it works on the tabs
        // that scroll the document (Search, Lists, Profile) and does nothing on
        // Home and Reels, which scroll inner containers. That is the same split
        // that forces `setMinimized` to be driven from JS.
        if #available(iOS 26.0, *), let scrollView {
            let interaction = UIScrollEdgeElementContainerInteraction()
            interaction.edge = .bottom
            interaction.scrollView = scrollView
            bar.addInteraction(interaction)
        }

        self.bar = bar
        collapsed = false
        applyStyle()
        resetPresentation()
    }

    /// Drive the condense. Separate from `applyItems` because only one of the
    /// two touches the item list, and both have to land in one animation.
    private func applyGeometry(animated: Bool) {
        guard let bar, let host = bar.superview else { return }
        leading?.constant = collapsed ? Self.condensedSideInset : 0
        trailing?.constant = collapsed ? -Self.condensedSideInset : 0
        heightPin?.isActive = collapsed
        guard animated else {
            host.layoutIfNeeded()
            return
        }
        UIView.animate(withDuration: 0.28, delay: 0,
                       options: [.beginFromCurrentState, .curveEaseInOut]) {
            host.layoutIfNeeded()
        }
    }

    /// Dark chrome on dark pages — almost entirely unnecessary now, and worth
    /// saying why.
    ///
    /// The hand-built bar needed this badly: its material resolved by *trait*,
    /// so over the always-black Reels page a light-themed app got a light warm
    /// fog with charcoal glyphs that vanished against dark video, and JS had to
    /// tell it to flip. The real material resolves by *backdrop luminance*
    /// instead. Over the black Reels page the platter renders as dark charcoal
    /// glass with white glyphs on its own, in a light-trait app, and setting
    /// `overrideUserInterfaceStyle` on the bar — or on the window — changes
    /// nothing at all. Both were measured: the frames are pixel-identical.
    ///
    /// One thing does still need the hint. The accent is a fixed brand rust,
    /// and rust on charcoal is dim where rust on a light platter is right, so
    /// the tint is lifted on pages we're told are dark. Everything else about
    /// the flip the material already does.
    func setStyle(dark: Bool) {
        guard dark != darkStyle else { return }
        darkStyle = dark
        applyStyle()
    }

    private func applyStyle() {
        bar?.tintColor = darkStyle ? Self.primaryOnDark : Self.primary
    }

    /// Deliberately does *not* force `visible` back to true, which the
    /// hand-built bar did. `configureTabBar` re-runs whenever the avatar
    /// initial arrives — the profile loads well after boot — and JS only
    /// re-pushes visibility when its own `suspended` changes, so forcing it
    /// here popped the bar back up over an open modal.
    private func resetPresentation() {
        guard let bar else { return }
        bar.layer.removeAllAnimations()
        bar.alpha = visible ? 1 : 0
        bar.transform = visible ? .identity : Self.offscreen(bar)
        bar.isUserInteractionEnabled = visible
    }

    private static func offscreen(_ bar: UITabBar) -> CGAffineTransform {
        // Translation only. Scaling a glass view resamples its backdrop at the
        // wrong size and the material visibly breaks; sliding it does not.
        CGAffineTransform(translationX: 0, y: max(bar.bounds.height, 88))
    }

    func removeFromHost() {
        bar?.removeFromSuperview()
        bar = nil
        leading = nil
        trailing = nil
        heightPin = nil
        barItems = []
        compactItems = []
        items = []
        collapsed = false
        visible = true
    }

    // MARK: Items

    func setItems(_ items: [Item], activePath: String?) {
        self.items = items
        self.activePath = activePath ?? ""
        barItems = items.enumerated().map { index, item in
            let barItem = UITabBarItem(title: item.label, image: nil, tag: index)
            // Deliberately no `SymbolConfiguration`. A real tab bar sizes and
            // weights its own glyphs, and every attempt to set that by hand is
            // one more way to look almost-right.
            barItem.image = Self.image(for: item, selected: false)
            barItem.selectedImage = Self.image(for: item, selected: true)
            barItem.accessibilityLabel = item.label
            return barItem
        }
        compactItems = items.enumerated().map { index, item in
            let barItem = UITabBarItem(title: nil, image: nil, tag: index)
            barItem.image = Self.image(for: item, selected: false)
            barItem.selectedImage = Self.image(for: item, selected: true)
            barItem.accessibilityLabel = item.label
            return barItem
        }
        applyItems(animated: false)
        loadAvatarsIfNeeded()
    }

    func setActive(path: String) {
        activePath = path
        guard let bar else { return }
        if collapsed {
            // Membership changes with the selection while minimized, so the
            // whole item list has to be re-applied rather than just the
            // selection moved.
            applyItems(animated: true)
            return
        }
        // Just the selection: the lens flies to it, with the system's own
        // timing. This is the one place the old bar needed 300 lines.
        applyingSelection {
            bar.selectedItem = selectedIndex.map { barItems[$0] }
        }
    }

    /// Push the current item list and selection onto the bar.
    ///
    /// Minimized is expressed as *fewer items*, not as a transform: a
    /// `UITabBar` platter sizes itself to its content, so handing it only the
    /// selected item shrinks it to a single small pill — the same shape the
    /// system's own minimize produces, because it is the same platter doing
    /// the same layout.
    private func applyItems(animated: Bool) {
        guard let bar else { return }
        let index = selectedIndex
        // Every tab, always. Condensing drops the labels and shrinks the
        // platter around them; it does not take tabs away. Handing the bar a
        // single item was the other way to shrink it — the platter hugs its
        // content, so one item gives exactly the small pill the system's own
        // minimize produces — but it left four tabs unreachable for the whole
        // of a scroll, which is not what Instagram's bar does.
        //
        // `setItems(_:animated:)` is what crossfades the labels out. Nothing is
        // wrapped around it on purpose: an extra `UIView.animate` forces the
        // pending layout to commit inside a second curve while UIKit's own is
        // still running. The platter's resize rides `applyGeometry` instead.
        let source = collapsed ? compactItems : barItems
        applyingSelection {
            bar.setItems(source, animated: animated)
            bar.selectedItem = index.map { source[$0] }
        }
    }

    /// Run a selection change we initiated, with the delegate deafened.
    ///
    /// `UITabBar` adopts an item of its own accord when `items` changes and
    /// calls `tabBar(_:didSelect:)` for it — Apple's "the delegate isn't called
    /// for programmatic selection" only covers writing `selectedItem`. Without
    /// this, installing the bar reported a tap on the *first* tab whatever the
    /// route actually was, so JS navigated the user to Home on every install,
    /// and minimizing reported a tap that the collapsed-bar branch below
    /// immediately answered by expanding again. Both were caught in the
    /// simulator; both look exactly like a bar with a mind of its own.
    ///
    /// The flag outlives the write by one runloop turn, because the adoption
    /// can land either inside the call or on the next turn.
    private func applyingSelection(_ body: () -> Void) {
        programmaticDepth += 1
        body()
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            self.programmaticDepth = max(0, self.programmaticDepth - 1)
        }
    }

    // MARK: Collapse on scroll

    func setCollapsed(_ next: Bool, animated: Bool) {
        guard next != collapsed, bar != nil else { return }
        collapsed = next
        let move = animated && !glassReduceMotion
        applyItems(animated: move)
        applyGeometry(animated: move)
        onCollapsedChange?(next)
    }

    // MARK: Visibility

    func setVisible(_ next: Bool, animated: Bool) {
        guard next != visible else { return }
        visible = next
        guard let bar else { return }
        bar.isUserInteractionEnabled = next
        let apply = {
            bar.alpha = next ? 1 : 0
            bar.transform = next ? .identity : Self.offscreen(bar)
        }
        if animated {
            UIView.animate(withDuration: 0.25, delay: 0,
                           options: [.beginFromCurrentState, .curveEaseInOut],
                           animations: apply)
        } else {
            apply()
        }
        // Coming back from hidden always comes back expanded — the keyboard's
        // own scrollIntoView would otherwise leave a bar nobody could see
        // minimized, and reveal it that way on dismissal.
        if next { setCollapsed(false, animated: false) }
    }

    func dismiss(completion: @escaping () -> Void) {
        guard let bar else {
            completion()
            return
        }
        bar.isUserInteractionEnabled = false
        UIView.animate(withDuration: 0.2, delay: 0, options: [.beginFromCurrentState, .curveEaseIn]) {
            bar.alpha = 0
            bar.transform = Self.offscreen(bar)
        } completion: { _ in
            completion()
        }
    }

    // MARK: Selection

    func tabBar(_ tabBar: UITabBar, didSelect item: UITabBarItem) {
        // UIKit echoing a selection we just wrote, not a tap. See
        // `applyingSelection`.
        guard programmaticDepth == 0 else { return }
        // No tap-to-expand branch. That existed because the condensed bar used
        // to show only the selected tab, so a touch there could not mean
        // anything else. It shows all five now, so a tap means what it says and
        // the bar stays condensed until the scroll — or the route change — says
        // otherwise. Instagram's behaves the same way.
        guard item.tag >= 0, item.tag < items.count else { return }
        let path = items[item.tag].path
        activePath = path
        onSelect?(path)
    }

    // MARK: Images

    private static func image(for item: Item, selected: Bool) -> UIImage? {
        if item.avatarInitial != nil || item.avatarUrl != nil {
            // One image for both states. A ring or an inset to mark selection
            // would have to pick a fixed colour, and the platter's chrome is
            // decided by whatever is behind it rather than by the trait — so
            // any fixed colour is wrong on one of the two. The lens marks this
            // tab exactly as it marks the other four.
            return avatarImage(initial: item.avatarInitial, photo: nil)
        }
        let name = selected ? (item.selectedSymbol ?? item.symbol) : item.symbol
        // `app.*` names are the app's own drawn glyphs — see `TabGlyph`.
        // Anything else is an SF Symbol, and a name that doesn't resolve falls
        // back to the unselected one rather than blanking the tab.
        if let drawn = TabGlyph.named(name) { return drawn }
        return UIImage(systemName: name) ?? UIImage(systemName: item.symbol)
    }

    /// The four tab glyphs, transcribed from the design set in
    /// `ios/App/App/tab-icons/` (24×24, 1.75 stroke, round caps and joins).
    ///
    /// Transcribed rather than loaded: iOS has no public API for rendering a
    /// bundled SVG, and the asset catalog that could is gitignored along with
    /// the Xcode project, so shipping them as files would ship them nowhere.
    /// The SVGs are kept beside this file so the transcription can be checked
    /// against something. Every arc in them is a 90° corner round, which maps
    /// exactly onto `addArc(tangent1End:tangent2End:radius:)` with the tangent
    /// corner set to the point the two adjacent segments would meet at — the
    /// roof apex, or the corner of a rounded rectangle.
    ///
    /// SF Symbols is still the fallback for anything not in here — `person`,
    /// which the Profile tab shows only until the user's initial arrives.
    private enum TabGlyph {
        /// The 28pt box UIKit gives a tab bar glyph, and the 24pt box the
        /// icons are drawn in. The whole drawing is scaled by the ratio,
        /// stroke included, so the proportions the designer set are what ships.
        private static let box: CGFloat = 24
        private static let size: CGFloat = 28
        private static let stroke: CGFloat = 1.75

        static let home: UIImage = render { p in
            p.move(to: CGPoint(x: 3.5, y: 10.9))
            p.addLine(to: CGPoint(x: 10.85, y: 4.55))
            // The rounded apex. (12, 3.556) is where the two roof slopes meet.
            p.addArc(tangent1End: CGPoint(x: 12, y: 3.556),
                     tangent2End: CGPoint(x: 20.5, y: 10.9), radius: 1.75)
            p.addLine(to: CGPoint(x: 20.5, y: 10.9))
            p.addLine(to: CGPoint(x: 20.5, y: 18.4))
            p.addArc(tangent1End: CGPoint(x: 20.5, y: 20.5),
                     tangent2End: CGPoint(x: 5.6, y: 20.5), radius: 2.1)
            p.addLine(to: CGPoint(x: 5.6, y: 20.5))
            p.addArc(tangent1End: CGPoint(x: 3.5, y: 20.5),
                     tangent2End: CGPoint(x: 3.5, y: 10.9), radius: 2.1)
            p.closeSubpath()
        }

        static let search: UIImage = render { p in
            p.addEllipse(in: CGRect(x: 4.5, y: 4.5, width: 12.5, height: 12.5))
            p.move(to: CGPoint(x: 15.4, y: 15.4))
            p.addLine(to: CGPoint(x: 20.4, y: 20.4))
        }

        static let reels: UIImage = render { p in
            p.addRoundedRect(in: CGRect(x: 3.25, y: 4.75, width: 17.5, height: 14.5),
                             cornerWidth: 4.25, cornerHeight: 4.25)
            p.move(to: CGPoint(x: 10.35, y: 9.55))
            p.addLine(to: CGPoint(x: 15.1, y: 12))
            p.addLine(to: CGPoint(x: 10.35, y: 14.45))
            p.closeSubpath()
        }

        static let lists: UIImage = render { p in
            // The card behind.
            p.move(to: CGPoint(x: 8, y: 4.5))
            p.addLine(to: CGPoint(x: 17.5, y: 4.5))
            p.addArc(tangent1End: CGPoint(x: 20.25, y: 4.5),
                     tangent2End: CGPoint(x: 20.25, y: 16), radius: 2.75)
            p.addLine(to: CGPoint(x: 20.25, y: 16))
            // The bookmark in front.
            p.move(to: CGPoint(x: 6.25, y: 8))
            p.addLine(to: CGPoint(x: 14, y: 8))
            p.addArc(tangent1End: CGPoint(x: 16.75, y: 8),
                     tangent2End: CGPoint(x: 16.75, y: 20.5), radius: 2.75)
            p.addLine(to: CGPoint(x: 16.75, y: 20.5))
            p.addLine(to: CGPoint(x: 10.125, y: 16.7))
            p.addLine(to: CGPoint(x: 3.5, y: 20.5))
            p.addLine(to: CGPoint(x: 3.5, y: 10.75))
            p.addArc(tangent1End: CGPoint(x: 3.5, y: 8),
                     tangent2End: CGPoint(x: 6.25, y: 8), radius: 2.75)
            p.closeSubpath()
        }

        static func named(_ name: String) -> UIImage? {
            switch name {
            case "app.home": return home
            case "app.search": return search
            case "app.reels": return reels
            case "app.lists": return lists
            default: return nil
            }
        }

        private static func render(_ build: (CGMutablePath) -> Void) -> UIImage {
            let scale = size / box
            let cg = CGMutablePath()
            build(cg)
            let path = UIBezierPath(cgPath: cg)
            path.apply(CGAffineTransform(scaleX: scale, y: scale))
            path.lineWidth = stroke * scale
            path.lineCapStyle = .round
            path.lineJoinStyle = .round
            let renderer = UIGraphicsImageRenderer(size: CGSize(width: size, height: size))
            let image = renderer.image { _ in
                UIColor.label.setStroke()
                path.stroke()
            }
            return image.withRenderingMode(.alwaysTemplate)
        }
    }

    /// The app's mark for the signed-in user: an initial in a brand circle, or
    /// their photo once there is one. Drawn as an original (not template)
    /// image, or UIKit would flatten the whole circle into one tint colour.
    ///
    /// Solid brand fill with a white letter, rather than the tinted-glass chip
    /// the profile page draws, for the same reason the ring is gone: this
    /// glyph has to stay legible on a platter that is a light fog on one page
    /// and charcoal on the next.
    private static func avatarImage(initial: String?, photo: UIImage?) -> UIImage {
        let size = CGSize(width: avatarSize, height: avatarSize)
        let renderer = UIGraphicsImageRenderer(size: size)
        let image = renderer.image { context in
            let circle = CGRect(origin: .zero, size: size)
            let path = UIBezierPath(ovalIn: circle)
            if let photo {
                context.cgContext.saveGState()
                path.addClip()
                photo.draw(in: circle)
                context.cgContext.restoreGState()
                return
            }
            primary.setFill()
            path.fill()
            let letter = (initial ?? "").prefix(1).uppercased()
            let attributes: [NSAttributedString.Key: Any] = [
                .font: UIFont.systemFont(ofSize: circle.height * 0.55, weight: .bold),
                .foregroundColor: UIColor.white,
            ]
            let text = NSAttributedString(string: letter, attributes: attributes)
            let bounds = text.boundingRect(with: circle.size, options: .usesLineFragmentOrigin, context: nil)
            text.draw(at: CGPoint(x: circle.midX - bounds.width / 2,
                                  y: circle.midY - bounds.height / 2))
        }
        return image.withRenderingMode(.alwaysOriginal)
    }

    /// Nothing populates `avatarUrl` today; this is here so that the day the
    /// data model grows real photos, the tab draws one without another pass.
    private func loadAvatarsIfNeeded() {
        for (index, item) in items.enumerated() {
            guard let urlString = item.avatarUrl, let url = URL(string: urlString) else { continue }
            if let cached = Self.avatarCache.object(forKey: urlString as NSString) {
                applyAvatar(cached, at: index)
                continue
            }
            URLSession.shared.dataTask(with: url) { [weak self] data, _, _ in
                guard let data, let image = UIImage(data: data) else { return }
                Self.avatarCache.setObject(image, forKey: urlString as NSString)
                DispatchQueue.main.async { self?.applyAvatar(image, at: index) }
            }.resume()
        }
    }

    private func applyAvatar(_ photo: UIImage, at index: Int) {
        guard index < barItems.count, index < compactItems.count else { return }
        let image = Self.avatarImage(initial: nil, photo: photo)
        barItems[index].image = image
        barItems[index].selectedImage = image
        compactItems[index].image = image
        compactItems[index].selectedImage = image
    }
}

// MARK: - Glass buttons

/// Circular chrome buttons — back, create, messages, share — as real UIKit
/// glass instead of the CSS approximation in `.glass-control`.
///
/// Why the whole button and not just the material: a native view always draws
/// *above* the WKWebView, so glass placed behind a web icon would cover it.
/// There is no z-order that puts web content on top of a native layer. The
/// only way to give these buttons the real material is for the native side to
/// draw the button — glass, glyph and badge — and for the page to keep an
/// invisible element of the same size so layout, and the non-iOS-26 fallback,
/// are unchanged.
///
/// This is the thing `MainViewController`'s header comment used to rule out,
/// and the objection there was specific: mirroring in-page controls would mean
/// re-syncing frames every frame against a *scrolling document*, where a frame
/// of lag reads as broken. These are not in the document flow — they are fixed
/// chrome in a header that fades and slides but never scrolls with content —
/// so the mirror only has to keep up with a header animation, and JS drives it
/// from the same rAF that drives the fade. Frames are set with implicit
/// animation off so a pushed rect lands on the frame it was measured for.
///
/// `isInteractive` is on here, unlike the tab bar. It is meant for exactly this
/// — a single glass *control*, where a touch should make the material respond.
/// On the bar it meant a touch anywhere lit the whole slab, which read as a bug.
/// One tappable region inside a shared capsule. Carries everything a lone
/// button would except the material, which belongs to the capsule around it.
struct GlassSegmentSpec {
    let id: String
    let symbol: String
    /// Set for a text segment (the Lists page's Restaurants | Recipes). The
    /// glyph is skipped and the word is the content.
    let title: String
    /// The selected segment of a control. Drawn with a flat fill pill behind
    /// it — deliberately NOT a second piece of glass, which is the same
    /// platter-and-lens split the system tab bar uses.
    let active: Bool
    let tint: UIColor
    let badge: String?
    let badgeTone: String
    let label: String
}

struct GlassButtonSpec {
    let id: String
    let frame: CGRect
    let symbol: String
    /// Set for a pill — a back chip with a word on it, rather than a circle
    /// with a glyph in it. Empty for the icon-only case.
    let title: String
    let tint: UIColor
    let alpha: CGFloat
    let badge: String?
    let badgeTone: String
    let label: String
    /// Non-empty makes this a *group*: one piece of glass with these regions
    /// laid across it, rather than one button. See `GlassGroupView`.
    let segments: [GlassSegmentSpec]
}

/// Several actions sharing one capsule of glass — the header's Messages and
/// Circle pair.
///
/// Drawn as one `UIGlassEffect` surface with plain buttons inside its
/// `contentView`, rather than as N glass buttons sitting side by side. That is
/// the same rule the tab bar's lens taught and that `GlassSurface` enforces on
/// the web side: one floating layer of glass, never a row of them. Two
/// touching capsules also read as two objects; one capsule with two regions
/// reads as a single control, which is what it is.
///
/// The buttons go *inside* `contentView`, which is where Apple says subviews
/// of a visual effect view go — and, unlike the sibling-overlay arrangement
/// that swallowed every tap in the first pass, hit-testing resolves to them
/// because they are genuinely on top of the material rather than under it.
final class GlassGroupView: UIView {
    private let glass = UIVisualEffectView(effect: GlassGroupView.makeEffect())
    private var buttons: [UIButton] = []
    private var badges: [BadgeLabel] = []
    private var ids: [String] = []
    /// The flat selection pill behind the active segment — see
    /// `GlassSegmentSpec.active`. Created lazily; a group of plain icon
    /// actions never has one.
    private var selection: UIView?
    private var activeIndex: Int?
    /// A selector (the Lists page's Restaurants | Recipes) rather than a row
    /// of independent actions. Selectors are dragged; action rows are tapped.
    private var isSelector = false
    private var drag: UILongPressGestureRecognizer?
    private var dragIndex: Int?
    private var dragOrigin: CGPoint = .zero
    private var hasDragged = false
    private var lastHighlight: Int?

    var onTap: ((String) -> Void)?
    /// True only mid-drag, so the layer leaves the geometry alone while the
    /// finger is on it.
    var isLiquidActive: Bool { dragIndex != nil }

    private static func makeEffect() -> UIVisualEffect {
        if #available(iOS 26.0, *) {
            let effect = UIGlassEffect()
            // The capsule is a surface, not a control — a press anywhere on it
            // lighting the whole thing is the bug the tab bar had.
            effect.isInteractive = false
            return effect
        }
        return UIBlurEffect(style: .systemChromeMaterial)
    }

    override init(frame: CGRect) {
        super.init(frame: frame)
        glass.translatesAutoresizingMaskIntoConstraints = false
        if #available(iOS 26.0, *) {
            glass.clipsToBounds = false
            glass.cornerConfiguration = .capsule()
        } else {
            glass.clipsToBounds = true
        }
        addSubview(glass)
        NSLayoutConstraint.activate([
            glass.topAnchor.constraint(equalTo: topAnchor),
            glass.bottomAnchor.constraint(equalTo: bottomAnchor),
            glass.leadingAnchor.constraint(equalTo: leadingAnchor),
            glass.trailingAnchor.constraint(equalTo: trailingAnchor),
        ])
        // Installed lazily in `apply`, and only for selectors — see `handleDrag`.
        let drag = UILongPressGestureRecognizer(target: self, action: #selector(handleDrag(_:)))
        drag.minimumPressDuration = 0
        drag.isEnabled = false
        addGestureRecognizer(drag)
        self.drag = drag
    }

    /// Drag the selection along the bar, the way the tab bar's lens is dragged.
    ///
    /// Only selectors get this. A row of independent actions (Messages and
    /// Circle sharing a capsule) is two separate destinations, so dragging
    /// between them would mean nothing; there, the buttons keep their own
    /// touch handling and the material presses the way every other glass
    /// button does.
    @objc private func handleDrag(_ gesture: UILongPressGestureRecognizer) {
        guard isSelector, !buttons.isEmpty else { return }
        let point = gesture.location(in: self)
        let width = bounds.width / CGFloat(buttons.count)
        let index = max(0, min(buttons.count - 1, Int(point.x / width)))
        switch gesture.state {
        case .began:
            // Nothing moves on touch-down. A tap is a tap; the pill only
            // starts following once the finger has actually travelled.
            dragOrigin = point
            hasDragged = false
        case .changed:
            if !hasDragged {
                guard abs(point.x - dragOrigin.x) > 8 else { break }
                hasDragged = true
                dragIndex = index
            }
            dragIndex = index
            movePill(toward: point.x, animated: false)
            if index != lastHighlight {
                lastHighlight = index
                highlight(index: index)
            }
        case .ended, .cancelled, .failed:
            let wasDrag = hasDragged
            dragIndex = nil
            hasDragged = false
            lastHighlight = nil
            guard gesture.state == .ended, index < ids.count else {
                if let activeIndex { setSelection(index: activeIndex, animated: true) }
                return
            }
            // A drag settles where the finger is; a plain tap commits the
            // region it landed in. Same outcome, different travel.
            setSelection(index: index, animated: true)
            highlight(index: index)
            if wasDrag || index != activeIndex { onTap?(ids[index]) }
        default:
            break
        }
    }

    /// Centre the pill on `x`, clamped so it never leaves the capsule.
    private func movePill(toward x: CGFloat, animated: Bool) {
        guard let pill = selection, !buttons.isEmpty else { return }
        let width = bounds.width / CGFloat(buttons.count)
        let half = width / 2
        let clamped = max(half, min(bounds.width - half, x))
        var frame = pill.frame
        frame.origin.x = clamped - frame.width / 2
        guard animated, !glassReduceMotion else {
            pill.frame = frame
            return
        }
        UIView.animate(withDuration: 0.2, delay: 0, options: [.beginFromCurrentState, .allowUserInteraction]) {
            pill.frame = frame
        }
    }

    /// Light the label under the pill while it is being dragged, so the
    /// selection reads as continuous rather than snapping at the end.
    private func highlight(index: Int) {
        for (i, button) in buttons.enumerated() {
            guard let title = button.attributedTitle(for: .normal), title.length > 0 else { continue }
            let text = title.string
            button.setAttributedTitle(NSAttributedString(string: text, attributes: [
                .font: UIFont.systemFont(ofSize: 13.5, weight: i == index ? .semibold : .medium),
                .foregroundColor: i == index ? UIColor.label : UIColor.label.withAlphaComponent(0.5),
            ]), for: .normal)
        }
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    override func layoutSubviews() {
        super.layoutSubviews()
        if #available(iOS 26.0, *) {} else {
            glass.layer.cornerRadius = min(bounds.width, bounds.height) / 2
        }
        // Equal regions across the capsule. The page lays its own fallback out
        // the same way, so the glyphs land where the invisible buttons are.
        let count = max(1, buttons.count)
        let width = bounds.width / CGFloat(count)
        if let activeIndex, selection?.isHidden == false, dragIndex == nil {
            // Layout passes must not fight the spring mid-flight, and must not
            // touch the pill at all while a finger is dragging it: a layout can
            // run on any frame, and this snapped the pill back to the selected
            // region between every drag update — which is the pill "moving in
            // weird ways" rather than following the finger.
            if selection?.layer.animationKeys()?.isEmpty ?? true {
                selection?.frame = selectionFrame(for: activeIndex)
                selection?.layer.cornerRadius = selectionFrame(for: activeIndex).height / 2
            }
        }
        for (index, button) in buttons.enumerated() {
            button.frame = CGRect(x: width * CGFloat(index), y: 0, width: width, height: bounds.height)
            if index < badges.count {
                let badge = badges[index]
                // `intrinsicContentSize`, not `sizeToFit()`: BadgeLabel widens
                // itself for padding by overriding the former, and sizeToFit
                // measures the text alone — which clipped a two-digit count.
                let w = max(18, ceil(badge.intrinsicContentSize.width))
                // Clamped inside the capsule so a badge on the last region
                // cannot hang off the screen edge.
                let x = min(button.frame.maxX - w + 4, bounds.width - w)
                badge.frame = CGRect(x: max(0, x), y: -3, width: w, height: 18)
                badge.layer.cornerRadius = 9
                bringSubviewToFront(badge)
            }
        }
    }

    func apply(_ spec: GlassButtonSpec) {
        // Rebuild only when the shape of the group changes; a badge ticking
        // over must not tear the buttons down under the user's finger.
        let incoming = spec.segments.map(\.id)
        if incoming != ids {
            buttons.forEach { $0.removeFromSuperview() }
            badges.forEach { $0.removeFromSuperview() }
            buttons = []
            badges = []
            ids = incoming
            for segment in spec.segments {
                let button = UIButton(type: .system)
                button.accessibilityLabel = segment.label
                button.addTarget(self, action: #selector(handleSegmentTap(_:)), for: .touchUpInside)
                glass.contentView.addSubview(button)
                buttons.append(button)

                let badge = BadgeLabel()
                badge.font = .systemFont(ofSize: 11, weight: .bold)
                badge.textColor = .white
                badge.textAlignment = .center
                badge.clipsToBounds = true
                badge.isHidden = true
                // Above the glass, not through it: a count read through the
                // material is a washed-out smudge.
                addSubview(badge)
                badges.append(badge)
            }
        }
        let point = max(15, min(22, spec.frame.height * 0.44))
        let config = UIImage.SymbolConfiguration(pointSize: point, weight: .regular)
        let newActive = spec.segments.firstIndex(where: { $0.active })
        // A group with a selected region is a selector: the gesture owns the
        // touches so the pill can be dragged. Everything else is a row of
        // independent buttons that keep their own.
        isSelector = newActive != nil
        drag?.isEnabled = isSelector
        buttons.forEach { $0.isUserInteractionEnabled = !isSelector }
        for (index, segment) in spec.segments.enumerated() where index < buttons.count {
            let button = buttons[index]
            if segment.title.isEmpty {
                button.setImage(UIImage(systemName: segment.symbol, withConfiguration: config), for: .normal)
                button.setAttributedTitle(nil, for: .normal)
            } else {
                button.setImage(nil, for: .normal)
                button.setAttributedTitle(NSAttributedString(string: segment.title, attributes: [
                    .font: UIFont.systemFont(ofSize: 13.5, weight: segment.active ? .semibold : .medium),
                    .foregroundColor: segment.active ? segment.tint : UIColor.label.withAlphaComponent(0.5),
                ]), for: .normal)
            }
            button.tintColor = segment.tint
            let badge = badges[index]
            if let text = segment.badge, !text.isEmpty {
                badge.text = text
                badge.isHidden = false
                badge.backgroundColor = segment.badgeTone == "danger" ? .systemRed : GlassTabBar.primary
                badge.invalidateIntrinsicContentSize()
            } else {
                badge.isHidden = true
            }
        }
        setSelection(index: newActive, animated: activeIndex != nil && newActive != activeIndex)
        setNeedsLayout()
    }

    @objc private func handleSegmentTap(_ sender: UIButton) {
        guard let index = buttons.firstIndex(of: sender), index < ids.count else { return }
        onTap?(ids[index])
    }

    /// The moving selection pill. A flat fill sliding between regions, with
    /// the system's tab-bar reasoning: the capsule is the one piece of glass,
    /// the marker on it hides what is behind it rather than lensing it twice.
    private func setSelection(index: Int?, animated: Bool) {
        activeIndex = index
        guard let index, index < buttons.count else {
            selection?.isHidden = true
            return
        }
        let pill: UIView
        if let existing = selection {
            pill = existing
        } else {
            let view = UIView()
            view.isUserInteractionEnabled = false
            view.backgroundColor = UIColor { traits in
                traits.userInterfaceStyle == .dark
                    ? UIColor.white.withAlphaComponent(0.16)
                    : UIColor.white.withAlphaComponent(0.88)
            }
            view.layer.cornerCurve = .continuous
            // Under the labels, above the material.
            glass.contentView.insertSubview(view, at: 0)
            selection = view
            pill = view
        }
        pill.isHidden = false
        let target = selectionFrame(for: index)
        pill.layer.cornerRadius = target.height / 2
        guard animated, !glassReduceMotion else {
            pill.frame = target
            return
        }
        UIView.animate(withDuration: 0.35, delay: 0, usingSpringWithDamping: 0.8,
                       initialSpringVelocity: 0, options: [.beginFromCurrentState, .allowUserInteraction]) {
            pill.frame = target
        }
    }

    private func selectionFrame(for index: Int) -> CGRect {
        let count = max(1, buttons.count)
        let width = bounds.width / CGFloat(count)
        return CGRect(x: width * CGFloat(index), y: 0, width: width, height: bounds.height)
            .insetBy(dx: 3, dy: 3)
    }

}

final class GlassButtonView: UIButton {
    private let icon = UIImageView()
    private let badge = BadgeLabel()

    var onTap: (() -> Void)?

    /// A `UIButton` wearing the system's glass configuration, not a hand-built
    /// control with a `UIGlassEffect` view inside it. The hand-built version
    /// looked identical and swallowed every tap: hit-testing resolved to the
    /// effect view's content view, so `UIControl` tracking never saw the touch
    /// (`sendActions` fired fine — only real touches died, the classic
    /// overlay-eats-the-tap, verified with a hit-test probe). The system
    /// configuration is the same material drawn *as the button's background*,
    /// so touches, the press bounce, and accessibility are all UIKit's problem
    /// — which is the same lesson the tab bar taught: stop replicating the
    /// control, be the control.
    init() {
        super.init(frame: .zero)
        var config: UIButton.Configuration
        if #available(iOS 26.0, *) {
            config = .glass()
        } else {
            // Unreachable in practice — the plugin reports unsupported below
            // iOS 26 and the page keeps its CSS buttons — but the class has to
            // compile against the iOS 15 deployment target.
            config = .gray()
        }
        config.cornerStyle = .capsule
        config.contentInsets = .zero
        configuration = config
        // Nothing custom on top of this — the configuration's own press IS
        // the interaction. Two attempts at hand-written press physics died
        // here: an inflate-and-follow read as ballooning, and a measured
        // Instagram-style stretch corrupted geometry the moment the layer
        // pushed a frame under a live transform (a frame write with a
        // non-identity transform is undefined, and it showed). Traditional
        // glass is calm; be calm.
        addTarget(self, action: #selector(handleTap), for: .touchUpInside)

        // The configuration draws the glass; the glyph is ours. Handing the
        // image to the configuration put it visibly off-centre (its layout
        // resolves against margins the zeroed contentInsets did not remove)
        // and silently ignored `baseForegroundColor` for the tint. A plain
        // image view pinned to the centre has neither problem, and with
        // interaction off it does not shadow the button's own touch handling.
        icon.contentMode = .center
        icon.isUserInteractionEnabled = false
        icon.translatesAutoresizingMaskIntoConstraints = false
        addSubview(icon)
        NSLayoutConstraint.activate([
            icon.centerXAnchor.constraint(equalTo: centerXAnchor),
            icon.centerYAnchor.constraint(equalTo: centerYAnchor),
        ])

        // Outside the configuration system, deliberately: a count badge read
        // through the material is a washed-out smudge, and it is meant to be
        // the loudest thing on the control.
        badge.font = .systemFont(ofSize: 11, weight: .bold)
        badge.textColor = .white
        badge.textAlignment = .center
        badge.clipsToBounds = true
        badge.isHidden = true
        badge.translatesAutoresizingMaskIntoConstraints = false
        addSubview(badge)
        NSLayoutConstraint.activate([
            badge.topAnchor.constraint(equalTo: topAnchor, constant: -3),
            badge.trailingAnchor.constraint(equalTo: trailingAnchor, constant: 4),
            badge.heightAnchor.constraint(equalToConstant: 18),
            badge.widthAnchor.constraint(greaterThanOrEqualToConstant: 18),
        ])
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    @objc private func handleTap() { onTap?() }

    override func layoutSubviews() {
        super.layoutSubviews()
        badge.layer.cornerRadius = badge.bounds.height / 2
        // The configuration system re-sorts subviews when it rebuilds — keep
        // the glyph above the glass and the badge above everything.
        bringSubviewToFront(icon)
        bringSubviewToFront(badge)
    }

    func apply(_ spec: GlassButtonSpec) {
        // Sized off the button rather than fixed, so the same spec works for
        // the 44pt header buttons and anything smaller.
        let point = max(15, min(22, spec.frame.height * 0.44))
        let symbolConfig = UIImage.SymbolConfiguration(pointSize: point, weight: .regular)
        let image = UIImage(systemName: spec.symbol, withConfiguration: symbolConfig)

        if spec.title.isEmpty {
            // Icon only. The glyph is ours rather than the configuration's:
            // handing the image to the configuration put it visibly off-centre
            // (its layout resolves against margins the zeroed contentInsets did
            // not remove). A centred image view has neither problem, and with
            // interaction off it cannot shadow the button's touch handling.
            icon.image = image
            icon.tintColor = spec.tint
            icon.isHidden = false
            if var config = configuration {
                config.title = nil
                config.image = nil
                config.contentInsets = .zero
                configuration = config
            }
        } else {
            // A pill. Here the configuration *has* to do the layout — there is
            // no centring a glyph and a word by hand that survives Dynamic
            // Type — so the glyph goes back into it, where the off-centre
            // problem doesn't arise because the content is no longer a lone
            // image being centred against stale margins.
            icon.isHidden = true
            guard var config = configuration else { return }
            config.image = image?.withRenderingMode(.alwaysTemplate)
            config.imagePlacement = .leading
            config.imagePadding = 3
            config.contentInsets = NSDirectionalEdgeInsets(top: 0, leading: 10, bottom: 0, trailing: 13)
            // Through an attributed title rather than `baseForegroundColor`,
            // which the glass configuration resolves for itself.
            var container = AttributeContainer()
            container.font = .systemFont(ofSize: 12.5, weight: .semibold)
            container.foregroundColor = spec.tint
            config.attributedTitle = AttributedString(spec.title, attributes: container)
            config.baseForegroundColor = spec.tint
            config.titleLineBreakMode = .byClipping
            configuration = config
        }
        accessibilityLabel = spec.label

        if let text = spec.badge, !text.isEmpty {
            badge.text = text
            badge.isHidden = false
            badge.backgroundColor = spec.badgeTone == "danger"
                ? UIColor.systemRed
                : GlassTabBar.primary
            badge.invalidateIntrinsicContentSize()
        } else {
            badge.isHidden = true
        }
    }
}

/// `UILabel` has no padding, and a two-digit count in an 18pt circle needs
/// some. Widening the intrinsic size is the honest way to get it; padding the
/// string with spaces (the other obvious trick) double-pads the moment the
/// same label is reused for a new count.
private final class BadgeLabel: UILabel {
    private let padding = UIEdgeInsets(top: 0, left: 5, bottom: 0, right: 5)
    override var intrinsicContentSize: CGSize {
        let base = super.intrinsicContentSize
        return CGSize(width: base.width + padding.left + padding.right, height: base.height)
    }
    override func drawText(in rect: CGRect) {
        super.drawText(in: rect.inset(by: padding))
    }
}

final class GlassButtonLayer {
    /// Either a lone glass button or a capsule of them. Keyed by id, so the
    /// page can turn a pair into a group and back without the layer caring.
    private enum Chrome {
        case button(GlassButtonView)
        case group(GlassGroupView)

        var view: UIView {
            switch self {
            case .button(let v): return v
            case .group(let v): return v
            }
        }
    }

    private var views: [String: Chrome] = [:]
    private weak var host: UIView?
    var onTap: ((String) -> Void)?

    func setHost(_ host: UIView?) { self.host = host }

    func apply(_ specs: [GlassButtonSpec]) {
        guard let host else { return }
        // No implicit animation. These frames are measured by JS on one frame
        // and pushed for that frame; letting Core Animation interpolate towards
        // them is precisely the lag this has to avoid.
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        var live = Set<String>()
        for spec in specs {
            live.insert(spec.id)
            let wantsGroup = !spec.segments.isEmpty
            // A spec that changed kind (a pair collapsing to a single button
            // when Circle hides on its own page) has to be rebuilt, not reused.
            if let existing = views[spec.id] {
                switch (existing, wantsGroup) {
                case (.button, true), (.group, false):
                    existing.view.removeFromSuperview()
                    views.removeValue(forKey: spec.id)
                default:
                    break
                }
            }
            let chrome: Chrome
            if let existing = views[spec.id] {
                chrome = existing
            } else if wantsGroup {
                let view = GlassGroupView(frame: spec.frame)
                view.onTap = { [weak self] id in self?.onTap?(id) }
                views[spec.id] = .group(view)
                host.addSubview(view)
                chrome = .group(view)
            } else {
                let view = GlassButtonView()
                view.frame = spec.frame
                view.onTap = { [weak self] in self?.onTap?(spec.id) }
                views[spec.id] = .button(view)
                host.addSubview(view)
                chrome = .button(view)
            }
            let view = chrome.view
            host.bringSubviewToFront(view)
            // A web overlay can't paint over a UIKit view, so an open sheet
            // has to make these leave the way it makes the tab bar leave. JS
            // does that by sending alpha 0 rather than by a second method —
            // the buttons are already being pushed every time anything about
            // them changes, and one channel is easier to reason about than two.
            view.alpha = spec.alpha
            view.isUserInteractionEnabled = spec.alpha > 0.05
            // Geometry stays put while a press is live: a frame write under a
            // non-identity transform lands somewhere new, and the settle
            // spring would return the control to the wrong home. The next
            // push after release trues it up.
            switch chrome {
            case .button(let button):
                button.frame = Self.fit(spec, in: host, view: button)
                button.apply(spec)
            case .group(let group):
                if !group.isLiquidActive { group.frame = spec.frame }
                group.apply(spec)
            }
            view.layoutIfNeeded()
        }
        for (id, chrome) in views where !live.contains(id) {
            chrome.view.removeFromSuperview()
            views.removeValue(forKey: id)
        }
        CATransaction.commit()
    }

    func clear() {
        views.values.forEach { $0.view.removeFromSuperview() }
        views.removeAll()
    }

    /// Where the button actually goes.
    ///
    /// Icon buttons take the web element's box exactly. Pills cannot: the
    /// same words set in the system font come out wider than the page's, and
    /// forced into the page's width the title wraps to two lines and spills
    /// out of a 30pt-tall chip (seen, not guessed). So a pill keeps the box's
    /// height and the edge it is anchored to, and takes whatever width its own
    /// content needs. Which edge is anchored is decided by the half of the
    /// screen it sits in — a left-hand chip grows rightwards, a right-hand one
    /// grows leftwards, so neither walks off its margin.
    private static func fit(_ spec: GlassButtonSpec, in host: UIView, view: GlassButtonView) -> CGRect {
        guard !spec.title.isEmpty else { return spec.frame }
        let needed = view.intrinsicContentSize.width
        guard needed > spec.frame.width else { return spec.frame }
        var frame = spec.frame
        frame.size.width = needed
        if spec.frame.midX > host.bounds.midX {
            frame.origin.x = spec.frame.maxX - needed
        }
        return frame
    }
}
