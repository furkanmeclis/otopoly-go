package handler

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"

	contractsusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/contracts/usecase"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/pkg/apiquery"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/pkg/response"
	"github.com/google/uuid"
)

type Handler struct {
	svc *contractsusecase.Service
}

func New(svc *contractsusecase.Service) *Handler {
	return &Handler{svc: svc}
}

func writeError(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, contractsusecase.ErrOTPRateLimited):
		response.TooManyRequests(w, r, err.Error())
	case errors.Is(err, contractsusecase.ErrOTPRequired):
		response.Conflict(w, r, "OTP_REQUIRED", err.Error())
	case errors.Is(err, contractsusecase.ErrOTPInvalid):
		response.BadRequest(w, r, "INVALID_OTP_CODE", err.Error())
	case errors.Is(err, contractsusecase.ErrOTPChannelUnavailable):
		response.Conflict(w, r, "OTP_CHANNEL_UNAVAILABLE", err.Error())
	case errors.Is(err, contractsusecase.ErrNotFound):
		response.NotFound(w, r, "not found")
	case errors.Is(err, contractsusecase.ErrConflict):
		response.Conflict(w, r, response.CodeConflict, err.Error())
	case errors.Is(err, contractsusecase.ErrInvalidRequest):
		response.BadRequest(w, r, response.CodeValidationError, err.Error())
	default:
		response.InternalErr(w, r, err, "request failed")
	}
}

func clientIP(r *http.Request) string {
	if xff := strings.TrimSpace(r.Header.Get("X-Forwarded-For")); xff != "" {
		parts := strings.Split(xff, ",")
		return strings.TrimSpace(parts[0])
	}
	host, _, err := net.SplitHostPort(strings.TrimSpace(r.RemoteAddr))
	if err != nil {
		return strings.TrimSpace(r.RemoteAddr)
	}
	return host
}

func contentDispositionAttachment(filename string) string {
	safe := strings.Map(func(r rune) rune {
		if r >= 'a' && r <= 'z' || r >= 'A' && r <= 'Z' || r >= '0' && r <= '9' || r == '.' || r == '_' || r == '-' {
			return r
		}
		return '_'
	}, filename)
	return fmt.Sprintf(`attachment; filename="%s"; filename*=UTF-8''%s`, safe, url.PathEscape(filename))
}

// --- Platform presets ---

func (h *Handler) PresetMeta(w http.ResponseWriter, r *http.Request) {
	response.JSON(w, r, http.StatusOK, h.svc.PlatformResourceMeta())
}

func (h *Handler) ListPresets(w http.ResponseWriter, r *http.Request) {
	if banned := apiquery.ForbiddenParams(r.URL.Query()); len(banned) > 0 {
		response.BadRequest(w, r, response.CodeValidationError, "forbidden query parameter")
		return
	}
	q := apiquery.Parse(r.URL.Query())
	var isActive *bool
	if v := r.URL.Query().Get("is_active"); v != "" {
		b := v == "true"
		isActive = &b
	}
	items, total, err := h.svc.ListPresets(r.Context(), q.Limit, q.Offset, contractsusecase.PresetFilters{
		Q: q.Q, IsActive: isActive, Sort: strings.TrimSpace(r.URL.Query().Get("sort")),
	})
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.JSON(w, r, http.StatusOK, apiquery.NewPage(items, total, q.Limit, q.Offset))
}

// ListPresetsForTenant lists active platform presets for tenant clone UX.
func (h *Handler) ListPresetsForTenant(w http.ResponseWriter, r *http.Request) {
	if banned := apiquery.ForbiddenParams(r.URL.Query()); len(banned) > 0 {
		response.BadRequest(w, r, response.CodeValidationError, "forbidden query parameter")
		return
	}
	q := apiquery.Parse(r.URL.Query())
	active := true
	items, total, err := h.svc.ListPresets(r.Context(), q.Limit, q.Offset, contractsusecase.PresetFilters{
		Q: q.Q, IsActive: &active, Sort: strings.TrimSpace(r.URL.Query().Get("sort")),
	})
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.JSON(w, r, http.StatusOK, apiquery.NewPage(items, total, q.Limit, q.Offset))
}

