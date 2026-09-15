package resourcemeta

import (
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/bulkengine"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/bulkengine/adapters"
)

// ColumnType is the admin DataTable / meta column type contract.
type ColumnType string

const (
	ColumnTypeString   ColumnType = "string"
	ColumnTypeEnum     ColumnType = "enum"
	ColumnTypeBoolean  ColumnType = "boolean"
	ColumnTypeDatetime ColumnType = "datetime"
	ColumnTypeUUID     ColumnType = "uuid"
)

// FilterVariant describes how admin should render a filter control.
type FilterVariant string

const (
	FilterVariantText    FilterVariant = "text"
	FilterVariantFaceted FilterVariant = "faceted"
)

// Capabilities declares which list/resource operations the API actually supports.
type Capabilities struct {
	Create bool `json:"create"`
	Read   bool `json:"read"`
	Update bool `json:"update"`
	Delete bool `json:"delete"`
	Search bool `json:"search"`
	Filter bool `json:"filter"`
	Sort   bool `json:"sort"`
	Export bool `json:"export"`
	Import bool `json:"import"`
	Bulk   bool `json:"bulk"`
}

// Column describes one list-table column the API supports.
type Column struct {
	Key            string        `json:"key"`
	LabelKey       string        `json:"label_key"`
	Type           ColumnType    `json:"type"`
	Sortable       bool          `json:"sortable"`
	Filterable     bool          `json:"filterable"`
	FilterVariant  FilterVariant `json:"filter_variant,omitempty"`
	DefaultVisible bool          `json:"default_visible"`
}

// Filter describes one list filter the API supports.
type Filter struct {
	Key        string        `json:"key"`
	LabelKey   string        `json:"label_key"`
	Variant    FilterVariant `json:"variant"`
	EnumLookup string        `json:"enum_lookup,omitempty"`
}

// ResourceMeta is the table-metadata contract for a primary list resource.
type ResourceMeta struct {
	Resource         string                     `json:"resource"`
	DefaultSort      string                     `json:"default_sort"`
	DefaultFields    []string                   `json:"default_fields"`
	Capabilities     Capabilities               `json:"capabilities"`
	SearchableFields []string                   `json:"searchable_fields"`
	SortableFields   []string                   `json:"sortable_fields"`
	FilterableFields []string                   `json:"filterable_fields"`
	Columns          []Column                   `json:"columns"`
	Filters          []Filter                   `json:"filters"`
	Includes         []string                   `json:"includes"`
	BulkActions      []bulkengine.BulkActionDef `json:"bulk_actions"`
}

// PlatformUsers returns meta for GET /v1/platform/users.
func PlatformUsers() ResourceMeta {
	return ResourceMeta{
		Resource:      "platform.users",
		DefaultSort:   "-created_at",
		DefaultFields: []string{"uuid", "email", "name", "surname", "status"},
		Capabilities: Capabilities{
			Create: true, Read: true, Update: true, Delete: false,
			Search: true, Filter: true, Sort: true, Export: true, Import: true, Bulk: true,
		},
		SearchableFields: []string{"email", "name", "surname"},
		SortableFields:   []string{"email", "name", "surname", "status", "created_at", "updated_at"},
		FilterableFields: []string{"status", "role"},
		Columns: []Column{
			{Key: "uuid", LabelKey: "users.uuid", Type: ColumnTypeUUID, DefaultVisible: true},
			{Key: "email", LabelKey: "users.email", Type: ColumnTypeString, Sortable: true, DefaultVisible: true},
			{Key: "name", LabelKey: "users.name", Type: ColumnTypeString, Sortable: true, DefaultVisible: true},
			{Key: "surname", LabelKey: "users.surname", Type: ColumnTypeString, Sortable: true, DefaultVisible: true},
			{Key: "status", LabelKey: "users.status", Type: ColumnTypeEnum, Sortable: true, Filterable: true, FilterVariant: FilterVariantFaceted, DefaultVisible: true},
			{Key: "created_at", LabelKey: "users.created_at", Type: ColumnTypeDatetime, Sortable: true, DefaultVisible: false},
		},
		Filters: []Filter{
			{Key: "status", LabelKey: "users.status", Variant: FilterVariantFaceted, EnumLookup: "user_status"},
			{Key: "role", LabelKey: "users.role", Variant: FilterVariantFaceted, EnumLookup: "role_slug"},
		},
		Includes:    []string{"roles"},
		BulkActions: adapters.NewUsers(nil).BulkActions(),
	}
}

// PlatformRoles returns meta for GET /v1/platform/roles.
func PlatformRoles() ResourceMeta {
	return ResourceMeta{
		Resource:      "platform.roles",
		DefaultSort:   "name",
		DefaultFields: []string{"uuid", "name", "slug", "is_system"},
		Capabilities: Capabilities{
			Create: true, Read: true, Update: true, Delete: true,
			Search: true, Filter: false, Sort: true, Export: true, Import: true, Bulk: true,
		},
		SearchableFields: []string{"name", "slug"},
		SortableFields:   []string{"name", "slug", "created_at", "updated_at"},
		FilterableFields: []string{},
		Columns: []Column{
			{Key: "uuid", LabelKey: "roles.uuid", Type: ColumnTypeUUID, DefaultVisible: true},
			{Key: "name", LabelKey: "roles.name", Type: ColumnTypeString, Sortable: true, DefaultVisible: true},
			{Key: "slug", LabelKey: "roles.slug", Type: ColumnTypeString, Sortable: true, DefaultVisible: true},
			{Key: "is_system", LabelKey: "roles.is_system", Type: ColumnTypeBoolean, DefaultVisible: true},
			{Key: "created_at", LabelKey: "roles.created_at", Type: ColumnTypeDatetime, Sortable: true, DefaultVisible: false},
		},
		Filters:     []Filter{},
		Includes:    []string{"permission_slugs"},
		BulkActions: adapters.NewRoles(nil).BulkActions(),
	}
}

