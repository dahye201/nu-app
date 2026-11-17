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
        let log = UNTextInputNotificationAction(identifier: Self.logAction,
                                                title: "Log it",
                                                options: [.authenticationRequired],
                                                textInputButtonTitle: "Log",
                                                textInputPlaceholder: "What did you just finish?")
        let later = UNNotificationAction(identifier: Self.laterAction, title: "Remind me in 1 hour", options: [])
        let skip = UNNotificationAction(identifier: Self.skipAction, title: "Not today", options: [])
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
            removeReminders(firingBefore: Date().addingTimeInterval(skipWindow), completion: completionHandler)

        case Self.laterAction:
            scheduleSnooze(body: response.notification.request.content.body, completion: completionHandler)

        case Self.skipAction:
            UserDefaults.standard.set(Self.dayString(Date()), forKey: Self.skipDayKey)
            let endOfToday = Calendar.current.startOfDay(for: Date()).addingTimeInterval(24 * 60 * 60)
            removeReminders(firingBefore: endOfToday, completion: completionHandler)

        default:
            completionHandler()
        }
    }

    // MARK: Scheduling

    /// Replaces all scheduled check-ins with `reminders` (fire date in ms, message body).
    func schedule(_ reminders: [(at: Double, body: String)], completion: @escaping (Int) -> Void) {
        let center = UNUserNotificationCenter.current()
        center.getPendingNotificationRequests { requests in
            let old = requests.map(\.identifier).filter { $0.hasPrefix(Self.reminderPrefix) }
            center.removePendingNotificationRequests(withIdentifiers: old)

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
            let ids = requests.map(\.identifier).filter { $0.hasPrefix(Self.reminderPrefix) || $0.hasPrefix(Self.snoozePrefix) }
            center.removePendingNotificationRequests(withIdentifiers: ids)
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
        CAPPluginMethod(name: "getTimeFormat", returnType: CAPPluginReturnPromise)
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
        NuReminders.shared.schedule(reminders) { count in call.resolve(["count": count]) }
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
