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
    /// KVO on the WebView's scroll view. The page scrolls the document on
    /// every tab root, so this is the whole scroll signal — no per-frame
    /// chatter across the JS bridge just to shrink a bar.
    private var scrollObservation: NSKeyValueObservation?
    private var lastScrollY: CGFloat = 0
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
            // A route change lands at the top of the new page, so whatever
            // the previous page's scroll left behind doesn't apply.
            bar.setCollapsed(false, animated: false)
            self.startObservingScroll()
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
        scrollObservation = nil
        tabBar?.removeFromHost()
        tabBar = nil
    }

    // MARK: - Shrink on scroll

    private func startObservingScroll() {
        guard scrollObservation == nil, let scrollView = bridge?.webView?.scrollView else { return }
        lastScrollY = scrollView.contentOffset.y
        scrollObservation = scrollView.observe(\.contentOffset, options: [.new]) { [weak self] view, _ in
            self?.handleScroll(view.contentOffset.y)
        }
    }

    /// Down shrinks, up restores, and the top always restores. `lastScrollY`
    /// only advances once a move clears the threshold, so a slow drag still
    /// accumulates into a decision instead of being filtered away forever.
    private func handleScroll(_ y: CGFloat) {
        guard let tabBar else { return }
        if y <= 12 {
            lastScrollY = y
            tabBar.setCollapsed(false, animated: true)
            return
        }
        let delta = y - lastScrollY
        guard abs(delta) > 6 else { return }
        lastScrollY = y
        tabBar.setCollapsed(delta > 0, animated: true)
    }

    deinit {
        scrollObservation = nil
        NotificationCenter.default.removeObserver(self)
    }
}

/// The bar itself. Kept free of Capacitor types so it stays readable as plain
/// UIKit — the plugin above is only a transport.
///
/// Shape notes, because the first pass read as "glass-ish" rather than
/// native: an iOS 26 tab bar is icon *over label*, the selected item sits on
/// a capsule that slides between positions rather than appearing in place,
/// you can drag along the bar to move the selection, and the whole thing
/// shrinks out of the way as you scroll down. All four are here.
final class GlassTabBar {
    struct Item {
        let path: String
        let symbol: String
        /// Filled counterpart drawn when the item is selected. Optional —
        /// several symbols (magnifyingglass, list.bullet) have no fill
        /// variant, and there the weight and tint change carry it.
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

    private var effectView: UIVisualEffectView?
    private var content: GlassTabBarContent?
    private var heightConstraint: NSLayoutConstraint?
    private var leadingConstraint: NSLayoutConstraint?
    private var trailingConstraint: NSLayoutConstraint?
    private var variant: Variant = .capsule
    private var visible = true
    private var collapsed = false

    /// Expanded vs. shrunk geometry. The shrunk bar drops its labels, loses
    /// a third of its height and pulls in from both edges, so it reads as
    /// having got out of the way rather than merely faded.
    private enum Metrics {
        static let expandedHeight: CGFloat = 64
        static let collapsedHeight: CGFloat = 48
        static let expandedInset: CGFloat = 16
        static let collapsedInset: CGFloat = 44
    }

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
        effectView.layer.cornerRadius = variant == .capsule ? Metrics.expandedHeight / 2 : 0

        let content = GlassTabBarContent(frame: .zero)
        content.translatesAutoresizingMaskIntoConstraints = false
        content.onSelect = { [weak self] path in self?.onSelect?(path) }
        effectView.contentView.addSubview(content)

        host.addSubview(effectView)
        // Above the WebView, below anything the shell presents modally.
        host.bringSubviewToFront(effectView)

