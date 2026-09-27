package usecase

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database/db"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/ai/tools"
	"github.com/google/uuid"
)

// Errors surfaced to handlers (mapped to stable error codes).
var (
	ErrInvalidRequest = errors.New("invalid request")
	ErrNotFound       = errors.New("not found")
	ErrDisabled       = errors.New("ai assistant is disabled")
	ErrNotConfigured  = errors.New("ai provider is not configured")
	ErrOrgDisabled    = errors.New("ai assistant is disabled for this organization")
	ErrQuotaExceeded  = errors.New("monthly ai token quota exceeded")
	ErrNoContext      = errors.New("organization context required")
	// ErrConversationLimit: too many conversations, or one conversation too long.
	ErrConversationLimit = errors.New("conversation limit reached")
)

// Per-user caps (abuse and cost guards; history is trimmed for the model anyway).
const (
	// MaxConversationsPerUser caps a user's live conversations per organization.
	MaxConversationsPerUser = 500
	// MaxMessagesPerConversation caps stored messages (user + assistant) per conversation.
	MaxMessagesPerConversation = 400
)

// Store is the persistence port (satisfied by *db.Queries).
type Store interface {
	GetAISettings(ctx context.Context) (db.AiSetting, error)
	UpdateAISettings(ctx context.Context, arg db.UpdateAISettingsParams) (db.AiSetting, error)
	GetAIOrganizationSettings(ctx context.Context, organizationID int64) (db.AiOrganizationSetting, error)
	UpsertAIOrganizationSettings(ctx context.Context, arg db.UpsertAIOrganizationSettingsParams) (db.AiOrganizationSetting, error)
	ListAIOrganizationSettingsByOrgIDs(ctx context.Context, organizationUuids []uuid.UUID) ([]db.ListAIOrganizationSettingsByOrgIDsRow, error)
	SumAIOrganizationTokensSince(ctx context.Context, arg db.SumAIOrganizationTokensSinceParams) (int64, error)
	InsertAIUsage(ctx context.Context, arg db.InsertAIUsageParams) error
	ListAIUsageByOrganization(ctx context.Context, arg db.ListAIUsageByOrganizationParams) ([]db.ListAIUsageByOrganizationRow, error)
	GetAIUserDisplay(ctx context.Context, id int64) (db.GetAIUserDisplayRow, error)
	GetAIOrganizationByUUID(ctx context.Context, argUuid uuid.UUID) (db.GetAIOrganizationByUUIDRow, error)
	CreateAIConversation(ctx context.Context, arg db.CreateAIConversationParams) (db.AiConversation, error)
	GetAIConversation(ctx context.Context, arg db.GetAIConversationParams) (db.AiConversation, error)
	ListAIConversations(ctx context.Context, arg db.ListAIConversationsParams) ([]db.AiConversation, error)
	CountAIConversations(ctx context.Context, arg db.CountAIConversationsParams) (int64, error)
	UpdateAIConversationTitle(ctx context.Context, arg db.UpdateAIConversationTitleParams) (db.AiConversation, error)
	TouchAIConversation(ctx context.Context, arg db.TouchAIConversationParams) error
	SoftDeleteAIConversation(ctx context.Context, id int64) error
	InsertAIMessage(ctx context.Context, arg db.InsertAIMessageParams) (db.AiMessage, error)
	ListAIMessages(ctx context.Context, conversationID int64) ([]db.AiMessage, error)
	GetAIMessageByID(ctx context.Context, id int64) (db.AiMessage, error)
	UpdateAIMessageContentUI(ctx context.Context, arg db.UpdateAIMessageContentUIParams) error
	InsertAIPendingAction(ctx context.Context, arg db.InsertAIPendingActionParams) (db.AiPendingAction, error)
	GetAIPendingActionForUser(ctx context.Context, arg db.GetAIPendingActionForUserParams) (db.GetAIPendingActionForUserRow, error)
	AttachAIPendingActionsToMessage(ctx context.Context, arg db.AttachAIPendingActionsToMessageParams) error
	ClaimAIPendingAction(ctx context.Context, arg db.ClaimAIPendingActionParams) (db.AiPendingAction, error)
	FinishAIPendingAction(ctx context.Context, arg db.FinishAIPendingActionParams) (db.AiPendingAction, error)
	CancelAIPendingAction(ctx context.Context, id int64) (db.AiPendingAction, error)
	ExpireAIPendingActions(ctx context.Context, arg db.ExpireAIPendingActionsParams) ([]db.AiPendingAction, error)
	FailStaleAIPendingActions(ctx context.Context, arg db.FailStaleAIPendingActionsParams) ([]db.AiPendingAction, error)
}

// Encrypter encrypts the provider API key at rest (crypto.SecretBox).
type Encrypter interface {
	Encrypt(plaintext string) (string, error)
	Decrypt(ciphertext string) (string, error)
}

