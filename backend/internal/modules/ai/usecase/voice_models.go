package usecase

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"regexp"
	"sort"
	"strings"
	"time"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database/db"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/ai/voice"
)

const (
	VoiceDownloadDownloading = "downloading"
	VoiceDownloadDone        = "done"
	VoiceDownloadError       = "error"
)

// ErrVoiceModelNotFound means the requested model id is not in Speaches registry.
var ErrVoiceModelNotFound = errors.New("voice model not found")

// VoiceDownloadStatus is the in-memory status for one model download.
type VoiceDownloadStatus struct {
	ModelID    string     `json:"model_id"`
	State      string     `json:"state"`
	Error      string     `json:"error,omitempty"`
	StartedAt  time.Time  `json:"started_at"`
	FinishedAt *time.Time `json:"finished_at,omitempty"`
}

// VoiceRegistryModel is a model row for the admin model picker.
type VoiceRegistryModel struct {
	ID        string               `json:"id"`
	Task      string               `json:"task"`
	OwnedBy   string               `json:"owned_by,omitempty"`
	Language  []string             `json:"language,omitempty"`
	Installed bool                 `json:"installed"`
	Download  *VoiceDownloadStatus `json:"download,omitempty"`
}

// VoiceModelsResult is returned by GET /platform/ai/voice/models.
type VoiceModelsResult struct {
	Reachable bool                 `json:"reachable"`
	BaseURL   string               `json:"base_url"`
	Message   string               `json:"message,omitempty"`
	Installed []VoiceModelInfo     `json:"installed"`
	Available []VoiceRegistryModel `json:"available"`
	Defaults  VoiceModelDefaults   `json:"defaults"`
}

type VoiceModelDefaults struct {
	STTModel string `json:"stt_model"`
	TTSModel string `json:"tts_model"`
}

type VoiceDownloadInput struct {
	ModelID string `json:"model_id"`
}

func (s *Service) downloadStatus(id string) *VoiceDownloadStatus {
	s.voiceDownloadsMu.Lock()
	defer s.voiceDownloadsMu.Unlock()
	st, ok := s.voiceDownloads[id]
	if !ok {
		return nil
	}
	return &st
}

func (s *Service) setDownloadStatus(st VoiceDownloadStatus) {
	s.voiceDownloadsMu.Lock()
	defer s.voiceDownloadsMu.Unlock()
	s.voiceDownloads[st.ModelID] = st
}

func (s *Service) beginDownload(id string) (VoiceDownloadStatus, bool) {
	now := s.now()
	s.voiceDownloadsMu.Lock()
	defer s.voiceDownloadsMu.Unlock()
	if st, ok := s.voiceDownloads[id]; ok && st.State == VoiceDownloadDownloading {
		return st, false
	}
	st := VoiceDownloadStatus{ModelID: id, State: VoiceDownloadDownloading, StartedAt: now}
	s.voiceDownloads[id] = st
	return st, true
}

func (s *Service) finishDownload(id string, err error) {
	now := s.now()
	s.voiceDownloadsMu.Lock()
	defer s.voiceDownloadsMu.Unlock()
	st := s.voiceDownloads[id]
	st.ModelID = id
	st.FinishedAt = &now
	if err != nil {
		st.State = VoiceDownloadError
		st.Error = err.Error()
	} else {
		st.State = VoiceDownloadDone
		st.Error = ""
	}
	s.voiceDownloads[id] = st
}

func (s *Service) VoiceModels(ctx context.Context, language string) (VoiceModelsResult, error) {
	row, err := s.store.GetAISettings(ctx)
	if err != nil {
		return VoiceModelsResult{}, err
	}
	return s.voiceModelsForRow(ctx, row, language)
}

func (s *Service) voiceModelsForRow(ctx context.Context, row db.AiSetting, language string) (VoiceModelsResult, error) {
	baseURL := s.effectiveVoiceBaseURL(row)
	ttsModel, _ := voice.ResolveTTS(ttsVoiceOf(row))
	res := VoiceModelsResult{
		BaseURL:   baseURL,
		Installed: []VoiceModelInfo{},
		Available: []VoiceRegistryModel{},
		Defaults:  VoiceModelDefaults{STTModel: sttModelOf(row), TTSModel: ttsModel},
	}
	if strings.TrimSpace(language) == "" {
		language = firstNonEmpty(strings.TrimSpace(row.VoiceLanguage), "tr")
	}
	if baseURL == "" {
		res.Message = "voice base_url is not set"
		return res, nil
	}
	ctx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	client := s.voiceClient(baseURL)
	installed, err := client.Models(ctx)
	if err != nil {
		res.Message = err.Error()
		return res, nil
	}
	res.Reachable = true
	installedSet := map[string]bool{}
	for _, m := range installed {
		res.Installed = append(res.Installed, VoiceModelInfo(m))
		installedSet[m.ID] = true
	}
	for _, task := range []string{voice.TaskSTT, voice.TaskTTS} {
		models, err := client.Registry(ctx, task)
		if err != nil {
			res.Message = err.Error()
			return res, nil
		}
		for _, m := range models {
			if !matchesVoiceLanguage(m, language) {
				continue
			}
			item := VoiceRegistryModel{
				ID: m.ID, Task: firstNonEmpty(m.Task, task), OwnedBy: m.OwnedBy,
				Language: append([]string{}, m.Language...), Installed: installedSet[m.ID],
			}
			if st := s.downloadStatus(m.ID); st != nil {
				item.Download = st
			}
			res.Available = append(res.Available, item)
		}
	}
	sort.Slice(res.Available, func(i, j int) bool {
		if res.Available[i].Installed != res.Available[j].Installed {
			return res.Available[i].Installed
		}
		return res.Available[i].ID < res.Available[j].ID
	})
	return res, nil
}

