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
    // theme: the AppTheme plugin below overrides the window's interface
    // style to match the web app, so these colors follow the app theme —
    // which starts as the OS appearance and follows the in-app switch from
    // there.
    private let appBackground = UIColor { traits in
        traits.userInterfaceStyle == .dark
            ? UIColor(red: 30.0 / 255.0, green: 30.0 / 255.0, blue: 32.0 / 255.0, alpha: 1.0)   // #1e1e20
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

// The web app's dark mode (a `.dark` class on <html>) starts out matching
// the OS appearance on a fresh install, and can then be steered away from it
// by the in-app toggle. This plugin lets JS flip the native window's
// interface style to match, which re-resolves every trait-aware UIColor (the
// backgrounds above), the keyboard appearance and the default status-bar
// style in one shot — so native chrome can never disagree with the page
// theme. Note the override is only applied once JS asks: a cold launch
// leaves the window on the OS appearance, which is what lets the web view
// read the real system setting via prefers-color-scheme.
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
        CAPPluginMethod(name: "selectionHaptic", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "confirmDestructive", returnType: CAPPluginReturnPromise),
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

    /// A genuine system alert on every supported iOS version, independent of glass support.
    @objc func confirmDestructive(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard var presenter = self.bridge?.viewController else {
                call.reject("No view controller available")
                return
            }
            while let presented = presenter.presentedViewController { presenter = presented }
            guard !(presenter is UIAlertController) else {
                call.resolve(["confirmed": false])
                return
            }
            let alert = UIAlertController(title: call.getString("title") ?? "Delete this item?",
                                          message: call.getString("message"), preferredStyle: .alert)
            let cancel = UIAlertAction(title: "Cancel", style: .cancel) { _ in call.resolve(["confirmed": false]) }
            alert.addAction(cancel)
            alert.addAction(UIAlertAction(title: call.getString("confirmLabel") ?? "Delete", style: .destructive) { _ in
                call.resolve(["confirmed": true])
            })
            alert.preferredAction = cancel
            presenter.present(alert, animated: true)
        }
    }

    @objc func selectionHaptic(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            let feedback = UISelectionFeedbackGenerator()
            feedback.prepare()
            feedback.selectionChanged()
            call.resolve()
        }
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
                // Older web bundles inside the same shell don't send a kind;
                // fall back to the guess they were written against.
                let kind = (entry["kind"] as? String).flatMap(GlassGroupKind.init(rawValue:))
                    ?? (segments.contains(where: \.active) ? .selector : .actions)
                return GlassButtonSpec(
                    id: id,
                    frame: CGRect(x: x, y: y, width: w, height: h),
                    symbol: symbol,
                    title: entry["title"] as? String ?? "",
                    titleStyle: entry["titleStyle"] as? String ?? "chip",
                    role: entry["role"] as? String ?? "button",
                    prominent: entry["prominent"] as? Bool ?? false,
                    fieldText: entry["fieldText"] as? String ?? "",
                    fieldTextGen: (entry["fieldTextGen"] as? NSNumber)?.intValue ?? 0,
                    fieldFocused: entry["fieldFocused"] as? Bool ?? false,
                    fieldFocusGen: (entry["fieldFocusGen"] as? NSNumber)?.intValue ?? 0,
                    fieldEditable: entry["fieldEditable"] as? Bool ?? false,
                    tint: Self.color(named: entry["tint"] as? String),
                    tintName: entry["tint"] as? String ?? "label",
                    alpha: CGFloat(entry["alpha"] as? Double ?? 1),
                    badge: badge,
                    badgeTone: entry["badgeTone"] as? String ?? "primary",
                    label: entry["label"] as? String ?? "",
                    segments: segments,
                    kind: kind
                )
            }
            self.buttonLayer.setHost(self.bridge?.viewController?.view)
            self.buttonLayer.onTap = { [weak self] id in
                self?.notifyListeners("glassButtonTapped", data: ["id": id])
            }
            self.buttonLayer.onFieldChange = { [weak self] id, text in
                self?.notifyListeners("glassFieldChanged", data: ["id": id, "text": text])
            }
            self.buttonLayer.onFieldSubmit = { [weak self] id in
                self?.notifyListeners("glassFieldSubmitted", data: ["id": id])
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

    /// #2b2622, the app's `--color-primary` (warm graphite; pale slate in dark). Duplicated here rather than read
    /// from the page: the bar has to draw before the WebView has told us
    /// anything, and this is stable brand chrome. It tints the *selected
    /// glyph* only — the lens stays neutral glass, which is what Apple's does.
    static let primary = UIColor(red: 0.169, green: 0.149, blue: 0.133, alpha: 1.0)

    /// The ink the floating glass chrome writes in — the selector's words,
    /// the chips' glyphs and labels, the field's magnifier and placeholder.
    /// A step softer than the system label in both appearances: stark white
    /// on dark glass read as harsh against the map, and true black did the
    /// same on light.
    static let glassInk = UIColor { trait in
        trait.userInterfaceStyle == .dark
            ? UIColor(white: 0.85, alpha: 1.0)
            : UIColor(white: 0.34, alpha: 1.0)
    }

    /// The tint the floating glass wears. Bare lens glass over a dark map
    /// reads as a faint outline; the reference's capsules carry a visible
    /// slate fill that still refracts. Tinting the glass — not replacing
    /// it — is the system's own mechanism for exactly that.
    /// The rim every glass capsule wears.
    ///
    /// Clear glass has almost no edge of its own. Over a map that is exactly
    /// right — the content behind supplies the definition — but over a flat
    /// ground (the search takeover's wash, the raised sheet's surface) there
    /// is nothing to refract and the capsule disappears entirely. This is a
    /// native stroke on the background configuration, so it follows the
    /// capsule's shape and the press swell; it is not a border drawn around
    /// the box.
    static let glassRim = UIColor { trait in
        trait.userInterfaceStyle == .dark
            ? UIColor(white: 1.0, alpha: 0.16)
            : UIColor(white: 0.44, alpha: 0.24)
    }

    static let glassTint = UIColor { trait in
        trait.userInterfaceStyle == .dark
            ? UIColor(red: 0.17, green: 0.18, blue: 0.22, alpha: 0.52)
            : UIColor(white: 0.99, alpha: 0.72)
    }

    /// The same rust lifted until it reads against the charcoal the platter
    /// adapts to over a black page. See `setStyle`.
    static let primaryOnDark = UIColor(red: 0.682, green: 0.733, blue: 0.827, alpha: 1.0)

    /// The ink every tab glyph and label wears, selected or not. The user's
    /// call: a tab should not change colour because it is the current one —
    /// the platter already says which is selected. White on the dark theme,
    /// graphite on the light; `applyStyle` picks by the page's theme rather
    /// than the trait, since the app's dark mode is its own switch.
    static func tabInk(dark: Bool) -> UIColor {
        dark ? UIColor.white : UIColor(red: 0.110, green: 0.102, blue: 0.098, alpha: 1.0)
    }

    /// The same ink as a dynamic colour, resolved by the bar's trait. The
    /// app writes its theme to the window's `overrideUserInterfaceStyle`,
    /// so this follows the in-app dark-mode switch without a bridge call —
    /// `darkStyle` only ever meant "the page behind the bar is black" (Reels),
    /// which is not the theme, and keyed off it the selected glyph came out
    /// graphite on the dark theme. The unselected row is vibrant and already
    /// adapts by itself; the selected copy under the lens takes `tintColor`.
    static let tabInkDynamic = UIColor { trait in
        trait.userInterfaceStyle == .dark
            ? UIColor.white
            : UIColor(red: 0.110, green: 0.102, blue: 0.098, alpha: 1.0)
    }

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
    /// The items currently ON the bar. Rebuilt — new instances — every time
    /// they are applied: `UITabBar` measures an item view once, when the item
    /// is handed to it, and reuses that view for the same instance forever
    /// after. Reusing two cached arrays is what left labels measured for a
    /// condensed platter ("Sea…", "Prof…") or missing entirely once the bar
    /// came back at a different size. Five items; building them is nothing.
    private var appliedItems: [UITabBarItem] = []
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
        bar.tintColor = Self.tabInkDynamic
        bar.unselectedItemTintColor = Self.tabInkDynamic
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
    private func applyGeometry(animated: Bool, completion: (() -> Void)? = nil) {
        guard let bar, let host = bar.superview else { completion?(); return }
        leading?.constant = collapsed ? Self.condensedSideInset : 0
        trailing?.constant = collapsed ? -Self.condensedSideInset : 0
        heightPin?.isActive = collapsed
        guard animated else {
            host.layoutIfNeeded()
            completion?()
            return
        }
        UIView.animate(withDuration: 0.28, delay: 0,
                       options: [.beginFromCurrentState, .curveEaseInOut]) {
            host.layoutIfNeeded()
        } completion: { _ in
            completion?()
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

    /// True when the bar is on the dark theme (the window's override style,
    /// set by the app) or over a black page (Reels).
    private var inkIsLight: Bool {
        darkStyle || (bar?.traitCollection.userInterfaceStyle == .dark)
    }

    private func applyStyle() {
        bar?.tintColor = Self.tabInkDynamic
        bar?.unselectedItemTintColor = Self.tabInkDynamic
        // The avatar cell is drawn `.alwaysOriginal`, so it does not follow
        // `tintColor` the way the glyphs do — the monogram has to be redrawn
        // in the new ink by hand. Keyed on "no photo to show yet" rather than
        // "no photo configured": an avatarUrl whose download has not landed is
        // showing the monogram too, and skipping it left that tab in the old
        // theme's ink until the picture arrived.
        for (index, item) in items.enumerated() where index < appliedItems.count {
            guard item.avatarInitial != nil || item.avatarUrl != nil else { continue }
            let photo = item.avatarUrl.flatMap { Self.avatarCache.object(forKey: $0 as NSString) }
            guard photo == nil else { continue }
            let image = Self.avatarImage(initial: item.avatarInitial, photo: nil, dark: inkIsLight)
            appliedItems[index].image = image
            appliedItems[index].selectedImage = image
        }
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
        appliedItems = []
        items = []
        collapsed = false
        visible = true
    }

    // MARK: Items

    func setItems(_ items: [Item], activePath: String?) {
        self.items = items
        self.activePath = activePath ?? ""
        applyItems(animated: false)
        loadAvatarsIfNeeded()
    }

    /// Build the bar's items. `titled: false` is the minimized pill, which
    /// shows the selected tab's icon and no label — a `UITabBarItem`'s title
    /// is what decides that.
    private func makeItems(titled: Bool) -> [UITabBarItem] {
        items.enumerated().map { index, item in
            let barItem = UITabBarItem(title: titled ? item.label : nil, image: nil, tag: index)
            // The already-downloaded photo, if there is one. Rebuilding an
            // item used to hand the Profile tab `photo: nil`, so the user's
            // face reverted to the monogram — permanently, since the only
            // thing that ever re-applied it was `setItems`, and a scroll
            // rebuilds without going near that.
            let photo = item.avatarUrl.flatMap { Self.avatarCache.object(forKey: $0 as NSString) }
            // Deliberately no `SymbolConfiguration`. A real tab bar sizes and
            // weights its own glyphs, and every attempt to set that by hand is
            // one more way to look almost-right.
            barItem.image = Self.image(for: item, selected: false, dark: inkIsLight, photo: photo)
            barItem.selectedImage = Self.image(for: item, selected: true, dark: inkIsLight, photo: photo)
            barItem.accessibilityLabel = item.label
            return barItem
        }
    }

    func setActive(path: String) {
        activePath = path
        guard let bar else { return }
        // Just the selection, collapsed or not: the lens flies to it, with the
        // system's own timing. This is the one place the old bar needed 300
        // lines.
        //
        // Collapsing used to take a different path here, on the grounds that
        // "membership changes with the selection while minimized" — true of
        // the version that shrank the platter by handing the bar a single
        // item, and false since it started shrinking by dropping the titles
        // instead. Every tab is on the bar in both states, so the item list
        // does not depend on which one is lit, and rebuilding it on every
        // navigation was churning five items and a forced layout to move a
        // highlight.
        applyingSelection {
            bar.selectedItem = selectedIndex.flatMap { $0 < appliedItems.count ? appliedItems[$0] : nil }
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
        // `UITabBar` measures its item titles when the items are SET, against
        // the width it has at that moment, and never re-measures them. A
        // freshly installed bar has no width yet — constraints have not been
        // resolved — so every label was sized for a zero-width cell and stayed
        // truncated ("Sea…", "Prof…") once layout stretched the cells around
        // it. That is why it only showed after a route that removes the bar
        // (a restaurant page, messages) and not on a cold launch, where the
        // avatar arriving late triggers a second configure at a real width.
        // Resolve the geometry before handing over the items.
        bar.superview?.layoutIfNeeded()
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
        // Fresh instances, measured against the geometry the bar has NOW.
        let source = makeItems(titled: !collapsed)
        appliedItems = source
        applyingSelection {
            bar.setItems(source, animated: animated)
            bar.selectedItem = index.map { source[$0] }
        }
        // Lay the new item views out NOW. `UITabBar` builds them lazily on its
        // next layout pass, and on the path back from a route that removed the
        // bar that pass did not come until something else forced one — which
        // is why the labels were missing until a tab was tapped.
        //
        // Only when nothing is animating. `setItems(_:animated: true)` is a
        // crossfade, and committing a layout synchronously in the middle of
        // one snaps the item views to their final places under a transition
        // that is still running — the stutter on every scroll-driven condense.
        // The animated path gets its layout from the animation itself.
        if !animated {
            bar.setNeedsLayout()
            bar.layoutIfNeeded()
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
        guard next != collapsed, let bar else { return }
        collapsed = next
        let move = animated && !glassReduceMotion
        if next {
            // Condensing: drop the titles first, then shrink the platter
            // around what is left.
            applyItems(animated: move)
            applyGeometry(animated: move)
        } else {
            // Expanding: grow the platter FIRST and only hand it the titled
            // items once it is actually that size. `UITabBar` lays its item
            // views out against the bar's CURRENT box when the items are set
            // and never re-measures them, so setting titled items while the
            // bar is still condensed produced a full-width bar whose labels
            // had been laid out for a 56pt cell — truncated to "Sea…" and
            // "Prof…", or dropped altogether. Growing first also matches what
            // the system does: the platter widens, then the labels arrive.
            applyGeometry(animated: move) { [weak self] in
                self?.applyItems(animated: move)
            }
        }
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
        // Ease *out*, not in. An ease-in starts slow, which spends the first
        // frames of a dismissal — the exact moment being watched — barely
        // moving. Leaving fast and settling is what reads as responsive, and
        // it is the same rule the entrances follow.
        UIView.animate(withDuration: 0.2, delay: 0, options: [.beginFromCurrentState, .curveEaseOut]) {
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

    private static func image(for item: Item, selected: Bool, dark: Bool = false, photo: UIImage? = nil) -> UIImage? {
        if item.avatarInitial != nil || item.avatarUrl != nil {
            // One image for both states. A ring or an inset to mark selection
            // would have to pick a fixed colour, and the platter's chrome is
            // decided by whatever is behind it rather than by the trait — so
            // any fixed colour is wrong on one of the two. The lens marks this
            // tab exactly as it marks the other four.
            return avatarImage(initial: item.avatarInitial, photo: photo, dark: dark)
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
    private static func avatarImage(initial: String?, photo: UIImage?, dark: Bool = false) -> UIImage {
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
            // Monogram fallback in the tab ink, lettered in its opposite —
            // the same inversion the app's `bg-primary text-on-primary` does.
            tabInk(dark: dark).setFill()
            path.fill()
            let letter = (initial ?? "").prefix(1).uppercased()
            let attributes: [NSAttributedString.Key: Any] = [
                .font: UIFont.systemFont(ofSize: circle.height * 0.55, weight: .bold),
                .foregroundColor: dark ? UIColor(red: 0.110, green: 0.102, blue: 0.098, alpha: 1.0) : UIColor.white,
            ]
            let text = NSAttributedString(string: letter, attributes: attributes)
            let bounds = text.boundingRect(with: circle.size, options: .usesLineFragmentOrigin, context: nil)
            text.draw(at: CGPoint(x: circle.midX - bounds.width / 2,
                                  y: circle.midY - bounds.height / 2))
        }
        return image.withRenderingMode(.alwaysOriginal)
    }

    /// The Profile tab draws the signed-in user's photo (`avatarUrl`, from
    /// user_profiles.avatar_url) — the same picture the profile page shows,
    /// so the tab is whatever the user made it. Cached per URL.
    private func loadAvatarsIfNeeded() {
        for (index, item) in items.enumerated() {
            guard let urlString = item.avatarUrl, let url = URL(string: urlString) else { continue }
            if let cached = Self.avatarCache.object(forKey: urlString as NSString) {
                applyAvatar(cached, for: urlString)
                continue
            }
            URLSession.shared.dataTask(with: url) { [weak self] data, _, _ in
                guard let data, let image = UIImage(data: data) else { return }
                Self.avatarCache.setObject(image, forKey: urlString as NSString)
                DispatchQueue.main.async { self?.applyAvatar(image, for: urlString) }
            }.resume()
        }
    }

    /// Keyed by URL, not by the index the request was made at: a reconfigure
    /// between the request and its response reorders `items`, and a download
    /// that landed on a captured index would paint someone's face onto the
    /// Search tab.
    private func applyAvatar(_ photo: UIImage, for urlString: String) {
        guard let index = items.firstIndex(where: { $0.avatarUrl == urlString }),
              index < appliedItems.count else { return }
        let image = Self.avatarImage(initial: nil, photo: photo)
        appliedItems[index].image = image
        appliedItems[index].selectedImage = image
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

/// What a group of segments *is*.
///
/// Sent by the page rather than inferred from whether some segment is active,
/// because the inference is wrong in the one case that matters: a selector
/// with nothing selected is still a selector, and would otherwise flip to the
/// other kind — rebuilding the view under the user's finger. The two kinds
/// want opposite touch handling, so the guess is not cosmetic.
enum GlassGroupKind: String {
    /// Independent actions sharing one piece of glass — Messages + Circle,
    /// Save + Share. Each region is pressed on its own. See
    /// `GlassActionGroupView`.
    case actions
    /// One control with a chosen region — the Lists page's Restaurants |
    /// Recipes. The selection is dragged along the bar. See
    /// `GlassSelectorBarView`.
    case selector
    /// A horizontally scrolling row of independent filter capsules — the map
    /// chrome's chips. Unlike `actions`, the capsules do not share one piece
    /// of glass; unlike `selector`, more than one can be chosen and the row
    /// scrolls. See `GlassChipRowView`.
    case chips
}

struct GlassButtonSpec {
    let id: String
    let frame: CGRect
    let symbol: String
    /// Set for a pill — a back chip with a word on it, rather than a circle
    /// with a glyph in it. Empty for the icon-only case.
    let title: String
    /// How that word is set. `chip` is a small semibold label centred in the
    /// capsule; `field` is a search bar — 17pt regular, leading aligned, so
    /// the capsule reads as somewhere you type rather than as a button whose
    /// label happens to be long.
    let titleStyle: String
    /// `button` unless the page says otherwise. `field` is a real
    /// `UITextField` riding the glass rather than a glyph or a label (see
    /// `GlassSearchFieldView`); `chip` is a filter capsule in a scrolling
    /// row, which differs from a plain pill only in how it is measured and
    /// how it grows when its text overflows.
    let role: String
    /// Selected. A lens has no fill to darken, so a chosen chip cannot say
    /// so in plain glass — it switches to the system's PROMINENT glass, the
    /// tinted variant, which is still a live refracting lens.
    let prominent: Bool
    /// The page's text for a field, applied only when `fieldTextGen`
    /// advances past what was last applied — the generation rule that keeps
    /// an echo of native typing from eating a keystroke.
    let fieldText: String
    let fieldTextGen: Int
    /// Focus rides a generation too, for a different reason: a payload
    /// re-asserting `focused` must not re-summon a keyboard the user
    /// dismissed with a drag.
    let fieldFocused: Bool
    let fieldFocusGen: Int
    let fieldEditable: Bool
    let tint: UIColor
    /// The tint's NAME, kept beside the resolved colour: a prominent
    /// capsule has to pick a legible foreground for its fill, and comparing
    /// `UIColor`s for that is a good way to get it subtly wrong.
    let tintName: String
    let alpha: CGFloat
    let badge: String?
    let badgeTone: String
    let label: String
    /// Non-empty makes this a *group*: several regions sharing one piece of
    /// glass, rather than one button.
    let segments: [GlassSegmentSpec]
    /// Which kind of group, when there are segments. Meaningless without them.
    let kind: GlassGroupKind
}

/// The Lists page's Restaurants | Recipes selector.
///
/// A real `UITabBar` with two items — the same answer the app's navbar
/// arrived at, for the same reason. The lens, the way it magnifies what it is
/// over, the drag that carries it between segments and the fluid morph on the
/// way are all the system's, and none of them can be reached from public API
/// any other way: the lens is a clear-glass view with a live portal onto a
/// second, selected-styled copy of the row, masked out of the row beneath it.
/// What this replaced was a flat pill sliding under static labels — an
/// impression of that, with none of it.
///
/// The one thing this class does is *place* it. A tab bar does not fill the
/// frame it is given: it seats a platter inside it, inset from the sides and
/// lifted off the bottom the way it would sit above a home indicator. So the
/// bar is handed a frame around the box the page measured, then trued up —
/// the platter's real rect is read back after layout and the bar shifted by
/// whatever is left over. Measuring beats hard-coding 21pt, which is only
/// today's number on today's device.
final class GlassSelectorBarView: UIView, UITabBarDelegate {
    /// Matches the fallback's `text-[13.5px] font-bold`, so the two layouts
    /// agree — and it is the only lever on how far the lens's magnification
    /// actually travels. The bar scales what it is over by a fixed ~1.23×
    /// (measured at 14pt and at 18pt: same ratio both times), which is
    /// Apple's number and not settable. Bigger type does not magnify by more
    /// *proportionally*; it just moves further doing it.
    private static let titleFont = UIFont.systemFont(ofSize: 13.5, weight: .semibold)

    /// A word drawn as a template image, so the bar tints it — selected,
    /// unselected and under the lens — exactly as it tints a glyph.
    private static func wordImage(_ text: String) -> UIImage? {
        guard !text.isEmpty else { return nil }
        let attributes: [NSAttributedString.Key: Any] = [.font: titleFont]
        let measured = (text as NSString).size(withAttributes: attributes)
        let size = CGSize(width: ceil(measured.width), height: ceil(measured.height))
        guard size.width > 0, size.height > 0 else { return nil }
        let image = UIGraphicsImageRenderer(size: size).image { _ in
            (text as NSString).draw(at: .zero, withAttributes: attributes)
        }
        return image.withRenderingMode(.alwaysTemplate)
    }

    private let bar = UITabBar()
    private var ids: [String] = []
    private var titles: [String] = []
    /// Where the bar has to sit for its platter to land on the page's box.
    /// Derived from a real layout pass rather than hard-coded, then reused —
    /// it does not change while the app runs, and re-deriving every layout
    /// would mean laying the bar out twice a frame.
    private var seat: Seat?
    private struct Seat { var top: CGFloat; var left: CGFloat; var bottom: CGFloat; var right: CGFloat }
    /// UIKit echoes a selection back through the delegate when we write one.
    private var programmaticDepth = 0

    var onTap: ((String) -> Void)?

    /// The bar animates its own lens and we never write a transform on it, so
    /// there is no window where a pushed frame would land badly.
    var isLiquidActive: Bool { false }

    override init(frame: CGRect) {
        super.init(frame: frame)
        bar.delegate = self
        // The glyph colour on the platter. The lens magnifies what is under
        // it rather than recolouring it, so this is the selected label's
        // colour too. The chrome ink, not the system label — see glassInk.
        bar.tintColor = GlassTabBar.glassInk
        bar.unselectedItemTintColor = GlassTabBar.glassInk.withAlphaComponent(0.55)
        // No UITabBarAppearance background here: that paints the BAR's full
        // rectangle, and the bar is deliberately bigger than the platter it
        // seats (the seat insets reach past the page's box), so the tint
        // came out as a pale slab hanging beyond the capsule — and under
        // whatever floats beside it. The chrome tint goes on the platter
        // itself, in applyChrome().
        // The platter is what you see; the bar around it is only a frame to
        // hang it in, and it reaches outside this view's box.
        clipsToBounds = false
        addSubview(bar)
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    /// The platter — the capsule you actually see. Found by shape rather than
    /// by class name: it is the biggest subview that isn't the bar's own box.
    private var platterView: UIView? {
        bar.subviews
            .filter { $0.frame.width > 1 && $0.frame.height > 1 && !bar.bounds.equalTo($0.frame) }
            .max { $0.frame.width * $0.frame.height < $1.frame.width * $1.frame.height }
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        guard bounds.width > 1, bounds.height > 1 else { return }
        if let seat {
            bar.frame = barFrame(for: seat)
            applyChrome()
            return
        }
        // Solved, not assumed. The platter is inset inside the bar by numbers
        // that are not ours, so each pass lays the bar out for real, reads
        // where the platter actually landed, and folds the error back into
        // the insets. 21pt a side is only the opening guess — the navbar's
        // number, which is not this bar's.
        //
        // The box is what decides how tight the control is: squeezing the bar
        // squeezes the platter, which is how the padding around the words
        // comes off. There is a floor — pushed far enough under what the lens
        // needs, its corner radius no longer fits its height and it stops
        // being a capsule, rendering as a leaf: two arcs meeting in a point.
        // The centring pass below is what keeps that honest, by taking
        // whatever size it actually settled at.
        var solved = Seat(top: 21, left: 21, bottom: 21, right: 21)
        for _ in 0..<3 {
            bar.frame = barFrame(for: solved)
            bar.layoutIfNeeded()
            guard let rect = platterRect else { return }
            solved.top += rect.minY - bounds.minY
            solved.left += rect.minX - bounds.minX
            solved.bottom += bounds.maxY - rect.maxY
            solved.right += bounds.maxX - rect.maxX
        }
        // Whatever size it settled at, centre *that* on the box — the same
        // bargain `GlassButtonLayer.fit` strikes for a pill: the page keeps
        // the position, the control keeps its size.
        bar.frame = barFrame(for: solved)
        bar.layoutIfNeeded()
        if let rect = platterRect {
            let dx = bounds.midX - rect.midX
            let dy = bounds.midY - rect.midY
            solved.left -= dx
            solved.right += dx
            solved.top -= dy
            solved.bottom += dy
        }
        seat = solved
        bar.frame = barFrame(for: solved)
        applyChrome()
    }

    private var platterRect: CGRect? {
        guard let platter = platterView else { return nil }
        return platter.convert(platter.bounds, to: self)
    }

    /// The chrome family's tint and hairline, on the platter's OWN layer so
    /// they follow the capsule the bar actually laid out — the platter is
    /// inset inside the bar by numbers that are not ours, and painting the
    /// bar instead put a pale slab past the capsule's edges. The lens, its
    /// magnification and the drag stay the system's.
    private func applyChrome() {
        guard let platter = platterView else { return }
        platter.backgroundColor = GlassTabBar.glassTint.resolvedColor(with: traitCollection)
        platter.layer.borderColor = GlassTabBar.glassRim.resolvedColor(with: traitCollection).cgColor
        platter.layer.borderWidth = 1
        platter.layer.cornerRadius = platter.bounds.height / 2
        platter.layer.masksToBounds = false
    }

    override func traitCollectionDidChange(_ previous: UITraitCollection?) {
        super.traitCollectionDidChange(previous)
        applyChrome()
    }

    private func barFrame(for seat: Seat) -> CGRect {
        CGRect(
            x: bounds.minX - seat.left,
            y: bounds.minY - seat.top,
            width: bounds.width + seat.left + seat.right,
            height: bounds.height + seat.top + seat.bottom
        )
    }

    func apply(_ spec: GlassButtonSpec) {
        let incomingIds = spec.segments.map(\.id)
        let incomingTitles = spec.segments.map(\.title)
        if incomingIds != ids || incomingTitles != titles {
            ids = incomingIds
            titles = incomingTitles
            bar.items = spec.segments.enumerated().map { index, segment in
                // The word *is* the image, and the item has no title.
                //
                // A tab bar stacks title under image and keeps the room for an
                // image whether or not there is one, so a title-only item is a
                // label sitting low in a band of nothing — and
                // `titlePositionAdjustment`, the knob for exactly that, is
                // ignored by the iOS 26 bar. Handing the word in as the image
                // sidesteps the whole argument: an item with an image and no
                // title centres it, the lens magnifies it the way it magnifies
                // any icon, and the type is the page's rather than the bar's.
                // The navbar already draws its own tab images this way.
                let item = UITabBarItem(title: nil, image: Self.wordImage(segment.title), tag: index)
                item.accessibilityLabel = segment.label
                return item
            }
            // Item widths changed, so the platter did too.
            seat = nil
            setNeedsLayout()
        }
        guard let items = bar.items else { return }
        let active = spec.segments.firstIndex(where: { $0.active }) ?? 0
        guard active < items.count, bar.selectedItem !== items[active] else { return }
        // Writing the selection makes UIKit call the delegate back as if a
        // finger had done it; without the guard, the page's own state would
        // arrive here and bounce straight back out as a tap.
        programmaticDepth += 1
        bar.selectedItem = items[active]
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            self.programmaticDepth = max(0, self.programmaticDepth - 1)
        }
    }

    func tabBar(_ tabBar: UITabBar, didSelect item: UITabBarItem) {
        guard programmaticDepth == 0, item.tag >= 0, item.tag < ids.count else { return }
        onTap?(ids[item.tag])
    }
}

/// Several independent actions sharing one capsule of glass — Discover's
/// Messages and Circle, the restaurant page's Save and Share.
///
/// One `UIGlassEffect` surface with the regions laid across its
/// `contentView`, rather than a row of separate glass circles: that is the
/// rule the tab bar's lens taught and that `GlassSurface` enforces on the web
/// side — one floating layer of glass, never a row of them.
///
/// The material is *interactive*, and that single flag is the whole
/// behaviour. Press it and the system inflates and brightens the capsule
/// under the finger, leans it as the finger moves, and settles it on release
/// — the same physics every other Liquid Glass control has, none of it
/// written here. It was off, on the reasoning that a surface is not a control
/// and lighting the whole slab for a touch anywhere on it was the tab bar's
/// bug. That reasoning does not survive contact with the system's own
/// controls: a two-button capsule *is* one control, and Apple lights the
/// whole of it. On the bar — five destinations across the screen's width —
/// it was still wrong, which is why the bar keeps its `false`.
///
/// The regions keep their own touch handling — unlike the selector's, which
/// give theirs up so the selection can be dragged — because here the two
/// destinations are separate and a tap has to land on the one it was aimed
/// at. The material sees the touch anyway and responds around them.
final class GlassActionGroupView: UIView {
    private let glass = UIVisualEffectView(effect: GlassActionGroupView.makeEffect())
    private var buttons: [UIButton] = []
    private var badges: [BadgeLabel] = []
    private var ids: [String] = []

    var onTap: ((String) -> Void)?

    /// True while a finger is on one of the regions. The layer pushes a
    /// measured frame on every sample; one that lands mid-press writes a frame
    /// under the live press transform, which is undefined — and the settle
    /// would then return the capsule to the wrong home.
    var isLiquidActive: Bool { buttons.contains { $0.isTracking || $0.isHighlighted } }

    private static func makeEffect() -> UIVisualEffect {
        if #available(iOS 26.0, *) {
            // Same pipeline as every lone capsule: CLEAR glass wearing the
            // family tint. The default (regular) glass reads a step darker
            // than the buttons beside it — the mismatch the home header
            // showed between the search circle and this capsule.
            let effect = UIGlassEffect(style: .clear)
            effect.isInteractive = true
            effect.tintColor = GlassTabBar.glassTint
            return effect
        }
        return UIBlurEffect(style: .systemChromeMaterial)
    }

    /// The family hairline, on the effect view's layer — the same rim every
    /// button draws through its configuration. Re-resolved on trait flips.
    private func applyRim() {
        glass.layer.borderColor = GlassTabBar.glassRim.resolvedColor(with: traitCollection).cgColor
        glass.layer.borderWidth = 1
        glass.layer.cornerRadius = bounds.height / 2
        glass.layer.cornerCurve = .continuous
        glass.layer.masksToBounds = false
    }

    override func traitCollectionDidChange(_ previous: UITraitCollection?) {
        super.traitCollectionDidChange(previous)
        applyRim()
    }

    override init(frame: CGRect) {
        super.init(frame: frame)
        glass.translatesAutoresizingMaskIntoConstraints = false
        if #available(iOS 26.0, *) {
            // The press swells the capsule past its own bounds; clipping would
            // shear the very animation this exists for.
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
        // The capsule grows outside its box while pressed, so the box must not
        // be what decides where a touch counts.
        clipsToBounds = false
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    override func layoutSubviews() {
        super.layoutSubviews()
        applyRim()
        if #available(iOS 26.0, *) {} else {
            glass.layer.cornerRadius = min(bounds.width, bounds.height) / 2
        }
        // A layout can run on any frame; one that runs mid-press moves the
        // regions out from under the material that is animating around them.
        guard !isLiquidActive else { return }
        // Equal regions across the capsule. The page lays its own fallback out
        // the same way, so the glyphs land where the invisible buttons are.
        let count = max(1, buttons.count)
        let width = bounds.width / CGFloat(count)
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
                // `.custom`, not `.system`: a system button washes its glyph
                // out for as long as the touch lasts, and here the touch lasts
                // as long as the finger is down. Held, that reads as disabled
                // rather than pressed — and it is redundant besides, because
                // the material is already answering the press. The system's
                // own glass controls keep their glyph at full strength while
                // the glass moves around it.
                let button = UIButton(type: .custom)
                button.accessibilityLabel = segment.label
                button.addTarget(self, action: #selector(handleSegmentTap(_:)), for: .touchUpInside)
                // Inside `contentView`, which is where subviews of a visual
                // effect view go — and where hit-testing resolves to them,
                // because they are genuinely on top of the material rather
                // than under it. The material still sees the touch and
                // responds around them.
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
        for (index, segment) in spec.segments.enumerated() where index < buttons.count {
            let button = buttons[index]
            // Template explicitly: a `.custom` button leaves an `.automatic`
            // image alone, and a bookmark that ignores its tint is the saved
            // state failing to show.
            // `app.*` names are the app's own drawn glyphs (see `AppGlyph`),
            // for marks SF Symbols has no equivalent of — checked first since
            // `UIImage(systemName:)` returns nil for them anyway.
            let image = (AppGlyph.named(segment.symbol, pointSize: point)
                ?? UIImage(systemName: segment.symbol, withConfiguration: config))?
                .withRenderingMode(.alwaysTemplate)
            button.setImage(image, for: .normal)
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
        setNeedsLayout()
    }

    @objc private func handleSegmentTap(_ sender: UIButton) {
        guard let index = buttons.firstIndex(where: { $0 === sender }), index < ids.count else { return }
        onTap?(ids[index])
    }
}

/// The search field — a real text editor on real glass.
///
/// The page's field was the last piece of CSS chrome: every control beside it
/// is `UIGlassEffect` and refracts, while `backdrop-filter` can only blur and
/// tint, and the eye catches the difference immediately — the same probe
/// that moved the buttons native. A field cannot take the buttons' route
/// (`UIButton.Configuration.glass()` draws titles, not editors), so this is
/// the action group's construction — an interactive glass capsule with
/// content laid across its `contentView` — where the content is a
/// `UITextField`.
///
/// Typing therefore happens natively and is *reported* to the page, which
/// reverses the usual direction of ownership and needs one rule to be safe:
/// the page's text is applied only when its generation advances. The page
/// bumps the generation when *it* decides the text — clearing on close, a
/// suggestion tapped — and everything else it sends is this view's own
/// report coming back around, possibly stale by a keystroke, and applying it
/// would eat the keystroke. Focus rides a generation for a different reason:
/// a payload re-asserting `focused` must not re-summon a keyboard the user
/// dismissed.
/// The map chrome's filter chips — one native, horizontally scrolling row.
///
/// The first version mirrored each chip onto its own web box, the way the
/// lone chrome buttons work, and the row failed in every direction at once:
/// per-chip boxes drift from the system font's real metrics, so capsules
/// grew into their neighbours — and a row of native buttons floating over a
/// web scroller cannot scroll at all, because the buttons take the touch
/// and the web container never sees the drag. The fix is to stop mirroring
/// chips and own the row: ONE registration hands over the strip, and a real
/// `UIScrollView` lays the capsules out from their own intrinsic widths,
/// scrolls them with native bounce, clips them at its edges, and keeps its
/// offset across payload pushes.
///
/// A chosen chip is the system's PROMINENT glass filled with the brand's
/// rust — the same selected language as everywhere else — because a plain
/// lens has no fill to darken.
final class GlassChipRowView: UIView {
    private let scroll = UIScrollView()
    private var buttons: [UIButton] = []
    private var ids: [String] = []
    /// Which buttons are icon-only. Their intrinsic width cannot be
    /// trusted: an image-only configuration reports a width that ignores
    /// the content insets, which rendered the Filters chip as a ~20pt
    /// pinched oval however wide its insets were set.
    private var iconOnly: [Bool] = []
    /// Everything that decides how a capsule draws. A change rebuilds the
    /// configurations; an identical push costs nothing.
    private var shape: [String] = []

    var onTap: ((String) -> Void)?

    override init(frame: CGRect) {
        super.init(frame: frame)
        scroll.showsHorizontalScrollIndicator = false
        scroll.alwaysBounceHorizontal = true
        scroll.contentInsetAdjustmentBehavior = .never
        scroll.clipsToBounds = true
        // No contentInset: the row's side margins are baked into the content
        // itself (the first chip starts at x=14 and the contentSize carries
        // the trailing margin). An inset needs the rest offset seeded to its
        // negative and UIKit re-clamps that at moments of its own choosing —
        // the row kept arriving 14–40pt left of home with its first chip
        // clipped at the screen edge. Content geometry cannot drift.
        addSubview(scroll)
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    private static func configure(_ button: UIButton, with seg: GlassSegmentSpec) {
        var config: UIButton.Configuration
        if #available(iOS 26.0, *) {
            // CLEAR glass, not regular: regular carries its own adaptive
            // frost and reads as a solid capsule over a map however light
            // the tint — the reference's airiness is the clear variant.
            config = seg.active ? .prominentGlass() : .clearGlass()
        } else {
            config = seg.active ? .filled() : .gray()
        }
        config.cornerStyle = .capsule
        if !seg.symbol.isEmpty {
            let symbolConfig = UIImage.SymbolConfiguration(pointSize: 12.5, weight: .medium)
            config.image = UIImage(systemName: seg.symbol, withConfiguration: symbolConfig)?
                .withRenderingMode(.alwaysTemplate)
            config.imagePlacement = .leading
            // No phantom gap on an icon-only chip (Filters).
            config.imagePadding = seg.title.isEmpty ? 0 : 6
        }
        // An icon-only chip takes wider insets: a lone 12pt glyph inside the
        // text insets came out as a pinched upright oval rather than a pill.
        let side: CGFloat = seg.title.isEmpty ? 22 : 15
        config.contentInsets = NSDirectionalEdgeInsets(top: 0, leading: side, bottom: 0, trailing: side)
        // Chosen: white on the chip's fill (the brand rust, or ink). Not
        // chosen: the chrome ink on the tinted glass.
        let foreground: UIColor = seg.active ? .white : GlassTabBar.glassInk
        config.baseBackgroundColor = seg.active ? seg.tint : GlassTabBar.glassTint
        config.baseForegroundColor = foreground
        if !seg.active {
            config.background.strokeColor = GlassTabBar.glassRim
            config.background.strokeWidth = 1
        }
        var container = AttributeContainer()
        container.font = .systemFont(ofSize: 13.5, weight: .semibold)
        container.foregroundColor = foreground
        config.attributedTitle = seg.title.isEmpty ? nil : AttributedString(seg.title, attributes: container)
        config.titleLineBreakMode = .byClipping
        // The prominent configuration resolves a foreground of its own from
        // the fill, after — and over — the attributed string's. The
        // transformer is the one hook that runs later still.
        config.titleTextAttributesTransformer = UIConfigurationTextAttributesTransformer { incoming in
            var out = incoming
            out.foregroundColor = foreground
            out.font = .systemFont(ofSize: 13.5, weight: .semibold)
            return out
        }
        button.configuration = config
        button.accessibilityLabel = seg.label
        button.accessibilityTraits = seg.active ? [.button, .selected] : .button
    }

    func apply(_ spec: GlassButtonSpec) {
        let incomingIds = spec.segments.map(\.id)
        let incomingShape = spec.segments.map { "\($0.id)|\($0.title)|\($0.active)|\($0.symbol)" }
        if incomingIds != ids {
            buttons.forEach { $0.removeFromSuperview() }
            buttons = spec.segments.map { seg in
                let button = UIButton(type: .custom)
                Self.configure(button, with: seg)
                button.addTarget(self, action: #selector(chipTapped(_:)), for: .touchUpInside)
                scroll.addSubview(button)
                return button
            }
            iconOnly = spec.segments.map { $0.title.isEmpty }
            ids = incomingIds
            shape = incomingShape
            setNeedsLayout()
        } else if incomingShape != shape {
            shape = incomingShape
            for (index, seg) in spec.segments.enumerated() where index < buttons.count {
                Self.configure(buttons[index], with: seg)
            }
            setNeedsLayout()
        }
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        // Offset survives relayout: the row must not jump back to its start
        // because a chip's label changed under a toggle.
        let offset = scroll.contentOffset
        scroll.frame = bounds
        let height: CGFloat = min(36, bounds.height)
        // Side margins live in the content — see the note in init.
        var x: CGFloat = 14
        for (index, button) in buttons.enumerated() {
            let floor: CGFloat = index < iconOnly.count && iconOnly[index] ? 54 : 44
            let width = max(ceil(button.intrinsicContentSize.width), floor)
            button.frame = CGRect(x: x, y: (bounds.height - height) / 2, width: width, height: height)
            x += width + 10
        }
        scroll.contentSize = CGSize(width: max(0, x - 10 + 14), height: bounds.height)
        scroll.contentOffset = offset
    }

    @objc private func chipTapped(_ sender: UIButton) {
        guard let index = buttons.firstIndex(where: { $0 === sender }), index < ids.count else { return }
        onTap?(ids[index])
    }
}

final class GlassSearchFieldView: UIView, UITextFieldDelegate {
    /// The ground is a DISABLED button wearing the same clear-glass
    /// configuration as every other capsule in the chrome — not a
    /// `UIGlassEffect` view. The two pipelines tint differently, and the
    /// field kept reading as a slightly different colour from the buttons
    /// beside it; drawing every capsule through one pipeline ends that by
    /// construction. While the field is read-only the ground button is
    /// live, so the closed state gets the configuration's own press
    /// physics and the tap that opens search.
    private let bg = UIButton(type: .custom)
    private let magnifier = UIImageView()
    private let field = UITextField()
    /// -1 so the first payload seeds the text; focus starts in agreement
    /// with the page's generation 0 and moves only on a real transition.
    private var appliedTextGen = -1
    private var appliedFocusGen = 0
    private var appliedSymbol = "magnifyingglass"
    /// Mirrors the spec: whether a tap on the glass should begin editing.
    private var editable = false

    var onTap: (() -> Void)?
    var onChange: ((String) -> Void)?
    var onSubmit: (() -> Void)?

    override init(frame: CGRect) {
        super.init(frame: frame)
        var config: UIButton.Configuration
        if #available(iOS 26.0, *) {
            config = .clearGlass()
        } else {
            config = .gray()
        }
        config.cornerStyle = .capsule
        config.contentInsets = .zero
        config.baseBackgroundColor = GlassTabBar.glassTint
        config.background.strokeColor = GlassTabBar.glassRim
        config.background.strokeWidth = 1
        bg.configuration = config
        bg.addTarget(self, action: #selector(pressed), for: .touchUpInside)
        addSubview(bg)
        clipsToBounds = false

        let symbolConfig = UIImage.SymbolConfiguration(pointSize: 16, weight: .medium)
        magnifier.image = UIImage(systemName: "magnifyingglass", withConfiguration: symbolConfig)?
            .withRenderingMode(.alwaysTemplate)
        magnifier.tintColor = GlassTabBar.glassInk.withAlphaComponent(0.8)
        magnifier.contentMode = .center
        magnifier.isUserInteractionEnabled = false
        addSubview(magnifier)

        field.font = .systemFont(ofSize: 17)
        field.textColor = .label
        // The caret in the brand colour, matching every other tinted control.
        field.tintColor = GlassTabBar.primary
        field.clearButtonMode = .whileEditing
        field.returnKeyType = .search
        field.autocorrectionType = .no
        field.autocapitalizationType = .none
        field.spellCheckingType = .no
        field.delegate = self
        field.addTarget(self, action: #selector(edited), for: .editingChanged)
        addSubview(field)

    }

    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    override func layoutSubviews() {
        super.layoutSubviews()
        bg.frame = bounds
        let iconWidth = magnifier.image?.size.width ?? 17
        magnifier.frame = CGRect(x: 16, y: 0, width: iconWidth, height: bounds.height)
        let fieldX = magnifier.frame.maxX + 7
        field.frame = CGRect(x: fieldX, y: 0, width: bounds.width - fieldX - 10, height: bounds.height)
    }

    func apply(_ spec: GlassButtonSpec) {
        // The leading glyph is the page's to choose — the location field
        // wears the compass arrow, the search field the magnifier.
        let symbol = spec.symbol.isEmpty ? "magnifyingglass" : spec.symbol
        if symbol != appliedSymbol {
            appliedSymbol = symbol
            let symbolConfig = UIImage.SymbolConfiguration(pointSize: 16, weight: .medium)
            magnifier.image = UIImage(systemName: symbol, withConfiguration: symbolConfig)?
                .withRenderingMode(.alwaysTemplate)
            setNeedsLayout()
        }
        if field.placeholder != spec.title {
            field.attributedPlaceholder = NSAttributedString(
                string: spec.title,
                attributes: [.foregroundColor: GlassTabBar.glassInk.withAlphaComponent(0.75)]
            )
        }
        // The ground button is ALWAYS live, so every field carries the
        // configuration's press physics — the lens is what makes the bar
        // read as interactive glass rather than a styled input. While no
        // edit session is running the text field stands down so the whole
        // capsule presses; the tap then either opens search (read-only) or
        // begins editing. During an edit session the text field takes the
        // touches (caret, selection, clear).
        editable = spec.fieldEditable
        field.isUserInteractionEnabled = spec.fieldEditable && field.isFirstResponder
        bg.isUserInteractionEnabled = true
        if spec.fieldTextGen != appliedTextGen {
            appliedTextGen = spec.fieldTextGen
            if field.text != spec.fieldText { field.text = spec.fieldText }
        }
        // A focus generation is only consumed while the field is actually
        // visible. The takeover mounts at opacity 0 and fades in, so the
        // first payloads carry alpha ≈ 0 — consuming the generation there
        // summoned the keyboard and the very next line resigned it for
        // being invisible, which read as autofocus simply not working. Left
        // pending, the generation applies on the first push where the fade
        // has actually begun, and the keyboard rises with the wash.
        if spec.fieldFocusGen != appliedFocusGen, spec.alpha > 0.05 {
            appliedFocusGen = spec.fieldFocusGen
            if spec.fieldFocused, spec.fieldEditable {
                if !field.isFirstResponder {
                    field.isUserInteractionEnabled = true
                    field.becomeFirstResponder()
                }
            } else if !spec.fieldFocused, field.isFirstResponder {
                field.resignFirstResponder()
            }
        }
        // Standing down — a sheet above it, a navigation away — has to take
        // the keyboard along: nothing else will, now that the editor is not
        // the WebView's.
        if spec.alpha <= 0.05, field.isFirstResponder {
            field.resignFirstResponder()
        }
        accessibilityLabel = spec.label
    }

    @objc private func edited() { onChange?(field.text ?? "") }
    @objc private func pressed() {
        if editable {
            field.isUserInteractionEnabled = true
            field.becomeFirstResponder()
        } else {
            onTap?()
        }
    }

    func textFieldShouldReturn(_ textField: UITextField) -> Bool {
        textField.resignFirstResponder()
        onSubmit?()
        return true
    }

    func textFieldDidEndEditing(_ textField: UITextField) {
        // Stand the editor down so the next tap lands on the glass and
        // plays the press before re-entering the edit session.
        textField.isUserInteractionEnabled = false
    }
}

/// Drawn glyphs for glass CONTROLS, rendered at the point size the caller
/// worked out rather than at a tab bar's fixed 28pt — which is why this is
/// its own type rather than another case in `GlassTabBar.TabGlyph`.
///
/// It exists because SF Symbols has no teardrop map marker. The whole
/// `mappin`/`pin` family is a PUSHPIN — `mappin` is a stalk with a bead,
/// `mappin.and.ellipse` adds a base underneath it — and a pushpin is a
/// different object from the drop-pin every maps UI uses. Drawing the mark
/// here is what lets a button wear the real lens AND the right icon; going
/// through `UIImage(systemName:)` alone, it could only have one or the other.
private enum AppGlyph {
    /// The box the path below is drawn in, SVG-style with y growing down.
    private static let box: CGFloat = 24

    static func named(_ name: String, pointSize: CGFloat) -> UIImage? {
        switch name {
        case "app.mappin": return mapPin(pointSize: pointSize)
        case "app.paperplane": return paperPlane(pointSize: pointSize)
        default: return nil
        }
    }

    /// The lucide `MapPin` the web layer draws, transcribed — so the native
    /// glyph and the CSS fallback are the same mark.
    private static func mapPin(pointSize: CGFloat) -> UIImage {
        // SF Symbols lays a glyph out in a box somewhat taller than its point
        // size; matching that keeps this the same visual weight as the system
        // symbols on the buttons either side of it.
        let side = pointSize * 1.42
        let scale = side / box
        let cg = CGMutablePath()
        cg.move(to: CGPoint(x: 4, y: 10))
        // The head: a half circle of r=8 about (12,10). y grows DOWNWARD in
        // this box, so sweeping π → 2π passes over the top, not under.
        cg.addArc(center: CGPoint(x: 12, y: 10), radius: 8,
                  startAngle: .pi, endAngle: 2 * .pi, clockwise: false)
        // Down the right flank to the point, then back up the left.
        cg.addCurve(to: CGPoint(x: 12, y: 21.9),
                    control1: CGPoint(x: 20, y: 14.99),
                    control2: CGPoint(x: 14.46, y: 20.19))
        cg.addCurve(to: CGPoint(x: 4, y: 10),
                    control1: CGPoint(x: 9.54, y: 20.19),
                    control2: CGPoint(x: 4, y: 14.99))
        cg.closeSubpath()
        // The hollow centre.
        cg.addEllipse(in: CGRect(x: 9, y: 7, width: 6, height: 6))

        let path = UIBezierPath(cgPath: cg)
        path.apply(CGAffineTransform(scaleX: scale, y: scale))
        path.lineWidth = 1.9 * scale
        path.lineCapStyle = .round
        path.lineJoinStyle = .round
        let renderer = UIGraphicsImageRenderer(size: CGSize(width: side, height: side))
        return renderer.image { _ in
            UIColor.label.setStroke()
            path.stroke()
        }.withRenderingMode(.alwaysTemplate)
    }

    /// The share glyph the web layer draws (a custom paper plane, not SF
    /// Symbols' `paperplane`, whose silhouette doesn't match) — transcribed
    /// so every share button in the app, native or CSS fallback, is the
    /// same mark.
    private static func paperPlane(pointSize: CGFloat) -> UIImage {
        let side = pointSize * 1.42
        let scale = side / box
        let cg = CGMutablePath()
        cg.move(to: CGPoint(x: 20.8, y: 3.2))
        cg.addLine(to: CGPoint(x: 10.4, y: 13.6))
        cg.move(to: CGPoint(x: 20.8, y: 3.2))
        cg.addLine(to: CGPoint(x: 14.3, y: 20.8))
        cg.addLine(to: CGPoint(x: 10.4, y: 13.6))
        cg.addLine(to: CGPoint(x: 3.2, y: 9.4))
        cg.closeSubpath()

        let path = UIBezierPath(cgPath: cg)
        path.apply(CGAffineTransform(scaleX: scale, y: scale))
        path.lineWidth = 2 * scale
        path.lineCapStyle = .round
        path.lineJoinStyle = .round
        let renderer = UIGraphicsImageRenderer(size: CGSize(width: side, height: side))
        return renderer.image { _ in
            UIColor.label.setStroke()
            path.stroke()
        }.withRenderingMode(.alwaysTemplate)
    }
}

final class GlassButtonView: UIView {
    /// The material. One `UIGlassEffect`, interactive, with the button and
    /// its glyph laid INSIDE its `contentView` — the same construction as
    /// the action group beside it, and the reason the glyph now rides the
    /// lens. The previous build was a `UIButton` wearing the glass
    /// *configuration* with the glyph as a sibling image view: the system
    /// swelled and leaned the glass under the finger and the glyph stayed
    /// put, so a dragged back button was a lens sliding out from under its
    /// arrow. Content inside the effect view's content view is part of what
    /// the system moves.
    private let glass: UIVisualEffectView
    /// `.custom`, not `.system`, and inside `contentView` — where hit-testing
    /// resolves to it because it is genuinely above the material. (A button
    /// *around* an effect view was tried once and swallowed every tap.) A
    /// system button would wash its glyph out for the whole press; the
    /// system's own glass controls keep theirs at full strength while the
    /// glass moves around it.
    private let control = UIButton(type: .custom)
    private let icon = UIImageView()
    private let badge = BadgeLabel()
    /// A pill's content — glyph + word in a stack pinned to the centre.
    private let pillStack = UIStackView()
    private let pillIcon = UIImageView()
    private let pillLabel = UILabel()
    /// Which material is installed. Swapping between plain and prominent
    /// glass means a new effect, and installing one every frame would
    /// throw away the press animation mid-gesture.
    private var appliedProminent: Bool?
    private var appliedTintName: String?

    var onTap: (() -> Void)?

    /// True while a finger is on the button. A measured frame pushed
    /// mid-press lands under the live press transform, which is undefined,
    /// and the settle would return the capsule to the wrong home.
    var isLiquidActive: Bool { control.isTracking || control.isHighlighted }

    private static func makeEffect(prominent: Bool, fill: UIColor) -> UIVisualEffect {
        if #available(iOS 26.0, *) {
            // Plain: CLEAR glass wearing the family tint, the same pipeline
            // as the action group and the chips, so the set reads as one
            // material. Prominent: the tinted lens — still refracting, with
            // the selection's fill in it.
            let effect = UIGlassEffect(style: prominent ? .regular : .clear)
            effect.isInteractive = true
            effect.tintColor = prominent ? fill : GlassTabBar.glassTint
            return effect
        }
        return UIBlurEffect(style: .systemChromeMaterial)
    }

    init() {
        glass = UIVisualEffectView(effect: GlassButtonView.makeEffect(prominent: false, fill: .clear))
        super.init(frame: .zero)
        // The press swells the capsule past its own bounds; clipping would
        // shear the very animation this exists for.
        clipsToBounds = false
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

        control.translatesAutoresizingMaskIntoConstraints = false
        control.addTarget(self, action: #selector(handleTap), for: .touchUpInside)
        glass.contentView.addSubview(control)
        NSLayoutConstraint.activate([
            control.topAnchor.constraint(equalTo: glass.contentView.topAnchor),
            control.bottomAnchor.constraint(equalTo: glass.contentView.bottomAnchor),
            control.leadingAnchor.constraint(equalTo: glass.contentView.leadingAnchor),
            control.trailingAnchor.constraint(equalTo: glass.contentView.trailingAnchor),
        ])

        icon.contentMode = .center
        icon.isUserInteractionEnabled = false
        icon.translatesAutoresizingMaskIntoConstraints = false
        control.addSubview(icon)
        NSLayoutConstraint.activate([
            icon.centerXAnchor.constraint(equalTo: control.centerXAnchor),
            icon.centerYAnchor.constraint(equalTo: control.centerYAnchor),
        ])

        pillStack.axis = .horizontal
        pillStack.alignment = .center
        pillStack.spacing = 6
        pillStack.isUserInteractionEnabled = false
        pillStack.isHidden = true
        pillStack.translatesAutoresizingMaskIntoConstraints = false
        pillStack.addArrangedSubview(pillIcon)
        pillStack.addArrangedSubview(pillLabel)
        control.addSubview(pillStack)
        NSLayoutConstraint.activate([
            pillStack.centerXAnchor.constraint(equalTo: control.centerXAnchor),
            pillStack.centerYAnchor.constraint(equalTo: control.centerYAnchor),
        ])

        // Above the glass, not through it: a count read through the
        // material is a washed-out smudge, and it is meant to be the
        // loudest thing on the control.
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

    /// The family hairline on the effect view's layer — the rim every
    /// capsule wears. A prominent capsule has a fill of its own and no rim.
    private func applyRim() {
        let rim = appliedProminent == true ? UIColor.clear : GlassTabBar.glassRim.resolvedColor(with: traitCollection)
        glass.layer.borderColor = rim.cgColor
        glass.layer.borderWidth = 1
        glass.layer.cornerRadius = bounds.height / 2
        glass.layer.cornerCurve = .continuous
        glass.layer.masksToBounds = false
    }

    override func traitCollectionDidChange(_ previous: UITraitCollection?) {
        super.traitCollectionDidChange(previous)
        applyRim()
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        applyRim()
        if #available(iOS 26.0, *) {} else {
            glass.layer.cornerRadius = min(bounds.width, bounds.height) / 2
        }
        badge.layer.cornerRadius = badge.bounds.height / 2
        bringSubviewToFront(badge)
    }

    /// What a pill actually needs: its centred stack plus even margins.
    func pillNeededWidth() -> CGFloat {
        pillStack.systemLayoutSizeFitting(UIView.layoutFittingCompressedSize).width + 30
    }

    func apply(_ spec: GlassButtonSpec) {
        let fill: UIColor = spec.tintName == "primary" ? GlassTabBar.primary : .label
        // Selection is a different MATERIAL, not a colour swapped into the
        // same one. Installed only on the transition — a new effect restarts
        // the material from scratch, press animation included.
        if appliedProminent != spec.prominent || appliedTintName != spec.tintName {
            appliedProminent = spec.prominent
            appliedTintName = spec.tintName
            glass.effect = GlassButtonView.makeEffect(prominent: spec.prominent, fill: fill)
            applyRim()
        }
        // Sized off the button rather than fixed, so the same spec works for
        // the 44pt chrome buttons and anything smaller. A chip's glyph is
        // fixed instead: it has to agree with the 13px icon the page
        // reserved room for, not with the capsule's height.
        let isChip = spec.role == "chip"
        // A pill's glyph is sized against its LABEL, not its capsule.
        let isLabelledPill = !spec.title.isEmpty && spec.titleStyle == "chip"
        let point = isChip ? 13 : isLabelledPill ? 11.5 : max(15, min(22, spec.frame.height * 0.44))
        let symbolConfig = UIImage.SymbolConfiguration(pointSize: point, weight: isLabelledPill ? .bold : .regular)
        // `app.*` names are the app's own drawn glyphs (see `AppGlyph`), for
        // marks SF Symbols simply doesn't have. Anything else is a symbol.
        let image = (AppGlyph.named(spec.symbol, pointSize: point)
            ?? UIImage(systemName: spec.symbol, withConfiguration: symbolConfig))?
            .withRenderingMode(.alwaysTemplate)
        // On a fill, the glyph has to be legible against it; on the lens it
        // wears the page's ink.
        let foreground: UIColor = spec.prominent
            ? (spec.tintName == "primary" ? .white : .systemBackground)
            : spec.tint

        if spec.title.isEmpty {
            pillStack.isHidden = true
            icon.image = image
            icon.tintColor = foreground
            icon.isHidden = false
        } else {
            icon.isHidden = true
            pillStack.isHidden = false
            pillIcon.image = image
            pillIcon.tintColor = foreground
            pillIcon.isHidden = spec.symbol.isEmpty || image == nil
            pillLabel.text = spec.title
            pillLabel.font = .systemFont(ofSize: 13, weight: .semibold)
            pillLabel.textColor = foreground
        }
        control.accessibilityLabel = spec.label
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
        case field(GlassSearchFieldView)
        case actions(GlassActionGroupView)
        case selector(GlassSelectorBarView)
        case chips(GlassChipRowView)

        var view: UIView {
            switch self {
            case .button(let v): return v
            case .field(let v): return v
            case .actions(let v): return v
            case .selector(let v): return v
            case .chips(let v): return v
            }
        }

        /// Whether this view is still the right *kind* for the spec. A pair
        /// that collapses to a single button when Circle hides on its own
        /// page has to be rebuilt, not reused.
        func fits(_ spec: GlassButtonSpec) -> Bool {
            switch self {
            case .button: return spec.segments.isEmpty && spec.role != "field"
            case .field: return spec.segments.isEmpty && spec.role == "field"
            case .actions: return !spec.segments.isEmpty && spec.kind == .actions
            case .selector: return !spec.segments.isEmpty && spec.kind == .selector
            case .chips: return !spec.segments.isEmpty && spec.kind == .chips
            }
        }
    }

    private var views: [String: Chrome] = [:]
    private weak var host: UIView?
    var onTap: ((String) -> Void)?
    var onFieldChange: ((String, String) -> Void)?
    var onFieldSubmit: ((String) -> Void)?

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
            if let existing = views[spec.id], !existing.fits(spec) {
                existing.view.removeFromSuperview()
                views.removeValue(forKey: spec.id)
            }
            let chrome: Chrome
            if let existing = views[spec.id] {
                chrome = existing
                        } else if !spec.segments.isEmpty, spec.kind == .chips {
                let view = GlassChipRowView(frame: spec.frame)
                view.onTap = { [weak self] id in self?.onTap?(id) }
                views[spec.id] = .chips(view)
                host.addSubview(view)
                chrome = .chips(view)
            } else if !spec.segments.isEmpty, spec.kind == .actions {
                let view = GlassActionGroupView(frame: spec.frame)
                view.onTap = { [weak self] id in self?.onTap?(id) }
                views[spec.id] = .actions(view)
                host.addSubview(view)
                chrome = .actions(view)
            } else if !spec.segments.isEmpty {
                let view = GlassSelectorBarView(frame: spec.frame)
                view.onTap = { [weak self] id in self?.onTap?(id) }
                views[spec.id] = .selector(view)
                host.addSubview(view)
                chrome = .selector(view)
            } else if spec.role == "field" {
                let view = GlassSearchFieldView(frame: spec.frame)
                view.onTap = { [weak self] in self?.onTap?(spec.id) }
                view.onChange = { [weak self] text in self?.onFieldChange?(spec.id, text) }
                view.onSubmit = { [weak self] in self?.onFieldSubmit?(spec.id) }
                views[spec.id] = .field(view)
                host.addSubview(view)
                chrome = .field(view)
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
                // Content BEFORE measurement. `fit` asks the button how wide
                // it needs to be, and a button answers for the content it is
                // currently carrying — so measuring first sized every pill
                // against the previous spec's title, or against no title at
                // all on the frame it was created. The payload only pushes on
                // change, so nothing came along afterwards to correct it: a
                // chip simply stayed at whatever width the stale answer gave
                // and clipped its own label.
                //
                // And no frame at all while a finger is on it — the same rule
                // the groups keep. The next push after release trues it up.
                if !button.isLiquidActive { button.frame = spec.frame }
                button.apply(spec)
                button.layoutIfNeeded()
                if !button.isLiquidActive { button.frame = Self.fit(spec, in: host, view: button) }
            case .field(let search):
                // The web box exactly — a field's width is the page's to
                // decide, unlike a pill's, whose label can outgrow it.
                search.frame = spec.frame
                search.apply(spec)
            case .actions(let group):
                if !group.isLiquidActive { group.frame = spec.frame }
                group.apply(spec)
            case .selector(let group):
                if !group.isLiquidActive { group.frame = spec.frame }
                group.apply(spec)
            case .chips(let row):
                row.frame = spec.frame
                row.apply(spec)
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
        let needed = view.pillNeededWidth()
        guard needed > spec.frame.width else { return spec.frame }
        var frame = spec.frame
        frame.size.width = needed
        // A chip lives in a scrolling row with its neighbours, so it cannot
        // anchor to an edge of the screen the way a lone header pill does —
        // it grows symmetrically into the gap instead, which is where the few
        // points of difference between the page's font and the system's go.
        if spec.role == "chip" {
            frame.origin.x = spec.frame.midX - needed / 2
            return frame
        }
        if spec.frame.midX > host.bounds.midX {
            frame.origin.x = spec.frame.maxX - needed
        }
        return frame
    }
}
