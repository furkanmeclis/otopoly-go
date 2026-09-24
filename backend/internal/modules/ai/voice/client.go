// Package voice is a small client for a Speaches server
// (https://speaches.ai): OpenAI-compatible speech-to-text
// (faster-whisper) and text-to-speech (Piper / Kokoro).
package voice

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/textproto"
	"strings"
	"time"
)

// Speaches model tasks (the `task` field of GET /v1/models).
const (
	TaskSTT = "automatic-speech-recognition"
	TaskTTS = "text-to-speech"
)

// ErrUnreachable wraps transport failures (DNS, refused, timeout).
var ErrUnreachable = errors.New("voice server unreachable")

// UpstreamError is a non-2xx answer from Speaches.
type UpstreamError struct {
	Status  int
	Message string
}

func (e *UpstreamError) Error() string {
	if e.Message == "" {
		return fmt.Sprintf("voice server returned HTTP %d", e.Status)
	}
	return fmt.Sprintf("voice server returned HTTP %d: %s", e.Status, e.Message)
}

// Client talks to one Speaches base URL.
type Client struct {
	baseURL string
	apiKey  string
	http    *http.Client
}

// New creates a client. baseURL is the server root (with or without /v1).
func New(baseURL, apiKey string, hc *http.Client) *Client {
	if hc == nil {
		hc = &http.Client{Timeout: 2 * time.Minute}
	}
	base := strings.TrimRight(strings.TrimSpace(baseURL), "/")
	base = strings.TrimSuffix(base, "/v1")
	return &Client{baseURL: base, apiKey: strings.TrimSpace(apiKey), http: hc}
}

func (c *Client) endpoint(path string) string { return c.baseURL + path }

func (c *Client) do(req *http.Request) (*http.Response, error) {
	if c.apiKey != "" {
		req.Header.Set("Authorization", "Bearer "+c.apiKey)
	}
	res, err := c.http.Do(req)
	if err != nil {
		if ctxErr := req.Context().Err(); ctxErr != nil {
			return nil, ctxErr
		}
		return nil, fmt.Errorf("%w: %v", ErrUnreachable, err)
	}
	if res.StatusCode >= 300 {
		defer func() { _ = res.Body.Close() }()
		raw, _ := io.ReadAll(io.LimitReader(res.Body, 8<<10))
		return nil, &UpstreamError{Status: res.StatusCode, Message: errorMessage(raw)}
	}
	return res, nil
}

// errorMessage extracts FastAPI ({"detail": ...}) or OpenAI-style
// ({"error": {"message": ...}}) error bodies.
func errorMessage(raw []byte) string {
	var body struct {
		Detail any `json:"detail"`
		Error  *struct {
			Message string `json:"message"`
		} `json:"error"`
		Message string `json:"message"`
	}
	if json.Unmarshal(raw, &body) == nil {
		switch {
		case body.Error != nil && body.Error.Message != "":
			return truncate(body.Error.Message, 300)
		case body.Detail != nil:
			if s, ok := body.Detail.(string); ok {
				return truncate(s, 300)
			}
			b, _ := json.Marshal(body.Detail)
			return truncate(string(b), 300)
		case body.Message != "":
			return truncate(body.Message, 300)
		}
	}
	return truncate(strings.TrimSpace(string(raw)), 300)
}

func truncate(s string, n int) string {
	r := []rune(s)
	if len(r) <= n {
		return s
	}
	return string(r[:n]) + "…"
}

// ------------------------------------------------------------------ STT

// TranscribeRequest is one audio clip to transcribe.
type TranscribeRequest struct {
	Audio       []byte
	Filename    string
	ContentType string
	Model       string
	// Language is an ISO-639-1 hint ("tr"); empty lets Whisper detect it.
	Language string
}

// Transcript is the recognized text.
type Transcript struct {
	Text     string
	Language string
	// Duration of the audio in seconds (0 when the server does not report it).
	Duration float64
}