// Features are the platform feature toggles.
type Features struct {
	Chat    bool `json:"chat"`
	Actions bool `json:"actions"`
	Charts  bool `json:"charts"`
	Voice   bool `json:"voice"`
	Todos   bool `json:"todos"`
}

// VoiceSettings are stored now and consumed by Phase 3 (Speaches STT/TTS).
type VoiceSettings struct {
	BaseURL        string `json:"base_url"`
	DefaultBaseURL string `json:"default_base_url"`
	STTModel       string `json:"stt_model"`
	TTSVoice       string `json:"tts_voice"`
	Language       string `json:"language"`
}

// ToolInfo describes a tool for the admin toggle list.
type ToolInfo struct {
	Name                 string   `json:"name"`
	Kind                 string   `json:"kind"`
	Feature              string   `json:"feature"`
	Permissions          []string `json:"permissions"`
	RequiresConfirmation bool     `json:"requires_confirmation"`
	Enabled              bool     `json:"enabled"`
}

// Settings is the platform admin payload (the API key is never returned).
type Settings struct {
	Provider                 string        `json:"provider"`
	HasAPIKey                bool          `json:"has_api_key"`
	APIKeyHint               string        `json:"api_key_hint,omitempty"`
	BaseURL                  string        `json:"base_url"`
	Model                    string        `json:"model"`
	TitleModel               string        `json:"title_model"`
	Effort                   string        `json:"effort"`
	MaxTokens                int           `json:"max_tokens"`
	Features                 Features      `json:"features"`
	Tools                    []ToolInfo    `json:"tools"`
	ExtraInstructions        string        `json:"extra_instructions"`
	DefaultMonthlyTokenQuota int64         `json:"default_monthly_token_quota"`
	Voice                    VoiceSettings `json:"voice"`
	Configured               bool          `json:"configured"`
	UpdatedAt                time.Time     `json:"updated_at"`
}

// PatchSettingsInput is a partial settings update. APIKey sets/replaces the
// key; ClearAPIKey removes it.
type PatchSettingsInput struct {
	Provider                 *string         `json:"provider"`
	APIKey                   *string         `json:"api_key"`
	ClearAPIKey              bool            `json:"clear_api_key"`
	BaseURL                  *string         `json:"base_url"`
	Model                    *string         `json:"model"`
	TitleModel               *string         `json:"title_model"`
	Effort                   *string         `json:"effort"`
	MaxTokens                *int            `json:"max_tokens"`
	Features                 *FeaturesPatch  `json:"features"`
	Tools                    map[string]bool `json:"tools"`
	ExtraInstructions        *string         `json:"extra_instructions"`
	DefaultMonthlyTokenQuota *int64          `json:"default_monthly_token_quota"`
	Voice                    *VoicePatch     `json:"voice"`
}

// FeaturesPatch is a partial feature toggle update.
type FeaturesPatch struct {
	Chat    *bool `json:"chat"`
	Actions *bool `json:"actions"`
	Charts  *bool `json:"charts"`
	Voice   *bool `json:"voice"`
	Todos   *bool `json:"todos"`
}

// VoicePatch is a partial voice settings update.
type VoicePatch struct {
	BaseURL  *string `json:"base_url"`
	STTModel *string `json:"stt_model"`
	TTSVoice *string `json:"tts_voice"`
	Language *string `json:"language"`
}

// TestResult is the outcome of a connection test.
type TestResult struct {
	OK        bool   `json:"ok"`
	Provider  string `json:"provider"`
	Model     string `json:"model"`
	LatencyMS int64  `json:"latency_ms"`
	Message   string `json:"message,omitempty"`
	Reply     string `json:"reply,omitempty"`
}

// Quota describes monthly token usage for an organization.
type Quota struct {
	Limit       int64     `json:"limit"`
	Used        int64     `json:"used"`
	Remaining   int64     `json:"remaining"`
	Unlimited   bool      `json:"unlimited"`
	PeriodStart time.Time `json:"period_start"`
	PeriodEnd   time.Time `json:"period_end"`
}

// Status tells the tenant UI whether the assistant can be used.
type Status struct {
	Available bool     `json:"available"`
	Reason    string   `json:"reason,omitempty"`
	Features  Features `json:"features"`
	Quota     Quota    `json:"quota"`
	Provider  string   `json:"provider"`
	Model     string   `json:"model"`
	Tools     []string `json:"tools"`
}

// OrgSettings is the per-organization override payload.
type OrgSettings struct {
	OrganizationUUID  uuid.UUID `json:"organization_uuid"`
	OrganizationName  string    `json:"organization_name"`
	Enabled           bool      `json:"enabled"`
	MonthlyTokenQuota *int64    `json:"monthly_token_quota"`
	DefaultQuota      int64     `json:"default_quota"`
	Quota             Quota     `json:"quota"`
}

