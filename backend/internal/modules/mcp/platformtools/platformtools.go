// Package platformtools holds the read tools of the platform admin MCP
// endpoint (/mcp/platform, docs/MCP.md). They implement the AI assistant's
// tools.Tool interface, so the same registry, permission check (every
// tool needs its platform.*.read permission) and schema validation apply.
// They read through the platform use cases, never SQL.
package platformtools

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"time"

	activityusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/activity/usecase"
	aitools "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/ai/tools"
	aiusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/ai/usecase"
	authmodel "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/auth/model"
	billingusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/billing/usecase"
	logsmodel "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/logs/model"
	orgusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/organizations/usecase"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/rbac"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/pkg/apiquery"
	"github.com/google/uuid"
)

// Page size limits of the list tools.
const (
	defaultLimit = 20
	maxLimit     = 50
)

// Organizations is the platform organization use case.
type Organizations interface {
	List(ctx context.Context, limit, offset int32, q, status string) ([]orgusecase.Organization, int64, error)
	Overview(ctx context.Context, id uuid.UUID) (orgusecase.Overview, error)
}

// Users is the platform user use case (*authusecase.AuthUseCase).
type Users interface {
	ListPlatformUsers(ctx context.Context, limit, offset int32, q, status, roleSlug string) ([]authmodel.PlatformUserDetail, int64, error)
	GetPlatformUser(ctx context.Context, userUUID uuid.UUID) (authmodel.PlatformUserDetail, error)
}

// Billing is the platform billing use case.
type Billing interface {
	Dashboard(ctx context.Context) (billingusecase.BillingDashboard, error)
	ListSubscriptionsAdmin(ctx context.Context, filters billingusecase.AdminSubscriptionFilters, limit, offset int32) ([]billingusecase.AdminSubscription, int64, error)
	ListOrdersAdmin(ctx context.Context, status, q string, limit, offset int32) ([]billingusecase.Order, int64, error)
}

// AIUsage is the AI assistant usage report.
type AIUsage interface {
	Usage(ctx context.Context, month string) (aiusecase.UsageSummary, error)
}

// Logs is the application log use case.
type Logs interface {
	List(ctx context.Context, q apiquery.Query, filter logsmodel.ListFilter) ([]logsmodel.Log, int64, error)
	Stats(ctx context.Context) (logsmodel.Stats, error)
}

// Activity is the audit log use case.
type Activity interface {
	List(ctx context.Context, q apiquery.Query, actorID *int64, resource, action, search string) ([]activityusecase.Event, int64, error)
}

// Deps are the use cases behind the tools; a nil dependency leaves its tools
// out.
type Deps struct {
	Organizations Organizations
	Users         Users
	Billing       Billing
	AIUsage       AIUsage
	Logs          Logs
	Activity      Activity
	// Health pings the infrastructure (postgres, redis, search, storage).
	Health func(ctx context.Context) map[string]string
}

// Registry builds the platform tool registry.
func Registry(d Deps) *aitools.Registry {
	r := aitools.NewRegistry()
	if d.Organizations != nil {
		r.Register(listOrganizations(d.Organizations))
		r.Register(getOrganization(d.Organizations))
	}
	if d.Users != nil {
		r.Register(listUsers(d.Users))
		r.Register(getUser(d.Users))
	}
	if d.Billing != nil {
		r.Register(billingDashboard(d.Billing))
		r.Register(listSubscriptions(d.Billing))
		r.Register(listBillingOrders(d.Billing))
	}
	if d.AIUsage != nil {
		r.Register(aiUsage(d.AIUsage))
	}
	if d.Logs != nil {
		r.Register(listLogs(d.Logs))
		r.Register(logStats(d.Logs))
	}
	if d.Activity != nil {
		r.Register(listActivity(d.Activity))
	}
	if d.Health != nil {
		r.Register(systemHealth(d.Health))
	}
	return r
}

// tool is a read tool built from a spec and a function.
type tool struct {
	spec aitools.Spec
	run  func(ctx context.Context, env aitools.Env, raw json.RawMessage) (aitools.Result, error)
}

func (t tool) Spec() aitools.Spec { return t.spec }

func (t tool) Run(ctx context.Context, env aitools.Env, raw json.RawMessage) (aitools.Result, error) {
	return t.run(ctx, env, raw)
}

func readSpec(name, desc string, schema map[string]any, perms ...string) aitools.Spec {
	return aitools.Spec{
		Name: name, Description: desc, InputSchema: schema, Permissions: perms,
		Feature: aitools.FeatureChat, Kind: aitools.KindRead,
	}
}

func object(props map[string]any, required ...string) map[string]any {
	s := map[string]any{"type": "object", "properties": props, "additionalProperties": false}
	if len(required) > 0 {
		s["required"] = required
	}
	return s
}

