// Package usecase implements tenant quotes (teklifler): server-side totals,
// race-safe numbering, a guarded status machine, PDF rendering, a public
// share link, delivery / reminder seams and quick conversion into a job.
package usecase

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"time"
	_ "time/tzdata" // Europe/Istanbul must resolve in minimal containers.
	"unicode"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database/db"
	customersusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/customers/usecase"
	financeusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/finance/usecase"
	jobsusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/jobs/usecase"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/activity"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/authctx"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/orgctx"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/resourcemeta"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/storage"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

var (
	ErrNotFound       = errors.New("not found")
	ErrInvalidRequest = errors.New("invalid request")
	ErrConflict       = errors.New("conflict")
	// ErrInvalidTransition is a status change the machine does not allow.
	ErrInvalidTransition = errors.New("invalid status transition")
	// ErrPDFUnavailable means the PDF renderer (Gotenberg) failed.
	ErrPDFUnavailable = errors.New("pdf renderer unavailable")
	// ErrVehicleRequired: converting needs a vehicle the quote does not have.
	ErrVehicleRequired = errors.New("vehicle required")
)

// Limits.
const (
	MaxLines       = 200
	MaxDescription = 300
	MaxNotes       = 5000
	numberPrefix   = "TKL"
)

// JobCreator creates a service job (satisfied by *jobsusecase.Service).
type JobCreator interface {
	Create(ctx context.Context, in jobsusecase.CreateInput) (jobsusecase.JobDetail, error)
}

// VehicleCreator adds a vehicle to a customer (satisfied by *customersusecase.Service).
type VehicleCreator interface {
	AddVehicle(ctx context.Context, customerUUID uuid.UUID, in customersusecase.CreateVehicleInput) (customersusecase.Vehicle, error)
}

// PDFRenderer converts HTML to PDF (satisfied by *pdfrender.Client).
type PDFRenderer interface {
	HTMLToPDF(ctx context.Context, html string) ([]byte, error)
}

// Service is the quotes use case.
type Service struct {
	pool      *pgxpool.Pool
	q         *db.Queries
	act       *activity.Recorder
	storage   storage.Driver
	pdf       PDFRenderer
	messenger QuoteMessenger
	scheduler ReminderScheduler
	jobs      JobCreator
	vehicles  VehicleCreator
	shareBase string
	loc       *time.Location
	now       func() time.Time
	log       *slog.Logger
}

// New builds the service with no-op messenger / scheduler seams.
// shareBaseURL is the public frontend origin used for /q/{token} links.
func New(pool *pgxpool.Pool, q *db.Queries, act *activity.Recorder, store storage.Driver, pdf PDFRenderer, shareBaseURL string) *Service {
	loc, err := time.LoadLocation("Europe/Istanbul")
	if err != nil {
		loc = time.FixedZone("TRT", 3*60*60)
	}
	return &Service{
		pool: pool, q: q, act: act, storage: store, pdf: pdf,
		messenger: NoopMessenger{}, scheduler: NoopReminderScheduler{},
		shareBase: strings.TrimRight(strings.TrimSpace(shareBaseURL), "/"),
		loc:       loc, now: time.Now, log: slog.Default(),
	}
}

// SetMessenger replaces the QuoteMessenger seam (nil restores the no-op).
func (s *Service) SetMessenger(m QuoteMessenger) {
	if m == nil {
		m = NoopMessenger{}
	}
	s.messenger = m
}

// SetReminderScheduler replaces the ReminderScheduler seam (nil restores the no-op).
func (s *Service) SetReminderScheduler(r ReminderScheduler) {
	if r == nil {
		r = NoopReminderScheduler{}
	}
	s.scheduler = r
}

// SetJobCreator wires quick conversion into the jobs module.
func (s *Service) SetJobCreator(j JobCreator) { s.jobs = j }

// SetVehicleCreator wires vehicle creation during conversion.
func (s *Service) SetVehicleCreator(v VehicleCreator) { s.vehicles = v }

// SetLogger sets the logger.
func (s *Service) SetLogger(l *slog.Logger) {
	if l != nil {
		s.log = l
	}
}

// ResourceMeta returns list metadata.
func (s *Service) ResourceMeta() resourcemeta.ResourceMeta { return resourcemeta.TenantQuotes() }

func (s *Service) requireOrg(ctx context.Context) (orgctx.Scope, error) {
	scope, ok := orgctx.ScopeFrom(ctx)
	if !ok || scope.InternalID <= 0 {
		return orgctx.Scope{}, errors.New("organization context required")
	}
	return scope, nil
}

func actorID(ctx context.Context) pgtype.Int8 {
	if p, ok := authctx.PrincipalFrom(ctx); ok && p.UserInternal > 0 {
		return pgtype.Int8{Int64: p.UserInternal, Valid: true}
	}
	return pgtype.Int8{}
}

func (s *Service) record(ctx context.Context, action string, id uuid.UUID, payload map[string]any) {
	if s.act == nil {
		return
	}
	var actor *int64
	if a := actorID(ctx); a.Valid {
		v := a.Int64
		actor = &v
	}
	s.act.Record(ctx, actor, action, "quote", &id, payload, nil)
}

func (s *Service) today() time.Time {
	n := s.now().In(s.loc)
	return time.Date(n.Year(), n.Month(), n.Day(), 0, 0, 0, 0, s.loc)
}

// ShareURL is the public link for a token.
func (s *Service) ShareURL(token string) string {
	return s.shareBase + "/q/" + token
}

func newShareToken() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}

// FormatNumber renders a quote number such as TKL-2026-0001.
func FormatNumber(year int, seq int32) string {
	return fmt.Sprintf("%s-%d-%04d", numberPrefix, year, seq)
}

