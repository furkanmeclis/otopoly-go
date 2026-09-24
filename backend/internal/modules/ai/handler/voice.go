package handler

import (
	"bytes"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"time"

	aiusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/ai/usecase"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/pkg/response"
)

// Voice error codes.
const (
	CodeAIVoiceDisabled    = "AI_VOICE_DISABLED"
	CodeAIVoiceUnavailable = "AI_VOICE_UNAVAILABLE"
	CodeAudioTooLarge      = "AUDIO_TOO_LARGE"
	CodeAudioTooLong       = "AUDIO_TOO_LONG"
	CodeAudioUnsupported   = "AUDIO_UNSUPPORTED"
)

func writeVoiceError(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, aiusecase.ErrVoiceDisabled):
		response.Error(w, r, http.StatusForbidden, CodeAIVoiceDisabled, "Voice is disabled")
	case errors.Is(err, aiusecase.ErrVoiceUnavailable):
		slog.WarnContext(r.Context(), "ai_voice_upstream_failed", "error", err)
		response.Error(w, r, http.StatusBadGateway, CodeAIVoiceUnavailable, "The voice server is unavailable")
	case errors.Is(err, aiusecase.ErrAudioTooLarge):
		response.Error(w, r, http.StatusRequestEntityTooLarge, CodeAudioTooLarge, "Audio is too large")
	case errors.Is(err, aiusecase.ErrAudioTooLong):
		response.Error(w, r, http.StatusBadRequest, CodeAudioTooLong, "Audio is too long")
	case errors.Is(err, aiusecase.ErrAudioUnsupported):
		response.Error(w, r, http.StatusUnsupportedMediaType, CodeAudioUnsupported, "Unsupported audio type")
	default:
		writeError(w, r, err)
	}
}

// Transcribe accepts a multipart upload (field "file") and returns its text.
func (h *Handler) Transcribe(w http.ResponseWriter, r *http.Request) {
	// Multipart framing adds a little on top of the audio itself.
	r.Body = http.MaxBytesReader(w, r.Body, aiusecase.MaxAudioBytes+64<<10)
	mr, err := r.MultipartReader()
	if err != nil {
		response.BadRequest(w, r, response.CodeValidationError, "multipart/form-data body with a \"file\" field is required")
		return
	}
	var in aiusecase.TranscribeInput
	for {
		part, err := mr.NextPart()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			var tooBig *http.MaxBytesError
			if errors.As(err, &tooBig) {
				writeVoiceError(w, r, aiusecase.ErrAudioTooLarge)
				return
			}
			response.BadRequest(w, r, response.CodeValidationError, "invalid multipart body")
			return
		}
		if part.FormName() != "file" || in.Audio != nil {
			_ = part.Close()
			continue
		}
		var buf bytes.Buffer
		_, err = io.Copy(&buf, io.LimitReader(part, aiusecase.MaxAudioBytes+1))
		_ = part.Close()
		if err != nil {
			var tooBig *http.MaxBytesError
			if errors.As(err, &tooBig) {
				writeVoiceError(w, r, aiusecase.ErrAudioTooLarge)
				return
			}
			response.BadRequest(w, r, response.CodeValidationError, "invalid multipart body")
			return
		}
		in.Audio = buf.Bytes()
		in.Filename = part.FileName()
		in.ContentType = part.Header.Get("Content-Type")
	}
	if in.Audio == nil {
		response.BadRequest(w, r, response.CodeValidationError, "file is required")
		return
	}
	rc := http.NewResponseController(w)
	_ = rc.SetWriteDeadline(time.Now().Add(2 * time.Minute))
	res, err := h.svc.Transcribe(r.Context(), in)
	if err != nil {
		writeVoiceError(w, r, err)
		return
	}
	response.JSON(w, r, http.StatusOK, res)
}

// Speech streams synthesized audio (audio/mpeg) for assistant text.
func (h *Handler) Speech(w http.ResponseWriter, r *http.Request) {
	var in aiusecase.SpeechInput
	if !decodeJSON(w, r, &in) {
		return
	}
	sp, err := h.svc.Speak(r.Context(), in)
	if err != nil {
		writeVoiceError(w, r, err)
		return
	}
	defer func() { _ = sp.Body.Close() }()
	rc := http.NewResponseController(w)
	_ = rc.SetWriteDeadline(time.Now().Add(3 * time.Minute))
	w.Header().Set("Content-Type", sp.ContentType)
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.WriteHeader(http.StatusOK)
	buf := make([]byte, 32<<10)
	for {
		n, readErr := sp.Body.Read(buf)
		if n > 0 {
			if _, err := w.Write(buf[:n]); err != nil {
				return
			}
			_ = rc.Flush()
		}
		if readErr != nil {
			if !errors.Is(readErr, io.EOF) {
				slog.WarnContext(r.Context(), "ai_voice_speech_stream_failed", "error", readErr)
			}
			return
		}
	}
}

// TestVoice checks the Speaches server and the configured models.
func (h *Handler) TestVoice(w http.ResponseWriter, r *http.Request) {
	var in aiusecase.VoiceTestInput
	if r.ContentLength != 0 {
		if !decodeJSON(w, r, &in) {
			return
		}
	}
	res, err := h.svc.TestVoice(r.Context(), in)
	if err != nil {
		writeVoiceError(w, r, err)
		return
	}
	response.JSON(w, r, http.StatusOK, res)
}