// Notifications returns meta for GET /v1/notifications (inbox).
func Notifications() ResourceMeta {
	return ResourceMeta{
		Resource:      "notifications",
		DefaultSort:   "-created_at",
		DefaultFields: []string{"uuid", "channel", "status", "priority", "title", "created_at", "read_at"},
		Capabilities: Capabilities{
			Create: false, Read: true, Update: false, Delete: false,
			Search: true, Filter: true, Sort: true, Export: false, Import: false, Bulk: false,
		},
		SearchableFields: []string{"title", "body", "template_code", "recipient"},
		SortableFields:   []string{"channel", "status", "priority", "created_at", "updated_at", "sent_at"},
		FilterableFields: []string{"status", "channel", "unread"},
		Columns: []Column{
			{Key: "uuid", LabelKey: "notifications.uuid", Type: ColumnTypeUUID, DefaultVisible: true},
			{Key: "channel", LabelKey: "notifications.channel", Type: ColumnTypeEnum, Sortable: true, Filterable: true, FilterVariant: FilterVariantFaceted, DefaultVisible: true},
			{Key: "status", LabelKey: "notifications.status", Type: ColumnTypeEnum, Sortable: true, Filterable: true, FilterVariant: FilterVariantFaceted, DefaultVisible: true},
			{Key: "priority", LabelKey: "notifications.priority", Type: ColumnTypeEnum, Sortable: true, DefaultVisible: true},
			{Key: "title", LabelKey: "notifications.title", Type: ColumnTypeString, DefaultVisible: true},
			{Key: "created_at", LabelKey: "notifications.created_at", Type: ColumnTypeDatetime, Sortable: true, DefaultVisible: true},
			{Key: "read_at", LabelKey: "notifications.read_at", Type: ColumnTypeDatetime, DefaultVisible: true},
		},
		Filters: []Filter{
			{Key: "status", LabelKey: "notifications.status", Variant: FilterVariantFaceted},
			{Key: "channel", LabelKey: "notifications.channel", Variant: FilterVariantFaceted},
			{Key: "unread", LabelKey: "notifications.unread", Variant: FilterVariantFaceted},
		},
		Includes:    []string{},
		BulkActions: []bulkengine.BulkActionDef{},
	}
}

// PlatformNotifications returns meta for GET /v1/platform/notifications.
func PlatformNotifications() ResourceMeta {
	m := Notifications()
	m.Resource = "platform.notifications"
	m.Capabilities.Export = true
	return m
}

// Activity returns meta for GET /v1/platform/activity.
func Activity() ResourceMeta {
	return ResourceMeta{
		Resource:      "platform.activity",
		DefaultSort:   "-created_at",
		DefaultFields: []string{"action", "resource", "actor_user_id", "created_at"},
		Capabilities: Capabilities{
			Read: true, Search: true, Filter: true, Sort: true, Export: true,
		},
		SearchableFields: []string{"action", "resource"},
		SortableFields:   []string{"created_at", "action", "resource"},
		Columns: []Column{
			{Key: "action", LabelKey: "activity.action", Sortable: true, DefaultVisible: true},
			{Key: "resource", LabelKey: "activity.resource", Sortable: true, DefaultVisible: true},
			{Key: "actor_user_id", LabelKey: "activity.actor", DefaultVisible: true},
			{Key: "created_at", LabelKey: "activity.created_at", Type: ColumnTypeDatetime, Sortable: true, DefaultVisible: true},
		},
	}
}

// PlatformStorage returns meta for GET /v1/platform/storage/objects.
func PlatformStorage() ResourceMeta {
	return ResourceMeta{
		Resource:      "platform.storage",
		DefaultSort:   "name",
		DefaultFields: []string{"name", "kind", "size", "updated_at", "access"},
		Capabilities: Capabilities{
			Create: true, Read: true, Update: true, Delete: true,
			Search: true, Filter: true, Sort: true, Export: false, Import: false, Bulk: false,
		},
		SearchableFields: []string{"name", "key", "mime_type"},
		SortableFields:   []string{"name", "size", "updated_at", "type"},
		FilterableFields: []string{"kind", "access"},
		Columns: []Column{
			{Key: "name", LabelKey: "storage.col_name", Type: ColumnTypeString, Sortable: true, DefaultVisible: true},
			{Key: "kind", LabelKey: "storage.col_type", Type: ColumnTypeEnum, Sortable: true, Filterable: true, FilterVariant: FilterVariantFaceted, DefaultVisible: true},
			{Key: "size", LabelKey: "storage.col_size", Type: ColumnTypeString, Sortable: true, DefaultVisible: true},
			{Key: "updated_at", LabelKey: "storage.col_modified", Type: ColumnTypeDatetime, Sortable: true, DefaultVisible: true},
			{Key: "access", LabelKey: "storage.col_access", Type: ColumnTypeEnum, Filterable: true, FilterVariant: FilterVariantFaceted, DefaultVisible: true},
		},
		Filters: []Filter{
			{Key: "kind", LabelKey: "storage.col_type", Variant: FilterVariantFaceted},
			{Key: "access", LabelKey: "storage.col_access", Variant: FilterVariantFaceted},
		},
		BulkActions: []bulkengine.BulkActionDef{},
	}
}