func numeric(raw string) pgtype.Numeric {
	var n pgtype.Numeric
	if err := n.Scan(strings.TrimSpace(raw)); err != nil || !n.Valid {
		_ = n.Scan("0")
	}
	return n
}

func numStr(n pgtype.Numeric) string { return financeusecase.NumericToString(n) }

func money(n pgtype.Numeric) string {
	r := ratFromNumeric(n)
	return r.FloatString(2)
}

func optTime(t pgtype.Timestamptz) *time.Time {
	if !t.Valid {
		return nil
	}
	v := t.Time
	return &v
}

func optUUID(u pgtype.UUID) *uuid.UUID {
	if !u.Valid {
		return nil
	}
	id := uuid.UUID(u.Bytes)
	return &id
}

func optDate(d pgtype.Date) *string {
	if !d.Valid {
		return nil
	}
	v := d.Time.Format("2006-01-02")
	return &v
}

func parseDate(raw string) (pgtype.Date, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return pgtype.Date{}, nil
	}
	t, err := time.Parse("2006-01-02", raw)
	if err != nil {
		return pgtype.Date{}, fmt.Errorf("%w: invalid date %q (want yyyy-MM-dd)", ErrInvalidRequest, raw)
	}
	return pgtype.Date{Time: t, Valid: true}, nil
}

// NormalizePlate uppercases and strips spaces / dashes; empty is allowed.
func NormalizePlate(raw string) (string, error) {
	var b strings.Builder
	for _, r := range strings.TrimSpace(raw) {
		if unicode.IsSpace(r) || r == '-' {
			continue
		}
		b.WriteRune(unicode.ToUpper(r))
	}
	p := b.String()
	if len(p) > 16 {
		return "", fmt.Errorf("%w: plate is too long", ErrInvalidRequest)
	}
	return p, nil
}

func isNoRows(err error) bool { return errors.Is(err, pgx.ErrNoRows) }

// ---------------------------------------------------------------- list / get

// List returns quotes for the active organization.
func (s *Service) List(ctx context.Context, limit, offset int32, f ListFilters) ([]Quote, int64, error) {
	scope, err := s.requireOrg(ctx)
	if err != nil {
		return nil, 0, err
	}
	sort := strings.TrimSpace(f.Sort)
	switch sort {
	case "", "-created_at", "created_at", "grand_total", "-grand_total", "valid_until":
	default:
		return nil, 0, fmt.Errorf("%w: unsupported sort", ErrInvalidRequest)
	}
	p := db.ListQuotesParams{OrganizationID: scope.InternalID, Sort: sort, LimitCount: limit, OffsetCount: offset}
	if st := strings.TrimSpace(f.Status); st != "" {
		if st != "open" && !IsKnownStatus(st) {
			return nil, 0, fmt.Errorf("%w: unknown status", ErrInvalidRequest)
		}
		p.Status = pgtype.Text{String: st, Valid: true}
	}
	if q := strings.TrimSpace(f.Q); q != "" {
		p.Q = pgtype.Text{String: q, Valid: true}
	}
	if f.CustomerUUID != nil {
		c, err := s.q.GetOrgCustomerRef(ctx, db.GetOrgCustomerRefParams{OrganizationID: scope.InternalID, Uuid: *f.CustomerUUID})
		if err != nil {
			if isNoRows(err) {
				return []Quote{}, 0, nil
			}
			return nil, 0, err
		}
		p.CustomerID = pgtype.Int8{Int64: c.ID, Valid: true}
	}
	if f.LeadUUID != nil {
		l, err := s.q.GetOrgLeadRef(ctx, db.GetOrgLeadRefParams{OrganizationID: scope.InternalID, Uuid: *f.LeadUUID})
		if err != nil {
			if isNoRows(err) {
				return []Quote{}, 0, nil
			}
			return nil, 0, err
		}
		p.LeadID = pgtype.Int8{Int64: l.ID, Valid: true}
	}
	rows, err := s.q.ListQuotes(ctx, p)
	if err != nil {
		return nil, 0, err
	}
	total, err := s.q.CountQuotes(ctx, db.CountQuotesParams{
		OrganizationID: p.OrganizationID, Status: p.Status, CustomerID: p.CustomerID, LeadID: p.LeadID, Q: p.Q,
	})
	if err != nil {
		return nil, 0, err
	}
	today := s.today()
	out := make([]Quote, 0, len(rows))
	for _, r := range rows {
		out = append(out, Quote{
			UUID: r.Uuid, Number: r.Number, Status: r.Status, Currency: r.Currency,
			GrandTotal: money(r.GrandTotal), ValidUntil: optDate(r.ValidUntil),
			Expired:      r.ValidUntil.Valid && r.ValidUntil.Time.Before(today),
			CustomerUUID: r.CustomerUuid, CustomerName: r.CustomerName, CustomerPhone: r.CustomerPhone,
			VehiclePlate: r.VehiclePlate, VehicleLabel: r.VehicleLabel,
			LeadUUID: optUUID(r.LeadUuid), JobUUID: optUUID(r.JobUuid), LineCount: r.LineCount,
			SentAt: optTime(r.SentAt), ViewedAt: optTime(r.ViewedAt),
			CreatedAt: r.CreatedAt.Time, UpdatedAt: r.UpdatedAt.Time,
		})
	}
	return out, total, nil
}

