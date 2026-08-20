import Capacitor
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
//   - setVisible({ visible, animated })      → hide for keyboard / overlays
//   - removeTabBar()                         → tear down, hand back to web
// Events:
//   - "tabSelected" { path }                 → JS routes
//   - "supportChanged" { supported }         → Reduce Transparency toggled
//
// Setup in Xcode: none. This file is already a member of the App target, and
// MainViewController.capacitorDidLoad registers the instance explicitly.
//
// VERIFY ON DEVICE (cannot be checked without building):
//   1. That UIVisualEffectView's backdrop actually samples WKWebView content.
//      WebKit composites out of process; if the bar looks like frosted *grey*
//      rather than a lensed view of the page beneath it, that sampling isn't
//      happening and the whole approach needs rethinking. Scroll a colourful
//      grid (Lists → Collections) under the bar and watch the tint move.
//   2. `UIGlassEffect`'s exact API surface. It is walled behind
//      `#available(iOS 26.0, *)` in one function (`makeGlassEffect`) so a
//      signature change is a one-line fix, and every older OS already takes
//      the UIBlurEffect path.
//   3. Tap targets: the bar is added to the bridge view controller's view, so
//      it sits above the WebView and swallows taps in its own bounds only.
// ─────────────────────────────────────────────────────────────────────────────

@objc(LiquidGlassPlugin)
public class LiquidGlassPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "LiquidGlassPlugin"
    public let jsName = "LiquidGlass"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "isSupported", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "configureTabBar", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setActiveTab", returnType: CAPPluginReturnPromise),
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
                self.tabBar = created
                bar = created
            }
            bar.install(in: host, variant: variant == "bar" ? .bar : .capsule)
            bar.setItems(items, activePath: activePath)
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

/// The bar itself. Kept free of Capacitor types so it stays readable as plain
/// UIKit — the plugin above is only a transport.
final class GlassTabBar {
    struct Item {
        let path: String
        let symbol: String
        let label: String
    }

    enum Variant {
        /// iOS 26's floating pill, inset from the screen edges.
        case capsule
        /// Flush full-width bar — the web nav's existing footprint.
        case bar
    }

    /// #9f3012, the app's `--color-primary`. Duplicated here rather than read
    /// from the page: the bar has to draw before the WebView has told us
    /// anything, and this value is stable brand chrome.
    private static let primary = UIColor(red: 0.624, green: 0.188, blue: 0.071, alpha: 1.0)

    var onSelect: ((String) -> Void)?

    private var effectView: UIVisualEffectView?
    private var stack: UIStackView?
    private var buttons: [UIButton] = []
    private var items: [Item] = []
    private var activePath: String?
    private var variant: Variant = .capsule
    private var visible = true

    // MARK: Install

    func install(in host: UIView, variant: Variant) {
        if let existing = effectView, existing.superview === host, self.variant == variant {
            host.bringSubviewToFront(existing)
            // A cancelled dismissal leaves it faded out and non-interactive.
            resetPresentation()
            return
        }
        removeFromHost()
        self.variant = variant

        let effectView = UIVisualEffectView(effect: Self.makeGlassEffect())
        effectView.translatesAutoresizingMaskIntoConstraints = false
        effectView.clipsToBounds = true
        effectView.layer.cornerCurve = .continuous
        // Half the 56pt height constraint below, so the capsule is a true
        // pill. The flush bar stays square against the screen edge.
        effectView.layer.cornerRadius = variant == .capsule ? 28 : 0

        let stack = UIStackView()
        stack.axis = .horizontal
        stack.distribution = .fillEqually
        stack.alignment = .center
        stack.translatesAutoresizingMaskIntoConstraints = false
        effectView.contentView.addSubview(stack)

        host.addSubview(effectView)
        // Above the WebView, below anything the shell presents modally.
        host.bringSubviewToFront(effectView)

        let guide = host.safeAreaLayoutGuide
        var constraints: [NSLayoutConstraint] = [
            stack.topAnchor.constraint(equalTo: effectView.contentView.topAnchor),
            stack.bottomAnchor.constraint(equalTo: effectView.contentView.bottomAnchor),
            stack.leadingAnchor.constraint(equalTo: effectView.contentView.leadingAnchor),
            stack.trailingAnchor.constraint(equalTo: effectView.contentView.trailingAnchor),
        ]
        switch variant {
        case .capsule:
            constraints += [
                effectView.leadingAnchor.constraint(equalTo: guide.leadingAnchor, constant: 16),
                effectView.trailingAnchor.constraint(equalTo: guide.trailingAnchor, constant: -16),
                effectView.bottomAnchor.constraint(equalTo: guide.bottomAnchor, constant: -8),
                effectView.heightAnchor.constraint(equalToConstant: 56),
            ]
        case .bar:
            constraints += [
                effectView.leadingAnchor.constraint(equalTo: host.leadingAnchor),
                effectView.trailingAnchor.constraint(equalTo: host.trailingAnchor),
                effectView.bottomAnchor.constraint(equalTo: host.bottomAnchor),
                effectView.topAnchor.constraint(equalTo: guide.bottomAnchor, constant: -50),
            ]
        }
        NSLayoutConstraint.activate(constraints)

        self.effectView = effectView
        self.stack = stack
        resetPresentation()
    }

