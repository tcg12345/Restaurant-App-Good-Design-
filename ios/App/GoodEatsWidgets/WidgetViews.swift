import SwiftUI
import WidgetKit

private let sage = Color(red: 0.20, green: 0.39, blue: 0.31)
private let terracotta = Color(red: 0.65, green: 0.35, blue: 0.24)

struct GoodEatsWidgetView: View {
    let entry: GoodEatsEntry
    let kind: GoodEatsWidgetKind
    var familyOverride: WidgetFamily? = nil
    @Environment(\.widgetFamily) private var systemFamily
    private var family: WidgetFamily { familyOverride ?? systemFamily }
    @Environment(\.colorScheme) private var scheme
    private var small: Bool { family == .systemSmall }
    private var accessory: Bool { [.accessoryCircular, .accessoryInline, .accessoryRectangular].contains(family) }
    private var accent: Color { scheme == .dark ? Color(red: 0.66, green: 0.82, blue: 0.72) : sage }
    private var destination: String {
        guard let data = entry.current else { return kind.path }
        switch kind {
        case .meals: return data.upcoming(at: entry.date).first?.path ?? kind.path
        case .saved: return data.savedPick(at: entry.date)?.path ?? kind.path
        case .ranking: return data.favorites.first?.path ?? kind.path
        default: return kind.path
        }
    }

    var body: some View {
        Group {
            if accessory { accessoryBody }
            else {
                VStack(alignment: .leading, spacing: small ? 10 : 12) {
                    HStack(spacing: 6) {
                        Image(systemName: kind.symbol).foregroundStyle(accent)
                        Text(kind.title.uppercased()).tracking(1.1).lineLimit(1).minimumScaleFactor(0.8)
                        Spacer(minLength: 0)
                        if !small { Text("GoodEats").foregroundStyle(.secondary).fontWeight(.medium) }
                    }.font(.system(size: 10, weight: .semibold))
                    if let data = entry.current {
                        switch kind {
                        case .meals: meals(data)
                        case .taste: taste(data)
                        case .circle: circle(data)
                        case .saved: saved(data)
                        case .ranking: ranking(data)
                        }
                    } else {
                        Spacer(minLength: 0)
                        Text(entry.snapshot == nil ? "Good things start here." : "A little catch-up.")
                            .font(.system(size: small ? 21 : 24, weight: .semibold, design: .rounded)).lineLimit(2).minimumScaleFactor(0.8)
                        Text("Open GoodEats to update your widget.").font(.system(size: 12)).foregroundStyle(.secondary)
                        Spacer(minLength: 0)
                    }
                }
            }
        }
        .widgetURL(goodEatsWidgetURL(destination))
        .containerBackground(for: .widget) {
            ZStack {
                Color(scheme == .dark ? UIColor.secondarySystemBackground : UIColor(red: 0.96, green: 0.97, blue: 0.95, alpha: 1))
                LinearGradient(colors: [accent.opacity(0.08), .clear], startPoint: .topLeading, endPoint: .bottomTrailing)
            }
        }
        .privacySensitive()
    }

    @ViewBuilder private func meals(_ data: GoodEatsWidgetSnapshot) -> some View {
        let upcoming = data.upcoming(at: entry.date)
        if let first = upcoming.first {
            if small {
                Spacer(minLength: 0)
                Label(first.kind == "recipe" ? "Cooking at home" : "Dining out", systemImage: first.kind == "recipe" ? "carrot" : "fork.knife")
                    .font(.system(size: 10, weight: .medium)).foregroundStyle(accent)
                Text(first.title).font(.system(size: 21, weight: .semibold, design: .rounded)).lineLimit(2).minimumScaleFactor(0.8)
                mealTime(first).font(.system(size: 11, weight: .medium))
            } else {
                ForEach(Array(upcoming.prefix(family == .systemLarge ? 4 : 2))) { meal in
                    Link(destination: goodEatsWidgetURL(meal.path)) {
                        HStack(spacing: 12) {
                            dateTile(meal)
                            VStack(alignment: .leading, spacing: 4) {
                                Text(meal.title).font(.system(size: 16, weight: .semibold)).lineLimit(1)
                                mealTime(meal).font(.system(size: 11))
                            }
                            Spacer(minLength: 0)
                            Image(systemName: meal.kind == "recipe" ? "carrot" : "fork.knife").foregroundStyle(meal.kind == "recipe" ? accent : terracotta).font(.system(size: 16))
                        }.padding(.vertical, family == .systemLarge ? 8 : 0)
                    }.buttonStyle(.plain)
                }
                Spacer(minLength: 0)
                if family == .systemLarge {
                    Link(destination: goodEatsWidgetURL("/calendar")) {
                        Label("Make a little room for something good", systemImage: "plus.circle").font(.system(size: 12, weight: .medium)).foregroundStyle(accent)
                    }
                }
            }
        } else {
            empty("Room for something good.", detail: "Plan a table or a night in.", symbol: "calendar.badge.plus")
        }
    }
    private func dateTile(_ meal: MealWidgetItem) -> some View {
        let date = Date(timeIntervalSince1970: meal.start)
        return VStack(spacing: 1) {
            Text(date, format: .dateTime.month(.abbreviated)).textCase(.uppercase).font(.system(size: 9, weight: .semibold))
            Text(date, format: .dateTime.day()).font(.system(size: 23, weight: .medium, design: .rounded))
        }.foregroundStyle(accent).frame(width: 43, height: 47).background(accent.opacity(0.08), in: RoundedRectangle(cornerRadius: 12))
    }
    private func mealTime(_ meal: MealWidgetItem) -> some View {
        let date = Date(timeIntervalSince1970: meal.start)
        return HStack(spacing: 4) {
            if meal.start <= entry.date.timeIntervalSince1970 { Text("Now").foregroundStyle(accent) }
            else {
                Text(date, format: .dateTime.weekday(.abbreviated))
                Text("·")
                Text(date, style: .time)
            }
            if meal.confirmed { Image(systemName: "checkmark.seal.fill").foregroundStyle(accent) }
        }.foregroundStyle(.secondary).lineLimit(1).minimumScaleFactor(0.8)
    }