func (h *Handler) CreatePreset(w http.ResponseWriter, r *http.Request) {
	var in contractsusecase.CreatePresetInput
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		response.BadRequest(w, r, response.CodeValidationError, "invalid JSON body")
		return
	}
	item, err := h.svc.CreatePreset(r.Context(), in)
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.JSON(w, r, http.StatusCreated, item)
}

func (h *Handler) GetPreset(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(r.PathValue("uuid"))
	if err != nil {
		response.BadRequest(w, r, response.CodeValidationError, "preset uuid is invalid")
		return
	}
	item, err := h.svc.GetPreset(r.Context(), id)
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.JSON(w, r, http.StatusOK, item)
}

func (h *Handler) PatchPreset(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(r.PathValue("uuid"))
	if err != nil {
		response.BadRequest(w, r, response.CodeValidationError, "preset uuid is invalid")
		return
	}
	var in contractsusecase.PatchPresetInput
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		response.BadRequest(w, r, response.CodeValidationError, "invalid JSON body")
		return
	}
	item, err := h.svc.PatchPreset(r.Context(), id, in)
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.JSON(w, r, http.StatusOK, item)
}

func (h *Handler) DeletePreset(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(r.PathValue("uuid"))
	if err != nil {
		response.BadRequest(w, r, response.CodeValidationError, "preset uuid is invalid")
		return
	}
	if err := h.svc.DeletePreset(r.Context(), id); err != nil {
		writeError(w, r, err)
		return
	}
	response.JSON(w, r, http.StatusOK, map[string]any{"deleted": true})
}

// --- Tenant templates ---

func (h *Handler) TemplateMeta(w http.ResponseWriter, r *http.Request) {
	response.JSON(w, r, http.StatusOK, h.svc.TenantResourceMeta())
}

func (h *Handler) ListTemplates(w http.ResponseWriter, r *http.Request) {
	if banned := apiquery.ForbiddenParams(r.URL.Query()); len(banned) > 0 {
		response.BadRequest(w, r, response.CodeValidationError, "forbidden query parameter")
		return
	}
	q := apiquery.Parse(r.URL.Query())
	var isActive *bool
	if v := r.URL.Query().Get("is_active"); v != "" {
		b := v == "true"
		isActive = &b
	}
	items, total, err := h.svc.ListTemplates(r.Context(), q.Limit, q.Offset, contractsusecase.TemplateFilters{
		Q: q.Q, IsActive: isActive, Sort: strings.TrimSpace(r.URL.Query().Get("sort")),
	})
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.JSON(w, r, http.StatusOK, apiquery.NewPage(items, total, q.Limit, q.Offset))
}

func (h *Handler) CreateTemplate(w http.ResponseWriter, r *http.Request) {
	var in contractsusecase.CreateTemplateInput
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		response.BadRequest(w, r, response.CodeValidationError, "invalid JSON body")
		return
	}
	item, err := h.svc.CreateTemplate(r.Context(), in)
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.JSON(w, r, http.StatusCreated, item)
}

func (h *Handler) CloneTemplate(w http.ResponseWriter, r *http.Request) {
	var in contractsusecase.CloneTemplateInput
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		response.BadRequest(w, r, response.CodeValidationError, "invalid JSON body")
		return
	}
	item, err := h.svc.CloneTemplate(r.Context(), in)
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.JSON(w, r, http.StatusCreated, item)
}

func (h *Handler) GetTemplate(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(r.PathValue("uuid"))
	if err != nil {
		response.BadRequest(w, r, response.CodeValidationError, "template uuid is invalid")
		return
	}
	item, err := h.svc.GetTemplate(r.Context(), id)
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.JSON(w, r, http.StatusOK, item)
}

