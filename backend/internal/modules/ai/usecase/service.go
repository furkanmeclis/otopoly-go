// Package usecase implements the AI assistant: platform settings, quota and
// usage metering, conversations and the streaming agent loop.
package usecase

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/url"
	"sort"
	"strings"
	"time"
	_ "time/tzdata" // Europe/Istanbul must resolve in minimal containers.

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database/db"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/ai/provider"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/ai/tools"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/authctx"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/orgctx"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

// DefaultMaxIterations caps model calls per user message.
const DefaultMaxIterations = 8

// ProviderFactory builds a provider from settings (overridable in tests).
type ProviderFactory func(cfg provider.Config) (provider.Provider, error)

// Service is the AI assistant use case.
type Service struct {
	store         Store
	box           Encrypter
	registry      *tools.Registry
	newProvider   ProviderFactory
	confirm       ConfirmationGate
	activity      ActivityRecorder
	log           *slog.Logger
	now           func() time.Time
	loc           *time.Location
	maxIterations int
	toolTimeout   time.Duration
}

// New creates the service.
func New(store Store, box Encrypter, registry *tools.Registry, log *slog.Logger) *Service {
	if log == nil {
		log = slog.Default()
	}
	if registry == nil {
		registry = tools.NewRegistry()
	}
	loc, err := time.LoadLocation("Europe/Istanbul")
	if err != nil {
		loc = time.FixedZone("TRT", 3*60*60)
	}
	return &Service{
		store:         store,
		box:           box,
		registry:      registry,
		newProvider:   provider.New,
		confirm:       disabledConfirmationGate{},
		log:           log,
		now:           time.Now,
		loc:           loc,
		maxIterations: DefaultMaxIterations,
		toolTimeout:   20 * time.Second,
	}
}

// SetProviderFactory overrides provider construction (tests, custom transports).
func (s *Service) SetProviderFactory(f ProviderFactory) { s.newProvider = f }

// SetConfirmationGate installs a custom confirmation flow for write tools
// (EnableActions installs the built-in one).
func (s *Service) SetConfirmationGate(g ConfirmationGate) {
	if g != nil {
		s.confirm = g
	}
}

// SetClock overrides time (tests).
func (s *Service) SetClock(now func() time.Time) { s.now = now }

// SetMaxIterations overrides the per-message model call cap.
func (s *Service) SetMaxIterations(n int) {
	if n > 0 {
		s.maxIterations = n
	}
}

// Registry exposes the tool registry.
func (s *Service) Registry() *tools.Registry { return s.registry }

// ------------------------------------------------------------------ settings

func (s *Service) toolEnabledMap(row db.AiSetting) map[string]bool {
	out := map[string]bool{}
	if len(row.ToolSettings) > 0 {
		_ = json.Unmarshal(row.ToolSettings, &out)
	}
	return out
}

func (s *Service) mapSettings(row db.AiSetting) Settings {
	enabled := s.toolEnabledMap(row)
	var toolInfos []ToolInfo
	for _, t := range s.registry.All() {
		spec := t.Spec()
		on, ok := enabled[spec.Name]
		toolInfos = append(toolInfos, ToolInfo{
			Name:                 spec.Name,
			Kind:                 string(spec.Kind),
			Feature:              string(spec.Feature),
			Permissions:          append([]string{}, spec.Permissions...),
			RequiresConfirmation: spec.RequiresConfirmation,
			Enabled:              !ok || on,
		})
	}
	out := Settings{
		Provider:   row.Provider,
		HasAPIKey:  row.ApiKeyEnc.Valid && row.ApiKeyEnc.String != "",
		BaseURL:    row.BaseUrl,
		Model:      row.Model,
		TitleModel: row.TitleModel,
		Effort:     row.Effort,
		MaxTokens:  int(row.MaxTokens),
		Features: Features{
			Chat: row.ChatEnabled, Actions: row.ActionsEnabled, Charts: row.ChartsEnabled,
			Voice: row.VoiceEnabled, Todos: row.TodosEnabled,
		},
		Tools:                    toolInfos,
		ExtraInstructions:        row.ExtraInstructions,
		DefaultMonthlyTokenQuota: row.DefaultMonthlyTokenQuota,
		Voice: VoiceSettings{
			BaseURL: row.VoiceBaseUrl, STTModel: row.VoiceSttModel, TTSVoice: row.VoiceTtsVoice, Language: row.VoiceLanguage,
		},
		Configured: isConfigured(row),
		UpdatedAt:  row.UpdatedAt.Time,
	}
	if out.HasAPIKey && s.box != nil {
		if key, err := s.box.Decrypt(row.ApiKeyEnc.String); err == nil && len(key) >= 8 {
			out.APIKeyHint = "…" + key[len(key)-4:]
		}
	}
	return out
}

