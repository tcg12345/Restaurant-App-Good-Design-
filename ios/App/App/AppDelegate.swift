import UIKit
import Capacitor
import UserNotifications

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {
    
    var window: UIWindow?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        UNUserNotificationCenter.current().delegate = GoodEatsNotificationCenter.shared
        return true     
    }

    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        let token = deviceToken.map { String(format: "%02x", $0) }.joined()
        let environment = Bundle.main.object(forInfoDictionaryKey: "GoodEatsAPNSEnvironment") as? String ?? "development"
        GoodEatsNotificationCenter.shared.plugin?.notifyListeners("registration", data: ["token": token, "environment": environment], retainUntilConsumed: true)
    }

    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        GoodEatsNotificationCenter.shared.plugin?.notifyListeners("registrationError", data: ["message": "Remote notifications could not connect. Please try again."], retainUntilConsumed: true)
    }

    func applicationWillResignActive(_ application: UIApplication) {
        // Sent when the application is about to move from active to inactive state. This can occur for certain types of temporary interruptions (such as an incoming phone call or SMS message) or when the user quits the application and it begins the transition to the background state.
        // Use this method to pause ongoing tasks, disable time     rs, and invalidate graphics rendering callbacks. Games should use this method to pause the game.
    }
  
    func applicationDidEnterBackground(_ application: UIApplication) {
        // Use this method to release shared resources, save user data, invalidate timers, and store enough application state information to restore your application to its current state in case it is terminated later.
        // If your application supports background execution, this method is called instead of applicationWillTerminate: when the user quits.
    }

    func applicationWillEnterForeground(_ application: UIApplication) {
        // Called as part of the transition from the background to the active state; here you can undo many of the changes made on entering the background.
    }

    func applicationDidBecomeActive(_ application: UIApplication) {
        // Restart any tasks that were paused (or not yet started) while the application was inactive. If the application was previously in the background, optionally refresh the user interface.
    }

    func applicationWillTerminate(_ application: UIApplication) {
        // Called when the application is about to terminate. Save data if appropriate. See also applicationDidEnterBackground:.
    }

    func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
        // Called when the app was launched with a url. Feel free to add additional processing here,
        // but if you want the App API to support tracking app url opens, make sure to keep this call
        return ApplicationDelegateProxy.shared.application(app, open: url, options: options)
    }

    func application(_ application: UIApplication, continue userActivity: NSUserActivity, restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void) -> Bool {
        // Called when the app was launched with an activity, including Universal Links.
        // Feel free to add additional processing here, but if you want the App API to support
        // tracking app url opens, make sure to keep this call
        return ApplicationDelegateProxy.shared.application(application, continue: userActivity, restorationHandler: restorationHandler)
    }

}

// One notification delegate owns both APNs and local meal reminders. It starts
// before the web bridge so a cold-launch tap cannot disappear during startup.
final class GoodEatsNotificationCenter: NSObject, UNUserNotificationCenterDelegate {
    static let shared = GoodEatsNotificationCenter()
    weak var plugin: GoodEatsNotificationsPlugin?
    var pendingAction: [String: Any]?
    var userId = UserDefaults.standard.string(forKey: "GoodEats.notificationUser") ?? ""
    var path = ""
    var enabled = UserDefaults.standard.bool(forKey: "GoodEats.notificationsEnabled")
    var revision = 0
    var schedulingTask: Task<Void, Never>?
    func badge(_ count: Int, completion: @escaping (Error?) -> Void = { _ in }) {
        if #available(iOS 16.0, *) { UNUserNotificationCenter.current().setBadgeCount(count, withCompletionHandler: completion) }
        else { DispatchQueue.main.async { UIApplication.shared.applicationIconBadgeNumber = count; completion(nil) } }
    }

    var installationId: String {
        if let id = UserDefaults.standard.string(forKey: "GoodEats.notificationInstallation") { return id }
        let id = UUID().uuidString
        UserDefaults.standard.set(id, forKey: "GoodEats.notificationInstallation")
        return id
    }
    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification, withCompletionHandler completion: @escaping (UNNotificationPresentationOptions) -> Void) {
        let data = notification.request.content.userInfo
        DispatchQueue.main.async {
            self.plugin?.notifyListeners("received", data: [:])
            let recipient = data["userId"] as? String ?? ""
            let destination = data["path"] as? String ?? ""
            guard self.enabled, recipient == self.userId, !recipient.isEmpty, destination != self.path else { completion([]); return }
            var options: UNNotificationPresentationOptions = [.banner, .list, .badge]
            if notification.request.content.sound != nil { options.insert(.sound) }
            completion(options)
        }
    }
    func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse, withCompletionHandler completion: @escaping () -> Void) {
        let data = response.notification.request.content.userInfo
        let action: [String: Any] = ["path": data["path"] as? String ?? "", "userId": data["userId"] as? String ?? "", "notificationId": data["notificationId"] as? String ?? ""]
        DispatchQueue.main.async {
            if let plugin = self.plugin { plugin.notifyListeners("action", data: action, retainUntilConsumed: true) }
            else { self.pendingAction = action }
            completion()
        }
    }
}

