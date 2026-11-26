import Foundation
import UIKit
import UserNotifications
import Capacitor

/// A reply typed into a reminder notification, kept natively until the web app has stored it.
struct PendingEntry: Codable {
    let id: String
    let text: String
    let ts: Double          // ms since 1970, when the reply was sent
    var ackedAt: Double?    // ms since 1970, when the web app confirmed it stored the entry
}

/// Durable queue for notification replies.
///
/// A reply is written to disk *before* iOS is told the action is handled, so it survives the app
/// being suspended or killed right afterwards. Entries stay for 7 days after the web app confirms
/// them (its localStorage write can lag behind); the web app de-duplicates by id, so delivering
/// the same entry again is harmless.
final class PendingEntryStore {
    static let shared = PendingEntryStore()

    private let queue = DispatchQueue(label: "nu.pending-entries")
    private let retentionMs: Double = 7 * 24 * 60 * 60 * 1000
    private let fallbackKey = "nu.pendingEntries.fallback"

    private var fileURL: URL {
        let dir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        return dir.appendingPathComponent("nu-pending-entries.json")
    }

    /// Reads the queue file. An unreadable file is moved aside instead of being overwritten.
    private func loadFile() -> [PendingEntry] {
        guard let data = try? Data(contentsOf: fileURL) else { return [] }
        if let entries = try? JSONDecoder().decode([PendingEntry].self, from: data) { return entries }
        let backup = fileURL.deletingPathExtension().appendingPathExtension("corrupt-\(Int(Date().timeIntervalSince1970)).json")
        try? FileManager.default.moveItem(at: fileURL, to: backup)
        NSLog("nu: pending entries file was unreadable, moved to \(backup.lastPathComponent)")
        return []
    }

    private func saveFile(_ entries: [PendingEntry]) throws {
        try FileManager.default.createDirectory(at: fileURL.deletingLastPathComponent(), withIntermediateDirectories: true)
        let data = try JSONEncoder().encode(entries)
        try data.write(to: fileURL, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
    }

    /// Entries that could not be written to the file (should never happen) live in UserDefaults instead.
    private func loadFallback() -> [PendingEntry] {
        guard let data = UserDefaults.standard.data(forKey: fallbackKey) else { return [] }
        return (try? JSONDecoder().decode([PendingEntry].self, from: data)) ?? []
    }

    private func saveFallback(_ entries: [PendingEntry]) {
        if entries.isEmpty {
            UserDefaults.standard.removeObject(forKey: fallbackKey)
        } else if let data = try? JSONEncoder().encode(entries) {
            UserDefaults.standard.set(data, forKey: fallbackKey)
        }
    }

    /// Saves a reply synchronously. Returns only after it is on disk (or in the fallback store).
    func append(text: String, at date: Date) {
        queue.sync {
            let entry = PendingEntry(id: UUID().uuidString, text: text, ts: (date.timeIntervalSince1970 * 1000).rounded(), ackedAt: nil)
            var entries = loadFile()
            entries.append(entry)
            do {
                try saveFile(entries)
            } catch {
                NSLog("nu: could not write reply to file (\(error)), using fallback store")
                saveFallback(loadFallback() + [entry])
            }
        }
    }

    func all() -> [PendingEntry] {
        queue.sync { loadFile() + loadFallback() }
    }

    /// Marks entries as stored by the web app and drops ones confirmed more than 7 days ago.
    func acknowledge(ids: Set<String>) {
        queue.sync {
            let now = Date().timeIntervalSince1970 * 1000
            func update(_ entries: [PendingEntry]) -> [PendingEntry] {
                entries
                    .map { entry -> PendingEntry in
                        var entry = entry
                        if ids.contains(entry.id) && entry.ackedAt == nil { entry.ackedAt = now }
                        return entry
                    }
                    .filter { entry in
                        guard let ackedAt = entry.ackedAt else { return true }
                        return now - ackedAt < retentionMs
                    }
            }
            do {
                try saveFile(update(loadFile()))
            } catch {
                NSLog("nu: could not update pending entries (\(error))")
            }
            saveFallback(update(loadFallback()))
        }
    }
}

/// Owns notification handling for nu.: the check-in category, reply capture and scheduling.
///
/// Set as the notification center delegate in `application(_:didFinishLaunchingWithOptions:)`,
/// so replies are received even when iOS launches the app in the background and the web view
/// never loads. Capacitor's own router is turned off (`ios.handleApplicationNotifications: false`).
final class NuReminders: NSObject, UNUserNotificationCenterDelegate {
    static let shared = NuReminders()