func isConfigured(row db.AiSetting) bool {
	switch row.Provider {
	case provider.KindOpenAICompatible:
		return strings.TrimSpace(row.BaseUrl) != "" && strings.TrimSpace(row.Model) != ""
	default:
		return row.ApiKeyEnc.Valid && row.ApiKeyEnc.String != "" && strings.TrimSpace(row.Model) != ""
	}
}

// Settings returns platform settings (no secrets).
func (s *Service) Settings(ctx context.Context) (Settings, error) {
	row, err := s.store.GetAISettings(ctx)
	if err != nil {
		return Settings{}, err
	}
	return s.mapSettings(row), nil
}

var (
	validProviders = map[string]bool{provider.KindAnthropic: true, provider.KindOpenAICompatible: true}
	validEfforts   = map[string]bool{"low": true, "medium": true, "high": true, "xhigh": true, "max": true}
)

func invalid(format string, args ...any) error {
	return fmt.Errorf("%w: %s", ErrInvalidRequest, fmt.Sprintf(format, args...))
}

func text(v *string, max int, field string) (pgtype.Text, error) {
	if v == nil {
		return pgtype.Text{}, nil
	}
	t := strings.TrimSpace(*v)
	if len([]rune(t)) > max {
		return pgtype.Text{}, invalid("%s is too long (max %d)", field, max)
	}
	return pgtype.Text{String: t, Valid: true}, nil
}

func validURL(raw string) bool {
	if raw == "" {
		return true
	}
	u, err := url.Parse(raw)
	return err == nil && (u.Scheme == "http" || u.Scheme == "https") && u.Host != ""
}