        let guide = host.safeAreaLayoutGuide
        var constraints: [NSLayoutConstraint] = [
            content.topAnchor.constraint(equalTo: effectView.contentView.topAnchor),
            content.bottomAnchor.constraint(equalTo: effectView.contentView.bottomAnchor),
            content.leadingAnchor.constraint(equalTo: effectView.contentView.leadingAnchor),
            content.trailingAnchor.constraint(equalTo: effectView.contentView.trailingAnchor),
        ]
        switch variant {
        case .capsule:
            let leading = effectView.leadingAnchor.constraint(equalTo: guide.leadingAnchor, constant: Metrics.expandedInset)
            let trailing = effectView.trailingAnchor.constraint(equalTo: guide.trailingAnchor, constant: -Metrics.expandedInset)
            let height = effectView.heightAnchor.constraint(equalToConstant: Metrics.expandedHeight)
            leadingConstraint = leading
            trailingConstraint = trailing
            heightConstraint = height
            constraints += [
                leading,
                trailing,
                effectView.bottomAnchor.constraint(equalTo: guide.bottomAnchor, constant: -8),
                height,
            ]
        case .bar:
            constraints += [
                effectView.leadingAnchor.constraint(equalTo: host.leadingAnchor),
                effectView.trailingAnchor.constraint(equalTo: host.trailingAnchor),
                effectView.bottomAnchor.constraint(equalTo: host.bottomAnchor),
                effectView.topAnchor.constraint(equalTo: guide.bottomAnchor, constant: -Metrics.expandedHeight),
            ]
        }
        NSLayoutConstraint.activate(constraints)

        self.effectView = effectView
        self.content = content
        collapsed = false
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
        guard let effectView, let height = heightConstraint,
              let leading = leadingConstraint, let trailing = trailingConstraint else {
            collapsed = next
            return
        }
        collapsed = next
        height.constant = next ? Metrics.collapsedHeight : Metrics.expandedHeight
        leading.constant = next ? Metrics.collapsedInset : Metrics.expandedInset
        trailing.constant = next ? -Metrics.collapsedInset : -Metrics.expandedInset
        content?.setLabelsHidden(next, animated: animated)

        let apply = {
            effectView.layer.cornerRadius = (next ? Metrics.collapsedHeight : Metrics.expandedHeight) / 2
            effectView.superview?.layoutIfNeeded()
        }
        if animated {
            UIView.animate(
                withDuration: 0.42,
                delay: 0,
                usingSpringWithDamping: 0.86,
                initialSpringVelocity: 0,
                options: [.beginFromCurrentState, .allowUserInteraction],
                animations: apply
            )
        } else {
            apply()
        }
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

/// Everything inside the glass: the items, the sliding selection capsule, and
/// the gestures. A UIView subclass so it can re-anchor the selection on a
/// real layout pass (rotation, collapse, safe-area change) without the
/// coordinator having to notice.
final class GlassTabBarContent: UIView {
    /// #9f3012, the app's `--color-primary`. Duplicated here rather than read
    /// from the page: the bar has to draw before the WebView has told us
    /// anything, and this value is stable brand chrome.
    private static let primary = UIColor(red: 0.624, green: 0.188, blue: 0.071, alpha: 1.0)

    /// Inset of the item row inside the glass. Every cell frame has to be
    /// converted out of the stack's space before it can position the
    /// selection or resolve a touch — they differ by exactly this.
    private static let rowInset: CGFloat = 6

    var onSelect: ((String) -> Void)?

    private let selection = UIView()
    private let stack = UIStackView()
    private var itemViews: [GlassTabItemView] = []
    private var items: [GlassTabBar.Item] = []
    private var activeIndex: Int?
    /// Index under the finger mid-drag. The selection follows it live; the
    /// route only changes on release, so a swipe across the bar doesn't fire
    /// four navigations on its way past.
    private var draggingIndex: Int?
    private var labelsHidden = false
    /// Last size the selection was anchored against. Guards `layoutSubviews`
    /// from re-snapping the capsule mid-spring — `moveSelection` calls
    /// `layoutIfNeeded()`, and without this the snap would land the capsule
    /// on its target before the animation block ever ran, so nothing moved.
    private var lastBounds: CGRect = .zero
    private let dragFeedback = UISelectionFeedbackGenerator()

