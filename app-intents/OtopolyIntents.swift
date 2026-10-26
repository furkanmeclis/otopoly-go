import AppIntents
internal import ExpoAppIntents
import SwiftUI

// Every intent except the daily summary opens the app and hands a navigation request to JavaScript
// (src/features/intents/routing.ts). JavaScript checks the session and the member's permissions before
// navigating, so nothing here trusts the caller. Dispatch names and param keys are a contract with
// routing.ts and with shortcuts users already saved: change them only with a migration there.

// MARK: - Today's summary (answers without opening the app)

struct TodaySummaryIntent: AppIntent {
  static let title: LocalizedStringResource = "Today's Summary"
  static let description = IntentDescription("Cars in progress, ready and delivered today, and today's collected payments.")
  static let openAppWhenRun: Bool = false

  @MainActor
  func perform() async throws -> some IntentResult & ProvidesDialog & ShowsSnippetView {
    let snapshot = await TodaySnapshot.load()
    return .result(dialog: "\(snapshot.spoken)", view: TodaySummarySnippet(snapshot: snapshot))
  }
}

struct TodaySummarySnippet: View {
  let snapshot: TodaySnapshot

  var body: some View {
    VStack(alignment: .leading, spacing: 10) {
      if snapshot.state == .ok {
        if !snapshot.organization.isEmpty {
          Text(snapshot.organization).font(.caption).foregroundStyle(.secondary).lineLimit(1)
        }
        HStack(spacing: 12) {
          stat(OtopolyText.pick(tr: "İşlemde", en: "In progress"), snapshot.inProgress, .orange)
          stat(OtopolyText.pick(tr: "Hazır", en: "Ready"), snapshot.ready, .blue)
          stat(OtopolyText.pick(tr: "Teslim", en: "Delivered"), snapshot.delivered, .green)
        }
        if !snapshot.collected.isEmpty {
          HStack {
            Text(OtopolyText.pick(tr: "Bugünkü tahsilat", en: "Collected today")).font(.subheadline)
            Spacer()
            Text(snapshot.collected).font(.headline).monospacedDigit()
          }
        }
        if !snapshot.updated.isEmpty {
          Text(OtopolyText.pick(tr: "\(snapshot.updated) itibarıyla", en: "As of \(snapshot.updated)"))
            .font(.caption2)
            .foregroundStyle(.secondary)
        }
      } else {
        Text(snapshot.spoken).font(.subheadline)
      }
    }
    .padding()
  }

  private func stat(_ label: String, _ value: Int, _ color: Color) -> some View {
    VStack(alignment: .leading, spacing: 2) {
      Text("\(value)").font(.title2.bold()).monospacedDigit().foregroundStyle(color)
      Text(label).font(.caption).foregroundStyle(.secondary).lineLimit(1)
    }
    .frame(maxWidth: .infinity, alignment: .leading)
  }
}

// MARK: - Jobs

struct NewJobIntent: AppIntent {
  static let title: LocalizedStringResource = "New Job"
  static let description = IntentDescription("Opens a new job. With a plate, the customer and vehicle are picked for you.")
  static let openAppWhenRun: Bool = true

  @Parameter(title: "Plate")
  var plate: String?

  @MainActor
  func perform() async throws -> some IntentResult {
    var params: AppIntentParams = [:]
    if let plate, !plate.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
      params["plate"] = .string(plate)
    }
    await AppIntentDispatcher.shared.dispatch(name: "newJob", params: params)
    return .result()
  }
}

struct ReadyJobsIntent: AppIntent {
  static let title: LocalizedStringResource = "Ready Cars"
  static let description = IntentDescription("Shows today's cars that are ready for delivery.")
  static let openAppWhenRun: Bool = true

  @MainActor
  func perform() async throws -> some IntentResult {
    await AppIntentDispatcher.shared.dispatch(name: "readyJobs")
    return .result()
  }
}

// MARK: - Customers

struct SearchPlateIntent: AppIntent {
  static let title: LocalizedStringResource = "Search Plate"
  static let description = IntentDescription("Finds the customer and vehicle with a plate.")
  static let openAppWhenRun: Bool = true

  @Parameter(title: "Plate", requestValueDialog: "Which plate?")
  var plate: String

  @MainActor
  func perform() async throws -> some IntentResult {
    await AppIntentDispatcher.shared.dispatch(name: "searchPlate", params: ["plate": .string(plate)])
    return .result()
  }
}

struct OpenCustomerIntent: AppIntent {
  static let title: LocalizedStringResource = "Open Customer"
  static let description = IntentDescription("Opens a customer's page.")
  static let openAppWhenRun: Bool = true

  @Parameter(title: "Customer", requestValueDialog: "Which customer?")
  var customer: CustomerEntity

  @MainActor
  func perform() async throws -> some IntentResult {
    await AppIntentDispatcher.shared.dispatch(name: "openCustomer", params: ["customerId": .string(customer.id)])
    return .result()
  }
}

// MARK: - Assistant, sign-in, calendar

struct AskAssistantIntent: AppIntent {
  static let title: LocalizedStringResource = "Ask the Assistant"
  static let description = IntentDescription("Opens the Otopoly assistant and asks your question.")
  static let openAppWhenRun: Bool = true

  @Parameter(title: "Question", requestValueDialog: "What would you like to ask?")
  var prompt: String

  @MainActor
  func perform() async throws -> some IntentResult {
    await AppIntentDispatcher.shared.dispatch(name: "askAssistant", params: ["prompt": .string(prompt)])
    return .result()
  }
}

struct QrLoginIntent: AppIntent {
  static let title: LocalizedStringResource = "Sign In with QR"
  static let description = IntentDescription("Opens the scanner to approve a web panel sign-in.")
  static let openAppWhenRun: Bool = true

  @MainActor
  func perform() async throws -> some IntentResult {
    await AppIntentDispatcher.shared.dispatch(name: "qrLogin")
    return .result()
  }
}

struct CalendarTodayIntent: AppIntent {
  static let title: LocalizedStringResource = "Today's Calendar"
  static let description = IntentDescription("Opens today's calendar.")
  static let openAppWhenRun: Bool = true

  @MainActor
  func perform() async throws -> some IntentResult {
    await AppIntentDispatcher.shared.dispatch(name: "calendarToday")
    return .result()
  }
}