// Summary returns open-quote counts for the dashboard (TRY by default).
func (s *Service) Summary(ctx context.Context, currency string) (Summary, error) {
	scope, err := s.requireOrg(ctx)
	if err != nil {
		return Summary{}, err
	}
	currency = strings.ToUpper(strings.TrimSpace(currency))
	if currency == "" {
		currency = "TRY"
	}
	today := s.today()
	monthStart := time.Date(today.Year(), today.Month(), 1, 0, 0, 0, 0, s.loc)
	row, err := s.q.QuoteSummary(ctx, db.QuoteSummaryParams{
		OrganizationID: scope.InternalID,
		Today:          pgtype.Date{Time: today, Valid: true},
		MonthStart:     pgtype.Timestamptz{Time: monthStart, Valid: true},
		Currency:       currency,
	})
	if err != nil {
		return Summary{}, err
	}
	return Summary{
		Currency: currency, OpenCount: row.OpenCount, DraftCount: row.DraftCount,
		AwaitingCount: row.AwaitingCount, PendingTotal: money(row.PendingTotal),
		ExpiringSoon: row.ExpiringSoon, AcceptedMonth: row.AcceptedMonth,
		AcceptedMonthTotal: money(row.AcceptedMonthTotal),
	}, nil
}

// Get returns the full quote.
func (s *Service) Get(ctx context.Context, id uuid.UUID) (Detail, error) {
	scope, err := s.requireOrg(ctx)
	if err != nil {
		return Detail{}, err
	}
	row, err := s.q.GetQuoteRowByUUID(ctx, db.GetQuoteRowByUUIDParams{Uuid: id, OrganizationID: scope.InternalID})
	if err != nil {
		if isNoRows(err) {
			return Detail{}, ErrNotFound
		}
		return Detail{}, err
	}
	return s.loadDetail(ctx, row)
}

func (s *Service) loadDetail(ctx context.Context, row db.Quote) (Detail, error) {
	refs, err := s.q.GetQuoteRefs(ctx, row.ID)
	if err != nil {
		return Detail{}, err
	}
	lines, err := s.q.ListQuoteLines(ctx, row.ID)
	if err != nil {
		return Detail{}, err
	}
	events, err := s.q.ListQuoteEvents(ctx, row.ID)
	if err != nil {
		return Detail{}, err
	}
	deliveries, err := s.q.ListQuoteDeliveries(ctx, row.ID)
	if err != nil {
		return Detail{}, err
	}
	reminders, err := s.q.ListQuoteReminders(ctx, row.ID)
	if err != nil {
		return Detail{}, err
	}
	today := s.today()
	converted := row.JobID.Valid
	d := Detail{
		Quote: Quote{
			UUID: row.Uuid, Number: row.Number, Status: row.Status, Currency: row.Currency,
			GrandTotal: money(row.GrandTotal), ValidUntil: optDate(row.ValidUntil),
			Expired:      row.ValidUntil.Valid && row.ValidUntil.Time.Before(today),
			CustomerUUID: refs.CustomerUuid, CustomerName: refs.CustomerName, CustomerPhone: refs.CustomerPhone,
			VehiclePlate: row.VehiclePlate, VehicleLabel: row.VehicleLabel,
			LeadUUID: optUUID(refs.LeadUuid), JobUUID: optUUID(refs.JobUuid), LineCount: int64(len(lines)),
			SentAt: optTime(row.SentAt), ViewedAt: optTime(row.ViewedAt),
			CreatedAt: row.CreatedAt.Time, UpdatedAt: row.UpdatedAt.Time,
		},
		LeadUUID:          optUUID(refs.LeadUuid),
		VehicleUUID:       optUUID(refs.VehicleUuid),
		VehicleModelUUID:  optUUID(refs.VehicleModelUuid),
		VehicleModelLabel: refs.VehicleModelLabel,
		CustomerEmail:     refs.CustomerEmail,
		PricesIncludeVAT:  row.PricesIncludeVat,
		DiscountType:      row.DiscountType,
		DiscountValue:     money(row.DiscountValue),
		Subtotal:          money(row.Subtotal),
		DiscountTotal:     money(row.DiscountTotal),
		VATTotal:          money(row.VatTotal),
		Notes:             row.Notes,
		Terms:             row.Terms,
		ShareURL:          s.ShareURL(row.ShareToken),
		ViewCount:         row.ViewCount,
		AcceptedAt:        optTime(row.AcceptedAt),
		RejectedAt:        optTime(row.RejectedAt),
		ExpiredAt:         optTime(row.ExpiredAt),
		CancelledAt:       optTime(row.CancelledAt),
		DecisionNote:      row.DecisionNote,
		DecisionChannel:   row.DecisionChannel,
		ConvertedAt:       optTime(row.ConvertedAt),
		CreatedByName:     refs.CreatedByName,
		AllowedStatuses:   manualTargets(row.Status, converted),
		CanEdit:           isEditable(row.Status),
		CanSend:           isSendable(row.Status),
		CanConvert:        isConvertible(row.Status) && !converted,
		Lines:             make([]Line, 0, len(lines)),
		Events:            make([]Event, 0, len(events)),
		Deliveries:        make([]Delivery, 0, len(deliveries)),
		Reminders:         make([]Reminder, 0, len(reminders)),
	}
	if row.VehicleYear.Valid {
		y := int(row.VehicleYear.Int16)
		d.VehicleYear = &y
	}
	for _, l := range lines {
		d.Lines = append(d.Lines, mapLine(l))
	}
	for _, e := range events {
		d.Events = append(d.Events, Event{
			UUID: e.Uuid, Kind: e.Kind, FromStatus: e.FromStatus, ToStatus: e.ToStatus,
			Body: e.Body, Channel: e.Channel, ActorName: e.ActorName, IP: e.Ip, CreatedAt: e.CreatedAt.Time,
		})
	}
	for _, dv := range deliveries {
		d.Deliveries = append(d.Deliveries, mapDelivery(dv))
	}
	for _, r := range reminders {
		d.Reminders = append(d.Reminders, mapReminder(r))
	}
	return d, nil
}

