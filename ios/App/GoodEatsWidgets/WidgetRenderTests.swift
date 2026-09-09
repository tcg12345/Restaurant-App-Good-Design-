import XCTest
import SwiftUI
import WidgetKit

final class WidgetRenderTests: XCTestCase {
    @MainActor func testEmptyAndLockScreenLayouts() throws {
        let cases: [(GoodEatsWidgetKind, WidgetFamily, CGSize, GoodEatsWidgetSnapshot?)] = [
            (.meals, .systemSmall, CGSize(width: 170, height: 170), nil),
            (.taste, .systemSmall, CGSize(width: 170, height: 170), nil),
            (.circle, .systemSmall, CGSize(width: 170, height: 170), nil),
            (.saved, .systemSmall, CGSize(width: 170, height: 170), nil),
            (.ranking, .systemSmall, CGSize(width: 170, height: 170), nil),
            (.meals, .accessoryRectangular, CGSize(width: 160, height: 72), widgetSample()),
            (.meals, .accessoryInline, CGSize(width: 240, height: 26), widgetSample()),
            (.taste, .accessoryCircular, CGSize(width: 72, height: 72), widgetSample()),
        ]
        for (kind, family, size, snapshot) in cases {
            let view = GoodEatsWidgetView(entry: GoodEatsEntry(date: .now, snapshot: snapshot), kind: kind, familyOverride: family)
                .padding(family == .systemSmall ? 16 : 0).frame(width: size.width, height: size.height)
                .background(Color(red: 0.96, green: 0.97, blue: 0.95))
            let renderer = ImageRenderer(content: view); renderer.scale = 2
            let attachment = XCTAttachment(image: try XCTUnwrap(renderer.uiImage))
            attachment.name = "edge-\(kind.rawValue)-\(family)"; attachment.lifetime = .keepAlways; add(attachment)
        }
    }
    @MainActor func testWidgetLayouts() throws {
        let families: [(WidgetFamily, CGSize)] = [(.systemSmall, CGSize(width: 170, height: 170)), (.systemMedium, CGSize(width: 364, height: 170)), (.systemLarge, CGSize(width: 364, height: 382))]
        for kind in [GoodEatsWidgetKind.meals, .taste, .circle, .saved, .ranking] {
            for (family, size) in families where family != .systemLarge || kind == .meals {
                for dark in [false, true] {
                    let entry = GoodEatsEntry(date: .now, snapshot: widgetSample())
                    let view = GoodEatsWidgetView(entry: entry, kind: kind, familyOverride: family)
                        .environment(\.colorScheme, dark ? .dark : .light)
                        .padding(16).frame(width: size.width, height: size.height)
                        .background(dark ? Color(red: 0.12, green: 0.14, blue: 0.13) : Color(red: 0.96, green: 0.97, blue: 0.95))
                        .clipShape(RoundedRectangle(cornerRadius: 24))
                    let renderer = ImageRenderer(content: view)
                    renderer.scale = 2
                    let image = try XCTUnwrap(renderer.uiImage)
                    XCTAssertEqual(image.size, size)
                    let attachment = XCTAttachment(image: image)
                    attachment.name = "\(kind.rawValue)-\(family)-\(dark ? "dark" : "light")"
                    attachment.lifetime = .keepAlways
                    add(attachment)
                }
            }
        }
    }
}
