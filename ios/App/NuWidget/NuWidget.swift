import WidgetKit
import SwiftUI
import UIKit

// nu.'s home screen widget (small): one question, and how long ago the latest entry was.
// No entry text and no streaks. A tap opens nu://write: the app's input, keyboard up.
// State and rotation rules: NuWidgetLogic.swift. Data: NuWidgetShared.swift (App Group).

@main
struct NuWidgetBundle: WidgetBundle {
    var body: some Widget {
        NuNowWidget()
    }
}

struct NuNowWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: NuWidgetShared.kind, provider: NuWidgetProvider()) { entry in
            NuWidgetView(entry: entry)
        }
        .configurationDisplayName(NSLocalizedString("widget.name", comment: "Widget gallery: name"))
        .description(NSLocalizedString("widget.description", comment: "Widget gallery: description"))
        .supportedFamilies([.systemSmall])
    }
}

// MARK: - Timeline

struct NuWidgetEntry: TimelineEntry {
    let date: Date
    let state: NuWidgetState
    let questionKey: String
    let lastEntry: Date?
    let language: String
}

struct NuWidgetProvider: TimelineProvider {
    func placeholder(in context: Context) -> NuWidgetEntry {
        Self.sample(now: Date())
    }

    func getSnapshot(in context: Context, completion: @escaping (NuWidgetEntry) -> Void) {
        let now = Date()
        // Widget gallery: a typical look rather than this phone's (possibly empty) state
        completion(context.isPreview ? Self.sample(now: now)
                                     : Self.entries(lastEntry: NuWidgetShared.lastEntryAt(), now: now, horizon: 0)[0])
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<NuWidgetEntry>) -> Void) {
        let entries = Self.entries(lastEntry: NuWidgetShared.lastEntryAt(), now: Date())
        completion(Timeline(entries: entries, policy: .atEnd))
    }

    /// One entry per redraw time. Built the same way whenever it runs (see NuWidgetLogic).
    static func entries(lastEntry: Date?, now: Date, horizon: TimeInterval = 12 * 60 * 60,
                        language: String = NuWidgetStrings.deviceLanguage,
                        logic: NuWidgetLogic = NuWidgetLogic()) -> [NuWidgetEntry] {
        let strings = NuWidgetStrings(language: language)
        var previous: String?
        return logic.timelineDates(lastEntry: lastEntry, now: now, horizon: horizon).map { date in
            let state = logic.state(lastEntry: lastEntry, now: date)
            let key = logic.questionKey(state: state, at: date, after: previous, text: strings.text)
            previous = strings.text(key)
            return NuWidgetEntry(date: date, state: state, questionKey: key, lastEntry: lastEntry, language: language)
        }
    }

    static func sample(now: Date, language: String = NuWidgetStrings.deviceLanguage) -> NuWidgetEntry {
        let last = now.addingTimeInterval(-(60 + 20) * 60)
        let logic = NuWidgetLogic()
        let state = logic.state(lastEntry: last, now: now)
        return NuWidgetEntry(date: now, state: state, questionKey: logic.questionKey(state: state, at: now),
                             lastEntry: last, language: language)
    }
}

// MARK: - Strings

/// Widget text in the app's language: Korean when the iPhone's first preferred language is Korean,
/// English otherwise (the same rule as src/i18n.js). Previews pass a language explicitly.
struct NuWidgetStrings {
    let language: String
    private let bundle: Bundle

    static var deviceLanguage: String {
        (Locale.preferredLanguages.first ?? "").lowercased().hasPrefix("ko") ? "ko" : "en"
    }

    init(language: String) {
        self.language = language
        bundle = Bundle.main.path(forResource: language, ofType: "lproj").flatMap(Bundle.init(path:)) ?? .main
    }

    func text(_ key: String) -> String {
        bundle.localizedString(forKey: key, value: nil, table: nil)
    }