func mapLine(l db.ListQuoteLinesRow) Line {
	return Line{
		UUID: l.Uuid, LineType: l.LineType,
		ServiceUUID: optUUID(l.ServiceUuid), ProductUUID: optUUID(l.ProductUuid),
		Description: l.Description, Quantity: numStr(l.Quantity), Unit: l.Unit,
		UnitPrice: money(l.UnitPrice), DiscountType: l.DiscountType, DiscountValue: money(l.DiscountValue),
		VATRate: numStr(l.VatRate), LineSubtotal: money(l.LineSubtotal), LineDiscount: money(l.LineDiscount),
		QuoteDiscountShare: money(l.QuoteDiscountShare), NetAmount: money(l.NetAmount),
		VATAmount: money(l.VatAmount), LineTotal: money(l.LineTotal), SortOrder: l.SortOrder,
	}
}

func mapDelivery(d db.QuoteDelivery) Delivery {
	return Delivery{
		UUID: d.Uuid, Channel: d.Channel, Recipient: d.Recipient, Status: d.Status, Error: d.Error,
		AttemptCount: d.AttemptCount, LastAttemptAt: optTime(d.LastAttemptAt), SentAt: optTime(d.SentAt),
		CreatedAt: d.CreatedAt.Time,
	}
}

func mapReminder(r db.QuoteReminder) Reminder {
	return Reminder{
		UUID: r.Uuid, Kind: r.Kind, OffsetDays: r.OffsetDays, FireAt: r.FireAt.Time, Status: r.Status,
		Error: r.Error, SentAt: optTime(r.SentAt), CancelledAt: optTime(r.CancelledAt),
	}
}

// ---------------------------------------------------------------- create / update

type resolvedLine struct {
	lineType      string
	serviceID     pgtype.Int8
	productID     pgtype.Int8
	description   string
	quantity      string
	unit          string
	unitPrice     string
	discountType  string
	discountValue string
	vatRate       string
}

type resolved struct {
	customerID    int64
	customerName  string
	leadID        pgtype.Int8
	leadStatus    string
	vehicleID     pgtype.Int8
	vehiclePlate  string
	vehicleLabel  string
	vehicleModel  pgtype.Int8
	vehicleYear   pgtype.Int2
	currency      string
	inclVAT       bool
	discountType  string
	discountValue string
	validUntil    pgtype.Date
	notes         string
	terms         string
	lines         []resolvedLine
	totals        Totals
}

func strOr(p *string, def string) string {
	if p == nil || strings.TrimSpace(*p) == "" {
		return def
	}
	return strings.TrimSpace(*p)
}

