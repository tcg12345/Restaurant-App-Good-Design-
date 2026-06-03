import Capacitor
import UIKit
import WebKit

// Capacitor 7's runtime auto-discovery of app-target Swift plugins is
// unreliable: the class can be in the binary yet still not register, which
// surfaces in JS as `"PhotoLibrary" plugin is not implemented on ios`.
// Registering through `capacitorDidLoad` is the supported escape hatch.
class MainViewController: CAPBridgeViewController {
    // The app's page background. Capacitor leaves the host view / WKWebView on
    // a black backing, which shows through as a black strip whenever the
    // on-screen keyboard animates or the web view overscrolls. Painting the
    // native surfaces with the app's own background color keeps everything
    // seamless (no black band by the keyboard). Trait-aware so it still looks
    // right if the device is in dark mode.
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

        if let webView = self.webView {
            webView.isOpaque = false
            webView.backgroundColor = appBackground
            webView.scrollView.backgroundColor = appBackground
        }
    }
}
