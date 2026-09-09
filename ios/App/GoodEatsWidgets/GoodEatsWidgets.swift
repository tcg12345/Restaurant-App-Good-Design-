import SwiftUI
import WidgetKit

struct GoodEatsEntry: TimelineEntry {
    let date: Date
    let snapshot: GoodEatsWidgetSnapshot?
    var current: GoodEatsWidgetSnapshot? { snapshot?.isExpired(at: date) == false ? snapshot : nil }
}

struct GoodEatsProvider: TimelineProvider {
    func placeholder(in context: Context) -> GoodEatsEntry { GoodEatsEntry(date: .now, snapshot: widgetSample()) }
    func getSnapshot(in context: Context, completion: @escaping (GoodEatsEntry) -> Void) {
        completion(GoodEatsEntry(date: .now, snapshot: context.isPreview ? widgetSample() : GoodEatsWidgetStore.read()))
    }
    func getTimeline(in context: Context, completion: @escaping (Timeline<GoodEatsEntry>) -> Void) {
        let now = Date(), snapshot = GoodEatsWidgetStore.read()
        let dates = snapshot?.timelineDates(after: now) ?? [now]
        completion(Timeline(entries: dates.map { GoodEatsEntry(date: $0, snapshot: snapshot) }, policy: .after(now.addingTimeInterval(3600))))
    }
}

enum GoodEatsWidgetKind: String {
    case meals, taste, circle, saved, ranking
    var title: String {
        switch self { case .meals: return "Upcoming Meals"; case .taste: return "Taste Profile"; case .circle: return "Your Circle"; case .saved: return "Saved for Later"; case .ranking: return "Top Tables" }
    }
    var symbol: String {
        switch self { case .meals: return "calendar"; case .taste: return "sparkles"; case .circle: return "person.2"; case .saved: return "bookmark"; case .ranking: return "trophy" }
    }
    var path: String {
        switch self { case .meals: return "/calendar"; case .taste: return "/profile/taste"; case .circle: return "/messages"; case .saved, .ranking: return "/pantry" }
    }
}

struct MealsWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "GoodEatsMeals", provider: GoodEatsProvider()) { GoodEatsWidgetView(entry: $0, kind: .meals) }
            .configurationDisplayName("Upcoming Meals").description("Your next reservation or home-cooked meal, right on time.")
            .supportedFamilies([.systemSmall, .systemMedium, .systemLarge, .accessoryRectangular, .accessoryInline])
    }
}
struct TasteWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "GoodEatsTaste", provider: GoodEatsProvider()) { GoodEatsWidgetView(entry: $0, kind: .taste) }
            .configurationDisplayName("Taste Profile").description("Your taste tier, progress, and community standing as you explore.")
            .supportedFamilies([.systemSmall, .systemMedium, .accessoryCircular])
    }
}
struct CircleWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "GoodEatsCircle", provider: GoodEatsProvider()) { GoodEatsWidgetView(entry: $0, kind: .circle) }
            .configurationDisplayName("Your Circle").description("Unread messages and friend requests, without revealing private conversations.")
            .supportedFamilies([.systemSmall, .systemMedium])
    }
}
struct SavedWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "GoodEatsSaved", provider: GoodEatsProvider()) { GoodEatsWidgetView(entry: $0, kind: .saved) }
            .configurationDisplayName("Saved for Later").description("A daily pick from the restaurants you've saved. Make someday a plan.")
            .supportedFamilies([.systemSmall, .systemMedium])
    }
}
struct RankingWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "GoodEatsRanking", provider: GoodEatsProvider()) { GoodEatsWidgetView(entry: $0, kind: .ranking) }
            .configurationDisplayName("Top Tables").description("Your personal restaurant podium, updated as your ratings evolve.")
            .supportedFamilies([.systemSmall, .systemMedium])
    }
}
#if !WIDGET_RENDER_TESTS
@main
struct GoodEatsWidgets: WidgetBundle {
    var body: some Widget { MealsWidget(); TasteWidget(); CircleWidget(); SavedWidget(); RankingWidget() }
}
#endif

// Gallery previews only. Live timelines never manufacture account data.
func widgetSample() -> GoodEatsWidgetSnapshot {
    let now = Date().timeIntervalSince1970
    return GoodEatsWidgetSnapshot(version: 1, owner: "preview", updatedAt: now,
        meals: [MealWidgetItem(id: "sample", title: "A table for two", kind: "restaurant", start: now + 3600, end: now + 7200, confirmed: true, path: "/calendar"), MealWidgetItem(id: "recipe", title: "Sunday pasta", kind: "recipe", start: now + 86400, end: now + 90000, confirmed: false, path: "/calendar")],
        taste: TasteWidgetData(tier: "Explorer", points: 142, progress: 0.62, next: "Connoisseur", toNext: 38, places: 24, cuisines: 9, cities: 3, rank: nil, identity: "The curious palate"),
        social: SocialWidgetData(messages: 3, requests: 1),
        saved: [PlaceWidgetItem(id: "saved", title: "That little neighborhood spot", subtitle: "Italian", path: "/pantry")],
        favorites: [PlaceWidgetItem(id: "one", title: "Your favorite table", subtitle: "Italian", path: "/pantry"), PlaceWidgetItem(id: "two", title: "The weekend regular", subtitle: "Japanese", path: "/pantry"), PlaceWidgetItem(id: "three", title: "A memorable evening", subtitle: "French", path: "/pantry")])
}
