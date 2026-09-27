package usecase

import (
	"context"
	"fmt"
	"math/big"
	"strings"
	"time"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database/db"
)

// ValidShareToken reports whether raw looks like a share token (43 url-safe
// base64 chars) so garbage never reaches the database.
func ValidShareToken(raw string) bool {
	if len(raw) != 43 {
		return false
	}
	for _, r := range raw {
		ok := r >= 'a' && r <= 'z' || r >= 'A' && r <= 'Z' || r >= '0' && r <= '9' || r == '-' || r == '_'
		if !ok {
			return false
		}
	}
	return true
}

func (s *Service) publicRow(ctx context.Context, q *db.Queries, token string, lock bool) (db.Quote, error) {
	if !ValidShareToken(token) {
		return db.Quote{}, ErrNotFound
	}
	var row db.Quote
	var err error
	if lock {
		row, err = q.GetQuoteByShareTokenForUpdate(ctx, token)
	} else {
		row, err = q.GetQuoteByShareToken(ctx, token)
	}
	if err != nil {
		if isNoRows(err) {
			return db.Quote{}, ErrNotFound
		}
		return db.Quote{}, err
	}
	// Drafts were never shared.
	if row.Status == StatusDraft {
		return db.Quote{}, ErrNotFound
	}
	return row, nil
}

func (s *Service) publicView(ctx context.Context, row db.Quote) (PublicQuote, error) {
	org, err := s.q.GetOrganizationByID(ctx, row.OrganizationID)
	if err != nil {
		return PublicQuote{}, err
	}
	refs, err := s.q.GetQuoteRefs(ctx, row.ID)
	if err != nil {
		return PublicQuote{}, err
	}
	lines, err := s.q.ListQuoteLines(ctx, row.ID)
	if err != nil {
		return PublicQuote{}, err
	}
	out := PublicQuote{
		Number: row.Number, Status: row.Status, OrganizationName: org.Name,
		OrganizationTel: org.Phone, OrganizationAddr: orgAddress(org), PrimaryColor: safeColor(org.PrimaryColor),
		CustomerName: refs.CustomerName, VehiclePlate: row.VehiclePlate, VehicleLabel: row.VehicleLabel,
		Currency: row.Currency, PricesIncludeVAT: row.PricesIncludeVat,
		Subtotal: money(row.Subtotal), DiscountTotal: money(row.DiscountTotal),
		VATTotal: money(row.VatTotal), GrandTotal: money(row.GrandTotal),
		ValidUntil: optDate(row.ValidUntil), Notes: row.Notes, Terms: row.Terms,
		IssuedAt: row.CreatedAt.Time, CanDecide: s.canDecide(row),
		Lines: make([]PublicLine, 0, len(lines)),
	}
	if org.LogoObjectKey.Valid && strings.TrimSpace(org.LogoObjectKey.String) != "" {
		u := fmt.Sprintf("/v1/public/organizations/logo/%s", org.Uuid.String())
		out.OrganizationLogo = &u
	}
	switch {
	case row.AcceptedAt.Valid && row.Status == StatusAccepted:
		out.DecidedAt = optTime(row.AcceptedAt)
	case row.RejectedAt.Valid && row.Status == StatusRejected:
		out.DecidedAt = optTime(row.RejectedAt)
	}
	for _, l := range lines {
		disc := new(big.Rat).Add(ratFromNumeric(l.LineDiscount), ratFromNumeric(l.QuoteDiscountShare))
		out.Lines = append(out.Lines, PublicLine{
			Description: l.Description, Quantity: numStr(l.Quantity), Unit: l.Unit,
			UnitPrice: money(l.UnitPrice), Discount: disc.FloatString(2), VATRate: numStr(l.VatRate),
			LineTotal: money(l.LineTotal),
		})
	}
	return out, nil
}

func (s *Service) canDecide(row db.Quote) bool {
	if row.Status != StatusSent && row.Status != StatusViewed {
		return false
	}
	return !row.ValidUntil.Valid || !row.ValidUntil.Time.Before(s.today())
}

// PublicGet returns the customer view. The first open of a sent quote moves
// it to viewed (exactly once; later opens only bump view_count).
func (s *Service) PublicGet(ctx context.Context, token string, client ClientInfo) (PublicQuote, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return PublicQuote{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := s.q.WithTx(tx)
	row, err := s.publicRow(ctx, q, token, true)
	if err != nil {
		return PublicQuote{}, err
	}
	if row.Status == StatusSent {
		if row, _, err = s.transitionTx(ctx, q, row, StatusViewed, transitionOpts{channel: "public", ip: client.IP, ua: client.UserAgent}); err != nil {
			return PublicQuote{}, err
		}
	}
	if err := q.IncrementQuoteViews(ctx, row.ID); err != nil {
		return PublicQuote{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return PublicQuote{}, err
	}
	return s.publicView(ctx, row)
}

// PublicDecide records the customer's accept / reject with IP, user agent and time.
func (s *Service) PublicDecide(ctx context.Context, token string, accept bool, in PublicDecisionInput, client ClientInfo) (PublicQuote, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return PublicQuote{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := s.q.WithTx(tx)
	row, err := s.publicRow(ctx, q, token, true)
	if err != nil {
		return PublicQuote{}, err
	}
	if !s.canDecide(row) {
		return PublicQuote{}, fmt.Errorf("%w: this quote can no longer be answered", ErrConflict)
	}
	to := StatusRejected
	if accept {
		to = StatusAccepted
	}
	updated, cancelled, err := s.transitionTx(ctx, q, row, to, transitionOpts{
		note: truncate(strings.TrimSpace(in.Note), 1000), channel: "public", ip: client.IP, ua: client.UserAgent,
	})
	if err != nil {
		return PublicQuote{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return PublicQuote{}, err
	}
	s.afterReminderChange(ctx, updated, cancelled, nil)
	s.notify(ctx, "decided", updated)
	if s.act != nil {
		s.act.Record(ctx, nil, "tenant.quote.public_decision", "quote", &updated.Uuid, map[string]any{
			"number": updated.Number, "status": to, "ip": client.IP, "at": time.Now().UTC().Format(time.RFC3339),
		}, nil)
	}
	return s.publicView(ctx, updated)
}

// PublicPDF returns the PDF for a shared quote.
func (s *Service) PublicPDF(ctx context.Context, token string) ([]byte, string, error) {
	row, err := s.publicRow(ctx, s.q, token, false)
	if err != nil {
		return nil, "", err
	}
	data, _, err := s.ensurePDF(ctx, row)
	if err != nil {
		return nil, "", err
	}
	return data, row.Number + ".pdf", nil
}
