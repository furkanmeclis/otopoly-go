package handler

import (
	"bytes"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestDecodeSaveMultipartAndJSON(t *testing.T) {
	var body bytes.Buffer
	mw := multipart.NewWriter(&body)
	_ = mw.WriteField("key_id", "GS6Q2FZ3PT")
	_ = mw.WriteField("environment", "sandbox")
	fw, _ := mw.CreateFormFile("private_key", "AuthKey_GS6Q2FZ3PT.p8")
	_, _ = fw.Write([]byte("-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----\n"))
	_ = mw.Close()
	r := httptest.NewRequest(http.MethodPut, "/", &body)
	r.Header.Set("Content-Type", mw.FormDataContentType())
	in, ok := decodeSave(httptest.NewRecorder(), r)
	if !ok || in.KeyID != "GS6Q2FZ3PT" || in.Environment != "sandbox" || !strings.HasPrefix(in.PrivateKey, "-----BEGIN PRIVATE KEY-----") {
		t.Fatalf("multipart: %+v %v", in, ok)
	}

	r = httptest.NewRequest(http.MethodPut, "/", strings.NewReader(`{"key_id":"GS6Q2FZ3PT","private_key":"PEM"}`))
	r.Header.Set("Content-Type", "application/json")
	in, ok = decodeSave(httptest.NewRecorder(), r)
	if !ok || in.KeyID != "GS6Q2FZ3PT" || in.PrivateKey != "PEM" {
		t.Fatalf("json: %+v %v", in, ok)
	}

	big := bytes.Repeat([]byte("a"), maxBodyBytes+10)
	r = httptest.NewRequest(http.MethodPut, "/", bytes.NewReader(big))
	r.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	if _, ok := decodeSave(w, r); ok || w.Code != http.StatusBadRequest {
		t.Fatalf("oversized body accepted: %d", w.Code)
	}
}
