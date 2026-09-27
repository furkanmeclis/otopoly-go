package usecase

import (
	"context"
	"errors"
	"fmt"
	"math"
	"mime"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database/db"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/ai/tools"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/ai/voice"
	"github.com/jackc/pgx/v5/pgtype"
)

// Voice defaults used when the platform settings leave a field empty.
const (
	DefaultSTTModel = "Systran/faster-whisper-small"
	DefaultTTSVoice = "speaches-ai/piper-tr_TR-fettah-medium"

	// MaxAudioBytes caps one push-to-talk upload (opus at ~32 kbit/s is
	// roughly 4 KB/s, so this is far above MaxAudioSeconds).
	MaxAudioBytes = 5 << 20
	// MaxAudioSeconds caps the transcribed clip length (the UI stops at 60s).
	MaxAudioSeconds = 120
	// MaxSpeechInputChars rejects absurd read-aloud payloads outright.
	MaxSpeechInputChars = 20000
	// MaxSpeechChars is what is actually synthesized (after Markdown cleanup).
	MaxSpeechChars = 2500
)

// Voice errors.
var (
	ErrVoiceDisabled    = errors.New("voice is disabled")
	ErrVoiceUnavailable = errors.New("voice server unavailable")
	ErrAudioTooLarge    = errors.New("audio is too large")
	ErrAudioTooLong     = errors.New("audio is too long")
	ErrAudioUnsupported = errors.New("unsupported audio type")
)

// SetVoiceAPIKey sets the bearer token sent to Speaches (its API_KEY).
func (s *Service) SetVoiceAPIKey(key string) { s.voiceAPIKey = strings.TrimSpace(key) }

// SetVoiceHTTPClient overrides the HTTP client used for Speaches (tests).
func (s *Service) SetVoiceHTTPClient(hc *http.Client) { s.voiceHTTP = hc }

// SetVoiceDefaultBaseURL sets the env-provided Speaches URL fallback.
func (s *Service) SetVoiceDefaultBaseURL(baseURL string) {
	s.voiceDefaultBaseURL = strings.TrimSpace(baseURL)
}

// SetVoiceAutoDownload toggles background model downloads.
func (s *Service) SetVoiceAutoDownload(enabled bool) { s.voiceAutoDownload = enabled }

func (s *Service) effectiveVoiceBaseURL(row db.AiSetting) string {
	return firstNonEmpty(strings.TrimSpace(row.VoiceBaseUrl), s.voiceDefaultBaseURL)
}

func (s *Service) voiceClient(baseURL string) *voice.Client {
	return voice.New(baseURL, s.voiceAPIKey, s.voiceHTTP)
}

func sttModelOf(row db.AiSetting) string {
	return firstNonEmpty(strings.TrimSpace(row.VoiceSttModel), DefaultSTTModel)
}

func ttsVoiceOf(row db.AiSetting) string {
	return firstNonEmpty(strings.TrimSpace(row.VoiceTtsVoice), DefaultTTSVoice)
}

type voiceScope struct {
	row    db.AiSetting
	orgID  int64
	userID int64
}

// voiceGate requires the assistant to be usable for the org (platform chat
// on + configured + org enabled) and the voice feature to be on with a
// Speaches URL. The token quota is not enforced: voice runs on self-hosted
// Speaches and does not consume model tokens.
func (s *Service) voiceGate(ctx context.Context) (voiceScope, error) {
	p, scope, err := principalScope(ctx)
	if err != nil {
		return voiceScope{}, err
	}
	row, err := s.store.GetAISettings(ctx)
	if err != nil {
		return voiceScope{}, err
	}
	if _, err := s.availability(ctx, row, scope.InternalID); err != nil && !errors.Is(err, ErrQuotaExceeded) {
		return voiceScope{}, err
	}
	if !s.featuresOf(row).Voice {
		return voiceScope{}, ErrVoiceDisabled
	}
	return voiceScope{row: row, orgID: scope.InternalID, userID: p.UserInternal}, nil
}

func voiceUpstreamErr(err error) error {
	if errors.Is(err, context.Canceled) {
		return err
	}
	return fmt.Errorf("%w: %v", ErrVoiceUnavailable, err)
}

// TranscribeInput is an uploaded push-to-talk clip.
type TranscribeInput struct {
	Audio       []byte
	Filename    string
	ContentType string
}

// TranscribeResult is returned to the composer.
type TranscribeResult struct {
	Text            string  `json:"text"`
	Language        string  `json:"language,omitempty"`
	DurationSeconds float64 `json:"duration_seconds"`
}

