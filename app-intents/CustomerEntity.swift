import AppIntents
internal import ExpoAppIntents
import Foundation

/// A customer Siri and Shortcuts can name ("Open Ahmet Yılmaz in Otopoly"). The app publishes only
/// recent customers (name + plates, no phone or e-mail) and clears the catalog on sign-out and on
/// organization switch, so another business's customers never resolve here.
struct CustomerEntity: AppEntity {
  static let typeDisplayRepresentation: TypeDisplayRepresentation = "Customer"
  static let defaultQuery = CustomerQuery()

  var id: String
  @Property(title: "Name")
  var name: String
  var subtitle: String?
  var synonyms: [String]

  var displayRepresentation: DisplayRepresentation {
    let spoken = synonyms.map { LocalizedStringResource(stringLiteral: $0) }
    if let subtitle, !subtitle.isEmpty {
      return DisplayRepresentation(title: "\(name)", subtitle: "\(subtitle)", synonyms: spoken)
    }
    return DisplayRepresentation(title: "\(name)", synonyms: spoken)
  }

  init(record: AppIntentEntityRecord) {
    self.id = record.id
    self.subtitle = record.subtitle
    self.synonyms = record.synonyms
    self.name = record.title
  }

  func matches(_ search: String) -> Bool {
    let needle = otopolyFold(search)
    guard !needle.isEmpty else {
      return false
    }
    return ([name] + synonyms).map(otopolyFold).contains { term in
      term == needle || term.contains(needle) || needle.contains(term)
    }
  }
}

/// Resolves customers from the catalog the app publishes (`otopoly.customer`). Empty until the app has
/// synced once after sign-in; Siri then has nothing to offer and asks the user to open the app.
struct CustomerQuery: EntityStringQuery {
  func entities(for identifiers: [String]) async throws -> [CustomerEntity] {
    return try await AppIntentEntityStore.shared.entities(ofKind: OtopolyCatalog.customers, matching: identifiers)
      .map(CustomerEntity.init(record:))
  }

  func suggestedEntities() async throws -> [CustomerEntity] {
    return try await AppIntentEntityStore.shared.entities(ofKind: OtopolyCatalog.customers)
      .map(CustomerEntity.init(record:))
  }

  func entities(matching string: String) async throws -> [CustomerEntity] {
    return try await suggestedEntities().filter { $0.matches(string) }
  }
}