// PatchSettings updates platform settings.
func (s *Service) PatchSettings(ctx context.Context, actorID *int64, in PatchSettingsInput) (Settings, error) {
	current, err := s.store.GetAISettings(ctx)
	if err != nil {
		return Settings{}, err
	}
	p := db.UpdateAISettingsParams{ClearApiKey: in.ClearAPIKey}
	if actorID != nil {
		p.UpdatedByUserID = pgtype.Int8{Int64: *actorID, Valid: true}
	} else {
		p.UpdatedByUserID = current.UpdatedByUserID
	}
	if in.Provider != nil {
		v := strings.TrimSpace(*in.Provider)
		if !validProviders[v] {
			return Settings{}, invalid("provider must be anthropic or openai_compatible")
		}
		p.Provider = pgtype.Text{String: v, Valid: true}
	}
	if in.APIKey != nil && strings.TrimSpace(*in.APIKey) != "" && !in.ClearAPIKey {
		key := strings.TrimSpace(*in.APIKey)
		if len(key) > 512 {
			return Settings{}, invalid("api_key is too long")
		}
		if s.box == nil {
			return Settings{}, errors.New("encryption is not configured")
		}
		enc, err := s.box.Encrypt(key)
		if err != nil {
			return Settings{}, err
		}
		p.ApiKeyEnc = pgtype.Text{String: enc, Valid: true}
	}
	if p.BaseUrl, err = text(in.BaseURL, 500, "base_url"); err != nil {
		return Settings{}, err
	}
	if p.BaseUrl.Valid && !validURL(p.BaseUrl.String) {
		return Settings{}, invalid("base_url must be an http(s) URL")
	}
	if p.Model, err = text(in.Model, 128, "model"); err != nil {
		return Settings{}, err
	}
	if p.Model.Valid && p.Model.String == "" {
		return Settings{}, invalid("model is required")
	}
	if p.TitleModel, err = text(in.TitleModel, 128, "title_model"); err != nil {
		return Settings{}, err
	}
	if in.Effort != nil {
		v := strings.TrimSpace(*in.Effort)
		if !validEfforts[v] {
			return Settings{}, invalid("effort must be one of low, medium, high, xhigh, max")
		}
		p.Effort = pgtype.Text{String: v, Valid: true}
	}
	if in.MaxTokens != nil {
		if *in.MaxTokens < 256 || *in.MaxTokens > 128000 {
			return Settings{}, invalid("max_tokens must be between 256 and 128000")
		}
		p.MaxTokens = pgtype.Int4{Int32: int32(*in.MaxTokens), Valid: true}
	}
	if f := in.Features; f != nil {
		b := func(v *bool) pgtype.Bool {
			if v == nil {
				return pgtype.Bool{}
			}
			return pgtype.Bool{Bool: *v, Valid: true}
		}
		p.ChatEnabled, p.ActionsEnabled, p.ChartsEnabled = b(f.Chat), b(f.Actions), b(f.Charts)
		p.VoiceEnabled, p.TodosEnabled = b(f.Voice), b(f.Todos)
	}
	if in.Tools != nil {
		merged := s.toolEnabledMap(current)
		for name, on := range in.Tools {
			if _, ok := s.registry.Get(name); !ok {
				return Settings{}, invalid("unknown tool %q", name)
			}
			if on {
				delete(merged, name)
			} else {
				merged[name] = false
			}
		}
		raw, _ := json.Marshal(merged)
		p.ToolSettings = raw
	}
	if p.ExtraInstructions, err = text(in.ExtraInstructions, 4000, "extra_instructions"); err != nil {
		return Settings{}, err
	}
	if in.DefaultMonthlyTokenQuota != nil {
		if *in.DefaultMonthlyTokenQuota < 0 {
			return Settings{}, invalid("default_monthly_token_quota must be >= 0")
		}
		p.DefaultMonthlyTokenQuota = pgtype.Int8{Int64: *in.DefaultMonthlyTokenQuota, Valid: true}
	}
	if v := in.Voice; v != nil {
		if p.VoiceBaseUrl, err = text(v.BaseURL, 500, "voice.base_url"); err != nil {
			return Settings{}, err
		}
		if p.VoiceBaseUrl.Valid && !validURL(p.VoiceBaseUrl.String) {
			return Settings{}, invalid("voice.base_url must be an http(s) URL")
		}
		if p.VoiceSttModel, err = text(v.STTModel, 128, "voice.stt_model"); err != nil {
			return Settings{}, err
		}
		if p.VoiceTtsVoice, err = text(v.TTSVoice, 128, "voice.tts_voice"); err != nil {
			return Settings{}, err
		}
		if p.VoiceLanguage, err = text(v.Language, 16, "voice.language"); err != nil {
			return Settings{}, err
		}
	}
	// Chat cannot be switched on without a usable provider configuration.
	next := current
	if p.Provider.Valid {
		next.Provider = p.Provider.String
	}
	if p.BaseUrl.Valid {
		next.BaseUrl = p.BaseUrl.String
	}
	if p.Model.Valid {
		next.Model = p.Model.String
	}
	if in.ClearAPIKey {
		next.ApiKeyEnc = pgtype.Text{}
	} else if p.ApiKeyEnc.Valid {
		next.ApiKeyEnc = p.ApiKeyEnc
	}
	chatOn := current.ChatEnabled
	if p.ChatEnabled.Valid {
		chatOn = p.ChatEnabled.Bool
	}
	if chatOn && !isConfigured(next) {
		if next.Provider == provider.KindOpenAICompatible {
			return Settings{}, invalid("base_url and model are required to enable chat")
		}
		return Settings{}, invalid("an API key and model are required to enable chat")
	}
	row, err := s.store.UpdateAISettings(ctx, p)
	if err != nil {
		return Settings{}, err
	}
	return s.mapSettings(row), nil
}

func (s *Service) providerFor(row db.AiSetting) (provider.Provider, error) {
	if !isConfigured(row) {
		return nil, ErrNotConfigured
	}
	cfg := provider.Config{Kind: row.Provider, BaseURL: row.BaseUrl}
	if row.ApiKeyEnc.Valid && row.ApiKeyEnc.String != "" {
		if s.box == nil {
			return nil, ErrNotConfigured
		}
		key, err := s.box.Decrypt(row.ApiKeyEnc.String)
		if err != nil {
			return nil, fmt.Errorf("decrypt api key: %w", err)
		}
		cfg.APIKey = key
	}
	if row.Provider == provider.KindAnthropic {
		// The Anthropic base URL is only overridable for proxies/gateways.
		cfg.BaseURL = strings.TrimSpace(row.BaseUrl)
	}
	p, err := s.newProvider(cfg)
	if errors.Is(err, provider.ErrNotConfigured) {
		return nil, ErrNotConfigured
	}
	return p, err
}