    func elapsed(_ value: NuElapsed) -> String {
        switch value {
        case .justNow: return text("widget.ago.justNow")
        case .minutes(let m): return String(format: text("widget.ago.minutes"), m)
        case .hours(let h): return String(format: text("widget.ago.hours"), h)
        case .hoursMinutes(let h, let m): return String(format: text("widget.ago.hoursMinutes"), h, m)
        }
    }
}

// MARK: - View

extension Color {
    static let nuRed = Color(red: 1, green: 59 / 255, blue: 48 / 255) // #FF3B30
}

struct NuWidgetView: View {
    let entry: NuWidgetEntry

    private var strings: NuWidgetStrings { NuWidgetStrings(language: entry.language) }
    private var question: String { strings.text(entry.questionKey) }
    private var elapsed: String? {
        guard entry.state.showsLastLog, let last = entry.lastEntry else { return nil }
        return strings.elapsed(NuWidgetLogic.elapsed(from: last, to: entry.date))
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            NuLogo()
            NuQuestion(lines: question.components(separatedBy: "\n"))
                .padding(.top, 6)
                .layoutPriority(1) // the gap below gives way first
            Spacer(minLength: 4)
            footer
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(accessibilityText)
        .widgetURL(NuWidgetShared.writeURL)
        .nuWidgetBackground()
    }

    @ViewBuilder private var footer: some View {
        if let elapsed = elapsed {
            VStack(alignment: .leading, spacing: 3) {
                Text(strings.text("widget.lastLog"))
                    .font(.system(size: 11, weight: .medium))
                    .foregroundColor(.secondary)
                    .lineLimit(1)
                HStack(spacing: 5) {
                    Circle().fill(Color.nuRed).frame(width: 6, height: 6)
                    Text(elapsed)
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundColor(.primary)
                        .lineLimit(1)
                        .minimumScaleFactor(0.8)
                }
            }
        } else {
            Text(strings.text("widget.tapToWrite"))
                .font(.system(size: 12))
                .foregroundColor(.secondary)
                .lineLimit(1)
                .minimumScaleFactor(0.8)
        }
    }

    private var accessibilityText: String {
        let q = question.replacingOccurrences(of: "\n", with: " ")
        if let elapsed = elapsed { return "\(q) \(strings.text("widget.lastLog")): \(elapsed)" }
        return "\(q) \(strings.text("widget.tapToWrite"))"
    }
}

/// "nu" with the small red dot, like the app's header (dot ≈ 0.15 of the type size, just above the baseline).
struct NuLogo: View {
    var size: CGFloat = 16

    var body: some View {
        HStack(alignment: .lastTextBaseline, spacing: size * 0.12) {
            Text(verbatim: "nu")
                .font(.system(size: size, weight: .bold))
                .kerning(-size * 0.04)
                .foregroundColor(.primary)
            Circle()
                .fill(Color.nuRed)
                .frame(width: size * 0.22, height: size * 0.22)
                .alignmentGuide(.lastTextBaseline) { d in d[.bottom] + size * 0.1 }
        }
    }
}

/// The question, broken exactly where the copy says ("\n"). The largest of 17 / 16 / 15 / 14.45 pt
/// (0.85) at which every line fits on one line is used; only when even that is too wide does the
/// text wrap (at most 3 lines, shrinking to 0.85 if the height runs short).
struct NuQuestion: View {
    let lines: [String]
    static let size: CGFloat = 17

    var body: some View {
        if #available(iOSApplicationExtension 16.0, *) {
            ViewThatFits(in: .horizontal) {
                unbroken(Self.size)
                unbroken(16)
                unbroken(15)
                unbroken(Self.size * 0.85)
                wrapping
            }
        } else {
            wrapping
        }
    }

    private func unbroken(_ size: CGFloat) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            ForEach(Array(lines.enumerated()), id: \.offset) { _, line in
                Text(verbatim: line)
                    .font(.system(size: size, weight: .semibold))
                    .foregroundColor(.primary)
                    .lineLimit(1)
                    .fixedSize(horizontal: true, vertical: false)
            }
        }
    }

    private var wrapping: some View {
        Text(verbatim: lines.joined(separator: "\n"))
            .font(.system(size: Self.size, weight: .semibold))
            .foregroundColor(.primary)
            .lineLimit(3)
            .minimumScaleFactor(0.85)
    }
}