// PlatformLogs returns meta for GET /v1/platform/logs.
func PlatformLogs() ResourceMeta {
	return ResourceMeta{
		Resource:      "platform.logs",
		DefaultSort:   "-created_at",
		DefaultFields: []string{"level", "message", "source", "created_at"},
		Capabilities: Capabilities{
			Read: true, Delete: true, Search: true, Filter: true, Sort: true, Bulk: false,
		},
		SearchableFields: []string{"message", "source", "request_id"},
		SortableFields:   []string{"created_at", "level", "source"},
		FilterableFields: []string{"level", "source", "created_from", "created_to"},
		Columns: []Column{
			{Key: "level", LabelKey: "logs.columns.level", Type: ColumnTypeEnum, Sortable: true, Filterable: true, FilterVariant: FilterVariantFaceted, DefaultVisible: true},
			{Key: "message", LabelKey: "logs.columns.message", Type: ColumnTypeString, DefaultVisible: true},
			{Key: "source", LabelKey: "logs.columns.source", Type: ColumnTypeString, Sortable: true, Filterable: true, DefaultVisible: true},
			{Key: "created_at", LabelKey: "logs.columns.created_at", Type: ColumnTypeDatetime, Sortable: true, DefaultVisible: true},
		},
		Filters: []Filter{
			{Key: "level", LabelKey: "logs.columns.level", Variant: FilterVariantFaceted},
			{Key: "source", LabelKey: "logs.columns.source", Variant: FilterVariantText},
		},
		BulkActions: []bulkengine.BulkActionDef{},
	}
}

// PlatformLogRules returns meta for GET /v1/platform/log-rules.
func PlatformLogRules() ResourceMeta {
	return ResourceMeta{
		Resource:      "platform.log_rules",
		DefaultSort:   "name",
		DefaultFields: []string{"name", "enabled", "levels", "older_than_hours", "interval_minutes"},
		Capabilities: Capabilities{
			Create: true, Read: true, Update: true, Delete: true, Sort: true,
		},
		SortableFields: []string{"name", "created_at", "updated_at"},
		Columns: []Column{
			{Key: "name", LabelKey: "logs.rules.columns.name", Type: ColumnTypeString, DefaultVisible: true},
			{Key: "enabled", LabelKey: "logs.rules.columns.enabled", Type: ColumnTypeBoolean, DefaultVisible: true},
			{Key: "older_than_hours", LabelKey: "logs.rules.columns.older_than", Type: ColumnTypeString, DefaultVisible: true},
			{Key: "interval_minutes", LabelKey: "logs.rules.columns.schedule", Type: ColumnTypeString, DefaultVisible: true},
			{Key: "last_run_at", LabelKey: "logs.rules.columns.last_run", Type: ColumnTypeDatetime, DefaultVisible: true},
		},
	}
}

// PlatformOrganizations returns meta for GET /v1/platform/organizations.
func PlatformOrganizations() ResourceMeta {
	return ResourceMeta{
		Resource:      "platform.organizations",
		DefaultSort:   "-created_at",
		DefaultFields: []string{"uuid", "slug", "name", "city", "phone", "status", "plan_code", "access_ends_at"},
		Capabilities: Capabilities{
			Create: true, Read: true, Update: true, Delete: false,
			Search: true, Filter: true, Sort: true, Export: false, Import: false, Bulk: false,
		},
		SearchableFields: []string{"name", "slug", "city", "phone"},
		SortableFields:   []string{"name", "slug", "city", "status", "created_at", "access_ends_at"},
		FilterableFields: []string{"status"},
		Columns: []Column{
			{Key: "uuid", LabelKey: "organizations.uuid", Type: ColumnTypeUUID, DefaultVisible: true},
			{Key: "slug", LabelKey: "organizations.slug", Type: ColumnTypeString, Sortable: true, DefaultVisible: true},
			{Key: "name", LabelKey: "organizations.name", Type: ColumnTypeString, Sortable: true, DefaultVisible: true},
			{Key: "city", LabelKey: "organizations.city", Type: ColumnTypeString, Sortable: true, DefaultVisible: true},
			{Key: "phone", LabelKey: "organizations.phone", Type: ColumnTypeString, DefaultVisible: true},
			{Key: "status", LabelKey: "organizations.status", Type: ColumnTypeEnum, Sortable: true, Filterable: true, FilterVariant: FilterVariantFaceted, DefaultVisible: true},
			{Key: "plan_code", LabelKey: "organizations.plan_code", Type: ColumnTypeString, DefaultVisible: true},
			{Key: "access_ends_at", LabelKey: "organizations.access_ends_at", Type: ColumnTypeDatetime, Sortable: true, DefaultVisible: true},
			{Key: "created_at", LabelKey: "organizations.created_at", Type: ColumnTypeDatetime, Sortable: true, DefaultVisible: false},
		},
		Filters: []Filter{
			{Key: "status", LabelKey: "organizations.status", Variant: FilterVariantFaceted},
		},
	}
}