// TestConnection sends a tiny request with the saved settings.
func (s *Service) TestConnection(ctx context.Context) (TestResult, error) {
	row, err := s.store.GetAISettings(ctx)
	if err != nil {
		return TestResult{}, err
	}
	res := TestResult{Provider: row.Provider, Model: row.Model}
	prov, err := s.providerFor(row)
	if err != nil {
		res.Message = err.Error()
		return res, nil
	}
	ctx, cancel := context.WithTimeout(ctx, 45*time.Second)
	defer cancel()
	started := s.now()
	resp, err := prov.Complete(ctx, provider.Request{
		Model:     row.Model,
		MaxTokens: 256,
		Effort:    "low",
		Messages: []provider.Message{{Role: provider.RoleUser, Content: []provider.Block{
			provider.TextBlock("Bağlantı testi. Yalnızca \"OK\" yaz."),
		}}},
	})
	res.LatencyMS = s.now().Sub(started).Milliseconds()
	if err != nil {
		res.Message = err.Error()
		return res, nil
	}
	s.recordUsage(context.WithoutCancel(ctx), nil, nil, nil, row.Provider, firstNonEmpty(resp.Model, row.Model), "test", resp.Usage)
	res.OK = true
	res.Reply = tools.Truncate(resp.Message.Text(), 120)
	return res, nil
}

// ------------------------------------------------------------------ quota

// monthBounds returns [start, end) of the month containing t in the service TZ.
func (s *Service) monthBounds(t time.Time) (time.Time, time.Time) {
	lt := t.In(s.loc)
	start := time.Date(lt.Year(), lt.Month(), 1, 0, 0, 0, 0, s.loc)
	return start, start.AddDate(0, 1, 0)
}

func (s *Service) orgOverride(ctx context.Context, orgID int64) (enabled bool, quota *int64, err error) {
	row, err := s.store.GetAIOrganizationSettings(ctx, orgID)
	if errors.Is(err, pgx.ErrNoRows) {
		return true, nil, nil
	}
	if err != nil {
		return false, nil, err
	}
	if row.MonthlyTokenQuota.Valid {
		q := row.MonthlyTokenQuota.Int64
		quota = &q
	}
	return row.Enabled, quota, nil
}

func (s *Service) quotaFor(ctx context.Context, settings db.AiSetting, orgID int64, override *int64) (Quota, error) {
	start, end := s.monthBounds(s.now())
	limit := settings.DefaultMonthlyTokenQuota
	if override != nil {
		limit = *override
	}
	used, err := s.store.SumAIOrganizationTokensSince(ctx, db.SumAIOrganizationTokensSinceParams{
		OrganizationID: pgtype.Int8{Int64: orgID, Valid: true},
		Since:          pgtype.Timestamptz{Time: start, Valid: true},
	})
	if err != nil {
		return Quota{}, err
	}
	q := Quota{Limit: limit, Used: used, Unlimited: limit == 0, PeriodStart: start, PeriodEnd: end}
	if !q.Unlimited {
		q.Remaining = limit - used
		if q.Remaining < 0 {
			q.Remaining = 0
		}
	}
	return q, nil
}

func (q Quota) exceeded() bool { return !q.Unlimited && q.Used >= q.Limit }

func (s *Service) recordUsage(ctx context.Context, orgID, userID, convID *int64, prov, model, purpose string, u provider.Usage) {
	i8 := func(v *int64) pgtype.Int8 {
		if v == nil {
			return pgtype.Int8{}
		}
		return pgtype.Int8{Int64: *v, Valid: true}
	}
	if err := s.store.InsertAIUsage(ctx, db.InsertAIUsageParams{
		OrganizationID: i8(orgID), UserID: i8(userID), ConversationID: i8(convID),
		Provider: prov, Model: tools.Truncate(model, 128), Purpose: purpose,
		InputTokens: u.InputTokens, OutputTokens: u.OutputTokens,
		CacheReadTokens: u.CacheReadTokens, CacheWriteTokens: u.CacheWriteTokens,
	}); err != nil {
		s.log.Warn("ai_usage_record_failed", "error", err)
	}
}

// ------------------------------------------------------------------ status

func principalScope(ctx context.Context) (authctx.Principal, orgctx.Scope, error) {
	p, ok := authctx.PrincipalFrom(ctx)
	if !ok {
		return authctx.Principal{}, orgctx.Scope{}, ErrNoContext
	}
	scope, ok := orgctx.ScopeFrom(ctx)
	if !ok || scope.InternalID <= 0 {
		return authctx.Principal{}, orgctx.Scope{}, ErrNoContext
	}
	return p, scope, nil
}

