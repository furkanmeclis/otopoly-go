// Package reviews wires review collection: tenant routes under
// /v1/tenant/reviews, the public answer page API under /v1/public/reviews,
// job event handlers and the messaging / notification center adapters.
package reviews

import (
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"strconv"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database/db"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/middleware"
	messagingusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/messaging/usecase"
	centermodel "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/notifycenter/model"
	reviewshandler "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/reviews/handler"
	reviewsusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/reviews/usecase"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/entitlements"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/events"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/jwt"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/rbac"
	"github.com/google/uuid"
)

// RegisterRoutes mounts /v1/tenant/reviews/* and /v1/public/reviews/{token}*.
// Reads need tenant.reviews.read (owners and staff); writes need
// tenant.reviews.write and the owner role. Every tenant route needs the
// reviews.enabled plan toggle.
func RegisterRoutes(
	mux *http.ServeMux,
	svc *reviewsusecase.Service,
	limiter reviewshandler.RateLimiter,
	tokens *jwt.Manager,
	loader middleware.IdentityLoader,
	q *db.Queries,
	ent *entitlements.Service,
) {
	h := reviewshandler.New(svc, limiter)
	authn := middleware.Authenticate(tokens, loader)
	requireOrg := middleware.RequireOrganization(tokens, q)
	requireFeature := middleware.RequireFeature(ent, reviewsusecase.FeatureEnabled)
	read := func(fn http.HandlerFunc) http.Handler {
		return middleware.Chain(fn, authn, requireOrg, requireFeature, middleware.RequirePermission(rbac.PermTenantReviewsRead))
	}
	write := func(fn http.HandlerFunc) http.Handler {
		return middleware.Chain(fn, authn, requireOrg, requireFeature,
			middleware.RequirePermission(rbac.PermTenantReviewsWrite), middleware.RequireOrgRole("owner"))
	}

	mux.Handle("GET /v1/tenant/reviews/meta", read(h.Meta))
	mux.Handle("GET /v1/tenant/reviews/summary", read(h.Summary))
	mux.Handle("GET /v1/tenant/reviews/settings", read(h.GetSettings))
	mux.Handle("PUT /v1/tenant/reviews/settings", write(h.UpdateSettings))
	mux.Handle("POST /v1/tenant/reviews/settings/test", write(h.SendTest))
	mux.Handle("GET /v1/tenant/reviews", read(h.List))
	mux.Handle("GET /v1/tenant/reviews/{uuid}", read(h.Get))
	mux.Handle("POST /v1/tenant/reviews/{uuid}/follow-up", write(h.FollowUp))

	mux.HandleFunc("GET /v1/public/reviews/{token}", h.PublicGet)
	mux.HandleFunc("POST /v1/public/reviews/{token}", h.PublicAnswer)
	mux.HandleFunc("POST /v1/public/reviews/{token}/google", h.PublicGoogle)
}

// RegisterEventHandlers schedules a request when a job is delivered and
// cancels it when the job is cancelled or voided before the send.
func RegisterEventHandlers(bus events.Bus, svc *reviewsusecase.Service, log *slog.Logger) {
	if bus == nil || svc == nil {
		return
	}
	if log == nil {
		log = slog.Default()
	}
	on := func(name string, fn func(context.Context, uuid.UUID) error) {
		bus.Subscribe(name, func(ctx context.Context, event events.Event) error {
			raw, _ := event.Payload["job_uuid"].(string)
			id, err := uuid.Parse(raw)
			if err != nil {
				return nil
			}
			if err := fn(ctx, id); err != nil {
				log.Warn("review_job_event_failed", "event", name, "job_uuid", raw, "error", err)
			}
			return nil
		})
	}
	on(events.JobsDelivered, svc.HandleJobDelivered)
	on(events.JobsCancelled, svc.HandleJobCancelled)
	on(events.JobsVoided, svc.HandleJobCancelled)
}

// MessagingAdapter sends review requests through the messaging module
// (WhatsApp line or platform number, the organization's SMS provider, plan
// gates and the outbound log).
type MessagingAdapter struct {
	svc *messagingusecase.Service
}

// NewMessagingAdapter wraps the messaging service.
func NewMessagingAdapter(svc *messagingusecase.Service) *MessagingAdapter {
	return &MessagingAdapter{svc: svc}
}

// ChannelAvailable implements usecase.Messenger.
func (m *MessagingAdapter) ChannelAvailable(ctx context.Context, orgID int64, channel string) (bool, error) {
	return m.svc.ChannelAvailable(ctx, orgID, channel)
}

// Template implements usecase.Messenger (type review.request).
func (m *MessagingAdapter) Template(ctx context.Context, orgID int64, channel, locale string) (reviewsusecase.Template, error) {
	t, found, err := m.svc.ResolveTemplate(ctx, orgID, reviewsusecase.EventRequest, channel, locale)
	if err != nil || !found {
		return reviewsusecase.Template{}, err
	}
	return reviewsusecase.Template{Body: t.Body, Active: t.Active, Custom: t.Custom, Found: true}, nil
}

// Queue implements usecase.Messenger.
func (m *MessagingAdapter) Queue(ctx context.Context, msg reviewsusecase.OutboundMessage) (uuid.UUID, error) {
	subject := msg.SubjectUUID
	return m.svc.QueueSend(ctx, messagingusecase.OutboundRequest{
		OrgID: msg.OrgID, EventType: reviewsusecase.EventRequest, Channel: msg.Channel, Phone: msg.Phone,
		Body: msg.Body, SubjectType: reviewsusecase.SubjectType, SubjectUUID: &subject, Vars: msg.Vars,
	})
}

// Dispatcher is the notification center subset used for team notices.
type Dispatcher interface {
	Dispatch(ctx context.Context, n centermodel.Notification) (centermodel.Result, error)
}

// CenterNotifier delivers the low-score notice (in-app with web / mobile
// push, e-mail when the member enabled it) through the notification center.
type CenterNotifier struct {
	center Dispatcher
}

// NewCenterNotifier wraps the notification center.
func NewCenterNotifier(c Dispatcher) *CenterNotifier { return &CenterNotifier{center: c} }

// LowScore implements usecase.TeamNotifier.
func (n *CenterNotifier) LowScore(ctx context.Context, t reviewsusecase.TeamNotice) error {
	if n == nil || n.center == nil {
		return nil
	}
	_, err := n.center.Dispatch(ctx, centermodel.Notification{
		OrgID: t.OrgID, Kind: reviewsusecase.KindLowScore,
		SubjectType: reviewsusecase.SubjectType, SubjectID: t.ReviewID,
		Recipient: centermodel.Recipient{UserID: t.UserID},
		Vars: map[string]string{
			"customer_name": t.CustomerName, "score": strconv.Itoa(t.Score), "comment": t.Comment, "plate": t.Plate,
		},
		ActionURL: t.ActionURL,
		DedupeKey: fmt.Sprintf("%s:%s:u%d", reviewsusecase.KindLowScore, t.ReviewUUID, t.UserID),
	})
	return err
}