// Transcribe calls POST /v1/audio/transcriptions (verbose_json for duration).
func (c *Client) Transcribe(ctx context.Context, in TranscribeRequest) (Transcript, error) {
	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)
	name := in.Filename
	if name == "" {
		name = "audio.webm"
	}
	h := textproto.MIMEHeader{}
	h.Set("Content-Disposition", fmt.Sprintf(`form-data; name="file"; filename=%q`, name))
	ct := in.ContentType
	if ct == "" {
		ct = "application/octet-stream"
	}
	h.Set("Content-Type", ct)
	part, err := mw.CreatePart(h)
	if err != nil {
		return Transcript{}, err
	}
	if _, err := part.Write(in.Audio); err != nil {
		return Transcript{}, err
	}
	fields := map[string]string{
		"model":           in.Model,
		"response_format": "verbose_json",
		"temperature":     "0",
	}
	if lang := strings.TrimSpace(in.Language); lang != "" && lang != "auto" {
		fields["language"] = lang
	}
	for k, v := range fields {
		if err := mw.WriteField(k, v); err != nil {
			return Transcript{}, err
		}
	}
	if err := mw.Close(); err != nil {
		return Transcript{}, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.endpoint("/v1/audio/transcriptions"), &buf)
	if err != nil {
		return Transcript{}, err
	}
	req.Header.Set("Content-Type", mw.FormDataContentType())
	req.Header.Set("Accept", "application/json")
	res, err := c.do(req)
	if err != nil {
		return Transcript{}, err
	}
	defer func() { _ = res.Body.Close() }()
	var out struct {
		Text     string  `json:"text"`
		Language string  `json:"language"`
		Duration float64 `json:"duration"`
	}
	if err := json.NewDecoder(io.LimitReader(res.Body, 4<<20)).Decode(&out); err != nil {
		return Transcript{}, fmt.Errorf("decode transcription: %w", err)
	}
	return Transcript{Text: strings.TrimSpace(out.Text), Language: out.Language, Duration: out.Duration}, nil
}

// ------------------------------------------------------------------ TTS

// SpeechRequest is text to synthesize.
type SpeechRequest struct {
	Model string
	Voice string
	Input string
	// Format is mp3 (default), wav or flac. Speaches does not support opus/aac.
	Format string
}

// Speech is a streaming audio response; the caller must close Body.
type Speech struct {
	Body        io.ReadCloser
	ContentType string
}

// Speech calls POST /v1/audio/speech and returns the audio stream.
func (c *Client) Speech(ctx context.Context, in SpeechRequest) (*Speech, error) {
	format := in.Format
	if format == "" {
		format = "mp3"
	}
	raw, err := json.Marshal(map[string]any{
		"model":           in.Model,
		"voice":           in.Voice,
		"input":           in.Input,
		"response_format": format,
	})
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.endpoint("/v1/audio/speech"), bytes.NewReader(raw))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	res, err := c.do(req)
	if err != nil {
		return nil, err
	}
	ct := res.Header.Get("Content-Type")
	if ct == "" {
		ct = mimeForFormat(format)
	}
	return &Speech{Body: res.Body, ContentType: ct}, nil
}

func mimeForFormat(f string) string {
	switch f {
	case "wav":
		return "audio/wav"
	case "flac":
		return "audio/flac"
	default:
		return "audio/mpeg"
	}
}

// ------------------------------------------------------------------ models

// Model is an installed (locally downloaded) Speaches model.
type Model struct {
	ID   string `json:"id"`
	Task string `json:"task,omitempty"`
}

// Models lists installed models (GET /v1/models).
func (c *Client) Models(ctx context.Context) ([]Model, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.endpoint("/v1/models"), nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/json")
	res, err := c.do(req)
	if err != nil {
		return nil, err
	}
	defer func() { _ = res.Body.Close() }()
	var out struct {
		Data []Model `json:"data"`
	}
	if err := json.NewDecoder(io.LimitReader(res.Body, 4<<20)).Decode(&out); err != nil {
		return nil, fmt.Errorf("decode models: %w", err)
	}
	return out.Data, nil
}