// allowedAudio are the container types browsers' MediaRecorder produce
// (plus common uploads); Speaches decodes them with PyAV/ffmpeg.
var allowedAudio = map[string]bool{
	"audio/webm": true, "video/webm": true, "audio/ogg": true, "audio/mp4": true,
	"audio/aac": true, "audio/mpeg": true, "audio/mp3": true, "audio/wav": true,
	"audio/x-wav": true, "audio/wave": true, "audio/flac": true, "audio/x-m4a": true,
	"audio/m4a": true,
}

// NormalizeAudioType returns the bare media type if it is an accepted
// recording format.
func NormalizeAudioType(ct string) (string, bool) {
	mt, _, err := mime.ParseMediaType(ct)
	if err != nil {
		return "", false
	}
	mt = strings.ToLower(mt)
	return mt, allowedAudio[mt]
}

// Transcribe turns a recorded clip into text with the configured
// faster-whisper model and language.
func (s *Service) Transcribe(ctx context.Context, in TranscribeInput) (TranscribeResult, error) {
	vs, err := s.voiceGate(ctx)
	if err != nil {
		return TranscribeResult{}, err
	}
	if len(in.Audio) == 0 {
		return TranscribeResult{}, invalid("audio file is empty")
	}
	if len(in.Audio) > MaxAudioBytes {
		return TranscribeResult{}, ErrAudioTooLarge
	}
	ct, ok := NormalizeAudioType(in.ContentType)
	if !ok {
		return TranscribeResult{}, ErrAudioUnsupported
	}
	ctx, cancel := context.WithTimeout(ctx, 90*time.Second)
	defer cancel()
	model := sttModelOf(vs.row)
	started := s.now()
	tr, err := s.voiceClient(s.effectiveVoiceBaseURL(vs.row)).Transcribe(ctx, voice.TranscribeRequest{
		Audio: in.Audio, Filename: in.Filename, ContentType: ct,
		Model: model, Language: vs.row.VoiceLanguage,
	})
	if err != nil {
		return TranscribeResult{}, voiceUpstreamErr(err)
	}
	s.logVoiceUsage(ctx, vs, "stt", model, voiceUnitSeconds, tr.Duration, s.now().Sub(started))
	if tr.Duration > MaxAudioSeconds {
		return TranscribeResult{}, ErrAudioTooLong
	}
	return TranscribeResult{Text: tr.Text, Language: tr.Language, DurationSeconds: math.Round(tr.Duration*10) / 10}, nil
}

// SpeechInput is text to read aloud.
type SpeechInput struct {
	Text string `json:"text"`
}

// Speak synthesizes assistant text (Markdown is cleaned up and the result
// clipped to MaxSpeechChars). The caller must close the returned stream.
func (s *Service) Speak(ctx context.Context, in SpeechInput) (*voice.Speech, error) {
	if utf8.RuneCountInString(in.Text) > MaxSpeechInputChars {
		return nil, invalid("text is too long (max %d)", MaxSpeechInputChars)
	}
	vs, err := s.voiceGate(ctx)
	if err != nil {
		return nil, err
	}
	text, _ := voice.Clip(voice.SpeakableText(in.Text), MaxSpeechChars)
	if text == "" {
		return nil, invalid("text is required")
	}
	model, voiceName := voice.ResolveTTS(ttsVoiceOf(vs.row))
	started := s.now()
	sp, err := s.voiceClient(s.effectiveVoiceBaseURL(vs.row)).Speech(ctx, voice.SpeechRequest{
		Model: model, Voice: voiceName, Input: text, Format: "mp3",
	})
	if err != nil {
		return nil, voiceUpstreamErr(err)
	}
	s.logVoiceUsage(ctx, vs, "tts", model, voiceUnitCharacters, float64(utf8.RuneCountInString(text)), s.now().Sub(started))
	return sp, nil
}

// Voice usage units written to the ai_usage ledger.
const (
	voiceUnitSeconds    = "seconds"
	voiceUnitCharacters = "characters"
)

