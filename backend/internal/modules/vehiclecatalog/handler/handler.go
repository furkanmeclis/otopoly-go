package handler

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strconv"
	"strings"

	vehicleusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/vehiclecatalog/usecase"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/storage"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/pkg/apiquery"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/pkg/response"
	"github.com/google/uuid"
)

type Handler struct {
	svc   *vehicleusecase.Service
	store storage.Driver
}

func New(svc *vehicleusecase.Service, store storage.Driver) *Handler {
	return &Handler{svc: svc, store: store}
}

func writeError(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, vehicleusecase.ErrNotFound):
		response.NotFound(w, r, "not found")
	case errors.Is(err, vehicleusecase.ErrConflict):
		response.Conflict(w, r, response.CodeConflict, err.Error())
	case errors.Is(err, vehicleusecase.ErrInvalidRequest):
		response.BadRequest(w, r, response.CodeValidationError, err.Error())
	default:
		response.InternalErr(w, r, err, "request failed")
	}
}

func (h *Handler) Meta(w http.ResponseWriter, r *http.Request) {
	response.JSON(w, r, http.StatusOK, h.svc.BrandsResourceMeta())
}

func (h *Handler) List(w http.ResponseWriter, r *http.Request) {
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
	sort := strings.TrimSpace(r.URL.Query().Get("sort"))
	items, total, err := h.svc.ListBrands(r.Context(), q.Limit, q.Offset, vehicleusecase.BrandFilters{
		Q:        q.Q,
		IsActive: isActive,
		Sort:     sort,
	})
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.JSON(w, r, http.StatusOK, apiquery.NewPage(items, total, q.Limit, q.Offset))
}

func (h *Handler) Create(w http.ResponseWriter, r *http.Request) {
	var in vehicleusecase.CreateBrandInput
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		response.BadRequest(w, r, response.CodeValidationError, "invalid JSON body")
		return
	}
	item, err := h.svc.CreateBrand(r.Context(), in)
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.JSON(w, r, http.StatusCreated, item)
}

func (h *Handler) Get(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(r.PathValue("uuid"))
	if err != nil {
		response.BadRequest(w, r, response.CodeValidationError, "brand uuid is invalid")
		return
	}
	item, err := h.svc.GetBrand(r.Context(), id)
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.JSON(w, r, http.StatusOK, item)
}

func (h *Handler) Patch(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(r.PathValue("uuid"))
	if err != nil {
		response.BadRequest(w, r, response.CodeValidationError, "brand uuid is invalid")
		return
	}
	var in vehicleusecase.PatchBrandInput
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		response.BadRequest(w, r, response.CodeValidationError, "invalid JSON body")
		return
	}
	item, err := h.svc.PatchBrand(r.Context(), id, in)
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.JSON(w, r, http.StatusOK, item)
}

func (h *Handler) Delete(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(r.PathValue("uuid"))
	if err != nil {
		response.BadRequest(w, r, response.CodeValidationError, "brand uuid is invalid")
		return
	}
	if err := h.svc.DeleteBrand(r.Context(), id); err != nil {
		writeError(w, r, err)
		return
	}
	response.JSON(w, r, http.StatusOK, map[string]any{"deleted": true})
}

func (h *Handler) UploadLogo(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(r.PathValue("uuid"))
	if err != nil {
		response.BadRequest(w, r, response.CodeValidationError, "brand uuid is invalid")
		return
	}
	// Cap the whole body: ParseMultipartForm only bounds memory and spills
	// the rest to temp files.
	r.Body = http.MaxBytesReader(w, r.Body, (3<<20)+(1<<20))
	if err := r.ParseMultipartForm(3 << 20); err != nil {
		response.BadRequest(w, r, response.CodeValidationError, "invalid multipart form")
		return
	}
	file, header, err := r.FormFile("logo")
	if err != nil {
		response.BadRequest(w, r, response.CodeValidationError, "logo is required")
		return
	}
	defer func() { _ = file.Close() }()
	head := make([]byte, 512)
	n, _ := io.ReadFull(file, head)
	mime, err := storage.DetectLogoMIME(header.Header.Get("Content-Type"), head[:n])
	if err != nil {
		response.BadRequest(w, r, response.CodeValidationError, err.Error())
		return
	}
	if err := storage.ValidateLogoSize(header.Size); err != nil {
		response.BadRequest(w, r, response.CodeValidationError, err.Error())
		return
	}
	ext, err := storage.LogoExtForMIME(mime)
	if err != nil {
		response.BadRequest(w, r, response.CodeValidationError, err.Error())
		return
	}
	key := storage.VehicleBrandLogoObjectKey(id, ext)
	body := io.MultiReader(strings.NewReader(string(head[:n])), file)
	if err := h.store.Upload(r.Context(), storage.File{
		Body: body, Size: header.Size, ContentType: mime, Filename: header.Filename,
	}, key); err != nil {
		response.InternalErr(w, r, err, "logo upload failed")
		return
	}
	item, err := h.svc.SetLogo(r.Context(), id, key)
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.JSON(w, r, http.StatusOK, item)
}