// PutOrgSettingsInput replaces the per-organization override.
type PutOrgSettingsInput struct {
	Enabled           bool   `json:"enabled"`
	MonthlyTokenQuota *int64 `json:"monthly_token_quota"`
}

// UsageModelRow is usage for one model within an organization. Kind is
// "chat" (model tokens) or "voice" (Speaches STT seconds / TTS characters).
type UsageModelRow struct {
	Model            string   `json:"model"`
	Kind             string   `json:"kind"`
	InputTokens      int64    `json:"input_tokens"`
	OutputTokens     int64    `json:"output_tokens"`
	CacheReadTokens  int64    `json:"cache_read_tokens"`
	CacheWriteTokens int64    `json:"cache_write_tokens"`
	AudioSeconds     float64  `json:"audio_seconds"`
	Characters       int64    `json:"characters"`
	RequestCount     int64    `json:"request_count"`
	EstimatedCostUSD *float64 `json:"estimated_cost_usd"`
}

// UsageOrgRow aggregates usage per organization.
type UsageOrgRow struct {
	OrganizationUUID uuid.UUID `json:"organization_uuid"`
	OrganizationName string    `json:"organization_name"`
	OrganizationSlug string    `json:"organization_slug"`
	InputTokens      int64     `json:"input_tokens"`
	OutputTokens     int64     `json:"output_tokens"`
	CacheReadTokens  int64     `json:"cache_read_tokens"`
	CacheWriteTokens int64     `json:"cache_write_tokens"`
	QuotaTokens      int64     `json:"quota_tokens"`
	RequestCount     int64     `json:"request_count"`
	// Voice (Speaches): transcribed audio seconds and synthesized characters.
	STTSeconds       float64         `json:"stt_seconds"`
	TTSCharacters    int64           `json:"tts_characters"`
	VoiceRequests    int64           `json:"voice_request_count"`
	EstimatedCostUSD float64         `json:"estimated_cost_usd"`
	Enabled          bool            `json:"enabled"`
	QuotaLimit       int64           `json:"quota_limit"`
	Models           []UsageModelRow `json:"models"`
}

// UsageSummary is the platform usage report for a month.
type UsageSummary struct {
	Month            string        `json:"month"`
	PeriodStart      time.Time     `json:"period_start"`
	PeriodEnd        time.Time     `json:"period_end"`
	Items            []UsageOrgRow `json:"items"`
	TotalTokens      int64         `json:"total_tokens"`
	STTSeconds       float64       `json:"stt_seconds"`
	TTSCharacters    int64         `json:"tts_characters"`
	EstimatedCostUSD float64       `json:"estimated_cost_usd"`
}

// Conversation is a chat thread.
type Conversation struct {
	UUID          uuid.UUID  `json:"uuid"`
	Title         string     `json:"title"`
	MessageCount  int32      `json:"message_count"`
	LastMessageAt *time.Time `json:"last_message_at,omitempty"`
	CreatedAt     time.Time  `json:"created_at"`
	UpdatedAt     time.Time  `json:"updated_at"`
}

// MessageView is a stored message rendered for the UI.
type MessageView struct {
	UUID      uuid.UUID       `json:"uuid"`
	Role      string          `json:"role"`
	Status    string          `json:"status"`
	Blocks    json.RawMessage `json:"blocks"`
	CreatedAt time.Time       `json:"created_at"`
}

// ConversationDetail is a conversation with its messages.
type ConversationDetail struct {
	Conversation
	Messages []MessageView `json:"messages"`
}

// UI block types stored in ai_messages.ui and streamed to the client.
const (
	UIText  = "text"
	UITool  = "tool"
	UIChart = "chart"
	UIError = "error"
	// UIConfirm is a write-action confirmation card (Data: ConfirmCard).
	UIConfirm = "confirm"
	// UITodoList is the assistant's plan checklist (Data: tools.Plan), ID "plan".
	UITodoList = "todo_list"
)

// UIBlock is a render block for the chat UI.
type UIBlock struct {
	Type          string         `json:"type"`
	Text          string         `json:"text,omitempty"`
	ID            string         `json:"id,omitempty"`
	Name          string         `json:"name,omitempty"`
	Status        string         `json:"status,omitempty"`
	SummaryKey    string         `json:"summary_key,omitempty"`
	SummaryParams map[string]any `json:"summary_params,omitempty"`
	Chart         *tools.Chart   `json:"chart,omitempty"`
	Code          string         `json:"code,omitempty"`
	Message       string         `json:"message,omitempty"`
	// Data carries type-specific payloads (confirm cards, plan checklists).
	Data json.RawMessage `json:"data,omitempty"`
}

// SendInput is a user chat message.
type SendInput struct {
	Content string `json:"content"`
	Locale  string `json:"locale"`
}