extension View {
    /// System background (follows light/dark). iOS 17+ needs it as the container background.
    @ViewBuilder func nuWidgetBackground() -> some View {
        if #available(iOSApplicationExtension 17.0, *) {
            containerBackground(Color(UIColor.systemBackground), for: .widget)
        } else {
            padding(16).background(Color(UIColor.systemBackground))
        }
    }
}

// MARK: - Previews

#if DEBUG
private enum PreviewData {
    static let calendar = Calendar.current
    /// Thursday 26 Nov 2026, 15:10 local time
    static let now = calendar.date(from: DateComponents(year: 2026, month: 11, day: 26, hour: 15, minute: 10))!

    /// A typical latest entry for each state
    static func lastEntry(for state: NuWidgetState) -> Date {
        switch state {
        case .justLogged: return now.addingTimeInterval(-5 * 60)
        case .timePassed: return now.addingTimeInterval(-(60 + 20) * 60)
        case .noneToday: return calendar.date(byAdding: .hour, value: -18, to: now)! // yesterday 21:10
        case .back: return calendar.date(byAdding: .day, value: -4, to: now)!
        }
    }

    static func entry(_ state: NuWidgetState, _ language: String) -> NuWidgetEntry {
        let last = lastEntry(for: state)
        let key = NuWidgetLogic().questionKey(state: state, at: now)
        return NuWidgetEntry(date: now, state: state, questionKey: key, lastEntry: last, language: language)
    }

    /// Phrase `number` of `state`, with the widest bottom line that state can show
    /// ("29 min ago" / "23h 59m ago") to check nothing is cut off.
    static func phrase(_ state: NuWidgetState, _ number: Int, _ language: String) -> NuWidgetEntry {
        let day = calendar.startOfDay(for: now)
        let (date, last): (Date, Date?)
        switch state {
        case .justLogged: (date, last) = (now, now.addingTimeInterval(-29 * 60 - 30))
        case .timePassed: (date, last) = (day.addingTimeInterval(23 * 3600 + 59 * 60 + 30), day.addingTimeInterval(10))
        case .noneToday, .back: (date, last) = (now, lastEntry(for: state))
        }
        return NuWidgetEntry(date: date, state: state, questionKey: NuWidgetLogic.questionKey(state: state, number: number),
                             lastEntry: last, language: language)
    }
}

/// 4 states × light/dark × Korean/English
struct NuWidgetStates_Previews: PreviewProvider {
    static var previews: some View {
        Group {
            ForEach(["ko", "en"], id: \.self) { language in
                ForEach(NuWidgetState.allCases, id: \.self) { state in
                    ForEach([ColorScheme.light, .dark], id: \.self) { scheme in
                        NuWidgetView(entry: PreviewData.entry(state, language))
                            .previewContext(WidgetPreviewContext(family: .systemSmall))
                            .environment(\.colorScheme, scheme)
                            .previewDisplayName("\(state.rawValue) · \(language) · \(scheme == .dark ? "dark" : "light")")
                    }
                }
            }
        }
    }
}

/// Every phrase (16 per language), to check none is cut off
struct NuWidgetPhrases_Previews: PreviewProvider {
    static var previews: some View {
        Group {
            ForEach(["ko", "en"], id: \.self) { language in
                ForEach(NuWidgetState.allCases, id: \.self) { state in
                    ForEach(1...NuWidgetLogic.phrasesPerState, id: \.self) { number in
                        NuWidgetView(entry: PreviewData.phrase(state, number, language))
                            .previewContext(WidgetPreviewContext(family: .systemSmall))
                            .previewDisplayName("\(language) · \(state.rawValue).\(number)")
                    }
                }
            }
        }
    }
}
#endif
