// Package dailysummary wires the end-of-day WhatsApp summary.
package dailysummary

import (
	"context"
	"net/http"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database/db"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/middleware"
	dshandler "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/dailysummary/handler"
	dsusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/dailysummary/usecase"
	messagingmodel "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/messaging/model"
	messagingusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/messaging/usecase"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/jwt"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/rbac"
)

// RegisterRoutes mounts /v1/tenant/daily-summary. The summary contains revenue
// and cash balances, so every route is owner-only (like messaging settings).
func RegisterRoutes(
	mux *http.ServeMux,
	svc *dsusecase.Service,
	tokens *jwt.Manager,
	loader middleware.IdentityLoader,
	q *db.Queries,
) {
	h := dshandler.New(svc)
	authn := middleware.Authenticate(tokens, loader)
	requireOrg := middleware.RequireOrganization(tokens, q)
	requireOwner := middleware.RequireOrgRole("owner")
	read := middleware.RequirePermission(rbac.PermTenantMessagingRead)
	write := middleware.RequirePermission(rbac.PermTenantMessagingWrite)

	tRead := func(fn http.HandlerFunc) http.Handler {
		return middleware.Chain(fn, authn, requireOrg, read, requireOwner)
	}
	tWrite := func(fn http.HandlerFunc) http.Handler {
		return middleware.Chain(fn, authn, requireOrg, write, requireOwner)
	}

	mux.Handle("GET /v1/tenant/daily-summary", tRead(h.GetSettings))
	mux.Handle("PUT /v1/tenant/daily-summary", tWrite(h.UpdateSettings))
	mux.Handle("GET /v1/tenant/daily-summary/preview", tRead(h.Preview))
	mux.Handle("POST /v1/tenant/daily-summary/test", tWrite(h.SendTest))
}

// MessagingSender adapts the messaging service (organization WhatsApp line,
// queued + logged in outbound_messages) to the summary Sender.
type MessagingSender struct {
	svc *messagingusecase.Service
}

func NewMessagingSender(svc *messagingusecase.Service) *MessagingSender {
	return &MessagingSender{svc: svc}
}

func (m *MessagingSender) WhatsAppConnected(ctx context.Context, orgID int64) (bool, error) {
	s, err := m.svc.GetSession(ctx, orgID)
	if err != nil {
		return false, err
	}
	return s.Status == messagingmodel.StatusConnected, nil
}

func (m *MessagingSender) QueueWhatsApp(ctx context.Context, orgID int64, phone, body, eventType, subjectType string) error {
	_, err := m.svc.QueueSend(ctx, messagingusecase.OutboundRequest{
		OrgID:       orgID,
		EventType:   eventType,
		Channel:     messagingmodel.ChannelWhatsApp,
		Phone:       phone,
		Body:        body,
		SubjectType: subjectType,
	})
	return err
}
