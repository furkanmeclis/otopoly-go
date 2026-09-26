package usecase

import (
	"context"
	"fmt"
	"strings"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database/db"
	"github.com/google/uuid"
)

// ReminderUUID maps a reminder id to its uuid within an organization (used by
// the notification-center integration, whose subjects are internal ids).
func (s *Service) ReminderUUID(ctx context.Context, orgID, reminderID int64) (uuid.UUID, error) {
	r, err := s.q.GetQuoteReminderByID(ctx, db.GetQuoteReminderByIDParams{ID: reminderID, OrganizationID: orgID})
	if err != nil {
		if isNoRows(err) {
			return uuid.Nil, ErrNotFound
		}
		return uuid.Nil, err
	}
	return r.Uuid, nil
}

// SendPreview renders the customer message the send dialog would deliver
// (no PDF rendering, nothing is stored). Without a previewing messenger it
// reports ErrNotConfigured.
func (s *Service) SendPreview(ctx context.Context, id uuid.UUID) (QuotePreview, error) {
	scope, err := s.requireOrg(ctx)
	if err != nil {
		return QuotePreview{}, err
	}
	row, err := s.q.GetQuoteRowByUUID(ctx, db.GetQuoteRowByUUIDParams{Uuid: id, OrganizationID: scope.InternalID})
	if err != nil {
		if isNoRows(err) {
			return QuotePreview{}, ErrNotFound
		}
		return QuotePreview{}, err
	}
	p, ok := s.messenger.(QuotePreviewer)
	if !ok {
		return QuotePreview{}, ErrNotConfigured
	}
	msg, err := s.buildMessageOpts(ctx, row, false)
	if err != nil {
		return QuotePreview{}, err
	}
	return p.PreviewQuote(ctx, msg)
}

// AsyncSendFailed records a failure reported after the message was handed
// off (e.g. the queued WhatsApp send failed for good). ref is the value the
// messenger / scheduler returned (stored in provider_ref / external_ref).
// Unknown refs are ignored.
func (s *Service) AsyncSendFailed(ctx context.Context, orgID int64, ref, reason string) error {
	ref = strings.TrimSpace(ref)
	if orgID <= 0 || ref == "" {
		return nil
	}
	reason = truncate(strings.TrimSpace(reason), 1000)
	if reason == "" {
		reason = "delivery failed"
	}
	if d, err := s.q.FailQuoteDeliveryByRef(ctx, db.FailQuoteDeliveryByRefParams{
		OrganizationID: orgID, ProviderRef: ref, Error: reason,
	}); err == nil {
		return s.addEvent(ctx, s.q, orgID, d.QuoteID, eventOpts{kind: "delivery_failed", body: reason, channel: "system"})
	} else if !isNoRows(err) {
		return fmt.Errorf("fail delivery: %w", err)
	}
	r, err := s.q.FailQuoteReminderByRef(ctx, db.FailQuoteReminderByRefParams{
		OrganizationID: orgID, ExternalRef: ref, Error: reason,
	})
	if err == nil {
		return s.addEvent(ctx, s.q, orgID, r.QuoteID, eventOpts{kind: "reminder_failed", body: r.Kind + " " + reason, channel: "system"})
	}
	if isNoRows(err) {
		return nil
	}
	return fmt.Errorf("fail reminder: %w", err)
}
