package i18n

import "strings"

// Locale is a supported BCP-47 short code.
type Locale string

const (
	LocaleTR Locale = "tr"
	LocaleEN Locale = "en"
)

// Normalize returns a supported locale or the fallback.
func Normalize(locale string) Locale {
	switch strings.ToLower(strings.TrimSpace(locale)) {
	case "en":
		return LocaleEN
	default:
		return LocaleTR
	}
}

var catalogs = map[Locale]map[string]string{
	LocaleTR: trCatalog,
	LocaleEN: enCatalog,
}

// Translate resolves a dotted key for the locale with en fallback.
func Translate(locale Locale, key string) string {
	if v, ok := catalogs[locale][key]; ok && v != "" {
		return v
	}
	if locale != LocaleEN {
		if v, ok := catalogs[LocaleEN][key]; ok {
			return v
		}
	}
	return key
}

var trCatalog = map[string]string{
	"users.uuid": "UUID", "users.email": "E-posta", "users.name": "Ad",
	"users.surname": "Soyad", "users.status": "Durum", "users.created_at": "Oluşturulma",
	"users.locale": "Dil", "users.role_slugs": "Roller", "users.role": "Rol",
	"roles.uuid": "UUID", "roles.name": "Ad", "roles.slug": "Slug",
	"roles.is_system": "Sistem rolü", "roles.created_at": "Oluşturulma",
	"roles.description": "Açıklama", "roles.permission_slugs": "İzinler",
	"organizations.uuid": "UUID", "organizations.slug": "Slug", "organizations.name": "İşletme",
	"organizations.city": "İl", "organizations.phone": "Telefon", "organizations.status": "Durum",
	"organizations.plan_code": "Plan", "organizations.access_ends_at": "Erişim bitişi",
	"organizations.created_at":     "Oluşturulma",
	"organizations.status.pending": "Beklemede", "organizations.status.active": "Aktif",
	"organizations.status.suspended": "Askıda", "organizations.status.expired": "Süresi doldu",
	"notifications.uuid": "UUID", "notifications.channel": "Kanal",
	"notifications.status": "Durum", "notifications.priority": "Öncelik",
	"notifications.title": "Başlık", "notifications.created_at": "Oluşturulma",
	"notifications.read_at": "Okunma", "notifications.unread": "Okunmamış",
	"activity.action": "İşlem", "activity.resource": "Kaynak",
	"activity.actor": "Kullanıcı", "activity.created_at": "Tarih",
	"common.yes": "Evet", "common.no": "Hayır",
	"users.status.active": "Aktif", "users.status.disabled": "Pasif", "users.status.pending": "Beklemede",
	"export.document":                          "Dışa aktarma",
	"export.generated_at":                      "Oluşturulma",
	"export.title.platform.users":              "Kullanıcılar dışa aktarma",
	"export.title.platform.roles":              "Roller dışa aktarma",
	"export.title.platform.notifications":      "Bildirimler dışa aktarma",
	"export.title.platform.activity":           "Etkinlik günlüğü dışa aktarma",
	"export.title.tenant.finance.accounts":     "Kasalar dışa aktarma",
	"export.title.tenant.finance.categories":   "Kategoriler dışa aktarma",
	"export.title.tenant.finance.transactions": "Finans hareketleri dışa aktarma",
	"resources.platform.users":                 "Kullanıcılar",
	"resources.platform.roles":                 "Roller",
	"resources.platform.notifications":         "Bildirimler",
	"resources.platform.activity":              "Etkinlik günlüğü",
	"resources.tenant.finance.accounts":        "Kasalar",
	"resources.tenant.finance.categories":      "Kategoriler",
	"resources.tenant.finance.transactions":    "Finans hareketleri",
	"finance.accounts.name":                    "Hesap",
	"finance.accounts.type":                    "Tip",
	"finance.accounts.currency":                "Para birimi",
	"finance.accounts.current_balance":         "Bakiye",
	"finance.accounts.is_default":              "Varsayılan",
	"finance.accounts.is_active":               "Aktif",
	"finance.accounts.bank_name":               "Banka",
	"finance.accounts.iban":                    "IBAN",
	"finance.accounts.notes":                   "Not",
	"finance.accounts.opening_balance":         "Açılış bakiyesi",
	"finance.accounts.type.cash":               "Nakit",
	"finance.accounts.type.bank":               "Banka",
	"finance.categories.name":                  "Kategori",
	"finance.categories.kind":                  "Tür",
	"finance.categories.sort_order":            "Sıra",
	"finance.categories.is_active":             "Aktif",
	"finance.categories.kind.income":           "Gelir",
	"finance.categories.kind.expense":          "Gider",
	"finance.transactions.date":                "Tarih",
	"finance.transactions.type":                "Tip",
	"finance.transactions.amount":              "Tutar",
	"finance.transactions.currency":            "Para birimi",
	"finance.transactions.account":             "Hesap",
	"finance.transactions.category":            "Kategori",
	"finance.transactions.status":              "Durum",
	"finance.transactions.description":         "Açıklama",
	"finance.transactions.reference":           "Referans",
	"finance.transactions.type.income":         "Gelir",
	"finance.transactions.type.expense":        "Gider",
	"finance.transactions.type.transfer":       "Virman",
	"finance.transactions.status.posted":       "Kayıtlı",
	"finance.transactions.status.void":         "İptal",
	"export.format.pdf":                        "PDF",
	"export.format.xlsx":                       "Excel",
	"export.format.csv":                        "CSV",
	"export.format.json":                       "JSON",
}