// TenantFinanceAccounts returns meta for GET /v1/tenant/finance/accounts.
func TenantFinanceAccounts() ResourceMeta {
	return ResourceMeta{
		Resource:      "tenant.finance.accounts",
		DefaultSort:   "name",
		DefaultFields: []string{"uuid", "name", "type", "currency", "current_balance", "is_default", "is_active"},
		Capabilities: Capabilities{
			Create: true, Read: true, Update: true, Delete: true, Search: true, Filter: true, Sort: true,
			Export: true, Import: true,
		},
		SearchableFields: []string{"name", "bank_name"},
		SortableFields:   []string{"name", "currency", "current_balance", "created_at"},
		FilterableFields: []string{"is_active", "type", "currency"},
		Columns: []Column{
			{Key: "name", LabelKey: "finance.accounts.name", Type: ColumnTypeString, Sortable: true, DefaultVisible: true},
			{Key: "type", LabelKey: "finance.accounts.type", Type: ColumnTypeEnum, Filterable: true, FilterVariant: FilterVariantFaceted, DefaultVisible: true},
			{Key: "currency", LabelKey: "finance.accounts.currency", Type: ColumnTypeString, Sortable: true, Filterable: true, DefaultVisible: true},
			{Key: "current_balance", LabelKey: "finance.accounts.current_balance", Type: ColumnTypeString, Sortable: true, DefaultVisible: true},
			{Key: "is_default", LabelKey: "finance.accounts.is_default", Type: ColumnTypeBoolean, DefaultVisible: true},
			{Key: "is_active", LabelKey: "finance.accounts.is_active", Type: ColumnTypeBoolean, Filterable: true, DefaultVisible: true},
		},
		Filters: []Filter{
			{Key: "is_active", LabelKey: "finance.accounts.is_active", Variant: FilterVariantFaceted},
			{Key: "type", LabelKey: "finance.accounts.type", Variant: FilterVariantFaceted},
		},
	}
}

// TenantFinanceCategories returns meta for GET /v1/tenant/finance/categories.
func TenantFinanceCategories() ResourceMeta {
	return ResourceMeta{
		Resource:      "tenant.finance.categories",
		DefaultSort:   "name",
		DefaultFields: []string{"uuid", "name", "kind", "sort_order", "is_active"},
		Capabilities: Capabilities{
			Create: true, Read: true, Update: true, Delete: true, Search: false, Filter: true, Sort: true,
			Export: true, Import: true,
		},
		SortableFields:   []string{"name", "kind", "sort_order"},
		FilterableFields: []string{"kind", "is_active"},
		Columns: []Column{
			{Key: "name", LabelKey: "finance.categories.name", Type: ColumnTypeString, Sortable: true, DefaultVisible: true},
			{Key: "kind", LabelKey: "finance.categories.kind", Type: ColumnTypeEnum, Filterable: true, FilterVariant: FilterVariantFaceted, DefaultVisible: true},
			{Key: "sort_order", LabelKey: "finance.categories.sort_order", Type: ColumnTypeString, Sortable: true, DefaultVisible: true},
			{Key: "is_active", LabelKey: "finance.categories.is_active", Type: ColumnTypeBoolean, Filterable: true, DefaultVisible: true},
		},
		Filters: []Filter{
			{Key: "kind", LabelKey: "finance.categories.kind", Variant: FilterVariantFaceted},
			{Key: "is_active", LabelKey: "finance.categories.is_active", Variant: FilterVariantFaceted},
		},
	}
}

// TenantFinanceTransactions returns meta for GET /v1/tenant/finance/transactions.
func TenantFinanceTransactions() ResourceMeta {
	return ResourceMeta{
		Resource:      "tenant.finance.transactions",
		DefaultSort:   "-transaction_date",
		DefaultFields: []string{"uuid", "type", "status", "amount", "currency", "transaction_date", "account_name", "category_name"},
		Capabilities: Capabilities{
			Create: true, Read: true, Update: false, Delete: false, Search: true, Filter: true, Sort: true,
			Export: true,
		},
		SearchableFields: []string{"description", "reference_no"},
		SortableFields:   []string{"transaction_date", "amount", "created_at"},
		FilterableFields: []string{"type", "status", "account_uuid", "category_uuid", "currency", "date_from", "date_to"},
		Columns: []Column{
			{Key: "transaction_date", LabelKey: "finance.transactions.date", Type: ColumnTypeString, Sortable: true, DefaultVisible: true},
			{Key: "type", LabelKey: "finance.transactions.type", Type: ColumnTypeEnum, Filterable: true, FilterVariant: FilterVariantFaceted, DefaultVisible: true},
			{Key: "amount", LabelKey: "finance.transactions.amount", Type: ColumnTypeString, Sortable: true, DefaultVisible: true},
			{Key: "currency", LabelKey: "finance.transactions.currency", Type: ColumnTypeString, Filterable: true, DefaultVisible: true},
			{Key: "account_name", LabelKey: "finance.transactions.account", Type: ColumnTypeString, DefaultVisible: true},
			{Key: "category_name", LabelKey: "finance.transactions.category", Type: ColumnTypeString, DefaultVisible: true},
			{Key: "status", LabelKey: "finance.transactions.status", Type: ColumnTypeEnum, Filterable: true, FilterVariant: FilterVariantFaceted, DefaultVisible: true},
			{Key: "description", LabelKey: "finance.transactions.description", Type: ColumnTypeString, DefaultVisible: true},
		},
		Filters: []Filter{
			{Key: "type", LabelKey: "finance.transactions.type", Variant: FilterVariantFaceted},
			{Key: "status", LabelKey: "finance.transactions.status", Variant: FilterVariantFaceted},
			{Key: "date_from", LabelKey: "finance.transactions.date_from", Variant: FilterVariantText},
			{Key: "date_to", LabelKey: "finance.transactions.date_to", Variant: FilterVariantText},
		},
	}
}

