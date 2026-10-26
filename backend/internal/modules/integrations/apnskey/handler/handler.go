// Package handler exposes the platform APNs key endpoints.
package handler

import (
	"encoding/json"
	"errors"
	"io"
	"mime"
	"net/http"
	"strings"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/integrations/apnskey/usecase"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/activity"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/authctx"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/pkg/response"
)

const (
	activityResource = "platform.integrations.apple.apns"
	maxBodyBytes     = 64 << 10
	maxKeyFileBytes  = 16 << 10
)

// Handler serves /v1/platform/integrations/apple/apns.
type Handler struct {
	svc      *usecase.Service
	activity *activity.Recorder
}

// New builds the handler.
func New(svc *usecase.Service, rec *activity.Recorder) *Handler {
	return &Handler{svc: svc, activity: rec}
}

// Get returns the status and masked hints.
func (h *Handler) Get(w http.ResponseWriter, r *http.Request) {
	st, err := h.svc.Get(r.Context())
	if err != nil {
		response.InternalErr(w, r, err, "failed to load APNs settings")
		return
	}
	response.JSON(w, r, http.StatusOK, st)
}

// Put uploads the .p8 (multipart file or PEM text) and the key fields.
func (h *Handler) Put(w http.ResponseWriter, r *http.Request) {
	in, ok := decodeSave(w, r)
	if !ok {
		return
	}
	actorID := actorInternalID(r)
	res, err := h.svc.Save(r.Context(), actorID, in)
	if err != nil {
		writeError(w, r, err)
		return
	}
	if h.activity != nil {
		h.activity.Record(r.Context(), actorID, "integrations.apns.updated", activityResource, nil, map[string]any{
			"key_id":       res.Status.KeyID,
			"team_id_set":  res.Status.TeamID != "",
			"bundle_id":    res.Status.BundleID,
			"environment":  res.Status.Environment,
			"key_uploaded": res.KeyUploaded,
		}, r)
	}
	response.JSON(w, r, http.StatusOK, res.Status)
}

// Delete removes the stored key.
func (h *Handler) Delete(w http.ResponseWriter, r *http.Request) {
	actorID := actorInternalID(r)
	before, _ := h.svc.Get(r.Context())
	st, err := h.svc.Delete(r.Context(), actorID)
	if err != nil {
		response.InternalErr(w, r, err, "failed to remove APNs key")
		return
	}
	if h.activity != nil {
		h.activity.Record(r.Context(), actorID, "integrations.apns.removed", activityResource, nil, map[string]any{
			"key_id": before.KeyID,
			"source": st.Source,
		}, r)
	}
	response.JSON(w, r, http.StatusOK, st)
}

// Test probes APNs with the active credentials.
func (h *Handler) Test(w http.ResponseWriter, r *http.Request) {
	res, err := h.svc.Test(r.Context())
	if err != nil {
		response.InternalErr(w, r, err, "failed to test APNs")
		return
	}
	if h.activity != nil {
		meta := map[string]any{
			"ok": res.OK, "verdict": res.Verdict, "reason": res.Reason,
			"source": res.Source, "environment": res.Environment,
		}
		if res.Status != nil {
			meta["status"] = *res.Status
		}
		h.activity.Record(r.Context(), actorInternalID(r), "integrations.apns.tested", activityResource, nil, meta, r)
	}
	response.JSON(w, r, http.StatusOK, res)
}

func decodeSave(w http.ResponseWriter, r *http.Request) (usecase.SaveInput, bool) {
	r.Body = http.MaxBytesReader(w, r.Body, maxBodyBytes)
	mediaType, _, _ := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if mediaType != "multipart/form-data" {
		var in usecase.SaveInput
		if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
			response.BadRequest(w, r, response.CodeValidationError, "invalid body")
			return in, false
		}
		return in, true
	}
	if err := r.ParseMultipartForm(maxBodyBytes); err != nil {
		response.BadRequest(w, r, response.CodeValidationError, "invalid multipart body")
		return usecase.SaveInput{}, false
	}
	in := usecase.SaveInput{
		KeyID:       r.FormValue("key_id"),
		TeamID:      r.FormValue("team_id"),
		BundleID:    r.FormValue("bundle_id"),
		Environment: r.FormValue("environment"),
		PrivateKey:  r.FormValue("private_key"),
	}
	if file, _, err := r.FormFile("private_key"); err == nil {
		defer func() { _ = file.Close() }()
		raw, err := io.ReadAll(io.LimitReader(file, maxKeyFileBytes+1))
		if err != nil || len(raw) > maxKeyFileBytes {
			response.ValidationError(w, r, []response.Detail{{Field: "private_key", Code: "invalid", Message: "private_key file is too large"}})
			return in, false
		}
		in.PrivateKey = strings.TrimSpace(string(raw))
	}
	return in, true
}

func writeError(w http.ResponseWriter, r *http.Request, err error) {
	var fe *usecase.FieldError
	if errors.As(err, &fe) {
		response.ValidationError(w, r, []response.Detail{{Field: fe.Field, Code: fe.Code, Message: fe.Message}})
		return
	}
	if errors.Is(err, usecase.ErrInvalidRequest) {
		response.BadRequest(w, r, response.CodeValidationError, err.Error())
		return
	}
	response.InternalErr(w, r, err, "failed to save APNs settings")
}

func actorInternalID(r *http.Request) *int64 {
	p, ok := authctx.PrincipalFrom(r.Context())
	if !ok {
		return nil
	}
	id := p.UserInternal
	return &id
}