    override init(frame: CGRect) {
        super.init(frame: frame)
        selection.backgroundColor = Self.primary.withAlphaComponent(0.13)
        selection.layer.cornerCurve = .continuous
        selection.isUserInteractionEnabled = false
        selection.alpha = 0
        addSubview(selection)

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

        // One tap and one pan over the whole bar, rather than five buttons.
        // Buttons would have to fight the pan for the touch, and the pan is
        // the whole point of "drag along the bar to switch".
        addGestureRecognizer(UITapGestureRecognizer(target: self, action: #selector(handleTap(_:))))
        addGestureRecognizer(UIPanGestureRecognizer(target: self, action: #selector(handlePan(_:))))
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    // MARK: Items

    func setItems(_ items: [GlassTabBar.Item], activePath: String?) {
        self.items = items
        itemViews.forEach { stack.removeArrangedSubview($0); $0.removeFromSuperview() }
        itemViews = items.map { item in
            let view = GlassTabItemView(frame: .zero)
            view.configure(item: item, selected: false, tint: Self.primary)
            view.setLabelHidden(labelsHidden, animated: false)
            stack.addArrangedSubview(view)
            return view
        }
        // Force a re-anchor on the next layout pass: the cells are new.
        lastBounds = .zero
        let index = items.firstIndex { $0.path == activePath } ?? 0
        applySelection(index: index, animated: false)
    }

    func setActive(path: String, animated: Bool) {
        guard let index = items.firstIndex(where: { $0.path == path }), index != activeIndex else { return }
        applySelection(index: index, animated: animated)
    }

    func setLabelsHidden(_ hidden: Bool, animated: Bool) {
        guard hidden != labelsHidden else { return }
        labelsHidden = hidden
        itemViews.forEach { $0.setLabelHidden(hidden, animated: animated) }
    }

    private func applySelection(index: Int, animated: Bool) {
        guard index >= 0, index < itemViews.count else { return }
        activeIndex = index
        for (i, view) in itemViews.enumerated() {
            view.setSelected(i == index, animated: animated)
        }
        moveSelection(to: index, animated: animated)
    }

    /// Slide the capsule to sit behind `index`. Springy and interruptible, so
    /// a drag that reverses mid-flight tracks the finger instead of finishing
    /// the old animation first.
    private func moveSelection(to index: Int, animated: Bool) {
        guard index >= 0, index < itemViews.count else { return }
        layoutIfNeeded()
        guard let target = selectionFrame(for: index) else { return }
        selection.layer.cornerRadius = min(target.height, target.width) / 2
        let apply = {
            self.selection.frame = target
            self.selection.alpha = 1
        }
        if animated {
            UIView.animate(
                withDuration: 0.38,
                delay: 0,
                usingSpringWithDamping: 0.82,
                initialSpringVelocity: 0,
                options: [.beginFromCurrentState, .allowUserInteraction],
                animations: apply
            )
        } else {
            apply()
        }
    }

    /// The cell rect, converted out of the stack's coordinate space, inset so
    /// the capsule hugs the item rather than filling its cell. Nil before the
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
        guard let index = draggingIndex ?? activeIndex,
              let target = selectionFrame(for: index) else { return }
        selection.layer.cornerRadius = min(target.height, target.width) / 2
        selection.frame = target
        selection.alpha = 1
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

    @objc private func handleTap(_ gesture: UITapGestureRecognizer) {
        guard let index = index(atX: gesture.location(in: self).x) else { return }
        commit(index: index)
    }

    @objc private func handlePan(_ gesture: UIPanGestureRecognizer) {
        let x = gesture.location(in: self).x
        switch gesture.state {
        case .began, .changed:
            if gesture.state == .began { dragFeedback.prepare() }
            guard let index = index(atX: x), index != draggingIndex else { return }
            // Tick as the selection crosses into a new tab — the feedback is
            // most of what makes the drag feel physical rather than like a
            // rectangle following a finger.
            dragFeedback.selectionChanged()
            dragFeedback.prepare()
            draggingIndex = index
            for (i, view) in itemViews.enumerated() {
                view.setSelected(i == index, animated: true)
            }
            moveSelection(to: index, animated: true)
        case .ended:
            let index = draggingIndex
            draggingIndex = nil
            if let index { commit(index: index) }
        case .cancelled, .failed:
            draggingIndex = nil
            // Put the selection back where the route actually is.
            if let active = activeIndex { applySelection(index: active, animated: true) }
        default:
            break
        }
    }

    private func commit(index: Int) {
        guard index >= 0, index < items.count else { return }
        let alreadyActive = index == activeIndex
        applySelection(index: index, animated: true)
        // Re-tapping the current tab is a no-op for the router, but the
        // selection animation above still plays, which is the right feedback.
        guard !alreadyActive else { return }
        UIImpactFeedbackGenerator(style: .light).impactOccurred()
        onSelect?(items[index].path)
    }
}

/// One tab: symbol over label, both animating between selected states.
final class GlassTabItemView: UIView {
    private let icon = UIImageView()
    private let title = UILabel()
    private var item: GlassTabBar.Item?
    private var tint: UIColor = .label

    override init(frame: CGRect) {
        super.init(frame: frame)
        // Touches belong to the bar's own tap/pan recognizers.
        isUserInteractionEnabled = false
        isAccessibilityElement = true
        accessibilityTraits = .button

        icon.contentMode = .center
        icon.translatesAutoresizingMaskIntoConstraints = false
        addSubview(icon)

        title.font = .systemFont(ofSize: 10, weight: .semibold)
        title.textAlignment = .center
        title.adjustsFontSizeToFitWidth = true
        title.minimumScaleFactor = 0.8
        title.translatesAutoresizingMaskIntoConstraints = false
        addSubview(title)

        NSLayoutConstraint.activate([
            icon.centerXAnchor.constraint(equalTo: centerXAnchor),
            // Nudged up so icon + label read as one centred block. When the
            // label fades out on collapse the icon is close enough to centre
            // that nothing appears to jump.
            icon.centerYAnchor.constraint(equalTo: centerYAnchor, constant: -7),
            title.topAnchor.constraint(equalTo: icon.bottomAnchor, constant: 2),
            title.leadingAnchor.constraint(equalTo: leadingAnchor, constant: 2),
            title.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -2),
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

    func setSelected(_ next: Bool, animated: Bool) {
        guard let item else { return }
        accessibilityTraits = next ? [.button, .selected] : [.button]
        let name = next ? (item.selectedSymbol ?? item.symbol) : item.symbol
        let config = UIImage.SymbolConfiguration(pointSize: 21, weight: next ? .semibold : .regular)
        // A symbol name that doesn't resolve yields nil, which would leave a
        // blank tab. Fall back through the unfilled name to a shape that
        // always exists, so a typo costs an icon and not the whole bar.
        let image = UIImage(systemName: name, withConfiguration: config)
            ?? UIImage(systemName: item.symbol, withConfiguration: config)
            ?? UIImage(systemName: "circle", withConfiguration: config)
        let color: UIColor = next ? tint : .secondaryLabel
        icon.tintColor = color
        title.textColor = color
        title.font = .systemFont(ofSize: 10, weight: next ? .bold : .semibold)
        if animated {
            UIView.transition(with: icon, duration: 0.18, options: [.transitionCrossDissolve, .allowUserInteraction]) {
                self.icon.image = image
            }
        } else {
            icon.image = image
        }
    }

    func setLabelHidden(_ hidden: Bool, animated: Bool) {
        let apply = { self.title.alpha = hidden ? 0 : 1 }
        if animated {
            UIView.animate(withDuration: 0.2, delay: 0, options: [.beginFromCurrentState], animations: apply)
        } else {
            apply()
        }
    }
}