// TenantCatalogProducts returns meta for GET /v1/tenant/catalog/products.
func TenantCatalogProducts() ResourceMeta {
	return ResourceMeta{
		Resource:      "tenant.catalog.products",
		DefaultSort:   "name",
		DefaultFields: []string{"uuid", "name", "category_name", "unit", "sale_price", "cost_price", "stock_quantity", "stock_status", "is_active"},
		Capabilities: Capabilities{
			Create: true, Read: true, Update: true, Delete: true, Search: true, Filter: true, Sort: true,
			Export: true, Import: true, Bulk: true,
		},
		SearchableFields: []string{"name", "sku", "barcode"},
		SortableFields:   []string{"name", "sku", "stock_quantity", "sale_price", "cost_price", "created_at"},
		FilterableFields: []string{"category_uuid", "stock_status", "is_active", "track_stock"},
		Columns: []Column{
			{Key: "name", LabelKey: "catalog.products.name", Type: ColumnTypeString, Sortable: true, DefaultVisible: true},
			{Key: "category_name", LabelKey: "catalog.products.category", Type: ColumnTypeString, DefaultVisible: true},
			{Key: "sku", LabelKey: "catalog.products.sku", Type: ColumnTypeString, Sortable: true, DefaultVisible: false},
			{Key: "barcode", LabelKey: "catalog.products.barcode", Type: ColumnTypeString, DefaultVisible: false},
			{Key: "unit", LabelKey: "catalog.products.unit", Type: ColumnTypeString, DefaultVisible: true},
			{Key: "sale_price", LabelKey: "catalog.products.sale_price", Type: ColumnTypeString, Sortable: true, DefaultVisible: true},
			{Key: "cost_price", LabelKey: "catalog.products.cost_price", Type: ColumnTypeString, Sortable: true, DefaultVisible: false},
			{Key: "vat_rate", LabelKey: "catalog.products.vat_rate", Type: ColumnTypeString, DefaultVisible: false},
			{Key: "stock_quantity", LabelKey: "catalog.products.stock_quantity", Type: ColumnTypeString, Sortable: true, DefaultVisible: true},
			{Key: "stock_status", LabelKey: "catalog.products.stock_status", Type: ColumnTypeEnum, Filterable: true, FilterVariant: FilterVariantFaceted, DefaultVisible: true},
			{Key: "is_active", LabelKey: "common.status", Type: ColumnTypeBoolean, Filterable: true, FilterVariant: FilterVariantFaceted, DefaultVisible: true},
		},
		Filters: []Filter{
			{Key: "category_uuid", LabelKey: "catalog.products.category", Variant: FilterVariantFaceted},
			{Key: "stock_status", LabelKey: "catalog.products.stock_status", Variant: FilterVariantFaceted},
			{Key: "is_active", LabelKey: "common.status", Variant: FilterVariantFaceted},
		},
		BulkActions: adapters.NewCatalogProducts(nil).BulkActions(),
	}
}

// TenantCatalogServices returns meta for GET /v1/tenant/catalog/services.
func TenantCatalogServices() ResourceMeta {
	return ResourceMeta{
		Resource:      "tenant.catalog.services",
		DefaultSort:   "name",
		DefaultFields: []string{"uuid", "name", "category_name", "code", "duration_minutes", "price", "vat_rate", "is_active"},
		Capabilities: Capabilities{
			Create: true, Read: true, Update: true, Delete: true, Search: true, Filter: true, Sort: true,
			Export: true, Import: true, Bulk: true,
		},
		SearchableFields: []string{"name", "code"},
		SortableFields:   []string{"name", "code", "price", "duration_minutes", "created_at"},
		FilterableFields: []string{"category_uuid", "is_active"},
		Columns: []Column{
			{Key: "name", LabelKey: "catalog.services.name", Type: ColumnTypeString, Sortable: true, DefaultVisible: true},
			{Key: "category_name", LabelKey: "catalog.services.category", Type: ColumnTypeString, DefaultVisible: true},
			{Key: "code", LabelKey: "catalog.services.code", Type: ColumnTypeString, Sortable: true, DefaultVisible: false},
			{Key: "duration_minutes", LabelKey: "catalog.services.duration", Type: ColumnTypeString, Sortable: true, DefaultVisible: true},
			{Key: "price", LabelKey: "catalog.services.price", Type: ColumnTypeString, Sortable: true, DefaultVisible: true},
			{Key: "vat_rate", LabelKey: "catalog.services.vat_rate", Type: ColumnTypeString, DefaultVisible: true},
			{Key: "is_active", LabelKey: "common.status", Type: ColumnTypeBoolean, Filterable: true, FilterVariant: FilterVariantFaceted, DefaultVisible: true},
		},
		Filters: []Filter{
			{Key: "category_uuid", LabelKey: "catalog.services.category", Variant: FilterVariantFaceted},
			{Key: "is_active", LabelKey: "common.status", Variant: FilterVariantFaceted},
		},
		BulkActions: adapters.NewCatalogServices(nil).BulkActions(),
	}
}

// TenantCatalogCategories returns meta for GET /v1/tenant/catalog/categories.
func TenantCatalogCategories() ResourceMeta {
	return ResourceMeta{
		Resource:      "tenant.catalog.categories",
		DefaultSort:   "sort_order",
		DefaultFields: []string{"uuid", "name", "kind", "sort_order", "is_active"},
		Capabilities: Capabilities{
			Create: true, Read: true, Update: true, Delete: true, Search: true, Filter: true, Sort: true,
			Export: true, Import: true,
		},
		SearchableFields: []string{"name"},
		SortableFields:   []string{"name", "sort_order", "created_at"},
		FilterableFields: []string{"kind", "is_active"},
		Columns: []Column{
			{Key: "name", LabelKey: "catalog.categories.name", Type: ColumnTypeString, Sortable: true, DefaultVisible: true},
			{Key: "kind", LabelKey: "catalog.categories.kind", Type: ColumnTypeEnum, Filterable: true, FilterVariant: FilterVariantFaceted, DefaultVisible: true},
			{Key: "parent_name", LabelKey: "catalog.categories.parent", Type: ColumnTypeString, DefaultVisible: true},
			{Key: "sort_order", LabelKey: "catalog.categories.sort_order", Type: ColumnTypeString, Sortable: true, DefaultVisible: true},
			{Key: "is_active", LabelKey: "common.status", Type: ColumnTypeBoolean, Filterable: true, FilterVariant: FilterVariantFaceted, DefaultVisible: true},
		},
		Filters: []Filter{
			{Key: "kind", LabelKey: "catalog.categories.kind", Variant: FilterVariantFaceted},
			{Key: "is_active", LabelKey: "common.status", Variant: FilterVariantFaceted},
		},
	}
}

