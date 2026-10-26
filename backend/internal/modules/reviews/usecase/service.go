// Package usecase implements review collection (değerlendirme toplama): when
// a job is delivered a review request is scheduled (delay + quiet hours),
// sent over WhatsApp or SMS with a public short link, and answered with 1-5
// stars. High scores are sent on to the business's Google review page; low
// scores notify the team and need a follow-up ("ele alındı").
package usecase

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"net/url"
	"slices"
	"strings"
	"time"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database/db"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/authctx"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/entitlements"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/orgctx"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/resourceevents"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

// Plan features.
const (
	FeatureEnabled = "reviews.enabled"
	FeatureMonthly = "reviews.monthly"
)

// Channels.
const (
	ChannelAuto     = "auto"
	ChannelWhatsApp = "whatsapp"
	ChannelSMS      = "sms"
)

// Message / notification kinds (msgtemplate types).
const (
	EventRequest  = "review.request"
	KindLowScore  = "review.low_score"
	SubjectType   = "review_request"
	ResourceName  = "review_request"
	LiveResource  = resourceevents.TenantReviews
	tokenBytes    = 16 // 22 url-safe chars, 128 bits
	tokenLength   = 22
	linkValidity  = 30 * 24 * time.Hour
	sweepBatch    = 100
	maxComment    = 1000
	maxNote       = 1000
	maxConsent    = 500
	maxExcluded   = 500
	maxGoogleURL  = 500
	kindJob       = "job"
	kindTest      = "test"
	followNone    = "none"
	followNeeded  = "required"
	followDone    = "done"
	statusSending = "sending"
)

// Request statuses.
const (
	StatusScheduled = "scheduled"
	StatusSent      = "sent"
	StatusOpened    = "opened"
	StatusAnswered  = "answered"
	StatusExpired   = "expired"
	StatusCancelled = "cancelled"
	StatusSkipped   = "skipped"
	StatusFailed    = "failed"
)

// Skip / cancel reasons (skip_reason).
const (
	ReasonDisabled           = "disabled"
	ReasonJobCancelled       = "job_cancelled"
	ReasonPlanDisabled       = "plan_disabled"
	ReasonExcluded           = "excluded"
	ReasonNoPhone            = "no_phone"
	ReasonFrequencyCap       = "frequency_cap"
	ReasonMonthlyLimit       = "monthly_limit"
	ReasonChannelUnavailable = "channel_unavailable"
	ReasonTemplateInactive   = "template_inactive"
	ReasonChannelPlan        = "channel_plan"
	ReasonChannelQuota       = "channel_quota"
	ReasonSendFailed         = "send_failed"
)

var (
	ErrNotFound           = errors.New("not found")
	ErrInvalidRequest     = errors.New("invalid request")
	ErrConflict           = errors.New("conflict")
	ErrAlreadyAnswered    = errors.New("review already answered")
	ErrExpired            = errors.New("review link expired")
	ErrChannelUnavailable = errors.New("no messaging channel can send now")
)

// OutboundMessage is one rendered message handed to messaging.
type OutboundMessage struct {
	OrgID       int64
	Channel     string
	Phone       string
	Body        string
	SubjectUUID uuid.UUID
	Vars        map[string]string
}

// Template is the effective message template.
type Template struct {
	Body   string
	Active bool
	Custom bool
	Found  bool
}

// Messenger is the messaging infrastructure (WhatsApp line / SMS provider,
// plan gates, outbound log).
type Messenger interface {
	ChannelAvailable(ctx context.Context, orgID int64, channel string) (bool, error)
	Template(ctx context.Context, orgID int64, channel, locale string) (Template, error)
	Queue(ctx context.Context, m OutboundMessage) (uuid.UUID, error)
}

// TeamNotice is the in-app (+ push) notice of a low score for one member.
type TeamNotice struct {
	OrgID        int64
	UserID       int64
	ReviewID     int64
	ReviewUUID   uuid.UUID
	CustomerName string
	Plate        string
	Score        int
	Comment      string
	ActionURL    string
}

