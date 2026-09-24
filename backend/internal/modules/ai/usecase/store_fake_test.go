package usecase

import (
	"context"
	"sync"
	"time"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database/db"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

// memStore is an in-memory Store for tests.
type memStore struct {
	mu        sync.Mutex
	settings  db.AiSetting
	orgs      map[int64]db.AiOrganizationSetting
	convs     []db.AiConversation
	messages  []db.AiMessage
	usage     []db.InsertAIUsageParams
	usedExtra int64 // pre-existing monthly tokens
	nextID    int64
}

func newMemStore() *memStore {
	return &memStore{
		settings: db.AiSetting{
			ID: 1, Provider: "anthropic", ApiKeyEnc: pgtype.Text{String: "enc:sk-test-key-1234", Valid: true},
			Model: "claude-opus-5", TitleModel: "claude-haiku-4-5", Effort: "medium", MaxTokens: 4000,
			ChatEnabled: true, ChartsEnabled: true, ToolSettings: []byte(`{}`), DefaultMonthlyTokenQuota: 1_000_000,
			VoiceLanguage: "tr",
		},
		orgs: map[int64]db.AiOrganizationSetting{},
	}
}

func (m *memStore) id() int64 { m.nextID++; return m.nextID }

func (m *memStore) GetAISettings(context.Context) (db.AiSetting, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.settings, nil
}

func (m *memStore) UpdateAISettings(_ context.Context, p db.UpdateAISettingsParams) (db.AiSetting, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	s := &m.settings
	if p.Provider.Valid {
		s.Provider = p.Provider.String
	}
	if p.ClearApiKey {
		s.ApiKeyEnc = pgtype.Text{}
	} else if p.ApiKeyEnc.Valid {
		s.ApiKeyEnc = p.ApiKeyEnc
	}
	if p.BaseUrl.Valid {
		s.BaseUrl = p.BaseUrl.String
	}
	if p.Model.Valid {
		s.Model = p.Model.String
	}
	if p.Effort.Valid {
		s.Effort = p.Effort.String
	}
	if p.MaxTokens.Valid {
		s.MaxTokens = p.MaxTokens.Int32
	}
	if p.ChatEnabled.Valid {
		s.ChatEnabled = p.ChatEnabled.Bool
	}
	if p.ChartsEnabled.Valid {
		s.ChartsEnabled = p.ChartsEnabled.Bool
	}
	if p.ToolSettings != nil {
		s.ToolSettings = p.ToolSettings
	}
	if p.DefaultMonthlyTokenQuota.Valid {
		s.DefaultMonthlyTokenQuota = p.DefaultMonthlyTokenQuota.Int64
	}
	return *s, nil
}

func (m *memStore) GetAIOrganizationSettings(_ context.Context, orgID int64) (db.AiOrganizationSetting, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	row, ok := m.orgs[orgID]
	if !ok {
		return db.AiOrganizationSetting{}, pgx.ErrNoRows
	}
	return row, nil
}

func (m *memStore) UpsertAIOrganizationSettings(_ context.Context, p db.UpsertAIOrganizationSettingsParams) (db.AiOrganizationSetting, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	row := db.AiOrganizationSetting{OrganizationID: p.OrganizationID, Enabled: p.Enabled, MonthlyTokenQuota: p.MonthlyTokenQuota}
	m.orgs[p.OrganizationID] = row
	return row, nil
}

func (m *memStore) ListAIOrganizationSettingsByOrgIDs(context.Context, []uuid.UUID) ([]db.ListAIOrganizationSettingsByOrgIDsRow, error) {
	return nil, nil
}

func (m *memStore) SumAIOrganizationTokensSince(_ context.Context, p db.SumAIOrganizationTokensSinceParams) (int64, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	total := m.usedExtra
	for _, u := range m.usage {
		if u.OrganizationID == p.OrganizationID {
			total += u.InputTokens + u.OutputTokens + u.CacheWriteTokens
		}
	}
	return total, nil
}

func (m *memStore) InsertAIUsage(_ context.Context, p db.InsertAIUsageParams) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.usage = append(m.usage, p)
	return nil
}