// PlatformVehicleBrands returns meta for GET /v1/platform/vehicle-brands.
func PlatformVehicleBrands() ResourceMeta {
	return ResourceMeta{
		Resource:      "platform.vehicle_brands",
		DefaultSort:   "name",
		DefaultFields: []string{"uuid", "name", "model_count", "is_active"},
		Capabilities: Capabilities{
			Create: true, Read: true, Update: true, Delete: true,
			Search: true, Filter: true, Sort: true,
		},
		SearchableFields: []string{"name"},
		SortableFields:   []string{"name", "created_at"},
		FilterableFields: []string{"is_active"},
		Columns: []Column{
			{Key: "name", LabelKey: "vehicle_brands.name", Type: ColumnTypeString, Sortable: true, DefaultVisible: true},
			{Key: "model_count", LabelKey: "vehicle_brands.model_count", Type: ColumnTypeString, DefaultVisible: true},
			{Key: "is_active", LabelKey: "common.status", Type: ColumnTypeBoolean, Filterable: true, FilterVariant: FilterVariantFaceted, DefaultVisible: true},
			{Key: "created_at", LabelKey: "vehicle_brands.created_at", Type: ColumnTypeDatetime, Sortable: true, DefaultVisible: false},
		},
		Filters: []Filter{
			{Key: "is_active", LabelKey: "common.status", Variant: FilterVariantFaceted},
		},
	}
}

// TenantCustomers returns meta for GET /v1/tenant/customers.
func TenantCustomers() ResourceMeta {
	return ResourceMeta{
		Resource:      "tenant.customers",
		DefaultSort:   "name",
		DefaultFields: []string{"uuid", "name", "phone", "kind", "vehicle_count", "is_active"},
		Capabilities: Capabilities{
			Create: true, Read: true, Update: true, Delete: true,
			Search: true, Filter: true, Sort: true,
		},
		SearchableFields: []string{"name", "phone", "email"},
		SortableFields:   []string{"name", "created_at"},
		FilterableFields: []string{"kind", "is_active"},
		Columns: []Column{
			{Key: "name", LabelKey: "customers.name", Type: ColumnTypeString, Sortable: true, DefaultVisible: true},
			{Key: "phone", LabelKey: "customers.phone", Type: ColumnTypeString, DefaultVisible: true},
			{Key: "kind", LabelKey: "customers.kind", Type: ColumnTypeEnum, Filterable: true, FilterVariant: FilterVariantFaceted, DefaultVisible: true},
			{Key: "vehicle_count", LabelKey: "customers.vehicle_count", Type: ColumnTypeString, DefaultVisible: true},
			{Key: "is_active", LabelKey: "common.status", Type: ColumnTypeBoolean, Filterable: true, FilterVariant: FilterVariantFaceted, DefaultVisible: true},
			{Key: "created_at", LabelKey: "customers.created_at", Type: ColumnTypeDatetime, Sortable: true, DefaultVisible: false},
		},
		Filters: []Filter{
			{Key: "kind", LabelKey: "customers.kind", Variant: FilterVariantFaceted},
			{Key: "is_active", LabelKey: "common.status", Variant: FilterVariantFaceted},
		},
	}
}

// TenantCari returns meta for GET /v1/tenant/cari.
func TenantCari() ResourceMeta {
	return ResourceMeta{
		Resource:      "tenant.cari",
		DefaultSort:   "customer_name",
		DefaultFields: []string{"uuid", "customer_name", "customer_phone", "balance", "currency", "is_active"},
		Capabilities: Capabilities{
			Create: false, Read: true, Update: false, Delete: false,
			Search: true, Filter: true, Sort: true, Export: true,
		},
		SearchableFields: []string{"customer_name", "customer_phone"},
		SortableFields:   []string{"customer_name", "balance", "created_at"},
		FilterableFields: []string{"is_active", "has_balance"},
		Columns: []Column{
			{Key: "customer_name", LabelKey: "cari.customer_name", Type: ColumnTypeString, Sortable: true, DefaultVisible: true},
			{Key: "customer_phone", LabelKey: "cari.customer_phone", Type: ColumnTypeString, DefaultVisible: true},
			{Key: "balance", LabelKey: "cari.balance", Type: ColumnTypeString, Sortable: true, DefaultVisible: true},
			{Key: "currency", LabelKey: "cari.currency", Type: ColumnTypeString, DefaultVisible: true},
			{Key: "is_active", LabelKey: "common.status", Type: ColumnTypeBoolean, Filterable: true, FilterVariant: FilterVariantFaceted, DefaultVisible: true},
			{Key: "created_at", LabelKey: "cari.created_at", Type: ColumnTypeDatetime, Sortable: true, DefaultVisible: false},
		},
		Filters: []Filter{
			{Key: "is_active", LabelKey: "common.status", Variant: FilterVariantFaceted},
			{Key: "has_balance", LabelKey: "cari.has_balance", Variant: FilterVariantFaceted},
		},
	}
}