// TeamNotifier delivers team notices (notification center).
type TeamNotifier interface {
	LowScore(ctx context.Context, n TeamNotice) error
}

// Entitlements is the plan gate (nil = everything allowed).
type Entitlements interface {
	Enabled(ctx context.Context, orgID int64, key string) (bool, error)
	Check(ctx context.Context, orgID int64, key string, delta int64) (entitlements.Decision, error)
	Consume(ctx context.Context, orgID int64, key string, delta int64) error
}

// Recorder writes activity events.
type Recorder interface {
	Record(ctx context.Context, actorID *int64, action, resource string, resourceUUID *uuid.UUID, payload map[string]any, r *http.Request)
}

// Service is the review collection use case.
type Service struct {
	q          *db.Queries
	msg        Messenger
	team       TeamNotifier
	ent        Entitlements
	act        Recorder
	liveEvents resourceevents.Publisher
	log        *slog.Logger
	publicBase string
	now        func() time.Time
	loc        *time.Location
}

// New builds the service. publicBase is the web app origin (links /r/{token}).
func New(q *db.Queries, msg Messenger, publicBase string, log *slog.Logger) *Service {
	if log == nil {
		log = slog.Default()
	}
	loc, err := time.LoadLocation("Europe/Istanbul")
	if err != nil {
		loc = time.FixedZone("TRT", 3*60*60)
	}
	return &Service{q: q, msg: msg, log: log, publicBase: strings.TrimRight(publicBase, "/"), now: time.Now, loc: loc}
}

// SetTeamNotifier installs the low-score notifier.
func (s *Service) SetTeamNotifier(n TeamNotifier) { s.team = n }

// SetEntitlements installs the plan gate. A typed nil is ignored.
func (s *Service) SetEntitlements(e *entitlements.Service) {
	if e != nil {
		s.ent = e
	}
}

// SetEntitlementsGate installs any plan gate (tests).
func (s *Service) SetEntitlementsGate(e Entitlements) { s.ent = e }

// SetRecorder installs the activity recorder.
func (s *Service) SetRecorder(r Recorder) { s.act = r }

// SetResourceEvents attaches the live list publisher.
func (s *Service) SetResourceEvents(pub resourceevents.Publisher) { s.liveEvents = pub }

// SetClock overrides the clock (tests).
func (s *Service) SetClock(now func() time.Time) { s.now = now }

// PublicURL is the customer link of a token.
func (s *Service) PublicURL(token string) string { return s.publicBase + "/r/" + token }

func (s *Service) requireOrg(ctx context.Context) (orgctx.Scope, error) {
	scope, ok := orgctx.ScopeFrom(ctx)
	if !ok || scope.InternalID <= 0 {
		return orgctx.Scope{}, errors.New("organization context required")
	}
	return scope, nil
}

// requireFeature checks reviews.enabled for tenant calls (routes check it
// too; the assistant tools reach the use case directly).
func (s *Service) requireFeature(ctx context.Context, orgID int64) error {
	if s.ent == nil {
		return nil
	}
	on, err := s.ent.Enabled(ctx, orgID, FeatureEnabled)
	if err != nil {
		return err
	}
	if !on {
		return entitlements.ErrFeatureDisabled
	}
	return nil
}

func actorID(ctx context.Context) *int64 {
	if p, ok := authctx.PrincipalFrom(ctx); ok && p.UserInternal > 0 {
		v := p.UserInternal
		return &v
	}
	return nil
}

func (s *Service) live(ctx context.Context, action string, ids ...uuid.UUID) {
	out := make([]string, 0, len(ids))
	for _, id := range ids {
		out = append(out, id.String())
	}
	resourceevents.Emit(ctx, s.liveEvents, LiveResource, action, out...)
}

func (s *Service) record(ctx context.Context, action string, id *uuid.UUID, payload map[string]any) {
	if s.act == nil {
		return
	}
	s.act.Record(ctx, actorID(ctx), action, ResourceName, id, payload, nil)
}

