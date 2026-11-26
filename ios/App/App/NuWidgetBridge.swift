import Foundation
import UIKit
import WidgetKit
import Capacitor

/// Keeps the home screen widget's "latest entry" time current (ios/App/NuWidget).
///
/// The web app reports the newest entry in its journal after every change (src/widget.js). Replies
/// typed into a reminder notification are saved natively first and reach the web journal later, so
/// the ones it has not taken yet count too. The widget is reloaded only when the time changes.
enum NuWidgetSync {
    private static let queue = DispatchQueue(label: "nu.widget-sync")

    /// `webLastEntryMs`: newest entry in the web journal (ms since 1970), nil when there is none.
    static func update(webLastEntryMs: Double?) {
        queue.async {
            let web = webLastEntryMs.map { Date(timeIntervalSince1970: $0 / 1000) }
            let waiting = PendingEntryStore.shared.all()
                .filter { $0.ackedAt == nil }
                .map { Date(timeIntervalSince1970: $0.ts / 1000) }
                .max()
            store([web, waiting].compactMap { $0 }.max())
        }
    }

    /// A reply was just saved from a notification (the web view may not even be loaded).
    static func noteReply(at date: Date) {
        queue.async {
            store([NuWidgetShared.lastEntryAt(), date].compactMap { $0 }.max())
        }
    }

    private static func store(_ date: Date?) {
        if NuWidgetShared.setLastEntryAt(date) {
            WidgetCenter.shared.reloadTimelines(ofKind: NuWidgetShared.kind)
        }
    }
}

/// "Open the input" request from a widget tap (nu://write), kept until the web app takes it:
/// on launch the web view is not loaded yet, so it asks on boot; while running, the `nuWrite`
/// window event tells it to ask now.
final class NuWriteRequest {
    static let shared = NuWriteRequest()

    private let lock = NSLock()
    private var pending = false
    private var notifyWhenActive = false

    /// Handles nu://write. Returns false for any other URL.
    func handle(_ url: URL, bridge: CAPBridgeProtocol?) -> Bool {
        guard url.scheme == "nu", url.host == "write" else { return false }
        lock.lock(); pending = true; lock.unlock()
        if UIApplication.shared.applicationState == .active {
            bridge?.triggerWindowJSEvent(eventName: "nuWrite")
        } else {
            // Focus only brings up the keyboard once the app is in front
            lock.lock(); notifyWhenActive = true; lock.unlock()
        }
        return true
    }

    /// From applicationDidBecomeActive.
    func appDidBecomeActive(bridge: CAPBridgeProtocol?) {
        lock.lock(); let notify = notifyWhenActive && pending; notifyWhenActive = false; lock.unlock()
        if notify { bridge?.triggerWindowJSEvent(eventName: "nuWrite") }
    }

    /// True once per tap.
    func take() -> Bool {
        lock.lock(); defer { lock.unlock() }
        let value = pending
        pending = false
        return value
    }
}

/// JS bridge: `registerPlugin('NuWidget')` in src/widget.js.
@objc(NuWidgetPlugin)
public class NuWidgetPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "NuWidgetPlugin"
    public let jsName = "NuWidget"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "setLastEntry", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "takeWriteRequest", returnType: CAPPluginReturnPromise)
    ]

    /// `at`: newest entry time in ms, or null when the journal has no entries.
    @objc func setLastEntry(_ call: CAPPluginCall) {
        NuWidgetSync.update(webLastEntryMs: (call.options["at"] as? NSNumber)?.doubleValue)
        call.resolve()
    }

    @objc func takeWriteRequest(_ call: CAPPluginCall) {
        call.resolve(["write": NuWriteRequest.shared.take()])
    }
}