// resolve validates input and verifies every referenced uuid belongs to orgID.
func (s *Service) resolve(ctx context.Context, q *db.Queries, orgID int64, in SaveInput) (resolved, error) {
	var r resolved
	if in.CustomerUUID == uuid.Nil {
		return r, fmt.Errorf("%w: customer_uuid is required", ErrInvalidRequest)
	}
	cust, err := q.GetOrgCustomerRef(ctx, db.GetOrgCustomerRefParams{OrganizationID: orgID, Uuid: in.CustomerUUID})
	if err != nil {
		if isNoRows(err) {
			return r, fmt.Errorf("%w: customer not found", ErrInvalidRequest)
		}
		return r, err
	}
	r.customerID, r.customerName = cust.ID, cust.Name

	if in.LeadUUID != nil && *in.LeadUUID != uuid.Nil {
		lead, err := q.GetOrgLeadRef(ctx, db.GetOrgLeadRefParams{OrganizationID: orgID, Uuid: *in.LeadUUID})
		if err != nil {
			if isNoRows(err) {
				return r, fmt.Errorf("%w: lead not found", ErrInvalidRequest)
			}
			return r, err
		}
		if lead.CustomerID != cust.ID {
			return r, fmt.Errorf("%w: lead belongs to another customer", ErrInvalidRequest)
		}
		r.leadID = pgtype.Int8{Int64: lead.ID, Valid: true}
		r.leadStatus = lead.Status
	}

	if v := in.Vehicle; v != nil {
		if v.VehicleUUID != nil && *v.VehicleUUID != uuid.Nil {
			veh, err := q.GetOrgCustomerVehicleRef(ctx, db.GetOrgCustomerVehicleRefParams{OrganizationID: orgID, Uuid: *v.VehicleUUID})
			if err != nil {
				if isNoRows(err) {
					return r, fmt.Errorf("%w: vehicle not found", ErrInvalidRequest)
				}
				return r, err
			}
			if veh.CustomerID != cust.ID {
				return r, fmt.Errorf("%w: vehicle belongs to another customer", ErrInvalidRequest)
			}
			r.vehicleID = pgtype.Int8{Int64: veh.ID, Valid: true}
			r.vehiclePlate = veh.Plate
			r.vehicleLabel = strings.TrimSpace(fmt.Sprintf("%s %s %d", veh.BrandName, veh.ModelName, veh.Year))
			r.vehicleModel = pgtype.Int8{Int64: veh.ModelID, Valid: true}
			r.vehicleYear = pgtype.Int2{Int16: veh.Year, Valid: true}
		} else {
			plate, err := NormalizePlate(v.Plate)
			if err != nil {
				return r, err
			}
			r.vehiclePlate = plate
			label := strings.TrimSpace(v.Label)
			if v.Year != nil {
				if *v.Year < 1900 || *v.Year > 2100 {
					return r, fmt.Errorf("%w: vehicle year must be between 1900 and 2100", ErrInvalidRequest)
				}
				r.vehicleYear = pgtype.Int2{Int16: int16(*v.Year), Valid: true}
			}
			if v.ModelUUID != nil && *v.ModelUUID != uuid.Nil {
				m, err := q.GetVehicleModelRef(ctx, *v.ModelUUID)
				if err != nil {
					if isNoRows(err) {
						return r, fmt.Errorf("%w: vehicle model not found", ErrInvalidRequest)
					}
					return r, err
				}
				r.vehicleModel = pgtype.Int8{Int64: m.ID, Valid: true}
				if label == "" {
					label = strings.TrimSpace(m.BrandName + " " + m.ModelName)
					if r.vehicleYear.Valid {
						label = fmt.Sprintf("%s %d", label, r.vehicleYear.Int16)
					}
				}
			}
			if len([]rune(label)) > 200 {
				return r, fmt.Errorf("%w: vehicle label is too long", ErrInvalidRequest)
			}
			r.vehicleLabel = label
		}
	}

	r.currency = strings.ToUpper(strings.TrimSpace(in.Currency))
	if r.currency == "" {
		r.currency = "TRY"
	}
	if len(r.currency) != 3 {
		return r, fmt.Errorf("%w: currency must be a 3-letter code", ErrInvalidRequest)
	}
	r.inclVAT = true
	if in.PricesIncludeVAT != nil {
		r.inclVAT = *in.PricesIncludeVAT
	}
	if r.discountType, err = normalizeDiscountType(in.DiscountType); err != nil {
		return r, fmt.Errorf("%w: %v", ErrInvalidRequest, err)
	}
	r.discountValue = strings.TrimSpace(in.DiscountValue)
	if r.discountValue == "" || r.discountType == DiscountNone {
		r.discountValue = "0"
	}
	if in.ValidUntil != nil {
		if r.validUntil, err = parseDate(*in.ValidUntil); err != nil {
			return r, err
		}
	}
	r.notes = strings.TrimSpace(in.Notes)
	r.terms = strings.TrimSpace(in.Terms)
	if len(r.notes) > MaxNotes || len(r.terms) > MaxNotes {
		return r, fmt.Errorf("%w: notes / terms are too long", ErrInvalidRequest)
	}

	if len(in.Lines) == 0 {
		return r, fmt.Errorf("%w: at least one line is required", ErrInvalidRequest)
	}
	if len(in.Lines) > MaxLines {
		return r, fmt.Errorf("%w: too many lines", ErrInvalidRequest)
	}
	tl := make([]TotalsLine, 0, len(in.Lines))
	for i, li := range in.Lines {
		rl := resolvedLine{
			lineType: strings.TrimSpace(li.LineType), description: strings.TrimSpace(li.Description),
			quantity: strings.TrimSpace(li.Quantity), unit: strings.TrimSpace(li.Unit),
		}
		if rl.quantity == "" {
			rl.quantity = "1"
		}
		if rl.lineType == "" {
			switch {
			case li.ServiceUUID != nil:
				rl.lineType = "service"
			case li.ProductUUID != nil:
				rl.lineType = "product"
			default:
				rl.lineType = "custom"
			}
		}
		defaultPrice, defaultVAT := "", "20"
		switch rl.lineType {
		case "service":
			if li.ServiceUUID == nil || *li.ServiceUUID == uuid.Nil {
				return r, fmt.Errorf("%w: line %d: service_uuid is required", ErrInvalidRequest, i+1)
			}
			svc, err := q.GetOrgServiceRef(ctx, db.GetOrgServiceRefParams{OrganizationID: orgID, Uuid: *li.ServiceUUID})
			if err != nil {
				if isNoRows(err) {
					return r, fmt.Errorf("%w: line %d: service not found", ErrInvalidRequest, i+1)
				}
				return r, err
			}
			rl.serviceID = pgtype.Int8{Int64: svc.ID, Valid: true}
			if rl.description == "" {
				rl.description = svc.Name
			}
			defaultPrice, defaultVAT = money(svc.Price), numStr(svc.VatRate)
		case "product":
			if li.ProductUUID == nil || *li.ProductUUID == uuid.Nil {
				return r, fmt.Errorf("%w: line %d: product_uuid is required", ErrInvalidRequest, i+1)
			}
			p, err := q.GetOrgProductRef(ctx, db.GetOrgProductRefParams{OrganizationID: orgID, Uuid: *li.ProductUUID})
			if err != nil {
				if isNoRows(err) {
					return r, fmt.Errorf("%w: line %d: product not found", ErrInvalidRequest, i+1)
				}
				return r, err
			}
			rl.productID = pgtype.Int8{Int64: p.ID, Valid: true}
			if rl.description == "" {
				rl.description = p.Name
			}
			if rl.unit == "" {
				rl.unit = p.Unit
			}
			defaultPrice, defaultVAT = money(p.SalePrice), numStr(p.VatRate)
		case "custom":
			if rl.description == "" {
				return r, fmt.Errorf("%w: line %d: description is required", ErrInvalidRequest, i+1)
			}
			if li.UnitPrice == nil || strings.TrimSpace(*li.UnitPrice) == "" {
				return r, fmt.Errorf("%w: line %d: unit_price is required", ErrInvalidRequest, i+1)
			}
		default:
			return r, fmt.Errorf("%w: line %d: line_type must be service, product or custom", ErrInvalidRequest, i+1)
		}
		if len([]rune(rl.description)) > MaxDescription {
			return r, fmt.Errorf("%w: line %d: description is too long", ErrInvalidRequest, i+1)
		}
		if len([]rune(rl.unit)) > 32 {
			return r, fmt.Errorf("%w: line %d: unit is too long", ErrInvalidRequest, i+1)
		}
		rl.unitPrice = strOr(li.UnitPrice, defaultPrice)
		rl.vatRate = strOr(li.VATRate, defaultVAT)
		if rl.discountType, err = normalizeDiscountType(li.DiscountType); err != nil {
			return r, fmt.Errorf("%w: line %d: %v", ErrInvalidRequest, i+1, err)
		}
		rl.discountValue = strings.TrimSpace(li.DiscountValue)
		if rl.discountValue == "" || rl.discountType == DiscountNone {
			rl.discountValue = "0"
		}
		r.lines = append(r.lines, rl)
		tl = append(tl, TotalsLine{
			Quantity: rl.quantity, UnitPrice: rl.unitPrice, DiscountType: rl.discountType,
			DiscountValue: rl.discountValue, VATRate: rl.vatRate,
		})
	}
	totals, err := ComputeTotals(tl, r.discountType, r.discountValue, r.inclVAT)
	if err != nil {
		return r, fmt.Errorf("%w: %v", ErrInvalidRequest, err)
	}
	r.totals = totals
	// Normalize stored decimals.
	for i := range r.lines {
		p, _ := parseDecimal(r.lines[i].unitPrice, "unit_price")
		r.lines[i].unitPrice = round2(p).FloatString(2)
		d, _ := parseDecimal(r.lines[i].discountValue, "discount_value")
		r.lines[i].discountValue = round2(d).FloatString(2)
		r.lines[i].quantity = strings.ReplaceAll(r.lines[i].quantity, ",", ".")
		r.lines[i].vatRate = strings.ReplaceAll(r.lines[i].vatRate, ",", ".")
	}
	dv, _ := parseDecimal(r.discountValue, "discount_value")
	r.discountValue = round2(dv).FloatString(2)
	return r, nil
}

