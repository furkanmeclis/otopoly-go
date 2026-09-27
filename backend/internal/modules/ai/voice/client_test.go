package voice_test

import (
	"context"
	"errors"
	"io"
	"strings"
	"testing"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/ai/voice"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/ai/voice/voicetest"
)

func TestTranscribeSendsModelLanguageAndFile(t *testing.T) {
	fake := voicetest.New()
	defer fake.Close()
	c := voice.New(fake.URL+"/v1/", "", nil) // trailing /v1 is tolerated
	tr, err := c.Transcribe(context.Background(), voice.TranscribeRequest{
		Audio: []byte("webm-bytes"), Filename: "clip.webm", ContentType: "audio/webm",
		Model: "Systran/faster-whisper-small", Language: "tr",
	})
	if err != nil {
		t.Fatal(err)
	}
	if tr.Text != "merhaba dünya" || tr.Duration != 2.5 || tr.Language != "tr" {
		t.Fatalf("transcript = %+v", tr)
	}
	got, _ := fake.Last()
	if got.Model != "Systran/faster-whisper-small" || got.Language != "tr" || got.ResponseFormat != "verbose_json" {
		t.Fatalf("fields = %+v", got)
	}
	if string(got.Audio) != "webm-bytes" || got.Filename != "clip.webm" || got.ContentType != "audio/webm" {
		t.Fatalf("file = %+v", got)
	}
}

func TestTranscribeOmitsAutoLanguage(t *testing.T) {
	fake := voicetest.New()
	defer fake.Close()
	_, err := voice.New(fake.URL, "", nil).Transcribe(context.Background(), voice.TranscribeRequest{
		Audio: []byte("x"), ContentType: "audio/ogg", Model: "m", Language: "auto",
	})
	if err != nil {
		t.Fatal(err)
	}
	if got, _ := fake.Last(); got.Language != "" || got.Filename != "audio.webm" {
		t.Fatalf("fields = %+v", got)
	}
}

func TestSpeechStreamsAudio(t *testing.T) {
	fake := voicetest.New()
	defer fake.Close()
	sp, err := voice.New(fake.URL, "", nil).Speech(context.Background(), voice.SpeechRequest{
		Model: "speaches-ai/piper-tr_TR-fettah-medium", Voice: "fettah", Input: "Merhaba",
	})
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = sp.Body.Close() }()
	raw, _ := io.ReadAll(sp.Body)
	if string(raw) != "ID3fake-mp3" || sp.ContentType != "audio/mpeg" {
		t.Fatalf("audio = %q (%s)", raw, sp.ContentType)
	}
	if _, got := fake.Last(); got.ResponseFormat != "mp3" || got.Voice != "fettah" || got.Input != "Merhaba" {
		t.Fatalf("speech = %+v", got)
	}
}

func TestAPIKeyAndUpstreamErrors(t *testing.T) {
	fake := voicetest.New()
	defer fake.Close()
	fake.Set(func(s *voicetest.Server) { s.APIKey = "secret"; s.Installed = []string{"a"} })

	_, err := voice.New(fake.URL, "", nil).Models(context.Background())
	var up *voice.UpstreamError
	if !errors.As(err, &up) || up.Status != 403 || up.Message != "Invalid API key" {
		t.Fatalf("err = %v", err)
	}
	models, err := voice.New(fake.URL, "secret", nil).Models(context.Background())
	if err != nil || len(models) != 1 || models[0].ID != "a" {
		t.Fatalf("models = %+v, err = %v", models, err)
	}

	fake.Set(func(s *voicetest.Server) { s.APIKey = ""; s.FailStatus = 404 })
	_, err = voice.New(fake.URL, "", nil).Speech(context.Background(), voice.SpeechRequest{Model: "x", Voice: "y", Input: "z"})
	if !errors.As(err, &up) || up.Status != 404 || !strings.Contains(up.Message, "not installed") {
		t.Fatalf("err = %v", err)
	}
}

func TestRegistryAndDownloadModel(t *testing.T) {
	fake := voicetest.New()
	defer fake.Close()
	fake.Set(func(s *voicetest.Server) {
		s.Registry = []map[string]any{
			{"id": "Systran/faster-whisper-small", "task": voice.TaskSTT, "owned_by": "Systran", "language": []string{"multilingual"}},
			{"id": "speaches-ai/piper-tr_TR-fettah-medium", "task": voice.TaskTTS, "owned_by": "speaches-ai", "language": []string{"tr"}},
		}
		s.Unknown = map[string]bool{"missing/model": true}
	})

	c := voice.New(fake.URL, "", nil)
	reg, err := c.Registry(context.Background(), voice.TaskTTS)
	if err != nil {
		t.Fatal(err)
	}
	if len(reg) != 1 || reg[0].ID != "speaches-ai/piper-tr_TR-fettah-medium" {
		t.Fatalf("registry = %+v", reg)
	}
	downloaded, err := c.DownloadModel(context.Background(), "Systran/faster-whisper-small")
	if err != nil || !downloaded {
		t.Fatalf("downloaded=%v err=%v", downloaded, err)
	}
	downloaded, err = c.DownloadModel(context.Background(), "Systran/faster-whisper-small")
	if err != nil || downloaded {
		t.Fatalf("second downloaded=%v err=%v", downloaded, err)
	}
	_, err = c.DownloadModel(context.Background(), "missing/model")
	if !errors.Is(err, voice.ErrModelNotFound) {
		t.Fatalf("err = %v", err)
	}
}

func TestUnreachable(t *testing.T) {
	fake := voicetest.New()
	url := fake.URL
	fake.Close()
	_, err := voice.New(url, "", nil).Models(context.Background())
	if !errors.Is(err, voice.ErrUnreachable) {
		t.Fatalf("err = %v", err)
	}
}