func (m *memStore) ListAIUsageByOrganization(context.Context, db.ListAIUsageByOrganizationParams) ([]db.ListAIUsageByOrganizationRow, error) {
	return nil, nil
}

func (m *memStore) GetAIUserDisplay(context.Context, int64) (db.GetAIUserDisplayRow, error) {
	return db.GetAIUserDisplayRow{Name: "Ayşe", Surname: "Yılmaz"}, nil
}

func (m *memStore) GetAIOrganizationByUUID(_ context.Context, id uuid.UUID) (db.GetAIOrganizationByUUIDRow, error) {
	return db.GetAIOrganizationByUUIDRow{ID: 7, Uuid: id, Slug: "demo", Name: "Demo Oto Yıkama"}, nil
}

func (m *memStore) CreateAIConversation(_ context.Context, p db.CreateAIConversationParams) (db.AiConversation, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	c := db.AiConversation{
		ID: m.id(), Uuid: uuid.New(), OrganizationID: p.OrganizationID, UserID: p.UserID, Title: p.Title,
		CreatedAt: pgtype.Timestamptz{Time: time.Now(), Valid: true},
	}
	m.convs = append(m.convs, c)
	return c, nil
}

func (m *memStore) GetAIConversation(_ context.Context, p db.GetAIConversationParams) (db.AiConversation, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, c := range m.convs {
		if c.Uuid == p.Uuid && c.OrganizationID == p.OrganizationID && c.UserID == p.UserID && !c.DeletedAt.Valid {
			return c, nil
		}
	}
	return db.AiConversation{}, pgx.ErrNoRows
}

func (m *memStore) ListAIConversations(context.Context, db.ListAIConversationsParams) ([]db.AiConversation, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	return append([]db.AiConversation(nil), m.convs...), nil
}

func (m *memStore) CountAIConversations(context.Context, db.CountAIConversationsParams) (int64, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	return int64(len(m.convs)), nil
}

func (m *memStore) UpdateAIConversationTitle(_ context.Context, p db.UpdateAIConversationTitleParams) (db.AiConversation, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	for i := range m.convs {
		if m.convs[i].ID == p.ID {
			m.convs[i].Title = p.Title
			return m.convs[i], nil
		}
	}
	return db.AiConversation{}, pgx.ErrNoRows
}

func (m *memStore) TouchAIConversation(_ context.Context, p db.TouchAIConversationParams) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	for i := range m.convs {
		if m.convs[i].ID == p.ID {
			m.convs[i].MessageCount += p.Added
		}
	}
	return nil
}

func (m *memStore) SoftDeleteAIConversation(_ context.Context, id int64) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	for i := range m.convs {
		if m.convs[i].ID == id {
			m.convs[i].DeletedAt = pgtype.Timestamptz{Time: time.Now(), Valid: true}
		}
	}
	return nil
}

func (m *memStore) InsertAIMessage(_ context.Context, p db.InsertAIMessageParams) (db.AiMessage, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	msg := db.AiMessage{
		ID: m.id(), Uuid: uuid.New(), ConversationID: p.ConversationID, OrganizationID: p.OrganizationID,
		Role: p.Role, Status: p.Status, Content: p.Content, Ui: p.Ui, Model: p.Model,
		InputTokens: p.InputTokens, OutputTokens: p.OutputTokens,
		CreatedAt: pgtype.Timestamptz{Time: time.Now(), Valid: true},
	}
	m.messages = append(m.messages, msg)
	return msg, nil
}

func (m *memStore) ListAIMessages(_ context.Context, convID int64) ([]db.AiMessage, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	var out []db.AiMessage
	for _, msg := range m.messages {
		if msg.ConversationID == convID {
			out = append(out, msg)
		}
	}
	return out, nil
}

// fakeBox is a reversible "encryption" for tests.
type fakeBox struct{}

func (fakeBox) Encrypt(s string) (string, error) { return "enc:" + s, nil }
func (fakeBox) Decrypt(s string) (string, error) {
	if len(s) > 4 && s[:4] == "enc:" {
		return s[4:], nil
	}
	return s, nil
}