func str(desc string, maxLen int) map[string]any {
	return map[string]any{"type": "string", "description": desc, "maxLength": maxLen}
}

func enum(desc string, values ...string) map[string]any {
	return map[string]any{"type": "string", "description": desc, "enum": values}
}

func uuidProp(desc string) map[string]any {
	return map[string]any{"type": "string", "description": desc, "format": "uuid"}
}

func paging(props map[string]any) map[string]any {
	props["limit"] = map[string]any{"type": "integer", "minimum": 1, "maximum": maxLimit, "description": "Page size (default 20)."}
	props["offset"] = map[string]any{"type": "integer", "minimum": 0, "maximum": 100000, "description": "Rows to skip."}
	return props
}

type page struct {
	Limit  int32 `json:"limit"`
	Offset int32 `json:"offset"`
}

func (p page) clamp() (int32, int32) {
	l := p.Limit
	if l <= 0 {
		l = defaultLimit
	}
	if l > maxLimit {
		l = maxLimit
	}
	o := max(p.Offset, 0)
	return l, o
}

// list wraps a page of items as {items, total, limit, offset}.
func list[T any](items []T, total int64, limit, offset int32) map[string]any {
	if items == nil {
		items = []T{}
	}
	return map[string]any{"items": items, "total": total, "limit": limit, "offset": offset}
}

func result(v any) (aitools.Result, error) {
	return aitools.JSONResult(v, "", nil), nil
}

func invalid(err error) (aitools.Result, error) {
	return aitools.ErrorResult("Invalid input: " + err.Error()), nil
}

// notFound maps domain not-found errors to a tool error the model can act on.
func notFound(err error, what string) (aitools.Result, error) {
	if err != nil && strings.Contains(strings.ToLower(err.Error()), "not found") {
		return aitools.ErrorResult(what + " not found."), nil
	}
	return aitools.Result{}, err
}

// --- organizations --------------------------------------------------------------

func listOrganizations(svc Organizations) aitools.Tool {
	schema := object(paging(map[string]any{
		"q":      str("Search in name, slug, city or phone.", 120),
		"status": enum("Organization status filter.", "pending", "active", "suspended", "expired"),
	}))
	return tool{
		spec: readSpec("list_organizations", "List the businesses (organizations) on the platform with status, plan and access window. Use to find an organization before get_organization.",
			schema, rbac.PermPlatformOrganizationsRead),
		run: func(ctx context.Context, _ aitools.Env, raw json.RawMessage) (aitools.Result, error) {
			var in struct {
				page
				Q      string `json:"q"`
				Status string `json:"status"`
			}
			if err := aitools.Decode(schema, raw, &in); err != nil {
				return invalid(err)
			}
			l, o := in.clamp()
			items, total, err := svc.List(ctx, l, o, strings.TrimSpace(in.Q), in.Status)
			if err != nil {
				return aitools.Result{}, err
			}
			return result(list(items, total, l, o))
		},
	}
}

func getOrganization(svc Organizations) aitools.Tool {
	schema := object(map[string]any{"organization_uuid": uuidProp("Organization uuid from list_organizations.")}, "organization_uuid")
	return tool{
		spec: readSpec("get_organization", "Overview of one organization: profile, record counts (customers, jobs, quotes, members), subscription and WhatsApp status.",
			schema, rbac.PermPlatformOrganizationsRead),
		run: func(ctx context.Context, _ aitools.Env, raw json.RawMessage) (aitools.Result, error) {
			var in struct {
				OrganizationUUID uuid.UUID `json:"organization_uuid"`
			}
			if err := aitools.Decode(schema, raw, &in); err != nil {
				return invalid(err)
			}
			out, err := svc.Overview(ctx, in.OrganizationUUID)
			if errors.Is(err, orgusecase.ErrNotFound) {
				return aitools.ErrorResult("Organization not found."), nil
			}
			if err != nil {
				return aitools.Result{}, err
			}
			return result(out)
		},
	}
}

// --- users ----------------------------------------------------------------------

func listUsers(svc Users) aitools.Tool {
	schema := object(paging(map[string]any{
		"q":      str("Search in e-mail or name.", 120),
		"status": enum("User status filter (deleted lists soft-deleted accounts).", "active", "disabled", "pending", "deleted"),
		"role":   str("Role slug filter, e.g. super_admin or organization_owner.", 64),
	}))
	return tool{
		spec: readSpec("list_users", "List platform user accounts with roles and sign-in methods.",
			schema, rbac.PermPlatformUsersRead),
		run: func(ctx context.Context, _ aitools.Env, raw json.RawMessage) (aitools.Result, error) {
			var in struct {
				page
				Q      string `json:"q"`
				Status string `json:"status"`
				Role   string `json:"role"`
			}
			if err := aitools.Decode(schema, raw, &in); err != nil {
				return invalid(err)
			}
			l, o := in.clamp()
			items, total, err := svc.ListPlatformUsers(ctx, l, o, strings.TrimSpace(in.Q), in.Status, strings.TrimSpace(in.Role))
			if err != nil {
				return aitools.Result{}, err
			}
			return result(list(items, total, l, o))
		},
	}
}