func featuresOf(row db.AiSetting) Features {
	return Features{
		Chat:    row.ChatEnabled,
		Actions: row.ActionsEnabled,
		Charts:  row.ChartsEnabled,
		Voice:   row.VoiceEnabled && strings.TrimSpace(row.VoiceBaseUrl) != "",
		Todos:   row.TodosEnabled,
	}
}

func (s *Service) gate(row db.AiSetting) tools.Gate {
	enabled := s.toolEnabledMap(row)
	f := featuresOf(row)
	return tools.Gate{
		FeatureEnabled: func(feat tools.Feature) bool {
			switch feat {
			case tools.FeatureChat:
				return f.Chat
			case tools.FeatureCharts:
				return f.Chat && f.Charts
			case tools.FeatureActions:
				return f.Chat && f.Actions
			case tools.FeatureTodos:
				return f.Chat && f.Todos
			}
			return false
		},
		ToolEnabled: func(name string) bool {
			on, ok := enabled[name]
			return !ok || on
		},
	}
}

// availability checks platform + org switches and quota.
func (s *Service) availability(ctx context.Context, row db.AiSetting, orgID int64) (Quota, error) {
	enabled, override, err := s.orgOverride(ctx, orgID)
	if err != nil {
		return Quota{}, err
	}
	q, err := s.quotaFor(ctx, row, orgID, override)
	if err != nil {
		return Quota{}, err
	}
	switch {
	case !row.ChatEnabled:
		return q, ErrDisabled
	case !isConfigured(row):
		return q, ErrNotConfigured
	case !enabled:
		return q, ErrOrgDisabled
	case q.exceeded():
		return q, ErrQuotaExceeded
	}
	return q, nil
}

// Status reports whether the assistant is usable for the current user/org.
func (s *Service) Status(ctx context.Context) (Status, error) {
	p, scope, err := principalScope(ctx)
	if err != nil {
		return Status{}, err
	}
	row, err := s.store.GetAISettings(ctx)
	if err != nil {
		return Status{}, err
	}
	q, availErr := s.availability(ctx, row, scope.InternalID)
	st := Status{Features: featuresOf(row), Quota: q, Provider: row.Provider, Model: row.Model, Tools: []string{}}
	switch {
	case availErr == nil:
		st.Available = true
	case errors.Is(availErr, ErrDisabled):
		st.Reason = "disabled"
	case errors.Is(availErr, ErrNotConfigured):
		st.Reason = "not_configured"
	case errors.Is(availErr, ErrOrgDisabled):
		st.Reason = "org_disabled"
	case errors.Is(availErr, ErrQuotaExceeded):
		st.Reason = "quota_exceeded"
	default:
		return Status{}, availErr
	}
	for _, t := range s.registry.Available(p, scope, s.gate(row)) {
		st.Tools = append(st.Tools, t.Spec().Name)
	}
	return st, nil
}

// ------------------------------------------------------------------ org overrides

// OrgSettings returns the override for an organization.
func (s *Service) OrgSettings(ctx context.Context, orgUUID uuid.UUID) (OrgSettings, error) {
	org, err := s.store.GetAIOrganizationByUUID(ctx, orgUUID)
	if errors.Is(err, pgx.ErrNoRows) {
		return OrgSettings{}, ErrNotFound
	}
	if err != nil {
		return OrgSettings{}, err
	}
	row, err := s.store.GetAISettings(ctx)
	if err != nil {
		return OrgSettings{}, err
	}
	enabled, override, err := s.orgOverride(ctx, org.ID)
	if err != nil {
		return OrgSettings{}, err
	}
	q, err := s.quotaFor(ctx, row, org.ID, override)
	if err != nil {
		return OrgSettings{}, err
	}
	return OrgSettings{
		OrganizationUUID: org.Uuid, OrganizationName: org.Name, Enabled: enabled,
		MonthlyTokenQuota: override, DefaultQuota: row.DefaultMonthlyTokenQuota, Quota: q,
	}, nil
}

// PutOrgSettings replaces the override for an organization.
func (s *Service) PutOrgSettings(ctx context.Context, orgUUID uuid.UUID, in PutOrgSettingsInput) (OrgSettings, error) {
	if in.MonthlyTokenQuota != nil && *in.MonthlyTokenQuota < 0 {
		return OrgSettings{}, invalid("monthly_token_quota must be >= 0")
	}
	org, err := s.store.GetAIOrganizationByUUID(ctx, orgUUID)
	if errors.Is(err, pgx.ErrNoRows) {
		return OrgSettings{}, ErrNotFound
	}
	if err != nil {
		return OrgSettings{}, err
	}
	params := db.UpsertAIOrganizationSettingsParams{OrganizationID: org.ID, Enabled: in.Enabled}
	if in.MonthlyTokenQuota != nil {
		params.MonthlyTokenQuota = pgtype.Int8{Int64: *in.MonthlyTokenQuota, Valid: true}
	}
	if _, err := s.store.UpsertAIOrganizationSettings(ctx, params); err != nil {
		return OrgSettings{}, err
	}
	return s.OrgSettings(ctx, orgUUID)
}

