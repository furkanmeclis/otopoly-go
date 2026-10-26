// Package stockreorder wires stock reorder suggestions (/v1/tenant/stock-reorder).
package stockreorder

import (
	"context"
	"net/http"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database/db"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/middleware"
	notifmodel "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/notifications/model"
	srhandler "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/stockreorder/handler"
	srusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/stockreorder/usecase"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/jwt"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/rbac"
	"strconv"
)

// RegisterRoutes mounts /v1/tenant/stock-reorder/*. Reading needs purchases
// and catalog read; settings, overrides and drafts need purchases write and
// the owner role (like purchases). The plan toggle stock_reorder.enabled is
// checked by the use case (403 FEATURE_DISABLED).
func RegisterRoutes(
	mux *http.ServeMux,
	svc *srusecase.Service,
	tokens *jwt.Manager,
	loader middleware.IdentityLoader,
	q *db.Queries,
) {
	h := srhandler.New(svc)
	authn := middleware.Authenticate(tokens, loader)
	requireOrg := middleware.RequireOrganization(tokens, q)
	read := func(fn http.HandlerFunc) http.Handler {
		return middleware.Chain(fn, authn, requireOrg,
			middleware.RequirePermission(rbac.PermTenantPurchasesRead),
			middleware.RequirePermission(rbac.PermTenantCatalogRead))
	}
	write := func(fn http.HandlerFunc) http.Handler {
		return middleware.Chain(fn, authn, requireOrg,
			middleware.RequirePermission(rbac.PermTenantPurchasesRead),
			middleware.RequirePermission(rbac.PermTenantCatalogRead),
			middleware.RequirePermission(rbac.PermTenantPurchasesWrite),
			middleware.RequireOrgRole("owner"))
	}

	mux.Handle("GET /v1/tenant/stock-reorder/suggestions", read(h.List))
	mux.Handle("GET /v1/tenant/stock-reorder/summary", read(h.Summary))
	mux.Handle("GET /v1/tenant/stock-reorder/settings", read(h.GetSettings))
	mux.Handle("PUT /v1/tenant/stock-reorder/settings", write(h.UpdateSettings))
	mux.Handle("GET /v1/tenant/stock-reorder/products/{uuid}", read(h.GetProduct))
	mux.Handle("PUT /v1/tenant/stock-reorder/products/{uuid}", write(h.PutProduct))
	mux.Handle("DELETE /v1/tenant/stock-reorder/products/{uuid}", write(h.DeleteProduct))
	mux.Handle("POST /v1/tenant/stock-reorder/drafts", write(h.CreateDrafts))
}

// Enqueuer is the notifications service subset used for the daily alert.
type Enqueuer interface {
	Enqueue(ctx context.Context, in notifmodel.EnqueueInput) ([]notifmodel.Notification, error)
}

// InAppNotifier creates the daily reorder notification (in-app; web and
// mobile push follow from the notifications module).
type InAppNotifier struct {
	notif Enqueuer
}

func NewInAppNotifier(n Enqueuer) *InAppNotifier { return &InAppNotifier{notif: n} }

// NotifyReorder implements usecase.Notifier.
func (n *InAppNotifier) NotifyReorder(ctx context.Context, orgID, userID int64, title, body, actionURL string, itemCount int) error {
	if n == nil || n.notif == nil {
		return nil
	}
	in := notifmodel.EnqueueInput{
		TenantID:    &orgID,
		UserID:      &userID,
		Channels:    []string{notifmodel.ChannelInapp},
		Priority:    notifmodel.PriorityNormal,
		Title:       title,
		Body:        body,
		SourceEvent: srusecase.NotificationKind,
		Payload: map[string]any{
			"kind":      srusecase.NotificationKind,
			"push_vars": map[string]any{"item_count": strconv.Itoa(itemCount)},
		},
	}
	if actionURL != "" {
		in.ActionURL = &actionURL
	}
	_, err := n.notif.Enqueue(ctx, in)
	return err
}
