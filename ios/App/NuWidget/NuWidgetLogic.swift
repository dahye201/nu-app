import Foundation

/// The widget's four states, decided by the latest entry time and the user's local calendar day.
enum NuWidgetState: String, CaseIterable {
    /// Logged today, less than 30 minutes ago
    case justLogged
    /// Logged today, 30 minutes ago or more
    case timePassed
    /// Nothing today; the latest entry is from yesterday, or there has never been one
    case noneToday
    /// The latest entry is from the day before yesterday or earlier
    case back

    /// Only with an entry today; a gap of days is never shown as a number.
    var showsLastLog: Bool { self == .justLogged || self == .timePassed }
}

/// How long ago the latest entry was: "just now", "5 min ago", "2h ago", "1h 20m ago".
enum NuElapsed: Equatable {
    case justNow
    case minutes(Int)
    case hours(Int)
    case hoursMinutes(Int, Int)
}

/// Pure widget logic (no WidgetKit or UI), so the same answers come out whenever the timeline is built.
struct NuWidgetLogic {
    var calendar: Calendar = .current

    static let justLoggedWindow: TimeInterval = 30 * 60
    static let phrasesPerState = 4
    static let slotHours = 2

    // MARK: State

    func state(lastEntry: Date?, now: Date) -> NuWidgetState {
        guard let last = lastEntry else { return .noneToday }
        let today = calendar.startOfDay(for: now)
        let lastDay = calendar.startOfDay(for: last)
        // Today (a time ahead of now, after a clock change, also counts as today)
        if lastDay >= today {
            return now.timeIntervalSince(last) < Self.justLoggedWindow ? .justLogged : .timePassed
        }
        let yesterday = calendar.date(byAdding: .day, value: -1, to: today) ?? today
        return lastDay >= yesterday ? .noneToday : .back
    }

    // MARK: Elapsed time

    static func elapsed(from last: Date, to now: Date) -> NuElapsed {
        let minutes = max(0, Int(now.timeIntervalSince(last) / 60)) // whole minutes, rounded down
        if minutes < 1 { return .justNow }
        if minutes < 60 { return .minutes(minutes) }
        let (h, m) = (minutes / 60, minutes % 60)
        return m == 0 ? .hours(h) : .hoursMinutes(h, m)
    }

    // MARK: Question rotation

    /// Two-hour slot, counted without a break across days, months and years:
    /// (days since 1970-01-01 of the local date) × 12 + local hour / 2.
    /// Consecutive slots always differ by one, so the phrase changes every 2 hours and the same
    /// phrase never shows twice in a row, including across midnight and month ends.
    func slot(at date: Date) -> Int {
        let c = calendar.dateComponents([.year, .month, .day, .hour], from: date)
        let day = Self.daysSinceEpoch(year: c.year ?? 1970, month: c.month ?? 1, day: c.day ?? 1)
        return day * (24 / Self.slotHours) + (c.hour ?? 0) / Self.slotHours
    }

    /// Localization key of the question, e.g. "widget.q.timePassed.3".
    func questionKey(state: NuWidgetState, at date: Date) -> String {
        let index = ((slot(at: date) % Self.phrasesPerState) + Self.phrasesPerState) % Self.phrasesPerState
        return Self.questionKey(state: state, number: index + 1)
    }

    static func questionKey(state: NuWidgetState, number: Int) -> String {
        "widget.q.\(state.rawValue).\(number)"
    }

    /// Like `questionKey(state:at:)`, but never the same wording as `previous` (the entry shown just
    /// before). Matters only when the state changes, as two states share a wording in Korean.
    func questionKey(state: NuWidgetState, at date: Date, after previous: String?, text: (String) -> String) -> String {
        let key = questionKey(state: state, at: date)
        guard let previous = previous, text(key) == previous else { return key }
        let number = Int(key.split(separator: ".").last ?? "1") ?? 1
        return Self.questionKey(state: state, number: number % Self.phrasesPerState + 1)
    }

    // MARK: Timeline

    /// When the widget should be redrawn, from `now` (first) up to `now + horizon`:
    /// - with an entry today: every minute for its first hour, then every 10 minutes until midnight
    ///   (so "5 min ago" and the 30-minute state change land on time)
    /// - every 2-hour rotation boundary, and every midnight
    func timelineDates(lastEntry: Date?, now: Date, horizon: TimeInterval = 12 * 60 * 60) -> [Date] {
        let end = now.addingTimeInterval(horizon)
        var dates: [Date] = []

        if let last = lastEntry, calendar.isDate(last, inSameDayAs: now) || last > now {
            let midnight = calendar.date(byAdding: .day, value: 1, to: calendar.startOfDay(for: now)) ?? end
            let stop = min(end, midnight)
            for minute in 1...60 {
                dates.append(last.addingTimeInterval(TimeInterval(minute * 60)))
            }
            var tick = last.addingTimeInterval(60 * 60 + 10 * 60)
            while tick < stop {
                dates.append(tick)
                tick = tick.addingTimeInterval(10 * 60)
            }
            dates = dates.filter { $0 < stop }
        }

        // Rotation boundaries (00:00, 02:00, … 22:00, local time); 00:00 is also midnight
        var day = calendar.startOfDay(for: now)
        while day <= end {
            for hour in stride(from: 0, to: 24, by: Self.slotHours) {
                if let boundary = calendar.date(bySettingHour: hour, minute: 0, second: 0, of: day) {
                    dates.append(boundary)
                }
            }
            day = calendar.date(byAdding: .day, value: 1, to: day) ?? end.addingTimeInterval(1)
        }

        let upcoming = Set(dates.filter { $0 > now && $0 <= end }).sorted()
        return [now] + upcoming
    }

    // MARK: Helpers

    /// Days from 1970-01-01 to the given proleptic Gregorian date (negative before it).
    static func daysSinceEpoch(year: Int, month: Int, day: Int) -> Int {
        // Howard Hinnant's days_from_civil
        let y = month <= 2 ? year - 1 : year
        let era = (y >= 0 ? y : y - 399) / 400
        let yoe = y - era * 400
        let mp = (month + 9) % 12
        let doy = (153 * mp + 2) / 5 + day - 1
        let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy
        return era * 146_097 + doe - 719_468
    }
}