// logVoiceUsage records voice metering in the ai_usage ledger (purpose
// stt/tts with zero tokens, so it never counts against the token quota) and
// emits a structured log line with the latency.
func (s *Service) logVoiceUsage(ctx context.Context, vs voiceScope, kind, model, unit string, amount float64, latency time.Duration) {
	s.log.InfoContext(ctx, "ai_voice_usage",
		"kind", kind, "organization_id", vs.orgID, "user_id", vs.userID,
		"model", model, "unit", unit, "amount", math.Round(amount*10)/10,
		"latency_ms", latency.Milliseconds())
	p := db.InsertAIUsageParams{
		OrganizationID: pgtype.Int8{Int64: vs.orgID, Valid: vs.orgID > 0},
		UserID:         pgtype.Int8{Int64: vs.userID, Valid: vs.userID > 0},
		Provider:       "speaches",
		Model:          tools.Truncate(model, 128),
		Purpose:        kind,
	}
	switch unit {
	case voiceUnitSeconds:
		p.AudioMs = int64(math.Round(math.Max(amount, 0) * 1000))
	case voiceUnitCharacters:
		p.Characters = int64(math.Max(amount, 0))
	}
	if err := s.store.InsertAIUsage(context.WithoutCancel(ctx), p); err != nil {
		s.log.Warn("ai_voice_usage_record_failed", "error", err)
	}
}

// ------------------------------------------------------------------ platform test

// VoiceTestInput optionally overrides saved settings (test before saving).
type VoiceTestInput struct {
	BaseURL  *string `json:"base_url"`
	STTModel *string `json:"stt_model"`
	TTSVoice *string `json:"tts_voice"`
}

// VoiceModelInfo is an installed Speaches model.
type VoiceModelInfo struct {
	ID   string `json:"id"`
	Task string `json:"task,omitempty"`
}

// VoiceTestResult reports reachability and whether the configured models
// are installed on the Speaches server.
type VoiceTestResult struct {
	OK                bool             `json:"ok"`
	Reachable         bool             `json:"reachable"`
	BaseURL           string           `json:"base_url"`
	LatencyMS         int64            `json:"latency_ms"`
	Message           string           `json:"message,omitempty"`
	STTModel          string           `json:"stt_model"`
	STTModelInstalled bool             `json:"stt_model_installed"`
	TTSModel          string           `json:"tts_model"`
	TTSVoice          string           `json:"tts_voice"`
	TTSModelInstalled bool             `json:"tts_model_installed"`
	InstalledModels   []VoiceModelInfo `json:"installed_models"`
}

// TestVoice lists the models installed on the Speaches server and checks
// the configured STT model and TTS voice against it.
func (s *Service) TestVoice(ctx context.Context, in VoiceTestInput) (VoiceTestResult, error) {
	row, err := s.store.GetAISettings(ctx)
	if err != nil {
		return VoiceTestResult{}, err
	}
	if in.BaseURL != nil {
		row.VoiceBaseUrl = strings.TrimSpace(*in.BaseURL)
	}
	if in.STTModel != nil {
		row.VoiceSttModel = strings.TrimSpace(*in.STTModel)
	}
	if in.TTSVoice != nil {
		row.VoiceTtsVoice = strings.TrimSpace(*in.TTSVoice)
	}
	if len(row.VoiceBaseUrl) > 500 || len(row.VoiceSttModel) > 128 || len(row.VoiceTtsVoice) > 128 {
		return VoiceTestResult{}, invalid("value is too long")
	}
	ttsModel, ttsVoice := voice.ResolveTTS(ttsVoiceOf(row))
	res := VoiceTestResult{
		BaseURL: s.effectiveVoiceBaseURL(row), STTModel: sttModelOf(row), TTSModel: ttsModel, TTSVoice: ttsVoice,
		InstalledModels: []VoiceModelInfo{},
	}
	if res.BaseURL == "" {
		res.Message = "voice base_url is not set"
		return res, nil
	}
	if !validURL(res.BaseURL) {
		return VoiceTestResult{}, invalid("voice.base_url must be an http(s) URL")
	}
	ctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	started := s.now()
	models, err := s.voiceClient(res.BaseURL).Models(ctx)
	res.LatencyMS = s.now().Sub(started).Milliseconds()
	if err != nil {
		res.Message = err.Error()
		return res, nil
	}
	res.Reachable = true
	for _, m := range models {
		res.InstalledModels = append(res.InstalledModels, VoiceModelInfo(m))
		if m.ID == res.STTModel {
			res.STTModelInstalled = true
		}
		if m.ID == res.TTSModel {
			res.TTSModelInstalled = true
		}
	}
	res.OK = res.STTModelInstalled && res.TTSModelInstalled
	if !res.OK {
		var missing []string
		if !res.STTModelInstalled {
			missing = append(missing, res.STTModel)
		}
		if !res.TTSModelInstalled {
			missing = append(missing, res.TTSModel)
		}
		res.Message = "models not installed: " + strings.Join(missing, ", ")
	}
	return res, nil
}
