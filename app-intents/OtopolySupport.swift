import AppIntents
internal import ExpoAppIntents
import Foundation

/// Catalog kinds the JavaScript side publishes with `setEntityCatalogAsync` (src/features/intents/catalog.ts).
/// Keep the strings identical on both sides.
enum OtopolyCatalog {
  /// One record (`id: "today"`) with the signed-in organization's figures for the day.
  static let today = "otopoly.today"
  /// Recent customers (from the last 30 days of jobs) so Siri and Shortcuts can resolve names.
  static let customers = "otopoly.customer"
}

/// Strings built at run time (dialogs with numbers) cannot come from a string catalog key, so they are
/// picked here by the language the system resolved for this app (Settings → Otopoly → Language).
enum OtopolyText {
  static var isTurkish: Bool {
    let language = Bundle.main.preferredLocalizations.first ?? Locale.preferredLanguages.first ?? "tr"
    return language.hasPrefix("tr")
  }

  static func pick(tr: String, en: String) -> String {
    return isTurkish ? tr : en
  }
}

/// Folds case and diacritics (Turkish ı/İ included) so "sahin" finds "Şahin" and "34abc12" finds "34 ABC 12".
func otopolyFold(_ value: String) -> String {
  return value
    .replacingOccurrences(of: "ı", with: "i")
    .replacingOccurrences(of: "İ", with: "i")
    .folding(options: [.caseInsensitive, .diacriticInsensitive], locale: Locale(identifier: "tr_TR"))
    .components(separatedBy: .whitespacesAndNewlines)
    .joined()
    .replacingOccurrences(of: "-", with: "")
}

/// Today's figures as the app last published them. Siri reads them without starting JavaScript, so the
/// numbers are as fresh as the app's last sync (the same snapshot the Home Screen widget shows).
struct TodaySnapshot {
  enum State {
    /// Nobody is signed in (or the app has never synced on this device).
    case signedOut
    /// The member may not see jobs in this organization.
    case noAccess
    /// The last sync is from an earlier day.
    case stale
    case ok
  }

  var state: State
  var organization: String = ""
  var inProgress: Int = 0
  var ready: Int = 0
  var delivered: Int = 0
  /// Formatted by the app in the organization's currency; empty when the member can't see payments.
  var collected: String = ""
  /// "HH:mm" of the last sync.
  var updated: String = ""

  static func load() async -> TodaySnapshot {
    let records = (try? await AppIntentEntityStore.shared.entities(ofKind: OtopolyCatalog.today)) ?? []
    guard let record = records.first(where: { $0.id == "today" }) else {
      return TodaySnapshot(state: .signedOut)
    }
    let meta = record.metadata
    var snapshot = TodaySnapshot(state: .ok)
    snapshot.organization = record.title
    snapshot.updated = meta["updated"] ?? ""
    if meta["state"] == "noAccess" {
      snapshot.state = .noAccess
      return snapshot
    }
    if meta["date"] != localDate() {
      snapshot.state = .stale
      return snapshot
    }
    snapshot.inProgress = Int(meta["inProgress"] ?? "") ?? 0
    snapshot.ready = Int(meta["ready"] ?? "") ?? 0
    snapshot.delivered = Int(meta["delivered"] ?? "") ?? 0
    snapshot.collected = meta["collected"] ?? ""
    return snapshot
  }

  /// Same day key the app writes (`localToday()`: device time zone, yyyy-MM-dd).
  static func localDate(_ date: Date = Date()) -> String {
    let formatter = DateFormatter()
    formatter.calendar = Calendar(identifier: .gregorian)
    formatter.locale = Locale(identifier: "en_US_POSIX")
    formatter.timeZone = TimeZone.current
    formatter.dateFormat = "yyyy-MM-dd"
    return formatter.string(from: date)
  }

  var spoken: String {
    switch state {
    case .signedOut:
      return OtopolyText.pick(
        tr: "Otopoly'de açık bir oturum yok. Uygulamayı açıp oturum açtığınızda günün özetini söyleyebilirim.",
        en: "You're not signed in to Otopoly. Open the app and sign in, then I can tell you today's summary."
      )
    case .noAccess:
      return OtopolyText.pick(
        tr: "\(organization) işletmesinde iş emirlerini görme yetkiniz yok.",
        en: "You don't have access to jobs in \(organization)."
      )
    case .stale:
      return OtopolyText.pick(
        tr: "Bugüne ait güncel bilgi henüz yok. Sayıları yenilemek için Otopoly'yi bir kez açın.",
        en: "There's no up-to-date information for today yet. Open Otopoly once to refresh the numbers."
      )
    case .ok:
      var text = OtopolyText.pick(
        tr: "\(organization): bugün \(inProgress) araç işlemde, \(ready) araç hazır, \(delivered) araç teslim edildi.",
        en: "\(organization): today \(inProgress) in progress, \(ready) ready and \(delivered) delivered."
      )
      if !collected.isEmpty {
        text += OtopolyText.pick(tr: " Bugünkü tahsilat \(collected).", en: " Collected today: \(collected).")
      }
      return text
    }
  }
}
