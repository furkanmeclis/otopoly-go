package usecase

import (
	"context"
	"errors"
	"io"
	"strings"
	"testing"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database/db"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/ai/voice/voicetest"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/authctx"
)

func newVoiceHarness(t *testing.T) (*harness, *voicetest.Server) {
	t.Helper()
	h := newHarness(t, nil)
	fake := voicetest.New()
	t.Cleanup(fake.Close)
	h.store.settings.VoiceEnabled = true
	h.store.settings.VoiceBaseUrl = fake.URL
	return h, fake
}

func TestVoiceGate(t *testing.T) {
	h, _ := newVoiceHarness(t)
	clip := TranscribeInput{Audio: []byte("a"), ContentType: "audio/webm"}

	h.store.settings.VoiceEnabled = false
	if _, err := h.svc.Transcribe(h.ctx, clip); !errors.Is(err, ErrVoiceDisabled) {
		t.Fatalf("voice off: err = %v", err)
	}
	h.store.settings.VoiceEnabled = true
	h.store.settings.VoiceBaseUrl = ""
	if _, err := h.svc.Speak(h.ctx, SpeechInput{Text: "x"}); !errors.Is(err, ErrVoiceDisabled) {
		t.Fatalf("no url: err = %v", err)
	}
	h.store.settings.VoiceBaseUrl = "http://127.0.0.1:1"
	h.store.settings.ChatEnabled = false
	if _, err := h.svc.Transcribe(h.ctx, clip); !errors.Is(err, ErrDisabled) {
		t.Fatalf("chat off: err = %v", err)
	}
	h.store.settings.ChatEnabled = true
	h.store.orgs[7] = db.AiOrganizationSetting{OrganizationID: 7, Enabled: false}
	if _, err := h.svc.Transcribe(h.ctx, clip); !errors.Is(err, ErrOrgDisabled) {
		t.Fatalf("org off: err = %v", err)
	}
	if _, err := h.svc.Transcribe(authctx.WithPrincipal(context.Background(), authctx.Principal{UserInternal: 42}), clip); !errors.Is(err, ErrNoContext) {
		t.Fatalf("no scope: err = %v", err)
	}
}

func TestTranscribeUsesSettingsAndDefaults(t *testing.T) {
	h, fake := newVoiceHarness(t)
	res, err := h.svc.Transcribe(h.ctx, TranscribeInput{Audio: []byte("opus"), Filename: "ptt.webm", ContentType: "audio/webm;codecs=opus"})
	if err != nil {
		t.Fatal(err)
	}
	if res.Text != "merhaba dünya" || res.DurationSeconds != 2.5 {
		t.Fatalf("res = %+v", res)
	}
	got, _ := fake.Last()
	if got.Model != DefaultSTTModel || got.Language != "tr" || got.ContentType != "audio/webm" {
		t.Fatalf("upstream = %+v", got)
	}
	// Voice usage lands in the ledger with zero tokens (never counts against the quota).
	if n := len(h.store.usage); n != 1 {
		t.Fatalf("usage rows = %d", n)
	}
	if u := h.store.usage[0]; u.Purpose != "stt" || u.AudioMs != 2500 || u.Model != DefaultSTTModel ||
		u.InputTokens+u.OutputTokens != 0 || u.OrganizationID.Int64 != 7 || !u.UserID.Valid {
		t.Fatalf("stt usage = %+v", u)
	}

	h.store.settings.VoiceSttModel = "Systran/faster-whisper-medium"
	h.store.settings.VoiceLanguage = "en"
	if _, err := h.svc.Transcribe(h.ctx, TranscribeInput{Audio: []byte("x"), ContentType: "audio/mp4"}); err != nil {
		t.Fatal(err)
	}
	if got, _ := fake.Last(); got.Model != "Systran/faster-whisper-medium" || got.Language != "en" {
		t.Fatalf("upstream = %+v", got)
	}
	// Quota exhaustion does not block voice (it uses no model tokens).
	h.store.usedExtra = 10_000_000
	if _, err := h.svc.Transcribe(h.ctx, TranscribeInput{Audio: []byte("x"), ContentType: "audio/ogg"}); err != nil {
		t.Fatalf("quota exceeded: err = %v", err)
	}
}

func TestTranscribeLimits(t *testing.T) {
	h, fake := newVoiceHarness(t)
	if _, err := h.svc.Transcribe(h.ctx, TranscribeInput{Audio: make([]byte, MaxAudioBytes+1), ContentType: "audio/webm"}); !errors.Is(err, ErrAudioTooLarge) {
		t.Fatalf("too large: err = %v", err)
	}
	if _, err := h.svc.Transcribe(h.ctx, TranscribeInput{Audio: []byte("x"), ContentType: "text/plain"}); !errors.Is(err, ErrAudioUnsupported) {
		t.Fatalf("type: err = %v", err)
	}
	if _, err := h.svc.Transcribe(h.ctx, TranscribeInput{ContentType: "audio/webm"}); !errors.Is(err, ErrInvalidRequest) {
		t.Fatalf("empty: err = %v", err)
	}
	fake.Set(func(s *voicetest.Server) { s.Duration = MaxAudioSeconds + 5 })
	if _, err := h.svc.Transcribe(h.ctx, TranscribeInput{Audio: []byte("x"), ContentType: "audio/webm"}); !errors.Is(err, ErrAudioTooLong) {
		t.Fatalf("too long: err = %v", err)
	}
	fake.Set(func(s *voicetest.Server) { s.FailStatus = 500 })
	if _, err := h.svc.Transcribe(h.ctx, TranscribeInput{Audio: []byte("x"), ContentType: "audio/webm"}); !errors.Is(err, ErrVoiceUnavailable) {
		t.Fatalf("upstream: err = %v", err)
	}
}

