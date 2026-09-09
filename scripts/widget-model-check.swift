import Foundation

@main
struct WidgetModelCheck {
    static func main() throws {
        let data = try Data(contentsOf: URL(fileURLWithPath: "/tmp/goodeats-widget-contract.json"))
        let snapshot = try JSONDecoder().decode(GoodEatsWidgetSnapshot.self, from: data)
        let now = Date(timeIntervalSince1970: snapshot.updatedAt)
        precondition(snapshot.version == 1 && snapshot.owner == "alice")
        precondition(snapshot.upcoming(at: now).count == 1)
        precondition(snapshot.upcoming(at: now.addingTimeInterval(7200)).isEmpty)
        precondition(snapshot.upcoming(at: now.addingTimeInterval(3600)).count == 1)
        precondition(snapshot.timelineDates(after: now).contains(now.addingTimeInterval(7200)))
        precondition(snapshot.socialIsStale(at: now.addingTimeInterval(86400)))
        precondition(snapshot.isExpired(at: now.addingTimeInterval(7 * 86400)))
        precondition(!snapshot.isExpired(at: now))
        precondition(snapshot.savedPick(at: now)?.id == "p1")
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "Europe/London")!
        let choices = (0..<3).map { PlaceWidgetItem(id: String($0), title: "Place", subtitle: "", path: "/pantry") }
        let rotating = GoodEatsWidgetSnapshot(version: snapshot.version, owner: snapshot.owner, updatedAt: snapshot.updatedAt, meals: snapshot.meals, taste: snapshot.taste, social: snapshot.social, saved: choices, favorites: [])
        // UK clocks go back on October 25, 2026. The old UTC-bucket approach
        // skipped a saved place between these two consecutive local dates.
        let before = calendar.date(from: DateComponents(year: 2026, month: 10, day: 25, hour: 12))!
        let after = calendar.date(byAdding: .day, value: 1, to: before)!
        let beforeIndex = Int(rotating.savedPick(at: before, calendar: calendar)!.id)!
        let afterIndex = Int(rotating.savedPick(at: after, calendar: calendar)!.id)!
        precondition(afterIndex == (beforeIndex + 1) % choices.count)
        precondition(rotating.savedPick(at: calendar.startOfDay(for: before), calendar: calendar)?.id == String(beforeIndex))
        precondition(URLComponents(url: goodEatsWidgetURL("/calendar?plan=meal-1"), resolvingAgainstBaseURL: false)?.queryItems?.first?.value == "/calendar?plan=meal-1")
        print("Widget contract, meal rollover, stale data, saved pick, and deep links passed.")
    }
}