@objc(GoodEatsNotificationsPlugin)
public class GoodEatsNotificationsPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "GoodEatsNotificationsPlugin"
    public let jsName = "GoodEatsNotifications"
    public let pluginMethods: [CAPPluginMethod] = ["status", "requestPermission", "register", "setContext", "syncMeals", "setBadge", "reset", "test"].map { CAPPluginMethod(name: $0, returnType: CAPPluginReturnPromise) }
    public override func load() {
        DispatchQueue.main.async {
            let owner = GoodEatsNotificationCenter.shared
            owner.plugin = self
            UNUserNotificationCenter.current().delegate = owner
            if let action = owner.pendingAction {
                owner.pendingAction = nil
                self.notifyListeners("action", data: action, retainUntilConsumed: true)
            }
        }
    }
    private func permission(_ settings: UNNotificationSettings) -> String {
        switch settings.authorizationStatus {
        case .authorized: return "granted"
        case .provisional, .ephemeral: return "provisional"
        case .denied: return "denied"
        default: return "prompt"
        }
    }
    @objc func status(_ call: CAPPluginCall) {
        UNUserNotificationCenter.current().getNotificationSettings { settings in
            call.resolve(["permission": self.permission(settings), "installationId": GoodEatsNotificationCenter.shared.installationId])
        }
    }
    @objc func requestPermission(_ call: CAPPluginCall) {
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .badge, .sound]) { _, error in
            if let error = error { call.reject(error.localizedDescription); return }
            UNUserNotificationCenter.current().getNotificationSettings { settings in call.resolve(["permission": self.permission(settings)]) }
        }
    }
    @objc func register(_ call: CAPPluginCall) {
        DispatchQueue.main.async { UIApplication.shared.registerForRemoteNotifications(); call.resolve() }
    }
    @objc func setContext(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            let owner = GoodEatsNotificationCenter.shared
            let next = call.getString("userId") ?? ""
            if owner.userId != next {
                owner.revision += 1
                UNUserNotificationCenter.current().removeAllPendingNotificationRequests()
                UNUserNotificationCenter.current().removeAllDeliveredNotifications()
                GoodEatsNotificationCenter.shared.badge(0)
            }
            owner.userId = next; owner.path = call.getString("path") ?? ""
            owner.enabled = call.getBool("enabled") ?? false
            UserDefaults.standard.set(next, forKey: "GoodEats.notificationUser")
            UserDefaults.standard.set(owner.enabled, forKey: "GoodEats.notificationsEnabled")
            call.resolve()
        }
    }
    @objc func syncMeals(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            let owner = GoodEatsNotificationCenter.shared
            owner.revision += 1
            let revision = owner.revision
            let rows = call.getArray("notifications", JSObject.self) ?? []
            let previous = owner.schedulingTask
            owner.schedulingTask = Task { @MainActor in
                await previous?.value
                let center = UNUserNotificationCenter.current()
                let pending = await center.pendingNotificationRequests()
                guard revision == owner.revision else { call.resolve(); return }
                let valid = rows.filter { ($0["userId"] as? String) == owner.userId && owner.enabled }.prefix(60)
                let ids = Set(valid.compactMap { $0["id"] as? String })
                center.removePendingNotificationRequests(withIdentifiers: pending.filter { $0.identifier.hasPrefix("meal:") && !ids.contains($0.identifier) }.map(\.identifier))
                do {
                    for row in valid {
                        guard revision == owner.revision else { break }
                        guard let id = row["id"] as? String, let at = row["at"] as? Double, at > Date().timeIntervalSince1970 * 1000 else { continue }
                        let content = UNMutableNotificationContent()
                        content.title = row["title"] as? String ?? "GoodEats"
                        content.body = row["body"] as? String ?? ""
                        if row["sound"] as? Bool == true { content.sound = .default }
                        content.threadIdentifier = "meals"
                        content.userInfo = ["userId": owner.userId, "path": row["path"] as? String ?? "/calendar", "at": at]
                        let existing = pending.first { $0.identifier == id }
                        if let existing = existing, existing.content.title == content.title, existing.content.body == content.body,
                           (existing.content.userInfo["at"] as? Double) == at, (existing.content.sound != nil) == (content.sound != nil) { continue }
                        let trigger = UNTimeIntervalNotificationTrigger(timeInterval: max(1, at / 1000 - Date().timeIntervalSince1970), repeats: false)
                        try await center.add(UNNotificationRequest(identifier: id, content: content, trigger: trigger))
                        if revision != owner.revision { center.removePendingNotificationRequests(withIdentifiers: [id]); break }
                    }
                    call.resolve()
                } catch { call.reject("Could not schedule meal reminders", nil, error) }
            }
        }
    }
    @objc func setBadge(_ call: CAPPluginCall) {
        GoodEatsNotificationCenter.shared.badge(max(0, call.getInt("count") ?? 0)) { error in
            if let error = error { call.reject(error.localizedDescription) } else { call.resolve() }
        }
    }
    @objc func reset(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            let owner = GoodEatsNotificationCenter.shared
            owner.revision += 1; owner.userId = ""; owner.enabled = false; owner.pendingAction = nil
            UserDefaults.standard.removeObject(forKey: "GoodEats.notificationUser")
            UserDefaults.standard.set(false, forKey: "GoodEats.notificationsEnabled")
            UIApplication.shared.unregisterForRemoteNotifications()
            let center = UNUserNotificationCenter.current()
            center.removeAllPendingNotificationRequests(); center.removeAllDeliveredNotifications(); GoodEatsNotificationCenter.shared.badge(0)
            call.resolve()
        }
    }
    @objc func test(_ call: CAPPluginCall) {
        let content = UNMutableNotificationContent()
        content.title = "You're all set"
        content.body = "GoodEats can now keep you in the loop."
        content.sound = .default
        content.userInfo = ["userId": GoodEatsNotificationCenter.shared.userId, "path": "/calendar"]
        UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: "goodeats-test", content: content, trigger: UNTimeIntervalNotificationTrigger(timeInterval: 5, repeats: false))) { error in
            if let error = error { call.reject(error.localizedDescription) } else { call.resolve() }
        }
    }
}
