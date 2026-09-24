package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"net/textproto"
	"strings"
	"testing"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database/db"
	aiusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/ai/usecase"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/ai/voice/voicetest"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/authctx"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/orgctx"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

// voiceStore implements only what the voice endpoints read.
type voiceStore struct {
	aiusecase.Store
	settings db.AiSetting
}

func (s *voiceStore) GetAISettings(context.Context) (db.AiSetting, error) { return s.settings, nil }
func (s *voiceStore) GetAIOrganizationSettings(context.Context, int64) (db.AiOrganizationSetting, error) {
	return db.AiOrganizationSetting{}, pgx.ErrNoRows
}
func (s *voiceStore) InsertAIUsage(context.Context, db.InsertAIUsageParams) error { return nil }
func (s *voiceStore) SumAIOrganizationTokensSince(context.Context, db.SumAIOrganizationTokensSinceParams) (int64, error) {
	return 0, nil
}

func newVoiceHandler(t *testing.T) (*Handler, *voicetest.Server, context.Context) {
	t.Helper()
	fake := voicetest.New()
	t.Cleanup(fake.Close)
	store := &voiceStore{settings: db.AiSetting{
		Provider: "openai_compatible", BaseUrl: "http://llm.local/v1", Model: "m", ChatEnabled: true,
		ApiKeyEnc: pgtype.Text{}, VoiceEnabled: true, VoiceBaseUrl: fake.URL, VoiceLanguage: "tr",
	}}
	svc := aiusecase.New(store, nil, nil, nil)
	ctx := authctx.WithPrincipal(context.Background(), authctx.Principal{UserID: uuid.New(), UserInternal: 1})
	ctx = orgctx.WithScope(ctx, orgctx.Scope{InternalID: 7, UUID: uuid.New(), Slug: "demo"})
	return New(svc, nil), fake, ctx
}

func multipartBody(t *testing.T, contentType string, audio []byte) (*bytes.Buffer, string) {
	t.Helper()
	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)
	_ = mw.WriteField("ignored", "x")
	h := textproto.MIMEHeader{}
	h.Set("Content-Disposition", `form-data; name="file"; filename="ptt.webm"`)
	h.Set("Content-Type", contentType)
	part, err := mw.CreatePart(h)
	if err != nil {
		t.Fatal(err)
	}
	_, _ = part.Write(audio)
	_ = mw.Close()
	return &buf, mw.FormDataContentType()
}

func TestTranscribeHandler(t *testing.T) {
	h, fake, ctx := newVoiceHandler(t)
	body, ct := multipartBody(t, "audio/webm;codecs=opus", []byte("opus-bytes"))
	req := httptest.NewRequest(http.MethodPost, "/v1/tenant/ai/voice/transcribe", body).WithContext(ctx)
	req.Header.Set("Content-Type", ct)
	rec := httptest.NewRecorder()
	h.Transcribe(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d body = %s", rec.Code, rec.Body)
	}
	var env struct {
		Data aiusecase.TranscribeResult `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &env); err != nil || env.Data.Text != "merhaba dünya" {
		t.Fatalf("body = %s", rec.Body)
	}
	if got, _ := fake.Last(); string(got.Audio) != "opus-bytes" || got.Filename != "ptt.webm" {
		t.Fatalf("upstream = %+v", got)
	}
}

func TestTranscribeHandlerErrors(t *testing.T) {
	h, _, ctx := newVoiceHandler(t)
	cases := []struct {
		name   string
		build  func() *http.Request
		status int
		code   string
	}{
		{"not multipart", func() *http.Request {
			return httptest.NewRequest(http.MethodPost, "/", strings.NewReader("{}"))
		}, http.StatusBadRequest, "VALIDATION_ERROR"},
		{"unsupported", func() *http.Request {
			body, ct := multipartBody(t, "text/plain", []byte("x"))
			r := httptest.NewRequest(http.MethodPost, "/", body)
			r.Header.Set("Content-Type", ct)
			return r
		}, http.StatusUnsupportedMediaType, CodeAudioUnsupported},
		{"too large", func() *http.Request {
			body, ct := multipartBody(t, "audio/webm", make([]byte, aiusecase.MaxAudioBytes+200<<10))
			r := httptest.NewRequest(http.MethodPost, "/", body)
			r.Header.Set("Content-Type", ct)
			return r
		}, http.StatusRequestEntityTooLarge, CodeAudioTooLarge},
	}
	for _, c := range cases {
		rec := httptest.NewRecorder()
		h.Transcribe(rec, c.build().WithContext(ctx))
		if rec.Code != c.status || !strings.Contains(rec.Body.String(), c.code) {
			t.Errorf("%s: status = %d body = %s", c.name, rec.Code, rec.Body)
		}
	}
}

func TestSpeechHandlerStreamsAudio(t *testing.T) {
	h, fake, ctx := newVoiceHandler(t)
	req := httptest.NewRequest(http.MethodPost, "/", strings.NewReader(`{"text":"Merhaba **dünya**"}`)).WithContext(ctx)
	rec := httptest.NewRecorder()
	h.Speech(rec, req)
	if rec.Code != http.StatusOK || rec.Header().Get("Content-Type") != "audio/mpeg" || rec.Body.String() != "ID3fake-mp3" {
		t.Fatalf("status = %d ct = %s body = %q", rec.Code, rec.Header().Get("Content-Type"), rec.Body)
	}
	if _, sp := fake.Last(); sp.Input != "Merhaba dünya" {
		t.Fatalf("upstream = %+v", sp)
	}

	fake.Set(func(s *voicetest.Server) { s.FailStatus = 404 })
	rec = httptest.NewRecorder()
	h.Speech(rec, httptest.NewRequest(http.MethodPost, "/", strings.NewReader(`{"text":"x"}`)).WithContext(ctx))
	if rec.Code != http.StatusBadGateway || !strings.Contains(rec.Body.String(), CodeAIVoiceUnavailable) {
		t.Fatalf("status = %d body = %s", rec.Code, rec.Body)
	}
}
