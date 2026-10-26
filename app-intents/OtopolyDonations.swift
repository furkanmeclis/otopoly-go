import AppIntents
internal import ExpoAppIntents
internal import ExpoModulesCore

// Intents JavaScript may donate (`donateIntentAsync(name, params)`, src/features/intents/donations.ts)
// after the user did the same thing in the app, so Siri can suggest it. Free text (plates, questions)
// is never donated; the parameterless intents donate nothing but the action itself.

extension TodaySummaryIntent: DonatableAppIntent {}
extension NewJobIntent: DonatableAppIntent {}
extension ReadyJobsIntent: DonatableAppIntent {}
extension QrLoginIntent: DonatableAppIntent {}
extension CalendarTodayIntent: DonatableAppIntent {}

extension OpenCustomerIntent: DonatableAppIntent {
  struct DonationParams: Record {
    // `.required` rejects params without `customerId`; the empty default is never used.
    @Field(.required) var customerId: String = ""
  }

  final class UnknownCustomerException: GenericException<String>, @unchecked Sendable {
    override var reason: String {
      return "Customer '\(param)' is not in the published 'otopoly.customer' catalog, so it cannot be donated."
    }
  }

  /// The customer is read from the published catalog, the same way Siri resolves it, so a donation
  /// always refers to a customer Siri can find again.
  init(donationParams: DonationParams) async throws {
    self.init()
    guard let customer = try await CustomerQuery().entities(for: [donationParams.customerId]).first else {
      throw UnknownCustomerException(donationParams.customerId)
    }
    self.customer = customer
  }
}