    static let categoryId = "nu.checkin"
    static let reminderPrefix = "nu.reminder."
    static let snoozePrefix = "nu.snooze."
    static let recapPrefix = "nu.recap."
    /// Evening recap settings from the web app: { time: "HH:MM", bodies: [text for 1 entry, 2 entries, …] }
    static let recapConfigKey = "nu.recap.config"
    static let skipDayKey = "nu.reminders.skipDay"

    private static let logAction = "nu.log"
    private static let laterAction = "nu.later"
    private static let skipAction = "nu.skip"

    /// After a reply, reminders due within this window are dropped ("skip if I just logged").
    private let skipWindow: TimeInterval = 2 * 60 * 60

    func install() {
        let center = UNUserNotificationCenter.current()
        center.delegate = self

        // .authenticationRequired: the reply is only accepted on an unlocked device, which keeps
        // the journal private and guarantees the queue file is writable.
        // Titles follow the app's language (en.lproj / ko.lproj), resolved at each launch.
        let log = UNTextInputNotificationAction(identifier: Self.logAction,
                                                title: NSLocalizedString("action.log", value: "Log it", comment: "Notification action: reply with an entry"),
                                                options: [.authenticationRequired],
                                                textInputButtonTitle: NSLocalizedString("action.log.send", value: "Log", comment: "Send button of the reply field"),
                                                textInputPlaceholder: NSLocalizedString("action.log.placeholder", value: "What did you just finish?", comment: "Reply field placeholder"))
        let later = UNNotificationAction(identifier: Self.laterAction,
                                         title: NSLocalizedString("action.later", value: "Remind me in 1 hour", comment: "Notification action: snooze for an hour"),
                                         options: [])
        let skip = UNNotificationAction(identifier: Self.skipAction,
                                        title: NSLocalizedString("action.skip", value: "Not today", comment: "Notification action: no more check-ins today"),
                                        options: [])
        let category = UNNotificationCategory(identifier: Self.categoryId, actions: [log, later, skip], intentIdentifiers: [], options: [])
        center.setNotificationCategories([category])
    }

    // While nu. is open there is nothing to remind about.
    func userNotificationCenter(_ center: UNUserNotificationCenter,
                                willPresent notification: UNNotification,
                                withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        completionHandler([])
    }

    func userNotificationCenter(_ center: UNUserNotificationCenter,
                                didReceive response: UNNotificationResponse,
                                withCompletionHandler systemCompletion: @escaping () -> Void) {
        // iOS requires this completion on the main thread; the notification center calls back on
        // its own queue, and calling it there aborts the app (seen with "Remind me in 1 hour").
        let completionHandler = { DispatchQueue.main.async(execute: systemCompletion) }
        switch response.actionIdentifier {
        case Self.logAction:
            let text = (response as? UNTextInputNotificationResponse)?.userText
                .trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            guard !text.isEmpty else { completionHandler(); return }
            // Saved to disk before anything else happens.
            PendingEntryStore.shared.append(text: text, at: Date())
            NuWidgetSync.noteReply(at: Date()) // home screen widget: "Last log · just now"
            bumpRecap {
                self.removeReminders(firingBefore: Date().addingTimeInterval(self.skipWindow), completion: completionHandler)
            }

        case Self.laterAction:
            scheduleSnooze(body: response.notification.request.content.body, completion: completionHandler)

        case Self.skipAction:
            UserDefaults.standard.set(Self.dayString(Date()), forKey: Self.skipDayKey)
            UNUserNotificationCenter.current().removePendingNotificationRequests(withIdentifiers: [Self.recapId(for: Date())])
            let endOfToday = Calendar.current.startOfDay(for: Date()).addingTimeInterval(24 * 60 * 60)
            removeReminders(firingBefore: endOfToday, completion: completionHandler)

        default:
            completionHandler()
        }
    }