func isNoRows(err error) bool { return errors.Is(err, pgx.ErrNoRows) }

func newToken() (string, error) {
	b := make([]byte, tokenBytes)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}

// ValidToken reports whether raw looks like a review token.
func ValidToken(raw string) bool {
	if len(raw) != tokenLength {
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

func ts(t time.Time) pgtype.Timestamptz { return pgtype.Timestamptz{Time: t, Valid: true} }

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
	v := uuid.UUID(u.Bytes)
	return &v
}

func truncate(s string, n int) string {
	r := []rune(s)
	if len(r) <= n {
		return s
	}
	return string(r[:n])
}

// ---------------------------------------------------------------- settings

func defaultSettings(orgID int64) db.ReviewSetting {
	return db.ReviewSetting{
		OrganizationID: orgID, Channel: ChannelAuto, DelayMinutes: 120, QuietHoursEnabled: true,
		QuietStartHour: 21, QuietEndHour: 9, HighScoreThreshold: 4, MinDaysBetween: 30,
		DefaultLocale: "tr", ExcludedCustomerIds: []int64{},
	}
}

func (s *Service) loadSettings(ctx context.Context, orgID int64) (db.ReviewSetting, error) {
	row, err := s.q.GetReviewSettings(ctx, orgID)
	if isNoRows(err) {
		return defaultSettings(orgID), nil
	}
	return row, err
}

// GetSettings returns the settings with channel availability, template and usage.
func (s *Service) GetSettings(ctx context.Context) (Settings, error) {
	scope, err := s.requireOrg(ctx)
	if err != nil {
		return Settings{}, err
	}
	if err := s.requireFeature(ctx, scope.InternalID); err != nil {
		return Settings{}, err
	}
	return s.settingsView(ctx, scope.InternalID)
}

func (s *Service) settingsView(ctx context.Context, orgID int64) (Settings, error) {
	row, err := s.loadSettings(ctx, orgID)
	if err != nil {
		return Settings{}, err
	}
	out := Settings{
		Enabled: row.Enabled, Channel: row.Channel, DelayMinutes: int(row.DelayMinutes),
		QuietHoursEnabled: row.QuietHoursEnabled, QuietStartHour: int(row.QuietStartHour), QuietEndHour: int(row.QuietEndHour),
		GoogleReviewURL: row.GoogleReviewUrl, HighScoreThreshold: int(row.HighScoreThreshold),
		MinDaysBetween: int(row.MinDaysBetween), ConsentText: row.ConsentText, DefaultLocale: row.DefaultLocale,
		ExcludedCustomers: []CustomerRef{}, Usage: Usage{Limit: -1},
	}
	if len(row.ExcludedCustomerIds) > 0 {
		custs, err := s.q.ListReviewCustomersByIDs(ctx, db.ListReviewCustomersByIDsParams{OrganizationID: orgID, Ids: row.ExcludedCustomerIds})
		if err != nil {
			return Settings{}, err
		}
		for _, c := range custs {
			out.ExcludedCustomers = append(out.ExcludedCustomers, CustomerRef{UUID: c.Uuid, Name: c.Name, Phone: c.Phone})
		}
	}
	if s.msg != nil {
		out.WhatsAppAvailable, _ = s.msg.ChannelAvailable(ctx, orgID, ChannelWhatsApp)
		out.SMSAvailable, _ = s.msg.ChannelAvailable(ctx, orgID, ChannelSMS)
	}
	out.EffectiveChannel = pickChannel(row.Channel, out.WhatsAppAvailable, out.SMSAvailable)
	tplChannel := out.EffectiveChannel
	if tplChannel == "" {
		tplChannel = ChannelWhatsApp
		if row.Channel == ChannelSMS {
			tplChannel = ChannelSMS
		}
	}
	tpl := s.template(ctx, orgID, tplChannel, row.DefaultLocale)
	org, err := s.q.GetReviewOrganization(ctx, orgID)
	if err != nil {
		return Settings{}, err
	}
	out.Template = TemplateInfo{
		Channel: tplChannel, Locale: row.DefaultLocale, Body: tpl.Body, IsCustom: tpl.Custom, Active: tpl.Active,
		Preview: Render(tpl.Body, Vars(sampleCustomer(row.DefaultLocale), org.Name, s.PublicURL("AbCdEfGhIjKlMnOpQrStUv"))),
	}
	if s.ent != nil {
		if d, err := s.ent.Check(ctx, orgID, FeatureMonthly, 0); err == nil {
			out.Usage = Usage{Used: d.Used, Limit: d.Limit}
		}
	}
	return out, nil
}

func sampleCustomer(locale string) string {
	if locale == "en" {
		return "John Smith"
	}
	return "Ahmet Yılmaz"
}

// ValidateGoogleURL accepts "" or an https URL with a host.
func ValidateGoogleURL(raw string) (string, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return "", nil
	}
	if len(raw) > maxGoogleURL {
		return "", fmt.Errorf("%w: google_review_url is too long", ErrInvalidRequest)
	}
	u, err := url.Parse(raw)
	if err != nil || u.Scheme != "https" || u.Host == "" || strings.ContainsAny(raw, " \t\n") {
		return "", fmt.Errorf("%w: google_review_url must be an https link", ErrInvalidRequest)
	}
	return u.String(), nil
}

