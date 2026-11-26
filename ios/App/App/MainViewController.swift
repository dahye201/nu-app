import UIKit
import Capacitor

/// Root view controller (set in Main.storyboard). Registers nu.'s own native plugins.
class MainViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(NuRemindersPlugin())
        bridge?.registerPluginInstance(NuJournalPlugin())
        bridge?.registerPluginInstance(NuWidgetPlugin())
        // nu. stays the notification delegate even if the bridge touched it while loading.
        NuReminders.shared.install()
    }
}