    /// Back to fully shown, whatever a half-finished animation left behind.
    private func resetPresentation() {
        visible = true
        guard let effectView else { return }
        effectView.layer.removeAllAnimations()
        effectView.alpha = 1
        effectView.transform = .identity
        effectView.isUserInteractionEnabled = true
    }

    func removeFromHost() {
        effectView?.removeFromSuperview()
        effectView = nil
        stack = nil
        buttons = []
    }

    // MARK: Items

    func setItems(_ items: [Item], activePath: String?) {
        guard let stack else { return }
        self.items = items
        self.activePath = activePath ?? items.first?.path

        buttons.forEach { $0.removeFromSuperview() }
        stack.arrangedSubviews.forEach { stack.removeArrangedSubview($0); $0.removeFromSuperview() }
        buttons = items.enumerated().map { index, item in
            let button = UIButton(type: .system)
            button.accessibilityLabel = item.label
            // Image and tint come from applyActiveStyling() below — it runs
            // in the same turn, so nothing renders imageless.
            button.addAction(
                UIAction { [weak self] _ in self?.select(index) },
                for: .touchUpInside
            )
            stack.addArrangedSubview(button)
            return button
        }
        applyActiveStyling()
    }

    func setActive(path: String) {
        guard path != activePath else { return }
        activePath = path
        applyActiveStyling()
    }

    private func applyActiveStyling() {
        for (index, item) in items.enumerated() {
            guard index < buttons.count else { break }
            let isActive = item.path == activePath
            let button = buttons[index]
            button.tintColor = isActive ? Self.primary : UIColor.label.withAlphaComponent(0.5)
            button.setImage(
                UIImage(
                    systemName: item.symbol,
                    withConfiguration: UIImage.SymbolConfiguration(
                        pointSize: 22,
                        weight: isActive ? .semibold : .regular
                    )
                ),
                for: .normal
            )
            button.accessibilityTraits = isActive ? [.button, .selected] : [.button]
        }
    }

    private func select(_ index: Int) {
        guard index < items.count else { return }
        UIImpactFeedbackGenerator(style: .light).impactOccurred()
        onSelect?(items[index].path)
    }

    // MARK: Visibility

    /// Mirrors the web nav's hide animation (fade + 20px drop) so the two
    /// implementations are indistinguishable when one replaces the other.
    func setVisible(_ next: Bool, animated: Bool) {
        guard next != visible, let effectView else {
            visible = next
            return
        }
        visible = next
        let apply = {
            effectView.alpha = next ? 1 : 0
            effectView.transform = next ? .identity : CGAffineTransform(translationX: 0, y: 20)
        }
        effectView.isUserInteractionEnabled = next
        if animated {
            UIView.animate(withDuration: 0.2, delay: 0, options: [.beginFromCurrentState, .curveEaseOut], animations: apply)
        } else {
            apply()
        }
    }

    /// Animate out, then hand back for removal. Matches the web nav's
    /// 200ms fade + 20px drop.
    func dismiss(completion: @escaping () -> Void) {
        guard let effectView else {
            completion()
            return
        }
        effectView.isUserInteractionEnabled = false
        UIView.animate(
            withDuration: 0.2,
            delay: 0,
            options: [.beginFromCurrentState, .curveEaseOut],
            animations: {
                effectView.alpha = 0
                effectView.transform = CGAffineTransform(translationX: 0, y: 20)
            },
            completion: { _ in completion() }
        )
    }

    // MARK: Material

    /// The single place the iOS 26 API is touched. Everything older — and any
    /// future signature change — lands on the blur fallback, which is the
    /// same material the system chrome used before Liquid Glass.
    private static func makeGlassEffect() -> UIVisualEffect {
        if #available(iOS 26.0, *) {
            let effect = UIGlassEffect()
            // Interactive glass responds to touch with the material's own
            // highlight and scale, which is most of what makes it read as
            // Liquid Glass rather than a blurred rectangle.
            effect.isInteractive = true
            return effect
        }
        return UIBlurEffect(style: .systemChromeMaterial)
    }
}