func (h *Handler) PublicStreamLogo(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(r.PathValue("uuid"))
	if err != nil {
		response.BadRequest(w, r, response.CodeValidationError, "brand uuid is invalid")
		return
	}
	key, err := h.svc.LogoObjectKey(r.Context(), id)
	if err != nil {
		writeError(w, r, err)
		return
	}
	rc, _, err := h.store.Download(r.Context(), key)
	if err != nil {
		response.NotFound(w, r, "logo not found")
		return
	}
	defer func() { _ = rc.Close() }()
	w.Header().Set("Content-Type", storage.MIMEFromLogoKey(key))
	_, _ = io.Copy(w, rc)
}

func (h *Handler) CreateModel(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(r.PathValue("uuid"))
	if err != nil {
		response.BadRequest(w, r, response.CodeValidationError, "brand uuid is invalid")
		return
	}
	var in vehicleusecase.CreateModelInput
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		response.BadRequest(w, r, response.CodeValidationError, "invalid JSON body")
		return
	}
	item, err := h.svc.CreateModel(r.Context(), id, in)
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.JSON(w, r, http.StatusCreated, item)
}

func (h *Handler) DeleteModel(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(r.PathValue("uuid"))
	if err != nil {
		response.BadRequest(w, r, response.CodeValidationError, "model uuid is invalid")
		return
	}
	if err := h.svc.DeleteModel(r.Context(), id); err != nil {
		writeError(w, r, err)
		return
	}
	response.JSON(w, r, http.StatusOK, map[string]any{"deleted": true})
}

func (h *Handler) AddYear(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(r.PathValue("uuid"))
	if err != nil {
		response.BadRequest(w, r, response.CodeValidationError, "model uuid is invalid")
		return
	}
	var in vehicleusecase.AddYearInput
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		response.BadRequest(w, r, response.CodeValidationError, "invalid JSON body")
		return
	}
	if err := h.svc.AddYear(r.Context(), id, in.Year); err != nil {
		writeError(w, r, err)
		return
	}
	response.JSON(w, r, http.StatusOK, map[string]any{"year": in.Year})
}

func (h *Handler) DeleteYear(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(r.PathValue("uuid"))
	if err != nil {
		response.BadRequest(w, r, response.CodeValidationError, "model uuid is invalid")
		return
	}
	year, err := strconv.Atoi(r.PathValue("year"))
	if err != nil {
		response.BadRequest(w, r, response.CodeValidationError, "year is invalid")
		return
	}
	if err := h.svc.DeleteYear(r.Context(), id, year); err != nil {
		writeError(w, r, err)
		return
	}
	response.JSON(w, r, http.StatusOK, map[string]any{"deleted": true})
}

func (h *Handler) Import(w http.ResponseWriter, r *http.Request) {
	var payload map[string]map[string][]string
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		response.BadRequest(w, r, response.CodeValidationError, "invalid JSON body")
		return
	}
	result, err := h.svc.Import(r.Context(), payload)
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.JSON(w, r, http.StatusOK, result)
}

func (h *Handler) Search(w http.ResponseWriter, r *http.Request) {
	q := apiquery.Parse(r.URL.Query())
	items, err := h.svc.SearchOptions(r.Context(), q.Q, int(q.Limit))
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.JSON(w, r, http.StatusOK, map[string]any{"items": items})
}