    // MARK: Scheduling

    /// Replaces all scheduled check-ins with `reminders` (fire date in ms, message body), and the
    /// evening recap with `recap` (today's, if there is one). `recapConfig` lets a reply typed into a
    /// notification update the recap's count later without the web app.
    func schedule(_ reminders: [(at: Double, body: String)], recap: (at: Double, count: Int, body: String)?,
                  recapConfig: [String: Any]?, completion: @escaping (Int) -> Void) {
        let center = UNUserNotificationCenter.current()
        if let recapConfig = recapConfig {
            UserDefaults.standard.set(recapConfig, forKey: Self.recapConfigKey)
        }
        center.getPendingNotificationRequests { requests in
            let old = requests.map(\.identifier).filter { $0.hasPrefix(Self.reminderPrefix) || $0.hasPrefix(Self.recapPrefix) }
            center.removePendingNotificationRequests(withIdentifiers: old)
            if let recap = recap {
                Self.addRecap(at: Date(timeIntervalSince1970: recap.at / 1000), count: recap.count, body: recap.body)
            }

            let group = DispatchGroup()
            let lock = NSLock()
            var added = 0
            for reminder in reminders {
                let date = Date(timeIntervalSince1970: reminder.at / 1000)
                let parts = Calendar.current.dateComponents([.year, .month, .day, .hour, .minute], from: date)
                let trigger = UNCalendarNotificationTrigger(dateMatching: parts, repeats: false)
                let request = UNNotificationRequest(identifier: "\(Self.reminderPrefix)\(Int(reminder.at))",
                                                    content: Self.content(body: reminder.body),
                                                    trigger: trigger)
                group.enter()
                center.add(request) { error in
                    if let error = error {
                        NSLog("nu: could not schedule reminder: \(error)")
                    } else {
                        lock.lock(); added += 1; lock.unlock()
                    }
                    group.leave()
                }
            }
            group.notify(queue: .main) { completion(added) }
        }
    }

    func cancelAll(completion: @escaping () -> Void) {
        let center = UNUserNotificationCenter.current()
        center.getPendingNotificationRequests { requests in
            let ids = requests.map(\.identifier).filter {
                $0.hasPrefix(Self.reminderPrefix) || $0.hasPrefix(Self.snoozePrefix) || $0.hasPrefix(Self.recapPrefix)
            }
            center.removePendingNotificationRequests(withIdentifiers: ids)
            UserDefaults.standard.removeObject(forKey: Self.recapConfigKey) // reminders off: no recap from replies either
            DispatchQueue.main.async(execute: completion)
        }
    }

    private func scheduleSnooze(body: String, completion: @escaping () -> Void) {
        let trigger = UNTimeIntervalNotificationTrigger(timeInterval: 60 * 60, repeats: false)
        let request = UNNotificationRequest(identifier: "\(Self.snoozePrefix)\(Int(Date().timeIntervalSince1970))",
                                            content: Self.content(body: body),
                                            trigger: trigger)
        UNUserNotificationCenter.current().add(request) { _ in completion() }
    }

    private func removeReminders(firingBefore limit: Date, completion: @escaping () -> Void) {
        let center = UNUserNotificationCenter.current()
        center.getPendingNotificationRequests { requests in
            let ids = requests.filter { request in
                guard request.identifier.hasPrefix(Self.reminderPrefix) || request.identifier.hasPrefix(Self.snoozePrefix) else { return false }
                guard let next = (request.trigger as? UNCalendarNotificationTrigger)?.nextTriggerDate()
                        ?? (request.trigger as? UNTimeIntervalNotificationTrigger)?.nextTriggerDate() else { return false }
                return next <= limit
            }.map(\.identifier)
            center.removePendingNotificationRequests(withIdentifiers: ids)
            completion()
        }
    }

