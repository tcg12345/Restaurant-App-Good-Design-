import Foundation

struct MealWidgetItem: Codable, Identifiable {
    let id: String
    let title: String
    let kind: String
    let start: Double
    let end: Double
    let confirmed: Bool
    let path: String
}
struct PlaceWidgetItem: Codable, Identifiable {
    let id: String
    let title: String
    let subtitle: String
    let path: String
}
struct TasteWidgetData: Codable {
    let tier: String
    let points: Int
    let progress: Double
    let next: String
    let toNext: Int
    let places: Int
    let cuisines: Int
    let cities: Int
    let rank: Int?
    let identity: String
}
struct SocialWidgetData: Codable {
    let messages: Int
    let requests: Int
}
struct GoodEatsWidgetSnapshot: Codable {
    let version: Int
    let owner: String
    let updatedAt: Double
    let meals: [MealWidgetItem]
    let taste: TasteWidgetData
    let social: SocialWidgetData
    let saved: [PlaceWidgetItem]
    let favorites: [PlaceWidgetItem]

    func upcoming(at date: Date) -> [MealWidgetItem] {
        meals.filter { $0.end > date.timeIntervalSince1970 }.sorted { $0.start < $1.start }
    }
    func isExpired(at date: Date) -> Bool { date.timeIntervalSince1970 - updatedAt >= 7 * 86_400 }
    func socialIsStale(at date: Date) -> Bool { date.timeIntervalSince1970 - updatedAt >= 86_400 }
    func savedPick(at date: Date, calendar: Calendar = .current) -> PlaceWidgetItem? {
        guard !saved.isEmpty else { return nil }
        // Count local calendar days rather than 24-hour UTC buckets. Around
        // daylight saving, a local day can be 23 or 25 hours long.
        var local = Calendar(identifier: .gregorian)
        local.timeZone = calendar.timeZone
        let components = local.dateComponents([.year, .month, .day], from: date)
        var utc = Calendar(identifier: .gregorian)
        utc.timeZone = TimeZone(secondsFromGMT: 0)!
        let civilDate = utc.date(from: components)!
        let day = Int(civilDate.timeIntervalSince1970 / 86_400)
        return saved[abs(day) % saved.count]
    }
    /// Precompute meal boundaries so the next meal changes even while the app is closed.
    func timelineDates(after date: Date) -> [Date] {
        let end = date.addingTimeInterval(86_400)
        let midnight = Calendar.current.date(byAdding: .day, value: 1, to: Calendar.current.startOfDay(for: date))!
        let boundaries = meals.flatMap { [Date(timeIntervalSince1970: $0.start), Date(timeIntervalSince1970: $0.end)] }
            + [midnight, Date(timeIntervalSince1970: updatedAt + 86_400), Date(timeIntervalSince1970: updatedAt + 7 * 86_400)]
        return [date] + Array(Set(boundaries.filter { $0 > date && $0 <= end })).sorted()
    }
}

#if !WIDGET_MODEL_TESTS
enum GoodEatsWidgetStore {
    static let group = "group.com.tylergorin.restaurantapp.widgets"
    static var directory: URL? { FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: group) }
    static var file: URL? { directory?.appendingPathComponent("widgets-v1.json") }
    static func read() -> GoodEatsWidgetSnapshot? {
        guard let file, let data = try? Data(contentsOf: file), data.count <= 128_000,
              let snapshot = try? JSONDecoder().decode(GoodEatsWidgetSnapshot.self, from: data),
              snapshot.version == 1, !snapshot.owner.isEmpty else { return nil }
        return snapshot
    }
    static func clear() { if let file { try? FileManager.default.removeItem(at: file) } }
    static func write(_ data: Data) throws {
        guard let file else { throw CocoaError(.fileNoSuchFile) }
        try data.write(to: file, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
    }
}

#endif

func goodEatsWidgetURL(_ path: String) -> URL {
    var url = URLComponents()
    url.scheme = "com.tylergorin.restaurantapp"
    url.host = "widget"
    url.queryItems = [URLQueryItem(name: "path", value: path)]
    return url.url!
}