    private func taste(_ data: GoodEatsWidgetSnapshot) -> some View {
        let taste = data.taste
        return HStack(spacing: 18) {
            VStack(alignment: .leading, spacing: small ? 5 : 7) {
                Spacer(minLength: 0)
                Text(taste.tier).font(.system(size: small ? 23 : 27, weight: .semibold, design: .rounded)).lineLimit(1).minimumScaleFactor(0.7)
                Text("\(taste.points) taste points").font(.system(size: 12, weight: .medium)).foregroundStyle(accent)
                GeometryReader { geometry in
                    ZStack(alignment: .leading) {
                        Capsule().fill(accent.opacity(0.12))
                        Capsule().fill(accent).frame(width: geometry.size.width * min(1, max(0, taste.progress)))
                    }
                }.frame(height: 4).padding(.vertical, 3)
                    .accessibilityLabel("\(Int(taste.progress * 100)) percent to the next tier")
                Text(taste.next.isEmpty ? "A palate worth celebrating" : "\(taste.toNext) to \(taste.next)").font(.system(size: 10)).foregroundStyle(.secondary).lineLimit(1).minimumScaleFactor(0.8)
                if !small { Text(taste.identity).font(.system(size: 11)).foregroundStyle(.secondary).lineLimit(1) }
            }
            if !small {
                VStack(alignment: .leading, spacing: 8) {
                    stat(taste.places, "places")
                    stat(taste.cuisines, "cuisines")
                    if let rank = taste.rank, rank > 0 {
                        Text("#\(rank) community").font(.system(size: 10, weight: .semibold)).foregroundStyle(accent)
                    } else { stat(taste.cities, "cities") }
                }.frame(minWidth: 80).padding(.leading, 14).overlay(alignment: .leading) { Rectangle().fill(accent.opacity(0.15)).frame(width: 1) }
            }
        }
    }
    private func stat(_ number: Int, _ label: String) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 4) {
            Text(number, format: .number.notation(.compactName)).font(.system(size: 22, weight: .semibold, design: .rounded))
            Text(label).font(.system(size: 10)).foregroundStyle(.secondary)
        }
    }

    @ViewBuilder private func circle(_ data: GoodEatsWidgetSnapshot) -> some View {
        if data.socialIsStale(at: entry.date) {
            empty("Catch up with your circle.", detail: "Open for the latest messages.", symbol: "person.2")
        } else if data.social.messages + data.social.requests == 0 {
            empty("All caught up.", detail: "Good company is a tap away.", symbol: "bubble.left.and.bubble.right")
        } else {
            HStack(alignment: .center, spacing: 20) {
                VStack(alignment: .leading, spacing: 3) {
                    Text(data.social.messages, format: .number.notation(.compactName)).font(.system(size: 44, weight: .medium, design: .rounded)).foregroundStyle(accent)
                    Text(data.social.messages == 1 ? "unread message" : "unread messages").font(.system(size: 12)).foregroundStyle(.secondary)
                }
                if !small {
                    Spacer(minLength: 0)
                    Image(systemName: "bubble.left.and.bubble.right").font(.system(size: 38, weight: .light)).foregroundStyle(accent.opacity(0.7))
                }
            }
            Text(data.social.requests == 0 ? "Your circle is a tap away" : "\(data.social.requests) friend request\(data.social.requests == 1 ? "" : "s")")
                .font(.system(size: 11, weight: .medium)).foregroundStyle(accent).lineLimit(1)
            if !small { Text("Updated \(Date(timeIntervalSince1970: data.updatedAt), style: .relative) ago").font(.system(size: 9)).foregroundStyle(.secondary) }
        }
    }

    @ViewBuilder private func saved(_ data: GoodEatsWidgetSnapshot) -> some View {
        if let place = data.savedPick(at: entry.date) {
            HStack(spacing: 16) {
                VStack(alignment: .leading, spacing: 7) {
                    Spacer(minLength: 0)
                    Text("SOMEDAY, SOON").font(.system(size: 9, weight: .semibold)).tracking(1.1).foregroundStyle(accent)
                    Text(place.title).font(.system(size: small ? 20 : 24, weight: .semibold, design: .rounded)).lineLimit(2).minimumScaleFactor(0.75)
                    Text(place.subtitle).font(.system(size: 11)).foregroundStyle(.secondary).lineLimit(1)
                    if !small { Text("A daily pick from your saved places ↗").font(.system(size: 10, weight: .medium)).foregroundStyle(accent) }
                }
                if !small {
                    Image(systemName: "fork.knife.circle").font(.system(size: 57, weight: .ultraLight)).foregroundStyle(accent.opacity(0.75))
                }
            }
        } else { empty("Keep a little wish list.", detail: "Save a place you'd love to try.", symbol: "bookmark") }
    }

    @ViewBuilder private func ranking(_ data: GoodEatsWidgetSnapshot) -> some View {
        if data.favorites.isEmpty {
            empty("Your podium awaits.", detail: "Rate a restaurant to start.", symbol: "trophy")
        } else if small, let first = data.favorites.first {
            Text("01").font(.system(size: 33, weight: .light, design: .rounded)).foregroundStyle(accent)
            Text(first.title).font(.system(size: 20, weight: .semibold, design: .rounded)).lineLimit(2).minimumScaleFactor(0.75)
            Text("Your top-rated table").font(.system(size: 10)).foregroundStyle(.secondary)
        } else {
            ForEach(Array(data.favorites.enumerated()), id: \.element.id) { index, place in
                Link(destination: goodEatsWidgetURL(place.path)) {
                    HStack(spacing: 11) {
                        Text(String(format: "%02d", index + 1)).font(.system(size: 19, weight: .light, design: .rounded)).foregroundStyle(accent).frame(width: 27)
                        Text(place.title).font(.system(size: 14, weight: .medium)).lineLimit(1)
                        Spacer(minLength: 0)
                        Image(systemName: "arrow.up.right").font(.system(size: 10)).foregroundStyle(.secondary)
                    }
                }.buttonStyle(.plain)
            }
            Spacer(minLength: 0)
        }
    }
    private func empty(_ title: String, detail: String, symbol: String) -> some View {
        VStack(alignment: .leading, spacing: 7) {
            Spacer(minLength: 0)
            Image(systemName: symbol).font(.system(size: 22, weight: .light)).foregroundStyle(accent)
            Text(title).font(.system(size: small ? 20 : 23, weight: .semibold, design: .rounded)).lineLimit(2).minimumScaleFactor(0.8)
            Text(detail).font(.system(size: 11)).foregroundStyle(.secondary).lineLimit(2)
            Spacer(minLength: 0)
        }
    }

    @ViewBuilder private var accessoryBody: some View {
        if family == .accessoryCircular {
            Gauge(value: entry.current?.taste.progress ?? 0) { Image(systemName: "sparkles") } currentValueLabel: {
                Text("\(entry.current?.taste.points ?? 0)").font(.system(size: 16, weight: .semibold)).minimumScaleFactor(0.7)
            }.gaugeStyle(.accessoryCircular)
        } else if let meal = entry.current?.upcoming(at: entry.date).first {
            if family == .accessoryInline {
                Label { Text("\(meal.title) · \(Date(timeIntervalSince1970: meal.start), style: .time)") } icon: { Image(systemName: meal.kind == "recipe" ? "carrot" : "fork.knife") }
            } else {
                VStack(alignment: .leading, spacing: 3) {
                    Text("NEXT MEAL").font(.caption2).fontWeight(.semibold)
                    Text(meal.title).font(.headline).lineLimit(1)
                    mealTime(meal).font(.caption)
                }
            }
        } else {
            Label("Plan something good", systemImage: "calendar")
        }
    }
}

#Preview("Upcoming meals", as: .systemMedium) { MealsWidget() } timeline: { GoodEatsEntry(date: .now, snapshot: widgetSample()) }
#Preview("Taste", as: .systemSmall) { TasteWidget() } timeline: { GoodEatsEntry(date: .now, snapshot: widgetSample()) }
#Preview("Circle", as: .systemMedium) { CircleWidget() } timeline: { GoodEatsEntry(date: .now, snapshot: widgetSample()) }
#Preview("Saved", as: .systemSmall) { SavedWidget() } timeline: { GoodEatsEntry(date: .now, snapshot: widgetSample()) }
#Preview("Top tables", as: .systemMedium) { RankingWidget() } timeline: { GoodEatsEntry(date: .now, snapshot: widgetSample()) }
