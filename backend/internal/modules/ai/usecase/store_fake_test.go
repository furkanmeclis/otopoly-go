package usecase

import (
	"context"
	"errors"
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
	actions   []db.AiPendingAction
	clock     func() time.Time
}

func (m *memStore) nowT() time.Time {
	if m.clock != nil {
		return m.clock()
	}
	return time.Now()
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

func (m *memStore) GetAIMessageByID(_ context.Context, id int64) (db.AiMessage, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, msg := range m.messages {
		if msg.ID == id {
			return msg, nil
		}
	}
	return db.AiMessage{}, pgx.ErrNoRows
}

func (m *memStore) UpdateAIMessageContentUI(_ context.Context, p db.UpdateAIMessageContentUIParams) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	for i := range m.messages {
		if m.messages[i].ID == p.ID {
			m.messages[i].Content, m.messages[i].Ui = p.Content, p.Ui
		}
	}
	return nil
}

func (m *memStore) InsertAIPendingAction(_ context.Context, p db.InsertAIPendingActionParams) (db.AiPendingAction, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, a := range m.actions {
		if a.IdempotencyKey == p.IdempotencyKey {
			return db.AiPendingAction{}, errors.New("duplicate idempotency key")
		}
	}
	a := db.AiPendingAction{
		ID: m.id(), Uuid: uuid.New(), OrganizationID: p.OrganizationID, UserID: p.UserID, ConversationID: p.ConversationID,
		ToolUseID: p.ToolUseID, ToolName: p.ToolName, Input: p.Input, Preview: p.Preview, Status: "pending",
		IdempotencyKey: p.IdempotencyKey, ExpiresAt: p.ExpiresAt,
	}
	m.actions = append(m.actions, a)
	return a, nil
}

func (m *memStore) GetAIPendingActionForUser(_ context.Context, p db.GetAIPendingActionForUserParams) (db.GetAIPendingActionForUserRow, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, a := range m.actions {
		if a.Uuid == p.Uuid && a.OrganizationID == p.OrganizationID && a.UserID == p.UserID {
			var convUUID uuid.UUID
			for _, c := range m.convs {
				if c.ID == a.ConversationID {
					convUUID = c.Uuid
				}
			}
			return db.GetAIPendingActionForUserRow{
				ID: a.ID, Uuid: a.Uuid, OrganizationID: a.OrganizationID, UserID: a.UserID, ConversationID: a.ConversationID,
				MessageID: a.MessageID, ToolUseID: a.ToolUseID, ToolName: a.ToolName, Input: a.Input, Preview: a.Preview,
				Status: a.Status, Result: a.Result, Error: a.Error, IdempotencyKey: a.IdempotencyKey, ExpiresAt: a.ExpiresAt,
				ConversationUuid: convUUID,
			}, nil
		}
	}
	return db.GetAIPendingActionForUserRow{}, pgx.ErrNoRows
}

func (m *memStore) AttachAIPendingActionsToMessage(_ context.Context, p db.AttachAIPendingActionsToMessageParams) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	for i := range m.actions {
		if m.actions[i].ConversationID == p.ConversationID && !m.actions[i].MessageID.Valid {
			m.actions[i].MessageID = p.MessageID
		}
	}
	return nil
}

func (m *memStore) ClaimAIPendingAction(_ context.Context, p db.ClaimAIPendingActionParams) (db.AiPendingAction, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	for i := range m.actions {
		a := &m.actions[i]
		if a.ID == p.ID && a.Status == "pending" && a.MessageID.Valid && a.ExpiresAt.Time.After(m.nowT()) {
			a.Status, a.Input, a.Preview = "executing", p.Input, p.Preview
			return *a, nil
		}
	}
	return db.AiPendingAction{}, pgx.ErrNoRows
}

func (m *memStore) FinishAIPendingAction(_ context.Context, p db.FinishAIPendingActionParams) (db.AiPendingAction, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	for i := range m.actions {
		a := &m.actions[i]
		if a.ID == p.ID {
			a.Status, a.Result, a.Error = p.Status, p.Result, p.Error
			return *a, nil
		}
	}
	return db.AiPendingAction{}, pgx.ErrNoRows
}

func (m *memStore) CancelAIPendingAction(_ context.Context, id int64) (db.AiPendingAction, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	for i := range m.actions {
		a := &m.actions[i]
		if a.ID == id && a.Status == "pending" {
			a.Status = "cancelled"
			return *a, nil
		}
	}
	return db.AiPendingAction{}, pgx.ErrNoRows
}

func (m *memStore) ExpireAIPendingActions(_ context.Context, p db.ExpireAIPendingActionsParams) ([]db.AiPendingAction, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	var out []db.AiPendingAction
	for i := range m.actions {
		a := &m.actions[i]
		if a.ConversationID == p.ConversationID && a.Status == "pending" && (p.AllPending || !a.ExpiresAt.Time.After(m.nowT())) {
			a.Status = "expired"
			out = append(out, *a)
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
