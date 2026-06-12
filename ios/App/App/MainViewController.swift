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
            : UIColor(red: 237.0 / 255.0, green: 231.0 / 255.0, blue: 217.0 / 255.0, alpha: 1.0) // #EDE7D9
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = appBackground
    }

    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(PhotoLibraryPlugin())
        bridge?.registerPluginInstance(AppThemePlugin())

        if let webView = self.webView {
            // Opaque + app-colored so the web view's own backing is never black
            // (a transparent web view let the black window show through the
            // keyboard's corner cut-outs).
            webView.isOpaque = true
            webView.backgroundColor = appBackground
            webView.scrollView.backgroundColor = appBackground
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