func getUser(svc Users) aitools.Tool {
	schema := object(map[string]any{"user_uuid": uuidProp("User uuid from list_users.")}, "user_uuid")
	return tool{
		spec: readSpec("get_user", "Details of one user account: status, roles and sign-in methods.",
			schema, rbac.PermPlatformUsersRead),
		run: func(ctx context.Context, _ aitools.Env, raw json.RawMessage) (aitools.Result, error) {
			var in struct {
				UserUUID uuid.UUID `json:"user_uuid"`
			}
			if err := aitools.Decode(schema, raw, &in); err != nil {
				return invalid(err)
			}
			out, err := svc.GetPlatformUser(ctx, in.UserUUID)
			if err != nil {
				return notFound(err, "User")
			}
			return result(out)
		},
	}
}

// --- billing ----------------------------------------------------------------------

func billingDashboard(svc Billing) aitools.Tool {
	schema := object(map[string]any{})
	return tool{
		spec: readSpec("billing_dashboard", "Platform billing dashboard: subscriptions by status, revenue figures, open orders and subscriptions expiring soon.",
			schema, rbac.PermPlatformBillingRead),
		run: func(ctx context.Context, _ aitools.Env, raw json.RawMessage) (aitools.Result, error) {
			if err := aitools.Validate(schema, raw); err != nil {
				return invalid(err)
			}
			out, err := svc.Dashboard(ctx)
			if err != nil {
				return aitools.Result{}, err
			}
			return result(out)
		},
	}
}

func listSubscriptions(svc Billing) aitools.Tool {
	schema := object(paging(map[string]any{
		"q":                    str("Search in organization name.", 120),
		"status":               enum("Subscription status filter.", "trial", "active", "grace", "read_only", "cancelled"),
		"expiring_within_days": map[string]any{"type": "integer", "minimum": 1, "maximum": 365, "description": "Only subscriptions whose period ends within this many days."},
	}))
	return tool{
		spec: readSpec("list_subscriptions", "List organization subscriptions with plan, status and period end.",
			schema, rbac.PermPlatformBillingRead),
		run: func(ctx context.Context, _ aitools.Env, raw json.RawMessage) (aitools.Result, error) {
			var in struct {
				page
				Q        string `json:"q"`
				Status   string `json:"status"`
				Expiring int32  `json:"expiring_within_days"`
			}
			if err := aitools.Decode(schema, raw, &in); err != nil {
				return invalid(err)
			}
			l, o := in.clamp()
			items, total, err := svc.ListSubscriptionsAdmin(ctx, billingusecase.AdminSubscriptionFilters{
				Status: in.Status, Q: strings.TrimSpace(in.Q), ExpiringWithinDays: in.Expiring,
			}, l, o)
			if err != nil {
				return aitools.Result{}, err
			}
			return result(list(items, total, l, o))
		},
	}
}

func listBillingOrders(svc Billing) aitools.Tool {
	schema := object(paging(map[string]any{
		"q":      str("Search in organization name or order number.", 120),
		"status": enum("Order status filter.", "pending_payment", "payment_reported", "approved", "rejected", "cancelled", "expired"),
	}))
	return tool{
		spec: readSpec("list_billing_orders", "List subscription orders (plan purchases, bank transfers reported and awaiting approval) across organizations.",
			schema, rbac.PermPlatformBillingRead),
		run: func(ctx context.Context, _ aitools.Env, raw json.RawMessage) (aitools.Result, error) {
			var in struct {
				page
				Q      string `json:"q"`
				Status string `json:"status"`
			}
			if err := aitools.Decode(schema, raw, &in); err != nil {
				return invalid(err)
			}
			l, o := in.clamp()
			items, total, err := svc.ListOrdersAdmin(ctx, in.Status, strings.TrimSpace(in.Q), l, o)
			if err != nil {
				return notFound(err, "Orders")
			}
			return result(list(items, total, l, o))
		},
	}
}

// --- AI usage -----------------------------------------------------------------------

func aiUsage(svc AIUsage) aitools.Tool {
	schema := object(map[string]any{
		"month": map[string]any{"type": "string", "description": "Month as YYYY-MM (default: current month).", "maxLength": 7, "minLength": 7},
	})
	return tool{
		spec: readSpec("ai_usage", "AI assistant usage of one month: requests and tokens per organization and model, with cost estimates.",
			schema, rbac.PermPlatformAIRead),
		run: func(ctx context.Context, _ aitools.Env, raw json.RawMessage) (aitools.Result, error) {
			var in struct {
				Month string `json:"month"`
			}
			if err := aitools.Decode(schema, raw, &in); err != nil {
				return invalid(err)
			}
			if in.Month != "" {
				if _, err := time.Parse("2006-01", in.Month); err != nil {
					return aitools.ErrorResult("Invalid input: month must be YYYY-MM."), nil
				}
			}
			out, err := svc.Usage(ctx, in.Month)
			if err != nil {
				return aitools.Result{}, err
			}
			return result(out)
		},
	}
}

