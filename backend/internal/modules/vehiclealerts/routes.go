// Package vehiclealerts wires team vehicle alerts (in-app/push + WhatsApp).
package vehiclealerts

import (
	"context"
	"log/slog"
	"net/http"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database/db"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/middleware"
	notifmodel "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/notifications/model"
	vahandler "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/vehiclealerts/handler"
	vausecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/vehiclealerts/usecase"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/events"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/jwt"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/rbac"
	"github.com/google/uuid"
)

// RegisterRoutes mounts /v1/tenant/vehicle-alerts (owner-only settings).
func RegisterRoutes(
	mux *http.ServeMux,
	svc *vausecase.Service,
	tokens *jwt.Manager,
	loader middleware.IdentityLoader,
	q *db.Queries,
) {
	h := vahandler.New(svc)
	authn := middleware.Authenticate(tokens, loader)
	requireOrg := middleware.RequireOrganization(tokens, q)
	requireOwner := middleware.RequireOrgRole("owner")
	read := middleware.RequirePermission(rbac.PermTenantMessagingRead)
	write := middleware.RequirePermission(rbac.PermTenantMessagingWrite)

	mux.Handle("GET /v1/tenant/vehicle-alerts",
		middleware.Chain(http.HandlerFunc(h.GetSettings), authn, requireOrg, read, requireOwner))
	mux.Handle("PUT /v1/tenant/vehicle-alerts",
		middleware.Chain(http.HandlerFunc(h.UpdateSettings), authn, requireOrg, write, requireOwner))
	mux.Handle("POST /v1/tenant/vehicle-alerts/test",
		middleware.Chain(http.HandlerFunc(h.SendTest), authn, requireOrg, write, requireOwner))
}

// RegisterEventHandlers maps job lifecycle events to alert events.
func RegisterEventHandlers(bus events.Bus, svc *vausecase.Service, log *slog.Logger) {
	if bus == nil || svc == nil {
		return
	}
	if log == nil {
		log = slog.Default()
	}
	on := func(name, alertEvent string) {
		bus.Subscribe(name, func(ctx context.Context, event events.Event) error {
			raw, _ := event.Payload["job_uuid"].(string)
			id, err := uuid.Parse(raw)
			if err != nil {
				return nil
			}
			if err := svc.HandleJobEvent(ctx, alertEvent, id); err != nil {
				log.Warn("vehicle_alert_event_failed", "event", name, "job_uuid", raw, "error", err)
			}
			return nil
		})
	}
	on(events.JobsCreated, vausecase.EventCreated)
	on(events.JobsReady, vausecase.EventReady)
	on(events.JobsDelivered, vausecase.EventDelivered)
	on(events.JobsCancelled, vausecase.EventCancelled)
	on(events.JobsVoided, vausecase.EventCancelled)
}

// Enqueuer is the notifications service subset used for in-app alerts.
type Enqueuer interface {
	Enqueue(ctx context.Context, in notifmodel.EnqueueInput) ([]notifmodel.Notification, error)
}

// InAppNotifier creates in-app notifications (web push is sent by the
// notifications module for members who enabled it).
type InAppNotifier struct {
	notif Enqueuer
}

func NewInAppNotifier(n Enqueuer) *InAppNotifier {
	return &InAppNotifier{notif: n}
}

func (n *InAppNotifier) NotifyMember(ctx context.Context, orgID, userID int64, title, body, actionURL string) error {
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
		SourceEvent: "vehicle_alert",
		Payload:     map[string]any{"kind": "vehicle_alert"},
	}
	if actionURL != "" {
		in.ActionURL = &actionURL
	}
	_, err := n.notif.Enqueue(ctx, in)
	return err
}