func (h *Handler) PatchTemplate(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(r.PathValue("uuid"))
	if err != nil {
		response.BadRequest(w, r, response.CodeValidationError, "template uuid is invalid")
		return
	}
	var in contractsusecase.PatchTemplateInput
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		response.BadRequest(w, r, response.CodeValidationError, "invalid JSON body")
		return
	}
	item, err := h.svc.PatchTemplate(r.Context(), id, in)
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.JSON(w, r, http.StatusOK, item)
}

func (h *Handler) DeleteTemplate(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(r.PathValue("uuid"))
	if err != nil {
		response.BadRequest(w, r, response.CodeValidationError, "template uuid is invalid")
		return
	}
	if err := h.svc.DeleteTemplate(r.Context(), id); err != nil {
		writeError(w, r, err)
		return
	}
	response.JSON(w, r, http.StatusOK, map[string]any{"deleted": true})
}

// --- Tenant instances ---

func (h *Handler) ListInstances(w http.ResponseWriter, r *http.Request) {
	if banned := apiquery.ForbiddenParams(r.URL.Query()); len(banned) > 0 {
		response.BadRequest(w, r, response.CodeValidationError, "forbidden query parameter")
		return
	}
	q := apiquery.Parse(r.URL.Query())
	filters := contractsusecase.InstanceFilters{
		Q:           q.Q,
		Status:      strings.TrimSpace(r.URL.Query().Get("status")),
		SubjectType: strings.TrimSpace(r.URL.Query().Get("subject_type")),
	}
	if raw := strings.TrimSpace(r.URL.Query().Get("subject_uuid")); raw != "" {
		id, err := uuid.Parse(raw)
		if err != nil {
			response.BadRequest(w, r, response.CodeValidationError, "subject_uuid is invalid")
			return
		}
		filters.SubjectUUID = &id
	}
	items, total, err := h.svc.ListInstances(r.Context(), q.Limit, q.Offset, filters)
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.JSON(w, r, http.StatusOK, apiquery.NewPage(items, total, q.Limit, q.Offset))
}

func (h *Handler) CreateInstance(w http.ResponseWriter, r *http.Request) {
	var in contractsusecase.CreateInstanceInput
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		response.BadRequest(w, r, response.CodeValidationError, "invalid JSON body")
		return
	}
	item, err := h.svc.CreateInstance(r.Context(), in)
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.JSON(w, r, http.StatusCreated, item)
}

func (h *Handler) GetInstance(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(r.PathValue("uuid"))
	if err != nil {
		response.BadRequest(w, r, response.CodeValidationError, "instance uuid is invalid")
		return
	}
	item, err := h.svc.GetInstance(r.Context(), id)
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.JSON(w, r, http.StatusOK, item)
}

func (h *Handler) VoidInstance(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(r.PathValue("uuid"))
	if err != nil {
		response.BadRequest(w, r, response.CodeValidationError, "instance uuid is invalid")
		return
	}
	item, err := h.svc.VoidInstance(r.Context(), id)
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.JSON(w, r, http.StatusOK, item)
}

func (h *Handler) Sign(w http.ResponseWriter, r *http.Request) {
	instanceID, err := uuid.Parse(r.PathValue("uuid"))
	if err != nil {
		response.BadRequest(w, r, response.CodeValidationError, "instance uuid is invalid")
		return
	}
	signerID, err := uuid.Parse(r.PathValue("signerUuid"))
	if err != nil {
		response.BadRequest(w, r, response.CodeValidationError, "signer uuid is invalid")
		return
	}
	var in contractsusecase.SignInput
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		response.BadRequest(w, r, response.CodeValidationError, "invalid JSON body")
		return
	}
	in.IPAddress = clientIP(r)
	in.UserAgent = r.UserAgent()
	item, err := h.svc.Sign(r.Context(), instanceID, signerID, in)
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.JSON(w, r, http.StatusOK, item)
}