// UpdateSettings validates and stores the settings.
func (s *Service) UpdateSettings(ctx context.Context, in UpdateSettingsInput) (Settings, error) {
	scope, err := s.requireOrg(ctx)
	if err != nil {
		return Settings{}, err
	}
	if err := s.requireFeature(ctx, scope.InternalID); err != nil {
		return Settings{}, err
	}
	row, err := s.loadSettings(ctx, scope.InternalID)
	if err != nil {
		return Settings{}, err
	}
	p := db.UpsertReviewSettingsParams{
		OrganizationID: scope.InternalID, Enabled: row.Enabled, Channel: row.Channel, DelayMinutes: row.DelayMinutes,
		QuietHoursEnabled: row.QuietHoursEnabled, QuietStartHour: row.QuietStartHour, QuietEndHour: row.QuietEndHour,
		GoogleReviewUrl: row.GoogleReviewUrl, HighScoreThreshold: row.HighScoreThreshold, MinDaysBetween: row.MinDaysBetween,
		ConsentText: row.ConsentText, DefaultLocale: row.DefaultLocale, ExcludedCustomerIds: row.ExcludedCustomerIds,
	}
	if p.ExcludedCustomerIds == nil {
		p.ExcludedCustomerIds = []int64{}
	}
	bad := func(msg string) (Settings, error) { return Settings{}, fmt.Errorf("%w: %s", ErrInvalidRequest, msg) }
	if in.Enabled != nil {
		p.Enabled = *in.Enabled
	}
	if in.Channel != nil {
		ch := strings.TrimSpace(*in.Channel)
		if ch != ChannelAuto && ch != ChannelSMS && ch != ChannelWhatsApp {
			return bad("channel must be auto, sms or whatsapp")
		}
		p.Channel = ch
	}
	if in.DelayMinutes != nil {
		if *in.DelayMinutes < 30 || *in.DelayMinutes > 2880 {
			return bad("delay_minutes must be between 30 and 2880")
		}
		p.DelayMinutes = int32(*in.DelayMinutes)
	}
	if in.QuietHoursEnabled != nil {
		p.QuietHoursEnabled = *in.QuietHoursEnabled
	}
	if in.QuietStartHour != nil {
		if *in.QuietStartHour < 0 || *in.QuietStartHour > 23 {
			return bad("quiet_start_hour must be 0-23")
		}
		p.QuietStartHour = int16(*in.QuietStartHour)
	}
	if in.QuietEndHour != nil {
		if *in.QuietEndHour < 0 || *in.QuietEndHour > 23 {
			return bad("quiet_end_hour must be 0-23")
		}
		p.QuietEndHour = int16(*in.QuietEndHour)
	}
	if in.GoogleReviewURL != nil {
		u, err := ValidateGoogleURL(*in.GoogleReviewURL)
		if err != nil {
			return Settings{}, err
		}
		p.GoogleReviewUrl = u
	}
	if in.HighScoreThreshold != nil {
		if *in.HighScoreThreshold < 2 || *in.HighScoreThreshold > 5 {
			return bad("high_score_threshold must be between 2 and 5")
		}
		p.HighScoreThreshold = int16(*in.HighScoreThreshold)
	}
	if in.MinDaysBetween != nil {
		if *in.MinDaysBetween < 0 || *in.MinDaysBetween > 365 {
			return bad("min_days_between must be between 0 and 365")
		}
		p.MinDaysBetween = int32(*in.MinDaysBetween)
	}
	if in.ConsentText != nil {
		c := strings.TrimSpace(*in.ConsentText)
		if len([]rune(c)) > maxConsent {
			return bad("consent_text is too long")
		}
		p.ConsentText = c
	}
	if in.DefaultLocale != nil {
		l := strings.TrimSpace(*in.DefaultLocale)
		if l != "tr" && l != "en" {
			return bad("default_locale must be tr or en")
		}
		p.DefaultLocale = l
	}
	if in.ExcludedCustomerUUIDs != nil {
		ids := *in.ExcludedCustomerUUIDs
		if len(ids) > maxExcluded {
			return bad(fmt.Sprintf("at most %d excluded customers", maxExcluded))
		}
		uniq := []uuid.UUID{}
		for _, id := range ids {
			if !slices.Contains(uniq, id) {
				uniq = append(uniq, id)
			}
		}
		custs, err := s.q.ListReviewCustomersByUUIDs(ctx, db.ListReviewCustomersByUUIDsParams{OrganizationID: scope.InternalID, Uuids: uniq})
		if err != nil {
			return Settings{}, err
		}
		if len(custs) != len(uniq) {
			return bad("unknown customer in excluded_customer_uuids")
		}
		p.ExcludedCustomerIds = make([]int64, 0, len(custs))
		for _, c := range custs {
			p.ExcludedCustomerIds = append(p.ExcludedCustomerIds, c.ID)
		}
	}
	if _, err := s.q.UpsertReviewSettings(ctx, p); err != nil {
		return Settings{}, err
	}
	s.record(ctx, "tenant.review.settings_update", nil, map[string]any{
		"enabled": p.Enabled, "channel": p.Channel, "delay_minutes": p.DelayMinutes,
	})
	return s.settingsView(ctx, scope.InternalID)
}