// TenantJobs returns meta for GET /v1/tenant/jobs.
func TenantJobs() ResourceMeta {
	return ResourceMeta{
		Resource:      "tenant.jobs",
		DefaultSort:   "-started_at",
		DefaultFields: []string{"uuid", "plate", "customer_name", "vehicle_label", "status", "total_amount", "started_at"},
		Capabilities: Capabilities{
			Create: true, Read: true, Update: true, Delete: false,
			Search: true, Filter: true, Sort: true, Export: true,
		},
		SearchableFields: []string{"plate", "customer_name", "vehicle_label"},
		SortableFields:   []string{"started_at", "total_amount", "plate"},
		FilterableFields: []string{"status"},
		Columns: []Column{
			{Key: "plate", LabelKey: "jobs.plate", Type: ColumnTypeString, Sortable: true, DefaultVisible: true},
			{Key: "customer_name", LabelKey: "jobs.customer_name", Type: ColumnTypeString, DefaultVisible: true},
			{Key: "vehicle_label", LabelKey: "jobs.vehicle_label", Type: ColumnTypeString, DefaultVisible: true},
			{Key: "status", LabelKey: "jobs.status", Type: ColumnTypeString, Filterable: true, FilterVariant: FilterVariantFaceted, DefaultVisible: true},
			{Key: "total_amount", LabelKey: "jobs.total_amount", Type: ColumnTypeString, Sortable: true, DefaultVisible: true},
			{Key: "started_at", LabelKey: "jobs.started_at", Type: ColumnTypeDatetime, Sortable: true, DefaultVisible: true},
		},
		Filters: []Filter{
			{Key: "status", LabelKey: "jobs.status", Variant: FilterVariantFaceted},
		},
	}
}

// TenantSales returns meta for GET /v1/tenant/sales.
func TenantSales() ResourceMeta {
	return ResourceMeta{
		Resource:      "tenant.sales",
		DefaultSort:   "-sold_at",
		DefaultFields: []string{"uuid", "customer_name", "method", "status", "total_amount", "sold_at"},
		Capabilities: Capabilities{
			Create: true, Read: true, Update: false, Delete: false,
			Search: true, Filter: true, Sort: true, Export: true,
		},
		SearchableFields: []string{"customer_name", "customer_phone", "notes"},
		SortableFields:   []string{"sold_at", "total_amount"},
		FilterableFields: []string{"status"},
		Columns: []Column{
			{Key: "customer_name", LabelKey: "sales.customer_name", Type: ColumnTypeString, DefaultVisible: true},
			{Key: "method", LabelKey: "sales.method", Type: ColumnTypeString, DefaultVisible: true},
			{Key: "status", LabelKey: "sales.status", Type: ColumnTypeString, Filterable: true, FilterVariant: FilterVariantFaceted, DefaultVisible: true},
			{Key: "total_amount", LabelKey: "sales.total_amount", Type: ColumnTypeString, Sortable: true, DefaultVisible: true},
			{Key: "sold_at", LabelKey: "sales.sold_at", Type: ColumnTypeDatetime, Sortable: true, DefaultVisible: true},
		},
		Filters: []Filter{
			{Key: "status", LabelKey: "sales.status", Variant: FilterVariantFaceted},
		},
	}
}

// TenantSuppliers returns meta for GET /v1/tenant/suppliers.
func TenantSuppliers() ResourceMeta {
	return ResourceMeta{
		Resource:      "tenant.suppliers",
		DefaultSort:   "name",
		DefaultFields: []string{"uuid", "name", "phone", "email", "is_active"},
		Capabilities: Capabilities{
			Create: true, Read: true, Update: true, Delete: true,
			Search: true, Filter: true, Sort: true, Export: true,
		},
		SearchableFields: []string{"name", "phone", "email", "tax_id"},
		SortableFields:   []string{"name", "created_at"},
		FilterableFields: []string{"is_active"},
		Columns: []Column{
			{Key: "name", LabelKey: "suppliers.name", Type: ColumnTypeString, Sortable: true, DefaultVisible: true},
			{Key: "phone", LabelKey: "suppliers.phone", Type: ColumnTypeString, DefaultVisible: true},
			{Key: "email", LabelKey: "suppliers.email", Type: ColumnTypeString, DefaultVisible: true},
			{Key: "is_active", LabelKey: "suppliers.is_active", Type: ColumnTypeBoolean, Filterable: true, FilterVariant: FilterVariantFaceted, DefaultVisible: true},
		},
		Filters: []Filter{
			{Key: "is_active", LabelKey: "suppliers.is_active", Variant: FilterVariantFaceted},
		},
	}
}

// TenantPurchases returns meta for GET /v1/tenant/purchases.
func TenantPurchases() ResourceMeta {
	return ResourceMeta{
		Resource:      "tenant.purchases",
		DefaultSort:   "-purchased_at",
		DefaultFields: []string{"uuid", "supplier_name", "method", "status", "total_amount", "purchased_at"},
		Capabilities: Capabilities{
			Create: true, Read: true, Update: false, Delete: false,
			Search: true, Filter: true, Sort: true, Export: true,
		},
		SearchableFields: []string{"supplier_name", "notes"},
		SortableFields:   []string{"purchased_at", "total_amount"},
		FilterableFields: []string{"status"},
		Columns: []Column{
			{Key: "supplier_name", LabelKey: "purchases.supplier_name", Type: ColumnTypeString, DefaultVisible: true},
			{Key: "method", LabelKey: "purchases.method", Type: ColumnTypeString, DefaultVisible: true},
			{Key: "status", LabelKey: "purchases.status", Type: ColumnTypeString, Filterable: true, FilterVariant: FilterVariantFaceted, DefaultVisible: true},
			{Key: "total_amount", LabelKey: "purchases.total_amount", Type: ColumnTypeString, Sortable: true, DefaultVisible: true},
			{Key: "purchased_at", LabelKey: "purchases.purchased_at", Type: ColumnTypeDatetime, Sortable: true, DefaultVisible: true},
		},
		Filters: []Filter{
			{Key: "status", LabelKey: "purchases.status", Variant: FilterVariantFaceted},
		},
	}
}