func (s *Service) insertLines(ctx context.Context, q *db.Queries, orgID, quoteID int64, r resolved) error {
	for i, l := range r.lines {
		a := r.totals.Lines[i]
		if _, err := q.CreateQuoteLine(ctx, db.CreateQuoteLineParams{
			OrganizationID: orgID, QuoteID: quoteID, LineType: l.lineType,
			ServiceID: l.serviceID, ProductID: l.productID, Description: l.description,
			Quantity: numeric(l.quantity), Unit: l.unit, UnitPrice: numeric(l.unitPrice),
			DiscountType: l.discountType, DiscountValue: numeric(l.discountValue), VatRate: numeric(l.vatRate),
			LineSubtotal: numeric(a.Subtotal), LineDiscount: numeric(a.LineDiscount),
			QuoteDiscountShare: numeric(a.QuoteDiscountShare), NetAmount: numeric(a.Net),
			VatAmount: numeric(a.VAT), LineTotal: numeric(a.Total), SortOrder: int32(i),
		}); err != nil {
			return err
		}
	}
	return nil
}

type eventOpts struct {
	kind, from, to, body, channel, ip, ua string
}

func (s *Service) addEvent(ctx context.Context, q *db.Queries, orgID, quoteID int64, e eventOpts) error {
	if e.channel == "" {
		e.channel = "tenant"
	}
	var actor pgtype.Int8
	if e.channel == "tenant" {
		actor = actorID(ctx)
	}
	_, err := q.CreateQuoteEvent(ctx, db.CreateQuoteEventParams{
		OrganizationID: orgID, QuoteID: quoteID, Kind: e.kind, FromStatus: e.from, ToStatus: e.to,
		Body: truncate(e.body, 2000), Channel: e.channel, Ip: truncate(e.ip, 64), UserAgent: truncate(e.ua, 400),
		ActorUserID: actor,
	})
	return err
}

func truncate(s string, n int) string {
	r := []rune(s)
	if len(r) <= n {
		return s
	}
	return string(r[:n])
}

// leadEvent appends to a linked lead's timeline (no-op without a lead).
func (s *Service) leadEvent(ctx context.Context, q *db.Queries, orgID int64, leadID pgtype.Int8, kind, body string, quote db.Quote, actor bool) error {
	if !leadID.Valid {
		return nil
	}
	var a pgtype.Int8
	if actor {
		a = actorID(ctx)
	}
	_, err := q.CreateLeadEvent(ctx, db.CreateLeadEventParams{
		OrganizationID: orgID, LeadID: leadID.Int64, Kind: kind, Body: body,
		RefType: "quote", RefUuid: pgtype.UUID{Bytes: quote.Uuid, Valid: true}, RefLabel: quote.Number,
		ActorUserID: a,
	})
	return err
}

// setLeadStatus moves a linked lead forward (never backwards) and records it.
func (s *Service) setLeadStatus(ctx context.Context, q *db.Queries, orgID int64, leadID pgtype.Int8, to string, quote db.Quote, actor bool) error {
	if !leadID.Valid {
		return nil
	}
	lead, err := q.GetLeadRefByID(ctx, leadID.Int64)
	if err != nil {
		if isNoRows(err) {
			return nil
		}
		return err
	}
	rank := map[string]int{"new": 0, "contacted": 1, "quoted": 2, "won": 3, "lost": 3}
	if lead.Status == to || rank[lead.Status] >= rank[to] {
		return nil
	}
	if _, err := q.SetLeadStatusByID(ctx, db.SetLeadStatusByIDParams{Status: to, ID: lead.ID, OrganizationID: orgID}); err != nil {
		return err
	}
	var a pgtype.Int8
	if actor {
		a = actorID(ctx)
	}
	_, err = q.CreateLeadEvent(ctx, db.CreateLeadEventParams{
		OrganizationID: orgID, LeadID: lead.ID, Kind: "status_changed", FromValue: lead.Status, ToValue: to,
		RefType: "quote", RefUuid: pgtype.UUID{Bytes: quote.Uuid, Valid: true}, RefLabel: quote.Number,
		ActorUserID: a,
	})
	return err
}