// pickChannel resolves the preferred channel against availability.
func pickChannel(pref string, waOK, smsOK bool) string {
	switch pref {
	case ChannelWhatsApp:
		if waOK {
			return ChannelWhatsApp
		}
	case ChannelSMS:
		if smsOK {
			return ChannelSMS
		}
	default:
		if waOK {
			return ChannelWhatsApp
		}
		if smsOK {
			return ChannelSMS
		}
	}
	return ""
}

func (s *Service) resolveChannel(ctx context.Context, orgID int64, pref string) string {
	if s.msg == nil {
		return ""
	}
	var waOK, smsOK bool
	if pref != ChannelSMS {
		waOK, _ = s.msg.ChannelAvailable(ctx, orgID, ChannelWhatsApp)
	}
	if pref == ChannelSMS || (pref != ChannelWhatsApp && !waOK) {
		smsOK, _ = s.msg.ChannelAvailable(ctx, orgID, ChannelSMS)
	}
	return pickChannel(pref, waOK, smsOK)
}

func (s *Service) template(ctx context.Context, orgID int64, channel, locale string) Template {
	if s.msg != nil {
		if t, err := s.msg.Template(ctx, orgID, channel, locale); err == nil && t.Found {
			return t
		} else if err != nil {
			s.log.Warn("review_template_failed", "org_id", orgID, "error", err)
		}
	}
	return Template{Body: DefaultBody(channel, locale), Active: true, Found: true}
}