// ------------------------------------------------------------------ usage report

// Usage returns per-organization usage for a month ("YYYY-MM"; empty = current).
func (s *Service) Usage(ctx context.Context, month string) (UsageSummary, error) {
	ref := s.now()
	if m := strings.TrimSpace(month); m != "" {
		t, err := time.ParseInLocation("2006-01", m, s.loc)
		if err != nil {
			return UsageSummary{}, invalid("month must be YYYY-MM")
		}
		ref = t
	}
	start, end := s.monthBounds(ref)
	rows, err := s.store.ListAIUsageByOrganization(ctx, db.ListAIUsageByOrganizationParams{
		DateFrom: pgtype.Timestamptz{Time: start, Valid: true},
		DateTo:   pgtype.Timestamptz{Time: end, Valid: true},
	})
	if err != nil {
		return UsageSummary{}, err
	}
	settings, err := s.store.GetAISettings(ctx)
	if err != nil {
		return UsageSummary{}, err
	}
	byOrg := map[uuid.UUID]*UsageOrgRow{}
	var order []uuid.UUID
	for _, r := range rows {
		item, ok := byOrg[r.OrganizationUuid]
		if !ok {
			item = &UsageOrgRow{
				OrganizationUUID: r.OrganizationUuid, OrganizationName: r.OrganizationName, OrganizationSlug: r.OrganizationSlug,
				Enabled: true, QuotaLimit: settings.DefaultMonthlyTokenQuota,
			}
			byOrg[r.OrganizationUuid] = item
			order = append(order, r.OrganizationUuid)
		}
		u := provider.Usage{InputTokens: r.InputTokens, OutputTokens: r.OutputTokens, CacheReadTokens: r.CacheReadTokens, CacheWriteTokens: r.CacheWriteTokens}
		cost, known := EstimateCostUSD(r.Model, u)
		mr := UsageModelRow{
			Model: r.Model, InputTokens: r.InputTokens, OutputTokens: r.OutputTokens,
			CacheReadTokens: r.CacheReadTokens, CacheWriteTokens: r.CacheWriteTokens, RequestCount: r.RequestCount,
		}
		if known {
			c := cost
			mr.EstimatedCostUSD = &c
			item.EstimatedCostUSD += cost
		}
		item.Models = append(item.Models, mr)
		item.InputTokens += r.InputTokens
		item.OutputTokens += r.OutputTokens
		item.CacheReadTokens += r.CacheReadTokens
		item.CacheWriteTokens += r.CacheWriteTokens
		item.QuotaTokens += u.QuotaTokens()
		item.RequestCount += r.RequestCount
	}
	if len(order) > 0 {
		overrides, err := s.store.ListAIOrganizationSettingsByOrgIDs(ctx, order)
		if err != nil {
			return UsageSummary{}, err
		}
		for _, o := range overrides {
			if item, ok := byOrg[o.OrganizationUuid]; ok {
				item.Enabled = o.Enabled
				if o.MonthlyTokenQuota.Valid {
					item.QuotaLimit = o.MonthlyTokenQuota.Int64
				}
			}
		}
	}
	out := UsageSummary{Month: start.Format("2006-01"), PeriodStart: start, PeriodEnd: end, Items: []UsageOrgRow{}}
	for _, id := range order {
		item := byOrg[id]
		item.EstimatedCostUSD = roundCost(item.EstimatedCostUSD)
		out.Items = append(out.Items, *item)
		out.TotalTokens += item.QuotaTokens
		out.EstimatedCostUSD += item.EstimatedCostUSD
	}
	sort.SliceStable(out.Items, func(i, j int) bool { return out.Items[i].QuotaTokens > out.Items[j].QuotaTokens })
	out.EstimatedCostUSD = roundCost(out.EstimatedCostUSD)
	return out, nil
}

func firstNonEmpty(vals ...string) string {
	for _, v := range vals {
		if strings.TrimSpace(v) != "" {
			return v
		}
	}
	return ""
}