// --- logs and audit -------------------------------------------------------------------

func listLogs(svc Logs) aitools.Tool {
	schema := object(paging(map[string]any{
		"levels": map[string]any{
			"type": "array", "maxItems": 3, "description": "Log levels (default all).",
			"items": map[string]any{"type": "string", "enum": logsmodel.PersistLevels},
		},
		"source":     str("Log source, e.g. api, worker or frontend.", 64),
		"q":          str("Search in the message.", 200),
		"since_hour": map[string]any{"type": "integer", "minimum": 1, "maximum": 720, "description": "Only logs of the last N hours."},
	}))
	return tool{
		spec: readSpec("list_logs", "List recent application logs (debug, warn, error), newest first, to investigate incidents.",
			schema, rbac.PermPlatformLogsRead),
		run: func(ctx context.Context, env aitools.Env, raw json.RawMessage) (aitools.Result, error) {
			var in struct {
				page
				Levels    []string `json:"levels"`
				Source    string   `json:"source"`
				Q         string   `json:"q"`
				SinceHour int      `json:"since_hour"`
			}
			if err := aitools.Decode(schema, raw, &in); err != nil {
				return invalid(err)
			}
			l, o := in.clamp()
			f := logsmodel.ListFilter{Levels: in.Levels, Source: strings.TrimSpace(in.Source), Q: strings.TrimSpace(in.Q)}
			if in.SinceHour > 0 {
				from := env.Now.Add(-time.Duration(in.SinceHour) * time.Hour)
				f.CreatedFrom = &from
			}
			items, total, err := svc.List(ctx, apiquery.Query{Limit: l, Offset: o}, f)
			if err != nil {
				return aitools.Result{}, err
			}
			return result(list(items, total, l, o))
		},
	}
}

func logStats(svc Logs) aitools.Tool {
	schema := object(map[string]any{})
	return tool{
		spec: readSpec("log_stats", "Counts of stored application logs per level.",
			schema, rbac.PermPlatformLogsRead),
		run: func(ctx context.Context, _ aitools.Env, raw json.RawMessage) (aitools.Result, error) {
			if err := aitools.Validate(schema, raw); err != nil {
				return invalid(err)
			}
			out, err := svc.Stats(ctx)
			if err != nil {
				return aitools.Result{}, err
			}
			return result(out)
		},
	}
}

func listActivity(svc Activity) aitools.Tool {
	schema := object(paging(map[string]any{
		"action":   str("Action filter, e.g. organization.updated or mcp.tool_called.", 120),
		"resource": str("Resource filter, e.g. organizations or users.", 120),
		"q":        str("Search in action, resource or payload.", 120),
	}))
	return tool{
		spec: readSpec("list_activity", "List the platform audit log (who did what, when), newest first.",
			schema, rbac.PermPlatformActivityRead),
		run: func(ctx context.Context, _ aitools.Env, raw json.RawMessage) (aitools.Result, error) {
			var in struct {
				page
				Action   string `json:"action"`
				Resource string `json:"resource"`
				Q        string `json:"q"`
			}
			if err := aitools.Decode(schema, raw, &in); err != nil {
				return invalid(err)
			}
			l, o := in.clamp()
			items, total, err := svc.List(ctx, apiquery.Query{Limit: l, Offset: o}, nil,
				strings.TrimSpace(in.Resource), strings.TrimSpace(in.Action), strings.TrimSpace(in.Q))
			if err != nil {
				return aitools.Result{}, err
			}
			return result(list(items, total, l, o))
		},
	}
}

func systemHealth(check func(ctx context.Context) map[string]string) aitools.Tool {
	schema := object(map[string]any{})
	return tool{
		spec: readSpec("system_health", "Health of the platform infrastructure: database, cache, search and object storage.",
			schema, rbac.PermPlatformSettingsRead),
		run: func(ctx context.Context, env aitools.Env, raw json.RawMessage) (aitools.Result, error) {
			if err := aitools.Validate(schema, raw); err != nil {
				return invalid(err)
			}
			checks := check(ctx)
			status := "ok"
			for _, v := range checks {
				if v != "ok" && v != "disabled" {
					status = "degraded"
				}
			}
			return result(map[string]any{"status": status, "checks": checks, "checked_at": env.Now.UTC().Format(time.RFC3339)})
		},
	}
}
