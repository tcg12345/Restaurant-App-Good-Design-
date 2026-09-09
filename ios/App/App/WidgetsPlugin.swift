import Capacitor
import WidgetKit

@objc(GoodEatsWidgetsPlugin)
public class GoodEatsWidgetsPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "GoodEatsWidgetsPlugin"
    public let jsName = "GoodEatsWidgets"
    public let pluginMethods: [CAPPluginMethod] = ["setOwner", "sync"].map { CAPPluginMethod(name: $0, returnType: CAPPluginReturnPromise) }
    private let writes = DispatchQueue(label: "com.goodeats.widgets")
    private var owner: String?
    private var lastContent: String?

    @objc func setOwner(_ call: CAPPluginCall) {
        let next = call.getString("owner") ?? ""
        writes.async {
            let previous = self.owner ?? GoodEatsWidgetStore.read()?.owner ?? ""
            self.owner = next
            if next.isEmpty || previous != next {
                GoodEatsWidgetStore.clear()
                self.lastContent = nil
                WidgetCenter.shared.reloadAllTimelines()
            }
            call.resolve()
        }
    }
    @objc func sync(_ call: CAPPluginCall) {
        guard let owner = call.getString("owner"), !owner.isEmpty,
              let json = call.getString("snapshot"), let data = json.data(using: .utf8), data.count <= 128_000,
              let snapshot = try? JSONDecoder().decode(GoodEatsWidgetSnapshot.self, from: data),
              snapshot.version == 1, snapshot.owner == owner, snapshot.meals.count <= 24,
              snapshot.saved.count <= 12, snapshot.favorites.count <= 3 else { call.reject("Invalid widget snapshot"); return }
        writes.async {
            guard self.owner == owner else { call.resolve(); return }
            // Ignore timestamp-only changes for reload budgeting; still persist freshness.
            var content = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] ?? [:]
            content.removeValue(forKey: "updatedAt")
            let fingerprint = (try? JSONSerialization.data(withJSONObject: content, options: [.sortedKeys])).flatMap { String(data: $0, encoding: .utf8) }
            let old = GoodEatsWidgetStore.read()
            do {
                try GoodEatsWidgetStore.write(data)
                if fingerprint != self.lastContent || old == nil || snapshot.updatedAt - (old?.updatedAt ?? 0) > 3600 {
                    self.lastContent = fingerprint
                    WidgetCenter.shared.reloadAllTimelines()
                }
                call.resolve()
            } catch { call.reject("Could not save widget data to the App Group", nil, error) }
        }
    }
}