// PlatformContractPresets returns meta for GET /v1/platform/contract-presets.
func PlatformContractPresets() ResourceMeta {
	return ResourceMeta{
		Resource:      "platform.contract_presets",
		DefaultSort:   "-created_at",
		DefaultFields: []string{"uuid", "title", "category", "signature_required", "is_active"},
		Capabilities: Capabilities{
			Create: true, Read: true, Update: true, Delete: true,
			Search: true, Filter: true, Sort: true,
		},
		SearchableFields: []string{"title", "description"},
		SortableFields:   []string{"title", "created_at"},
		FilterableFields: []string{"is_active", "category"},
		Columns: []Column{
			{Key: "title", LabelKey: "contracts.title", Type: ColumnTypeString, Sortable: true, DefaultVisible: true},
			{Key: "category", LabelKey: "contracts.category", Type: ColumnTypeString, Filterable: true, FilterVariant: FilterVariantFaceted, DefaultVisible: true},
			{Key: "signature_required", LabelKey: "contracts.signature_required", Type: ColumnTypeBoolean, DefaultVisible: true},
			{Key: "is_active", LabelKey: "common.status", Type: ColumnTypeBoolean, Filterable: true, FilterVariant: FilterVariantFaceted, DefaultVisible: true},
			{Key: "created_at", LabelKey: "contracts.created_at", Type: ColumnTypeDatetime, Sortable: true, DefaultVisible: false},
		},
		Filters: []Filter{
			{Key: "is_active", LabelKey: "common.status", Variant: FilterVariantFaceted},
			{Key: "category", LabelKey: "contracts.category", Variant: FilterVariantFaceted},
		},
	}
}

// TenantContracts returns meta for GET /v1/tenant/contracts/templates.
func TenantContracts() ResourceMeta {
	return ResourceMeta{
		Resource:      "tenant.contracts",
		DefaultSort:   "-created_at",
		DefaultFields: []string{"uuid", "title", "category", "signature_required", "is_active"},
		Capabilities: Capabilities{
			Create: true, Read: true, Update: true, Delete: true,
			Search: true, Filter: true, Sort: true,
		},
		SearchableFields: []string{"title"},
		SortableFields:   []string{"title", "created_at"},
		FilterableFields: []string{"is_active", "category", "status", "subject_type"},
		Columns: []Column{
			{Key: "title", LabelKey: "contracts.title", Type: ColumnTypeString, Sortable: true, DefaultVisible: true},
			{Key: "category", LabelKey: "contracts.category", Type: ColumnTypeString, Filterable: true, FilterVariant: FilterVariantFaceted, DefaultVisible: true},
			{Key: "signature_required", LabelKey: "contracts.signature_required", Type: ColumnTypeBoolean, DefaultVisible: true},
			{Key: "is_active", LabelKey: "common.status", Type: ColumnTypeBoolean, Filterable: true, FilterVariant: FilterVariantFaceted, DefaultVisible: true},
			{Key: "created_at", LabelKey: "contracts.created_at", Type: ColumnTypeDatetime, Sortable: true, DefaultVisible: false},
		},
		Filters: []Filter{
			{Key: "is_active", LabelKey: "common.status", Variant: FilterVariantFaceted},
			{Key: "category", LabelKey: "contracts.category", Variant: FilterVariantFaceted},
		},
	}
}

// TenantReports returns meta for GET /v1/tenant/reports.
func TenantReports() ResourceMeta {
	return ResourceMeta{
		Resource:      "tenant.reports",
		DefaultSort:   "-date_to",
		DefaultFields: []string{"date_from", "date_to", "total_income", "total_expense", "net_profit"},
		Capabilities: Capabilities{
			Create: false, Read: true, Update: false, Delete: false,
			Search: false, Filter: true, Sort: false, Export: true,
		},
		FilterableFields: []string{
			"date_from", "date_to", "currency", "payment_method", "account_uuid", "source_type", "granularity", "section",
		},
		Columns: []Column{
			{Key: "section", LabelKey: "reports.section", Type: ColumnTypeString, DefaultVisible: true},
			{Key: "label", LabelKey: "reports.label", Type: ColumnTypeString, DefaultVisible: true},
			{Key: "metric", LabelKey: "reports.metric", Type: ColumnTypeString, DefaultVisible: true},
			{Key: "count", LabelKey: "reports.count", Type: ColumnTypeString, DefaultVisible: true},
			{Key: "amount", LabelKey: "reports.amount", Type: ColumnTypeString, DefaultVisible: true},
			{Key: "date", LabelKey: "reports.date", Type: ColumnTypeString, DefaultVisible: true},
		},
		Filters: []Filter{
			{Key: "date_from", LabelKey: "reports.date_from", Variant: FilterVariantText},
			{Key: "date_to", LabelKey: "reports.date_to", Variant: FilterVariantText},
			{Key: "currency", LabelKey: "reports.currency", Variant: FilterVariantText},
			{Key: "payment_method", LabelKey: "reports.payment_method", Variant: FilterVariantFaceted},
			{Key: "source_type", LabelKey: "reports.source_type", Variant: FilterVariantFaceted},
			{Key: "granularity", LabelKey: "reports.granularity", Variant: FilterVariantFaceted},
			{Key: "section", LabelKey: "reports.section", Variant: FilterVariantFaceted},
		},
	}
}