func matchesVoiceLanguage(m voice.RegistryModel, language string) bool {
	lang := strings.ToLower(strings.TrimSpace(language))
	if lang == "" {
		lang = "tr"
	}
	for _, candidate := range m.Language {
		c := strings.ToLower(strings.TrimSpace(candidate))
		if c == lang || c == "multilingual" {
			return true
		}
	}
	if m.Task == voice.TaskTTS {
		if piperLanguage(m.ID) == lang {
			return true
		}
	}
	return false
}

var piperIDLanguage = regexp.MustCompile(`piper-([a-z]{2})_[A-Z]{2}-`)

func piperLanguage(id string) string {
	m := piperIDLanguage.FindStringSubmatch(id)
	if len(m) == 2 {
		return strings.ToLower(m[1])
	}
	return ""
}

func (s *Service) DownloadVoiceModel(ctx context.Context, in VoiceDownloadInput) (VoiceDownloadStatus, error) {
	id := strings.TrimSpace(in.ModelID)
	if id == "" || len(id) > 256 {
		return VoiceDownloadStatus{}, invalid("model_id is required")
	}
	row, err := s.store.GetAISettings(ctx)
	if err != nil {
		return VoiceDownloadStatus{}, err
	}
	baseURL := s.effectiveVoiceBaseURL(row)
	if baseURL == "" {
		return VoiceDownloadStatus{}, invalid("voice.base_url is not set")
	}
	if ok, err := s.voiceModelExists(ctx, baseURL, id); err != nil {
		return VoiceDownloadStatus{}, voiceUpstreamErr(err)
	} else if !ok {
		return VoiceDownloadStatus{}, ErrVoiceModelNotFound
	}
	st, started := s.beginDownload(id)
	if started {
		go s.downloadVoiceModel(context.Background(), baseURL, id)
	}
	return st, nil
}

func (s *Service) voiceModelExists(ctx context.Context, baseURL, id string) (bool, error) {
	ctx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	client := s.voiceClient(baseURL)
	for _, task := range []string{voice.TaskSTT, voice.TaskTTS} {
		models, err := client.Registry(ctx, task)
		if err != nil {
			return false, err
		}
		for _, m := range models {
			if m.ID == id {
				return true, nil
			}
		}
	}
	return false, nil
}

func (s *Service) downloadVoiceModel(ctx context.Context, baseURL, id string) {
	s.log.InfoContext(ctx, "ai_voice_model_download_started", slog.String("model_id", id))
	hc := &http.Client{Timeout: 15 * time.Minute}
	_, err := voice.New(baseURL, s.voiceAPIKey, hc).DownloadModel(ctx, id)
	if err != nil {
		s.log.WarnContext(ctx, "ai_voice_model_download_failed", slog.String("model_id", id), slog.Any("error", err))
		s.finishDownload(id, err)
		return
	}
	s.log.InfoContext(ctx, "ai_voice_model_download_done", slog.String("model_id", id))
	s.finishDownload(id, nil)
}

// StartVoiceModelEnsure starts the best-effort API-process startup downloader.
func (s *Service) StartVoiceModelEnsure(ctx context.Context) {
	if !s.voiceAutoDownload {
		return
	}
	row, err := s.store.GetAISettings(ctx)
	if err != nil {
		s.log.WarnContext(ctx, "ai_voice_model_ensure_settings_failed", slog.Any("error", err))
		return
	}
	s.EnsureVoiceModelsAsync(row)
}

func (s *Service) EnsureVoiceModelsAsync(row db.AiSetting) {
	if !s.voiceAutoDownload {
		return
	}
	baseURL := s.effectiveVoiceBaseURL(row)
	if baseURL == "" {
		return
	}
	stt := sttModelOf(row)
	tts, _ := voice.ResolveTTS(ttsVoiceOf(row))
	go s.ensureVoiceModels(context.Background(), baseURL, []string{stt, tts})
}

func (s *Service) ensureVoiceModels(ctx context.Context, baseURL string, ids []string) {
	deadline := s.now().Add(10 * time.Minute)
	for {
		installed, err := voice.New(baseURL, s.voiceAPIKey, &http.Client{Timeout: 15 * time.Second}).Models(ctx)
		if err == nil {
			installedSet := map[string]bool{}
			for _, m := range installed {
				installedSet[m.ID] = true
			}
			for _, id := range ids {
				if strings.TrimSpace(id) == "" || installedSet[id] {
					if installedSet[id] {
						s.log.InfoContext(ctx, "ai_voice_model_already_installed", slog.String("model_id", id))
					}
					continue
				}
				if _, started := s.beginDownload(id); started {
					s.downloadVoiceModel(ctx, baseURL, id)
				}
			}
			return
		}
		if s.now().After(deadline) {
			s.log.WarnContext(ctx, "ai_voice_model_ensure_unreachable", slog.Any("error", err))
			return
		}
		time.Sleep(5 * time.Second)
	}
}
