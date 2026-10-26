internal import ExpoAppIntents
internal import ExpoModulesCore

/// Registered Expo inline module that wires app-target App Intents code to expo-app-intents.
/// Do not change the name of this class.
final class AppIntentsSetup: Module {
  public func definition() -> ExpoModulesCore.ModuleDefinition {
    Name("AppIntentsSetup")

    OnCreate {
      // Names JavaScript donates by (src/features/intents/donations.ts); same as the dispatch names.
      AppIntentDonationRegistry.shared.register("todaySummary", as: TodaySummaryIntent.self)
      AppIntentDonationRegistry.shared.register("newJob", as: NewJobIntent.self)
      AppIntentDonationRegistry.shared.register("readyJobs", as: ReadyJobsIntent.self)
      AppIntentDonationRegistry.shared.register("qrLogin", as: QrLoginIntent.self)
      AppIntentDonationRegistry.shared.register("calendarToday", as: CalendarTodayIntent.self)
      AppIntentDonationRegistry.shared.register("openCustomer", as: OpenCustomerIntent.self)

      Task {
        await AppIntentDispatcher.shared.setShortcutsRefreshHandler {
          AppShortcuts.updateAppShortcutParameters()
        }
        AppShortcuts.updateAppShortcutParameters()
      }
    }
  }
}