func (h *Handler) SendSignerOTP(w http.ResponseWriter, r *http.Request) {
	instanceID, signerID, ok := parseInstanceSigner(w, r)
	if !ok {
		return
	}
	var in contractsusecase.SendOTPInput
	if r.ContentLength != 0 {
		if err := json.NewDecoder(r.Body).Decode(&in); err != nil && !errors.Is(err, io.EOF) {
			response.BadRequest(w, r, response.CodeValidationError, "invalid JSON body")
			return
		}
	}
	in.IPAddress = clientIP(r)
	in.UserAgent = r.UserAgent()
	item, err := h.svc.SendSignerOTP(r.Context(), instanceID, signerID, in)
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.JSON(w, r, http.StatusOK, item)
}

func (h *Handler) VerifySignerOTP(w http.ResponseWriter, r *http.Request) {
	instanceID, signerID, ok := parseInstanceSigner(w, r)
	if !ok {
		return
	}
	var in contractsusecase.VerifyOTPInput
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		response.BadRequest(w, r, response.CodeValidationError, "invalid JSON body")
		return
	}
	item, err := h.svc.VerifySignerOTP(r.Context(), instanceID, signerID, in)
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.JSON(w, r, http.StatusOK, item)
}

func parseInstanceSigner(w http.ResponseWriter, r *http.Request) (uuid.UUID, uuid.UUID, bool) {
	instanceID, err := uuid.Parse(r.PathValue("uuid"))
	if err != nil {
		response.BadRequest(w, r, response.CodeValidationError, "instance uuid is invalid")
		return uuid.Nil, uuid.Nil, false
	}
	signerID, err := uuid.Parse(r.PathValue("signerUuid"))
	if err != nil {
		response.BadRequest(w, r, response.CodeValidationError, "signer uuid is invalid")
		return uuid.Nil, uuid.Nil, false
	}
	return instanceID, signerID, true
}

func (h *Handler) UploadMedia(w http.ResponseWriter, r *http.Request) {
	instanceID, err := uuid.Parse(r.PathValue("uuid"))
	if err != nil {
		response.BadRequest(w, r, response.CodeValidationError, "instance uuid is invalid")
		return
	}
	if err := r.ParseMultipartForm(12 << 20); err != nil {
		response.BadRequest(w, r, response.CodeValidationError, "invalid multipart form")
		return
	}
	file, header, err := r.FormFile("file")
	if err != nil {
		response.BadRequest(w, r, response.CodeValidationError, "file is required")
		return
	}
	defer func() { _ = file.Close() }()
	data, err := io.ReadAll(file)
	if err != nil {
		response.InternalErr(w, r, err, "failed to read upload")
		return
	}
	ct := header.Header.Get("Content-Type")
	item, err := h.svc.UploadMedia(r.Context(), instanceID, contractsusecase.UploadMediaInput{
		FileName:    header.Filename,
		ContentType: ct,
		Caption:     strings.TrimSpace(r.FormValue("caption")),
		Body:        data,
	})
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.JSON(w, r, http.StatusCreated, item)
}

func (h *Handler) DeleteMedia(w http.ResponseWriter, r *http.Request) {
	instanceID, err := uuid.Parse(r.PathValue("uuid"))
	if err != nil {
		response.BadRequest(w, r, response.CodeValidationError, "instance uuid is invalid")
		return
	}
	mediaID, err := uuid.Parse(r.PathValue("mediaUuid"))
	if err != nil {
		response.BadRequest(w, r, response.CodeValidationError, "media uuid is invalid")
		return
	}
	if err := h.svc.DeleteMedia(r.Context(), instanceID, mediaID); err != nil {
		writeError(w, r, err)
		return
	}
	response.JSON(w, r, http.StatusOK, map[string]any{"deleted": true})
}

func (h *Handler) DownloadPDF(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(r.PathValue("uuid"))
	if err != nil {
		response.BadRequest(w, r, response.CodeValidationError, "instance uuid is invalid")
		return
	}
	file, ct, filename, err := h.svc.DownloadPDF(r.Context(), id)
	if err != nil {
		writeError(w, r, err)
		return
	}
	defer func() { _ = file.Close() }()
	w.Header().Set("Content-Type", ct)
	w.Header().Set("Content-Disposition", contentDispositionAttachment(filename))
	_, _ = io.Copy(w, file)
}