    // MARK: Evening recap

    static func recapId(for date: Date) -> String { "\(recapPrefix)\(dayString(date))" }

    /// Plain notification (no Log it / snooze actions): "4 things logged today. That was a real day."
    private static func addRecap(at date: Date, count: Int, body: String) {
        let content = UNMutableNotificationContent()
        content.body = body
        content.sound = .default
        content.userInfo = ["recapCount": count]
        let parts = Calendar.current.dateComponents([.year, .month, .day, .hour, .minute], from: date)
        let request = UNNotificationRequest(identifier: recapId(for: date), content: content,
                                            trigger: UNCalendarNotificationTrigger(dateMatching: parts, repeats: false))
        UNUserNotificationCenter.current().add(request) { error in
            if let error = error { NSLog("nu: could not schedule recap: \(error)") }
        }
    }

    /// A reply was just saved: today's recap counts one more (or starts at 1). Skipped when reminders
    /// are off, on a "Not today" day, or after the recap time. Never touches the saved reply.
    private func bumpRecap(then next: @escaping () -> Void) {
        let now = Date()
        guard let config = UserDefaults.standard.dictionary(forKey: Self.recapConfigKey),
              let time = config["time"] as? String, let bodies = config["bodies"] as? [String], !bodies.isEmpty,
              UserDefaults.standard.string(forKey: Self.skipDayKey) != Self.dayString(now) else { next(); return }
        let hm = time.split(separator: ":").compactMap { Int($0) }
        guard hm.count == 2, let at = Calendar.current.date(bySettingHour: hm[0], minute: hm[1], second: 0, of: now), at > now
        else { next(); return }
        let center = UNUserNotificationCenter.current()
        center.getPendingNotificationRequests { requests in
            let current = requests.first { $0.identifier == Self.recapId(for: now) }
            let count = ((current?.content.userInfo["recapCount"] as? Int) ?? 0) + 1
            Self.addRecap(at: at, count: count, body: bodies[min(count, bodies.count) - 1])
            next()
        }
    }

    private static func content(body: String) -> UNNotificationContent {
        let content = UNMutableNotificationContent()
        content.body = body
        content.sound = .default
        content.categoryIdentifier = categoryId
        return content
    }