// Create creates a draft quote with a race-safe sequential number.
func (s *Service) Create(ctx context.Context, in SaveInput) (Detail, error) {
	scope, err := s.requireOrg(ctx)
	if err != nil {
		return Detail{}, err
	}
	orgID := scope.InternalID
	r, err := s.resolve(ctx, s.q, orgID, in)
	if err != nil {
		return Detail{}, err
	}
	token, err := newShareToken()
	if err != nil {
		return Detail{}, err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return Detail{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := s.q.WithTx(tx)
	row, err := s.createTx(ctx, q, orgID, r, token)
	if err != nil {
		return Detail{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return Detail{}, err
	}
	s.record(ctx, "tenant.quote.create", row.Uuid, map[string]any{"number": row.Number, "total": money(row.GrandTotal)})
	return s.loadDetail(ctx, row)
}

func (s *Service) createTx(ctx context.Context, q *db.Queries, orgID int64, r resolved, token string) (db.Quote, error) {
	year := s.now().In(s.loc).Year()
	seq, err := q.NextQuoteNumber(ctx, db.NextQuoteNumberParams{OrganizationID: orgID, Year: int32(year)})
	if err != nil {
		return db.Quote{}, err
	}
	row, err := q.CreateQuote(ctx, db.CreateQuoteParams{
		OrganizationID: orgID, Number: FormatNumber(year, seq), CustomerID: r.customerID, LeadID: r.leadID,
		VehicleID: r.vehicleID, VehiclePlate: r.vehiclePlate, VehicleLabel: r.vehicleLabel,
		VehicleModelID: r.vehicleModel, VehicleYear: r.vehicleYear, Currency: r.currency,
		PricesIncludeVat: r.inclVAT, DiscountType: r.discountType, DiscountValue: numeric(r.discountValue),
		Subtotal: numeric(r.totals.Subtotal), DiscountTotal: numeric(r.totals.DiscountTotal),
		VatTotal: numeric(r.totals.VATTotal), GrandTotal: numeric(r.totals.GrandTotal),
		ValidUntil: r.validUntil, Notes: r.notes, Terms: r.terms, ShareToken: token, CreatedBy: actorID(ctx),
	})
	if err != nil {
		return db.Quote{}, err
	}
	if err := s.insertLines(ctx, q, orgID, row.ID, r); err != nil {
		return db.Quote{}, err
	}
	if err := s.addEvent(ctx, q, orgID, row.ID, eventOpts{kind: "created", to: StatusDraft}); err != nil {
		return db.Quote{}, err
	}
	if err := s.leadEvent(ctx, q, orgID, r.leadID, "quote_created", "", row, true); err != nil {
		return db.Quote{}, err
	}
	if err := s.setLeadStatus(ctx, q, orgID, r.leadID, "quoted", row, true); err != nil {
		return db.Quote{}, err
	}
	return row, nil
}

// Update replaces the editable content (draft / sent / viewed quotes).
func (s *Service) Update(ctx context.Context, id uuid.UUID, in SaveInput) (Detail, error) {
	scope, err := s.requireOrg(ctx)
	if err != nil {
		return Detail{}, err
	}
	orgID := scope.InternalID
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return Detail{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := s.q.WithTx(tx)
	cur, err := q.GetQuoteRowByUUIDForUpdate(ctx, db.GetQuoteRowByUUIDForUpdateParams{Uuid: id, OrganizationID: orgID})
	if err != nil {
		if isNoRows(err) {
			return Detail{}, ErrNotFound
		}
		return Detail{}, err
	}
	if !isEditable(cur.Status) {
		return Detail{}, fmt.Errorf("%w: a %s quote cannot be edited", ErrConflict, cur.Status)
	}
	r, err := s.resolve(ctx, q, orgID, in)
	if err != nil {
		return Detail{}, err
	}
	row, err := q.UpdateQuoteContent(ctx, db.UpdateQuoteContentParams{
		CustomerID: r.customerID, LeadID: r.leadID, VehicleID: r.vehicleID, VehiclePlate: r.vehiclePlate,
		VehicleLabel: r.vehicleLabel, VehicleModelID: r.vehicleModel, VehicleYear: r.vehicleYear,
		Currency: r.currency, PricesIncludeVat: r.inclVAT, DiscountType: r.discountType,
		DiscountValue: numeric(r.discountValue), Subtotal: numeric(r.totals.Subtotal),
		DiscountTotal: numeric(r.totals.DiscountTotal), VatTotal: numeric(r.totals.VATTotal),
		GrandTotal: numeric(r.totals.GrandTotal), ValidUntil: r.validUntil, Notes: r.notes, Terms: r.terms,
		ID: cur.ID, OrganizationID: orgID,
	})
	if err != nil {
		return Detail{}, err
	}
	if err := q.DeleteQuoteLines(ctx, db.DeleteQuoteLinesParams{QuoteID: row.ID, OrganizationID: orgID}); err != nil {
		return Detail{}, err
	}
	if err := s.insertLines(ctx, q, orgID, row.ID, r); err != nil {
		return Detail{}, err
	}
	if err := s.addEvent(ctx, q, orgID, row.ID, eventOpts{kind: "updated", from: row.Status, to: row.Status}); err != nil {
		return Detail{}, err
	}
	// valid_until changed → re-plan pending reminders against the new date.
	var cancelled []db.QuoteReminder
	var planned []db.QuoteReminder
	if cur.ValidUntil != row.ValidUntil {
		cancelled, planned, err = s.replanReminders(ctx, q, row)
		if err != nil {
			return Detail{}, err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return Detail{}, err
	}
	s.afterReminderChange(ctx, row, cancelled, planned)
	s.record(ctx, "tenant.quote.update", row.Uuid, map[string]any{"number": row.Number, "total": money(row.GrandTotal)})
	return s.loadDetail(ctx, row)
}

// Duplicate copies a quote into a new draft (e.g. to revise an expired one).
func (s *Service) Duplicate(ctx context.Context, id uuid.UUID) (Detail, error) {
	src, err := s.Get(ctx, id)
	if err != nil {
		return Detail{}, err
	}
	in := SaveInput{
		CustomerUUID: src.CustomerUUID, LeadUUID: src.LeadUUID, Currency: src.Currency,
		PricesIncludeVAT: &src.PricesIncludeVAT, DiscountType: src.DiscountType, DiscountValue: src.DiscountValue,
		Notes: src.Notes, Terms: src.Terms,
	}
	if src.VehicleUUID != nil {
		in.Vehicle = &VehicleInput{VehicleUUID: src.VehicleUUID}
	} else if src.VehiclePlate != "" || src.VehicleLabel != "" || src.VehicleModelUUID != nil {
		in.Vehicle = &VehicleInput{Plate: src.VehiclePlate, Label: src.VehicleLabel, ModelUUID: src.VehicleModelUUID, Year: src.VehicleYear}
	}
	for _, l := range src.Lines {
		price, vat := l.UnitPrice, l.VATRate
		in.Lines = append(in.Lines, LineInput{
			LineType: l.LineType, ServiceUUID: l.ServiceUUID, ProductUUID: l.ProductUUID,
			Description: l.Description, Quantity: l.Quantity, Unit: l.Unit, UnitPrice: &price,
			DiscountType: l.DiscountType, DiscountValue: l.DiscountValue, VATRate: &vat,
		})
	}
	return s.Create(ctx, in)
}

// ---------------------------------------------------------------- status

type transitionOpts struct {
	note, channel, ip, ua string
}

// transitionTx applies a guarded status change and all its side effects
// inside q's transaction. It returns reminders cancelled by the change so
// the caller can notify the scheduler after commit.
func (s *Service) transitionTx(ctx context.Context, q *db.Queries, cur db.Quote, to string, o transitionOpts) (db.Quote, []db.QuoteReminder, error) {
	if !CanTransition(cur.Status, to) {
		return db.Quote{}, nil, fmt.Errorf("%w: %s → %s", ErrInvalidTransition, cur.Status, to)
	}
	if cur.Status == StatusAccepted && to == StatusCancelled && cur.JobID.Valid {
		return db.Quote{}, nil, fmt.Errorf("%w: quote was converted to a job", ErrInvalidTransition)
	}
	if o.channel == "" {
		o.channel = "tenant"
	}
	row, err := q.SetQuoteStatus(ctx, db.SetQuoteStatusParams{
		ToStatus: to, DecisionNote: truncate(strings.TrimSpace(o.note), 1000), DecisionChannel: o.channel,
		DecisionIp: truncate(o.ip, 64), DecisionUserAgent: truncate(o.ua, 400), ID: cur.ID, FromStatus: cur.Status,
	})
	if err != nil {
		if isNoRows(err) {
			return db.Quote{}, nil, fmt.Errorf("%w: status changed concurrently", ErrConflict)
		}
		return db.Quote{}, nil, err
	}
	if err := s.addEvent(ctx, q, row.OrganizationID, row.ID, eventOpts{
		kind: "status_changed", from: cur.Status, to: to, body: o.note, channel: o.channel, ip: o.ip, ua: o.ua,
	}); err != nil {
		return db.Quote{}, nil, err
	}
	var cancelled []db.QuoteReminder
	if isTerminal(to) {
		if cancelled, err = q.CancelOpenQuoteReminders(ctx, row.ID); err != nil {
			return db.Quote{}, nil, err
		}
	}
	actor := o.channel == "tenant"
	switch to {
	case StatusSent:
		err = s.leadEvent(ctx, q, row.OrganizationID, row.LeadID, "quote_sent", "", row, actor)
	case StatusAccepted:
		if err = s.leadEvent(ctx, q, row.OrganizationID, row.LeadID, "quote_accepted", o.note, row, actor); err == nil {
			err = s.setLeadStatus(ctx, q, row.OrganizationID, row.LeadID, "won", row, actor)
		}
	case StatusRejected:
		err = s.leadEvent(ctx, q, row.OrganizationID, row.LeadID, "quote_rejected", o.note, row, actor)
	}
	if err != nil {
		return db.Quote{}, nil, err
	}
	return row, cancelled, nil
}

// SetStatus applies a manual status change from the tenant UI.
func (s *Service) SetStatus(ctx context.Context, id uuid.UUID, in StatusInput) (Detail, error) {
	scope, err := s.requireOrg(ctx)
	if err != nil {
		return Detail{}, err
	}
	to := strings.TrimSpace(in.Status)
	if !IsKnownStatus(to) {
		return Detail{}, fmt.Errorf("%w: unknown status", ErrInvalidRequest)
	}
	for _, sys := range systemOnly {
		if to == sys {
			return Detail{}, fmt.Errorf("%w: %s is set by the system", ErrInvalidTransition, to)
		}
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return Detail{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := s.q.WithTx(tx)
	cur, err := q.GetQuoteRowByUUIDForUpdate(ctx, db.GetQuoteRowByUUIDForUpdateParams{Uuid: id, OrganizationID: scope.InternalID})
	if err != nil {
		if isNoRows(err) {
			return Detail{}, ErrNotFound
		}
		return Detail{}, err
	}
	row, cancelled, err := s.transitionTx(ctx, q, cur, to, transitionOpts{note: in.Note})
	if err != nil {
		return Detail{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return Detail{}, err
	}
	s.afterReminderChange(ctx, row, cancelled, nil)
	s.record(ctx, "tenant.quote.status", row.Uuid, map[string]any{"number": row.Number, "from": cur.Status, "to": to})
	return s.loadDetail(ctx, row)
}
