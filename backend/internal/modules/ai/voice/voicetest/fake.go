// Package voicetest provides an in-process fake Speaches server for tests.
package voicetest

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync"
	"time"
)

// Transcription is one recorded POST /v1/audio/transcriptions.
type Transcription struct {
	Model, Language, ResponseFormat, Filename, ContentType string
	Audio                                                  []byte
}

// Speech is one recorded POST /v1/audio/speech.
type Speech struct {
	Model, Voice, Input, ResponseFormat string
}

// Server is a fake Speaches with configurable answers.
type Server struct {
	*httptest.Server

	mu             sync.Mutex
	APIKey         string   // when set, requests need "Authorization: Bearer <APIKey>"
	Installed      []string // ids returned by GET /v1/models
	Registry       []map[string]any
	Downloads      []string
	DownloadDelay  time.Duration
	Unknown        map[string]bool
	Text           string  // transcription text
	Duration       float64 // transcription duration (seconds)
	Audio          []byte  // speech payload
	FailStatus     int     // when set, every audio call fails with this status
	Transcriptions []Transcription
	Speeches       []Speech
}

// New starts the fake; call Close when done.
func New() *Server {
	s := &Server{Text: "merhaba dünya", Duration: 2.5, Audio: []byte("ID3fake-mp3")}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", func(w http.ResponseWriter, _ *http.Request) { _, _ = io.WriteString(w, "OK") })
	mux.HandleFunc("GET /v1/models", s.auth(s.models))
	mux.HandleFunc("GET /v1/registry", s.auth(s.registry))
	mux.HandleFunc("POST /v1/models/", s.auth(s.download))
	mux.HandleFunc("POST /v1/audio/transcriptions", s.auth(s.transcribe))
	mux.HandleFunc("POST /v1/audio/speech", s.auth(s.speech))
	s.Server = httptest.NewServer(mux)
	return s
}

func (s *Server) auth(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		s.mu.Lock()
		key := s.APIKey
		s.mu.Unlock()
		if key != "" && r.Header.Get("Authorization") != "Bearer "+key {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusForbidden)
			_, _ = io.WriteString(w, `{"detail":"Invalid API key"}`)
			return
		}
		next(w, r)
	}
}

func (s *Server) fail(w http.ResponseWriter) bool {
	s.mu.Lock()
	status := s.FailStatus
	s.mu.Unlock()
	if status == 0 {
		return false
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_, _ = io.WriteString(w, `{"detail":"Model 'x' is not installed locally."}`)
	return true
}

func (s *Server) models(w http.ResponseWriter, _ *http.Request) {
	s.mu.Lock()
	defer s.mu.Unlock()
	data := []map[string]string{}
	for _, id := range s.Installed {
		task := "automatic-speech-recognition"
		if strings.Contains(id, "piper") || strings.Contains(id, "Kokoro") {
			task = "text-to-speech"
		}
		data = append(data, map[string]string{"id": id, "object": "model", "task": task})
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{"object": "list", "data": data})
}

func (s *Server) registry(w http.ResponseWriter, r *http.Request) {
	s.mu.Lock()
	defer s.mu.Unlock()
	task := r.URL.Query().Get("task")
	out := []map[string]any{}
	for _, m := range s.Registry {
		if task == "" || m["task"] == task {
			out = append(out, m)
		}
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{"data": out, "object": "list"})
}

func (s *Server) download(w http.ResponseWriter, r *http.Request) {
	id := strings.TrimPrefix(r.URL.Path, "/v1/models/")
	if unescaped, err := url.PathUnescape(id); err == nil {
		id = unescaped
	}
	s.mu.Lock()
	delay := s.DownloadDelay
	s.mu.Unlock()
	if delay > 0 {
		time.Sleep(delay)
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.Unknown != nil && s.Unknown[id] {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusNotFound)
		_, _ = io.WriteString(w, `{"detail":"unknown model"}`)
		return
	}
	for _, installed := range s.Installed {
		if installed == id {
			w.WriteHeader(http.StatusCreated)
			return
		}
	}
	s.Downloads = append(s.Downloads, id)
	s.Installed = append(s.Installed, id)
	w.WriteHeader(http.StatusOK)
}

func (s *Server) transcribe(w http.ResponseWriter, r *http.Request) {
	if s.fail(w) {
		return
	}
	if err := r.ParseMultipartForm(32 << 20); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	f, hdr, err := r.FormFile("file")
	if err != nil {
		http.Error(w, err.Error(), http.StatusUnprocessableEntity)
		return
	}
	audio, _ := io.ReadAll(f)
	_ = f.Close()
	s.mu.Lock()
	s.Transcriptions = append(s.Transcriptions, Transcription{
		Model: r.FormValue("model"), Language: r.FormValue("language"), ResponseFormat: r.FormValue("response_format"),
		Filename: hdr.Filename, ContentType: hdr.Header.Get("Content-Type"), Audio: audio,
	})
	out := map[string]any{"text": " " + s.Text + " ", "language": "tr", "duration": s.Duration, "segments": []any{}}
	s.mu.Unlock()
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(out)
}

func (s *Server) speech(w http.ResponseWriter, r *http.Request) {
	if s.fail(w) {
		return
	}
	var body struct {
		Model          string `json:"model"`
		Voice          string `json:"voice"`
		Input          string `json:"input"`
		ResponseFormat string `json:"response_format"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, err.Error(), http.StatusUnprocessableEntity)
		return
	}
	s.mu.Lock()
	s.Speeches = append(s.Speeches, Speech{Model: body.Model, Voice: body.Voice, Input: body.Input, ResponseFormat: body.ResponseFormat})
	audio := append([]byte{}, s.Audio...)
	s.mu.Unlock()
	w.Header().Set("Content-Type", "audio/mpeg")
	_, _ = w.Write(audio)
}

// Last returns the most recent transcription and speech calls.
func (s *Server) Last() (Transcription, Speech) {
	s.mu.Lock()
	defer s.mu.Unlock()
	var t Transcription
	var sp Speech
	if n := len(s.Transcriptions); n > 0 {
		t = s.Transcriptions[n-1]
	}
	if n := len(s.Speeches); n > 0 {
		sp = s.Speeches[n-1]
	}
	return t, sp
}

// Set mutates the fake under its lock.
func (s *Server) Set(fn func(s *Server)) {
	s.mu.Lock()
	defer s.mu.Unlock()
	fn(s)
}
