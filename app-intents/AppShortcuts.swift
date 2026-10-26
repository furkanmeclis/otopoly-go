import AppIntents

/// Otopoly's App Shortcuts (Siri phrases, Shortcuts app tiles, Spotlight actions). Phrases are compiled
/// into the app; the Turkish phrases live in AppShortcuts.xcstrings next to this file.
///
/// System rules: every phrase includes \(.applicationName); a phrase interpolates at most one entity
/// parameter (free-text parameters such as the plate are asked by Siri); at most 10 App Shortcuts.
struct AppShortcuts: AppShortcutsProvider {
  static var appShortcuts: [AppShortcut] {
    AppShortcut(
      intent: TodaySummaryIntent(),
      phrases: [
        "Today's summary in \(.applicationName)",
        "How many cars today in \(.applicationName)",
        "Today's revenue in \(.applicationName)",
      ],
      shortTitle: "Today's Summary",
      systemImageName: "chart.bar.doc.horizontal"
    )
    AppShortcut(
      intent: NewJobIntent(),
      phrases: [
        "New job in \(.applicationName)",
        "Open a new job in \(.applicationName)",
      ],
      shortTitle: "New Job",
      systemImageName: "plus.rectangle.on.rectangle"
    )
    AppShortcut(
      intent: SearchPlateIntent(),
      phrases: [
        "Search a plate in \(.applicationName)",
        "Find a plate in \(.applicationName)",
      ],
      shortTitle: "Search Plate",
      systemImageName: "magnifyingglass"
    )
    AppShortcut(
      intent: OpenCustomerIntent(),
      phrases: [
        "Open \(\.$customer) in \(.applicationName)",
        "Show customer \(\.$customer) in \(.applicationName)",
        "Find a customer in \(.applicationName)",
      ],
      shortTitle: "Open Customer",
      systemImageName: "person.crop.circle"
    )
    AppShortcut(
      intent: ReadyJobsIntent(),
      phrases: [
        "Show ready cars in \(.applicationName)",
        "Which cars are ready in \(.applicationName)",
      ],
      shortTitle: "Ready Cars",
      systemImageName: "car.side"
    )
    AppShortcut(
      intent: AskAssistantIntent(),
      phrases: [
        "Ask the assistant in \(.applicationName)",
        "Ask a question in \(.applicationName)",
      ],
      shortTitle: "Ask the Assistant",
      systemImageName: "sparkles"
    )
    AppShortcut(
      intent: QrLoginIntent(),
      phrases: [
        "Sign in with QR in \(.applicationName)",
        "Scan the QR code in \(.applicationName)",
      ],
      shortTitle: "Sign In with QR",
      systemImageName: "qrcode.viewfinder"
    )
    AppShortcut(
      intent: CalendarTodayIntent(),
      phrases: [
        "Today's calendar in \(.applicationName)",
        "Show today's appointments in \(.applicationName)",
      ],
      shortTitle: "Today's Calendar",
      systemImageName: "calendar"
    )
  }
}