    static func dayString(_ date: Date) -> String {
        let parts = Calendar.current.dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", parts.year ?? 0, parts.month ?? 0, parts.day ?? 0)
    }
}

/// JS bridge: `registerPlugin('NuReminders')` in src/reminders.js.
@objc(NuRemindersPlugin)
public class NuRemindersPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "NuRemindersPlugin"
    public let jsName = "NuReminders"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "getPermission", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "askPermission", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "schedule", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "cancelAll", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "takePending", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "ackPending", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "openSettings", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getTimeFormat", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clearSkipDay", returnType: CAPPluginReturnPromise)
    ]

    @objc func getPermission(_ call: CAPPluginCall) {
        UNUserNotificationCenter.current().getNotificationSettings { settings in
            let display: String
            switch settings.authorizationStatus {
            case .authorized, .provisional, .ephemeral: display = "granted"
            case .denied: display = "denied"
            case .notDetermined: display = "prompt"
            @unknown default: display = "prompt"
            }
            call.resolve(["display": display])
        }
    }

    @objc func askPermission(_ call: CAPPluginCall) {
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound]) { granted, _ in
            call.resolve(["display": granted ? "granted" : "denied"])
        }
    }

    @objc func schedule(_ call: CAPPluginCall) {
        let list = call.getArray("reminders", JSObject.self) ?? []
        let reminders = list.compactMap { item -> (at: Double, body: String)? in
            guard let at = (item["at"] as? NSNumber)?.doubleValue, let body = item["body"] as? String else { return nil }
            return (at: at, body: body)
        }
        var recap: (at: Double, count: Int, body: String)?
        if let item = call.getObject("recap"), let at = (item["at"] as? NSNumber)?.doubleValue,
           let count = (item["count"] as? NSNumber)?.intValue, let body = item["body"] as? String {
            recap = (at: at, count: count, body: body)
        }
        var recapConfig: [String: Any]?
        if let time = call.getString("recapTime"), let bodies = call.getArray("recapBodies", String.self) {
            recapConfig = ["time": time, "bodies": bodies]
        }
        NuReminders.shared.schedule(reminders, recap: recap, recapConfig: recapConfig) { count in call.resolve(["count": count]) }
    }

    @objc func cancelAll(_ call: CAPPluginCall) {
        NuReminders.shared.cancelAll { call.resolve() }
    }

    /// Every reply not yet confirmed (plus recently confirmed ones); the web app de-duplicates by id.
    @objc func takePending(_ call: CAPPluginCall) {
        let entries: [JSObject] = PendingEntryStore.shared.all().map { ["id": $0.id, "text": $0.text, "ts": $0.ts] }
        let skipDay = UserDefaults.standard.string(forKey: NuReminders.skipDayKey)
        call.resolve(["entries": entries, "skipDay": skipDay ?? NSNull()])
    }

    /// Undoes "Not today" (Resume, or the user changed reminder settings); the web app reschedules.
    @objc func clearSkipDay(_ call: CAPPluginCall) {
        UserDefaults.standard.removeObject(forKey: NuReminders.skipDayKey)
        call.resolve()
    }

    /// Whether the user's iPhone shows 12-hour time ("3 PM") or 24-hour ("15:00").
    @objc func getTimeFormat(_ call: CAPPluginCall) {
        let pattern = DateFormatter.dateFormat(fromTemplate: "j", options: 0, locale: .current) ?? ""
        call.resolve(["hour12": pattern.contains("a")])
    }

    /// Opens nu.'s notification settings in the iPhone Settings app (nu.'s settings page before iOS 16).
    @objc func openSettings(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            let target: String
            if #available(iOS 16.0, *) {
                target = UIApplication.openNotificationSettingsURLString
            } else {
                target = UIApplication.openSettingsURLString
            }
            guard let url = URL(string: target) else { call.resolve(); return }
            UIApplication.shared.open(url) { _ in call.resolve() }
        }
    }

    @objc func ackPending(_ call: CAPPluginCall) {
        let ids = call.getArray("ids", String.self) ?? []
        PendingEntryStore.shared.acknowledge(ids: Set(ids))
        call.resolve()
    }
}

/// Native copy of the journal (every day's entries), kept in Application Support so it is part of
/// the iPhone's iCloud/computer backup and survives WebKit clearing the web view's localStorage.
/// The web app writes it after every change and reads it on launch only when localStorage is empty.
/// Separate from the notification reply queue (PendingEntryStore), which is unchanged.
@objc(NuJournalPlugin)
public class NuJournalPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "NuJournalPlugin"
    public let jsName = "NuJournal"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "save", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "load", returnType: CAPPluginReturnPromise)
    ]

    private static let queue = DispatchQueue(label: "nu.journal-mirror")

    private static var fileURL: URL {
        let dir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        return dir.appendingPathComponent("nu-journal.json")
    }

    /// `data`: the journal as a JSON string. Written atomically, so a crash leaves the previous copy.
    @objc func save(_ call: CAPPluginCall) {
        guard let text = call.getString("data"), let data = text.data(using: .utf8) else {
            call.reject("missing data"); return
        }
        Self.queue.async {
            do {
                let url = Self.fileURL
                try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
                try data.write(to: url, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
                call.resolve()
            } catch {
                NSLog("nu: could not write journal copy (\(error))")
                call.reject("write failed")
            }
        }
    }

    /// The saved journal JSON string, or null if there is none.
    @objc func load(_ call: CAPPluginCall) {
        Self.queue.async {
            let text = (try? Data(contentsOf: Self.fileURL)).flatMap { String(data: $0, encoding: .utf8) }
            call.resolve(["data": text ?? NSNull()])
        }
    }
}