func TestSpeakCleansAndClipsText(t *testing.T) {
	h, fake := newVoiceHarness(t)
	sp, err := h.svc.Speak(h.ctx, SpeechInput{Text: "**Toplam** tahsilat ₺20.000."})
	if err != nil {
		t.Fatal(err)
	}
	raw, _ := io.ReadAll(sp.Body)
	_ = sp.Body.Close()
	if string(raw) != "ID3fake-mp3" || sp.ContentType != "audio/mpeg" {
		t.Fatalf("audio = %q %s", raw, sp.ContentType)
	}
	_, got := fake.Last()
	if got.Model != DefaultTTSVoice || got.Voice != "fettah" || got.Input != "Toplam tahsilat 20.000 TL." || got.ResponseFormat != "mp3" {
		t.Fatalf("upstream = %+v", got)
	}
	if n := len(h.store.usage); n != 1 {
		t.Fatalf("usage rows = %d", n)
	}
	if u := h.store.usage[0]; u.Purpose != "tts" || u.Characters != int64(len([]rune(got.Input))) || u.AudioMs != 0 {
		t.Fatalf("tts usage = %+v", u)
	}

	h.store.settings.VoiceTtsVoice = "speaches-ai/Kokoro-82M-v1.0-ONNX:af_heart"
	sp, err = h.svc.Speak(h.ctx, SpeechInput{Text: strings.Repeat("Uzun bir cümle. ", 400)})
	if err != nil {
		t.Fatal(err)
	}
	_ = sp.Body.Close()
	_, got = fake.Last()
	if got.Model != "speaches-ai/Kokoro-82M-v1.0-ONNX" || got.Voice != "af_heart" || len([]rune(got.Input)) > MaxSpeechChars {
		t.Fatalf("upstream = %s/%s len=%d", got.Model, got.Voice, len([]rune(got.Input)))
	}

	if _, err := h.svc.Speak(h.ctx, SpeechInput{Text: "```\ncode only\n```"}); !errors.Is(err, ErrInvalidRequest) {
		t.Fatalf("empty after cleanup: err = %v", err)
	}
	if _, err := h.svc.Speak(h.ctx, SpeechInput{Text: strings.Repeat("a", MaxSpeechInputChars+1)}); !errors.Is(err, ErrInvalidRequest) {
		t.Fatalf("too long: err = %v", err)
	}
}

func TestTestVoiceReportsInstalledModels(t *testing.T) {
	h, fake := newVoiceHarness(t)
	fake.Set(func(s *voicetest.Server) { s.Installed = []string{DefaultSTTModel} })
	res, err := h.svc.TestVoice(h.ctx, VoiceTestInput{})
	if err != nil {
		t.Fatal(err)
	}
	if res.OK || !res.Reachable || !res.STTModelInstalled || res.TTSModelInstalled || !strings.Contains(res.Message, DefaultTTSVoice) {
		t.Fatalf("res = %+v", res)
	}
	if len(res.InstalledModels) != 1 || res.InstalledModels[0].Task != "automatic-speech-recognition" {
		t.Fatalf("models = %+v", res.InstalledModels)
	}

	fake.Set(func(s *voicetest.Server) {
		s.Installed = []string{"Systran/faster-whisper-medium", "speaches-ai/piper-tr_TR-dfki-medium"}
	})
	stt, tts := "Systran/faster-whisper-medium", "speaches-ai/piper-tr_TR-dfki-medium"
	res, err = h.svc.TestVoice(h.ctx, VoiceTestInput{STTModel: &stt, TTSVoice: &tts})
	if err != nil {
		t.Fatal(err)
	}
	if !res.OK || res.TTSVoice != "dfki" || res.Message != "" {
		t.Fatalf("res = %+v", res)
	}

	down := "http://127.0.0.1:1"
	res, err = h.svc.TestVoice(h.ctx, VoiceTestInput{BaseURL: &down})
	if err != nil || res.OK || res.Reachable || res.Message == "" {
		t.Fatalf("unreachable: res = %+v err = %v", res, err)
	}
	bad := "ftp://x"
	if _, err := h.svc.TestVoice(h.ctx, VoiceTestInput{BaseURL: &bad}); !errors.Is(err, ErrInvalidRequest) {
		t.Fatalf("bad url: err = %v", err)
	}
	empty := ""
	if res, err := h.svc.TestVoice(h.ctx, VoiceTestInput{BaseURL: &empty}); err != nil || res.OK || res.Message == "" {
		t.Fatalf("empty url: res = %+v err = %v", res, err)
	}
}

func TestNormalizeAudioType(t *testing.T) {
	for in, want := range map[string]string{
		"audio/webm;codecs=opus": "audio/webm", "Audio/MP4": "audio/mp4", "audio/ogg; codecs=opus": "audio/ogg",
	} {
		if got, ok := NormalizeAudioType(in); !ok || got != want {
			t.Errorf("NormalizeAudioType(%q) = %q, %v", in, got, ok)
		}
	}
	for _, in := range []string{"", "text/html", "application/octet-stream"} {
		if _, ok := NormalizeAudioType(in); ok {
			t.Errorf("NormalizeAudioType(%q) accepted", in)
		}
	}
}
