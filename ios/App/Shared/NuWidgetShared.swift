import Foundation

/// What nu. shares with its home screen widget (ios/App/NuWidget), through the App Group container.
/// Compiled into both the app and the widget extension.
///
/// Only the time of the latest entry is shared: the widget shows how long ago it was, never what
/// was written.
enum NuWidgetShared {
    /// Must match the App Groups entitlement of both targets (App.entitlements, NuWidget.entitlements).
    static let appGroup = "group.com.dadahuis.nu"
    /// WidgetKit kind of the "nu." widget.
    static let kind = "NuNowWidget"
    /// Opened by a tap on the widget: the app goes straight to the input with the keyboard up.
    static let writeURL = URL(string: "nu://write")!

    private static let lastEntryKey = "nu.widget.lastEntryAt" // ms since 1970; absent = no entries

    private static var defaults: UserDefaults? { UserDefaults(suiteName: appGroup) }

    static func lastEntryAt() -> Date? {
        guard let ms = defaults?.object(forKey: lastEntryKey) as? Double else { return nil }
        return Date(timeIntervalSince1970: ms / 1000)
    }

    /// Stores the latest entry time. Returns true when it changed (the widget needs a reload).
    @discardableResult
    static func setLastEntryAt(_ date: Date?) -> Bool {
        guard let defaults = defaults else { return false }
        let old = defaults.object(forKey: lastEntryKey) as? Double
        let new = date.map { ($0.timeIntervalSince1970 * 1000).rounded() }
        guard old != new else { return false }
        if let new = new { defaults.set(new, forKey: lastEntryKey) } else { defaults.removeObject(forKey: lastEntryKey) }
        return true
    }
}