var enCatalog = map[string]string{
	"users.uuid": "UUID", "users.email": "Email", "users.name": "First name",
	"users.surname": "Last name", "users.status": "Status", "users.created_at": "Created",
	"users.locale": "Locale", "users.role_slugs": "Roles", "users.role": "Role",
	"roles.uuid": "UUID", "roles.name": "Name", "roles.slug": "Slug",
	"roles.is_system": "System role", "roles.created_at": "Created",
	"roles.description": "Description", "roles.permission_slugs": "Permissions",
	"organizations.uuid": "UUID", "organizations.slug": "Slug", "organizations.name": "Business",
	"organizations.city": "City", "organizations.phone": "Phone", "organizations.status": "Status",
	"organizations.plan_code": "Plan", "organizations.access_ends_at": "Access ends",
	"organizations.created_at":     "Created",
	"organizations.status.pending": "Pending", "organizations.status.active": "Active",
	"organizations.status.suspended": "Suspended", "organizations.status.expired": "Expired",
	"notifications.uuid": "UUID", "notifications.channel": "Channel",
	"notifications.status": "Status", "notifications.priority": "Priority",
	"notifications.title": "Title", "notifications.created_at": "Created",
	"notifications.read_at": "Read at", "notifications.unread": "Unread",
	"activity.action": "Action", "activity.resource": "Resource",
	"activity.actor": "User", "activity.created_at": "Date",
	"common.yes": "Yes", "common.no": "No",
	"users.status.active": "Active", "users.status.disabled": "Disabled", "users.status.pending": "Pending",
	"export.document":                          "Export",
	"export.generated_at":                      "Generated",
	"export.title.platform.users":              "Users export",
	"export.title.platform.roles":              "Roles export",
	"export.title.platform.notifications":      "Notifications export",
	"export.title.platform.activity":           "Activity log export",
	"export.title.tenant.finance.accounts":     "Accounts export",
	"export.title.tenant.finance.categories":   "Categories export",
	"export.title.tenant.finance.transactions": "Transactions export",
	"resources.platform.users":                 "Users",
	"resources.platform.roles":                 "Roles",
	"resources.platform.notifications":         "Notifications",
	"resources.platform.activity":              "Activity log",
	"resources.tenant.finance.accounts":        "Accounts",
	"resources.tenant.finance.categories":      "Categories",
	"resources.tenant.finance.transactions":    "Transactions",
	"finance.accounts.name":                    "Account",
	"finance.accounts.type":                    "Type",
	"finance.accounts.currency":                "Currency",
	"finance.accounts.current_balance":         "Balance",
	"finance.accounts.is_default":              "Default",
	"finance.accounts.is_active":               "Active",
	"finance.accounts.bank_name":               "Bank",
	"finance.accounts.iban":                    "IBAN",
	"finance.accounts.notes":                   "Notes",
	"finance.accounts.opening_balance":         "Opening balance",
	"finance.accounts.type.cash":               "Cash",
	"finance.accounts.type.bank":               "Bank",
	"finance.categories.name":                  "Category",
	"finance.categories.kind":                  "Kind",
	"finance.categories.sort_order":            "Sort order",
	"finance.categories.is_active":             "Active",
	"finance.categories.kind.income":           "Income",
	"finance.categories.kind.expense":          "Expense",
	"finance.transactions.date":                "Date",
	"finance.transactions.type":                "Type",
	"finance.transactions.amount":              "Amount",
	"finance.transactions.currency":            "Currency",
	"finance.transactions.account":             "Account",
	"finance.transactions.category":            "Category",
	"finance.transactions.status":              "Status",
	"finance.transactions.description":         "Description",
	"finance.transactions.reference":           "Reference",
	"finance.transactions.type.income":         "Income",
	"finance.transactions.type.expense":        "Expense",
	"finance.transactions.type.transfer":       "Transfer",
	"finance.transactions.status.posted":       "Posted",
	"finance.transactions.status.void":         "Void",
	"export.format.pdf":                        "PDF",
	"export.format.xlsx":                       "Excel",
	"export.format.csv":                        "CSV",
	"export.format.json":                       "JSON",
}
