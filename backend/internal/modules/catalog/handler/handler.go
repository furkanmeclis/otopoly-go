package handler

import (
	"encoding/json"
	"errors"
	"net/http"

	catalogusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/catalog/usecase"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/pkg/apiquery"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/pkg/response"
	"github.com/google/uuid"
)

type Handler struct {
	svc *catalogusecase.Service
}

func New(svc *catalogusecase.Service) *Handler {
	return &Handler{svc: svc}
}

func (h *Handler) Summary(w http.ResponseWriter, r *http.Request) {
	summary, err := h.svc.GetSummary(r.Context())
	if err != nil {
		response.InternalErr(w, r, err, "failed to load catalog summary")
		return
	}
	response.JSON(w, r, http.StatusOK, summary)
}

// ============================================================================
// Categories
// ============================================================================

func (h *Handler) CategoriesMeta(w http.ResponseWriter, r *http.Request) {
	response.JSON(w, r, http.StatusOK, h.svc.CategoriesResourceMeta())
}

func (h *Handler) ListCategories(w http.ResponseWriter, r *http.Request) {
	q := apiquery.Parse(r.URL.Query())
	var isActive *bool
	if v := r.URL.Query().Get("is_active"); v != "" {
		b := v == "true"
		isActive = &b
	}
	filters := catalogusecase.CategoryFilters{
		Kind:     r.URL.Query().Get("kind"),
		IsActive: isActive,
		Q:        q.Q,
	}
	items, err := h.svc.ListCategories(r.Context(), filters)
	if err != nil {
		response.InternalErr(w, r, err, "failed to list categories")
		return
	}
	response.JSON(w, r, http.StatusOK, map[string]any{
		"items": items,
		"total": len(items),
	})
}

func (h *Handler) CreateCategory(w http.ResponseWriter, r *http.Request) {
	var body struct {
		ParentUUID *uuid.UUID `json:"parent_uuid"`
		Name       string     `json:"name"`
		Kind       string     `json:"kind"`
		SortOrder  int32      `json:"sort_order"`
		IsActive   *bool      `json:"is_active"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		response.BadRequest(w, r, response.CodeValidationError, "Invalid JSON body")
		return
	}
	cat, err := h.svc.CreateCategory(r.Context(), catalogusecase.CreateCategoryInput{
		ParentUUID: body.ParentUUID,
		Name:       body.Name,
		Kind:       body.Kind,
		SortOrder:  body.SortOrder,
		IsActive:   body.IsActive,
	})
	if err != nil {
		if errors.Is(err, catalogusecase.ErrConflict) {
			response.Conflict(w, r, response.CodeConflict, err.Error())
			return
		}
		if errors.Is(err, catalogusecase.ErrInvalidRequest) {
			response.BadRequest(w, r, response.CodeValidationError, err.Error())
			return
		}
		response.InternalErr(w, r, err, "failed to create category")
		return
	}
	response.JSON(w, r, http.StatusCreated, cat)
}

func (h *Handler) GetCategory(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(r.PathValue("uuid"))
	if err != nil {
		response.BadRequest(w, r, response.CodeValidationError, "Invalid category UUID")
		return
	}
	cat, err := h.svc.GetCategory(r.Context(), id)
	if err != nil {
		if errors.Is(err, catalogusecase.ErrNotFound) {
			response.NotFound(w, r, "Category not found")
			return
		}
		response.InternalErr(w, r, err, "failed to get category")
		return
	}
	response.JSON(w, r, http.StatusOK, cat)
}

func (h *Handler) PatchCategory(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(r.PathValue("uuid"))
	if err != nil {
		response.BadRequest(w, r, response.CodeValidationError, "Invalid category UUID")
		return
	}
	var raw map[string]json.RawMessage
	if err := json.NewDecoder(r.Body).Decode(&raw); err != nil {
		response.BadRequest(w, r, response.CodeValidationError, "Invalid JSON body")
		return
	}
	var in catalogusecase.UpdateCategoryInput
	if b, ok := raw["name"]; ok {
		var s string
		if err := json.Unmarshal(b, &s); err == nil {
			in.Name = &s
		}
	}
	if b, ok := raw["kind"]; ok {
		var s string
		if err := json.Unmarshal(b, &s); err == nil {
			in.Kind = &s
		}
	}
	if b, ok := raw["sort_order"]; ok {
		var n int32
		if err := json.Unmarshal(b, &n); err == nil {
			in.SortOrder = &n
		}
	}
	if b, ok := raw["is_active"]; ok {
		var v bool
		if err := json.Unmarshal(b, &v); err == nil {
			in.IsActive = &v
		}
	}
	if b, ok := raw["parent_uuid"]; ok {
		in.SetParent = true
		var u *uuid.UUID
		if err := json.Unmarshal(b, &u); err == nil {
			in.ParentUUID = u
		}
	}

	cat, err := h.svc.UpdateCategory(r.Context(), id, in)
	if err != nil {
		if errors.Is(err, catalogusecase.ErrNotFound) {
			response.NotFound(w, r, "Category not found")
			return
		}
		if errors.Is(err, catalogusecase.ErrConflict) {
			response.Conflict(w, r, response.CodeConflict, err.Error())
			return
		}
		if errors.Is(err, catalogusecase.ErrInvalidRequest) {
			response.BadRequest(w, r, response.CodeValidationError, err.Error())
			return
		}
		response.InternalErr(w, r, err, "failed to update category")
		return
	}
	response.JSON(w, r, http.StatusOK, cat)
}

func (h *Handler) DeleteCategory(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(r.PathValue("uuid"))
	if err != nil {
		response.BadRequest(w, r, response.CodeValidationError, "Invalid category UUID")
		return
	}
	if err := h.svc.DeleteCategory(r.Context(), id); err != nil {
		if errors.Is(err, catalogusecase.ErrNotFound) {
			response.NotFound(w, r, "Category not found")
			return
		}
		response.InternalErr(w, r, err, "failed to delete category")
		return
	}
	response.JSON(w, r, http.StatusOK, map[string]any{"deleted": true})
}

// ============================================================================
// Products
// ============================================================================

func (h *Handler) ProductsMeta(w http.ResponseWriter, r *http.Request) {
	response.JSON(w, r, http.StatusOK, h.svc.ProductsResourceMeta())
}

func (h *Handler) ListProducts(w http.ResponseWriter, r *http.Request) {
	q := apiquery.Parse(r.URL.Query())
	var categoryUUID *uuid.UUID
	if v := r.URL.Query().Get("category_uuid"); v != "" {
		if u, err := uuid.Parse(v); err == nil {
			categoryUUID = &u
		}
	}
	var isActive *bool
	if v := r.URL.Query().Get("is_active"); v != "" {
		b := v == "true"
		isActive = &b
	}
	var trackStock *bool
	if v := r.URL.Query().Get("track_stock"); v != "" {
		b := v == "true"
		trackStock = &b
	}

	filters := catalogusecase.ProductFilters{
		CategoryUUID: categoryUUID,
		StockStatus:  r.URL.Query().Get("stock_status"),
		Unit:         r.URL.Query().Get("unit"),
		IsActive:     isActive,
		TrackStock:   trackStock,
		Q:            q.Q,
		SortBy:       r.URL.Query().Get("sort_by"),
	}

	items, total, err := h.svc.ListProducts(r.Context(), q.Limit, q.Offset, filters)
	if err != nil {
		response.InternalErr(w, r, err, "failed to list products")
		return
	}
	response.JSON(w, r, http.StatusOK, apiquery.NewPage(items, total, q.Limit, q.Offset))
}

func (h *Handler) CreateProduct(w http.ResponseWriter, r *http.Request) {
	var in catalogusecase.CreateProductInput
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		response.BadRequest(w, r, response.CodeValidationError, "Invalid JSON body")
		return
	}
	product, err := h.svc.CreateProduct(r.Context(), in)
	if err != nil {
		if errors.Is(err, catalogusecase.ErrConflict) {
			response.Conflict(w, r, response.CodeConflict, err.Error())
			return
		}
		if errors.Is(err, catalogusecase.ErrInvalidRequest) {
			response.BadRequest(w, r, response.CodeValidationError, err.Error())
			return
		}
		response.InternalErr(w, r, err, "failed to create product")
		return
	}
	response.JSON(w, r, http.StatusCreated, product)
}

func (h *Handler) GetProduct(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(r.PathValue("uuid"))
	if err != nil {
		response.BadRequest(w, r, response.CodeValidationError, "Invalid product UUID")
		return
	}
	product, err := h.svc.GetProduct(r.Context(), id)
	if err != nil {
		if errors.Is(err, catalogusecase.ErrNotFound) {
			response.NotFound(w, r, "Product not found")
			return
		}
		response.InternalErr(w, r, err, "failed to get product")
		return
	}
	response.JSON(w, r, http.StatusOK, product)
}

func (h *Handler) PatchProduct(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(r.PathValue("uuid"))
	if err != nil {
		response.BadRequest(w, r, response.CodeValidationError, "Invalid product UUID")
		return
	}
	var raw map[string]json.RawMessage
	if err := json.NewDecoder(r.Body).Decode(&raw); err != nil {
		response.BadRequest(w, r, response.CodeValidationError, "Invalid JSON body")
		return
	}

	var in catalogusecase.UpdateProductInput
	if b, ok := raw["name"]; ok {
		var s string
		if err := json.Unmarshal(b, &s); err == nil {
			in.Name = &s
		}
	}
	if b, ok := raw["category_uuid"]; ok {
		in.SetCategory = true
		var u *uuid.UUID
		if err := json.Unmarshal(b, &u); err == nil {
			in.CategoryUUID = u
		}
	}
	if b, ok := raw["sku"]; ok {
		in.SetSKU = true
		var s *string
		if err := json.Unmarshal(b, &s); err == nil {
			in.SKU = s
		}
	}
	if b, ok := raw["barcode"]; ok {
		in.SetBarcode = true
		var s *string
		if err := json.Unmarshal(b, &s); err == nil {
			in.Barcode = s
		}
	}
	if b, ok := raw["unit"]; ok {
		var s string
		if err := json.Unmarshal(b, &s); err == nil {
			in.Unit = &s
		}
	}
	if b, ok := raw["cost_price"]; ok {
		var s string
		if err := json.Unmarshal(b, &s); err == nil {
			in.CostPrice = &s
		}
	}
	if b, ok := raw["sale_price"]; ok {
		var s string
		if err := json.Unmarshal(b, &s); err == nil {
			in.SalePrice = &s
		}
	}
	if b, ok := raw["vat_rate"]; ok {
		var s string
		if err := json.Unmarshal(b, &s); err == nil {
			in.VATRate = &s
		}
	}
	if b, ok := raw["currency"]; ok {
		var s string
		if err := json.Unmarshal(b, &s); err == nil {
			in.Currency = &s
		}
	}
	if b, ok := raw["stock_quantity"]; ok {
		var s string
		if err := json.Unmarshal(b, &s); err == nil {
			in.StockQuantity = &s
		}
	}
	if b, ok := raw["min_stock_alert"]; ok {
		var s string
		if err := json.Unmarshal(b, &s); err == nil {
			in.MinStockAlert = &s
		}
	}
	if b, ok := raw["track_stock"]; ok {
		var v bool
		if err := json.Unmarshal(b, &v); err == nil {
			in.TrackStock = &v
		}
	}
	if b, ok := raw["is_active"]; ok {
		var v bool
		if err := json.Unmarshal(b, &v); err == nil {
			in.IsActive = &v
		}
	}
	if b, ok := raw["description"]; ok {
		var s string
		if err := json.Unmarshal(b, &s); err == nil {
			in.Description = &s
		}
	}

	product, err := h.svc.UpdateProduct(r.Context(), id, in)
	if err != nil {
		if errors.Is(err, catalogusecase.ErrNotFound) {
			response.NotFound(w, r, "Product not found")
			return
		}
		if errors.Is(err, catalogusecase.ErrConflict) {
			response.Conflict(w, r, response.CodeConflict, err.Error())
			return
		}
		if errors.Is(err, catalogusecase.ErrInvalidRequest) {
			response.BadRequest(w, r, response.CodeValidationError, err.Error())
			return
		}
		response.InternalErr(w, r, err, "failed to update product")
		return
	}
	response.JSON(w, r, http.StatusOK, product)
}

func (h *Handler) AdjustProductStock(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(r.PathValue("uuid"))
	if err != nil {
		response.BadRequest(w, r, response.CodeValidationError, "Invalid product UUID")
		return
	}
	var in catalogusecase.AdjustStockInput
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		response.BadRequest(w, r, response.CodeValidationError, "Invalid JSON body")
		return
	}
	product, err := h.svc.AdjustStock(r.Context(), id, in)
	if err != nil {
		if errors.Is(err, catalogusecase.ErrNotFound) {
			response.NotFound(w, r, "Product not found")
			return
		}
		if errors.Is(err, catalogusecase.ErrInvalidRequest) {
			response.BadRequest(w, r, response.CodeValidationError, err.Error())
			return
		}
		response.InternalErr(w, r, err, "failed to adjust product stock")
		return
	}
	response.JSON(w, r, http.StatusOK, product)
}

func (h *Handler) DeleteProduct(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(r.PathValue("uuid"))
	if err != nil {
		response.BadRequest(w, r, response.CodeValidationError, "Invalid product UUID")
		return
	}
	if err := h.svc.DeleteProduct(r.Context(), id); err != nil {
		if errors.Is(err, catalogusecase.ErrNotFound) {
			response.NotFound(w, r, "Product not found")
			return
		}
		response.InternalErr(w, r, err, "failed to delete product")
		return
	}
	response.JSON(w, r, http.StatusOK, map[string]any{"deleted": true})
}

// ============================================================================
// Services
// ============================================================================

func (h *Handler) ServicesMeta(w http.ResponseWriter, r *http.Request) {
	response.JSON(w, r, http.StatusOK, h.svc.ServicesResourceMeta())
}

func (h *Handler) ListServices(w http.ResponseWriter, r *http.Request) {
	q := apiquery.Parse(r.URL.Query())
	var categoryUUID *uuid.UUID
	if v := r.URL.Query().Get("category_uuid"); v != "" {
		if u, err := uuid.Parse(v); err == nil {
			categoryUUID = &u
		}
	}
	var isActive *bool
	if v := r.URL.Query().Get("is_active"); v != "" {
		b := v == "true"
		isActive = &b
	}

	filters := catalogusecase.ServiceFilters{
		CategoryUUID: categoryUUID,
		IsActive:     isActive,
		Q:            q.Q,
		SortBy:       r.URL.Query().Get("sort_by"),
	}

	items, total, err := h.svc.ListServices(r.Context(), q.Limit, q.Offset, filters)
	if err != nil {
		response.InternalErr(w, r, err, "failed to list services")
		return
	}
	response.JSON(w, r, http.StatusOK, apiquery.NewPage(items, total, q.Limit, q.Offset))
}

func (h *Handler) CreateService(w http.ResponseWriter, r *http.Request) {
	var in catalogusecase.CreateServiceInput
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		response.BadRequest(w, r, response.CodeValidationError, "Invalid JSON body")
		return
	}
	service, err := h.svc.CreateService(r.Context(), in)
	if err != nil {
		if errors.Is(err, catalogusecase.ErrConflict) {
			response.Conflict(w, r, response.CodeConflict, err.Error())
			return
		}
		if errors.Is(err, catalogusecase.ErrInvalidRequest) {
			response.BadRequest(w, r, response.CodeValidationError, err.Error())
			return
		}
		response.InternalErr(w, r, err, "failed to create service")
		return
	}
	response.JSON(w, r, http.StatusCreated, service)
}

func (h *Handler) GetService(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(r.PathValue("uuid"))
	if err != nil {
		response.BadRequest(w, r, response.CodeValidationError, "Invalid service UUID")
		return
	}
	service, err := h.svc.GetService(r.Context(), id)
	if err != nil {
		if errors.Is(err, catalogusecase.ErrNotFound) {
			response.NotFound(w, r, "Service not found")
			return
		}
		response.InternalErr(w, r, err, "failed to get service")
		return
	}
	response.JSON(w, r, http.StatusOK, service)
}

func (h *Handler) PatchService(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(r.PathValue("uuid"))
	if err != nil {
		response.BadRequest(w, r, response.CodeValidationError, "Invalid service UUID")
		return
	}
	var raw map[string]json.RawMessage
	if err := json.NewDecoder(r.Body).Decode(&raw); err != nil {
		response.BadRequest(w, r, response.CodeValidationError, "Invalid JSON body")
		return
	}

	var in catalogusecase.UpdateServiceInput
	if b, ok := raw["name"]; ok {
		var s string
		if err := json.Unmarshal(b, &s); err == nil {
			in.Name = &s
		}
	}
	if b, ok := raw["category_uuid"]; ok {
		in.SetCategory = true
		var u *uuid.UUID
		if err := json.Unmarshal(b, &u); err == nil {
			in.CategoryUUID = u
		}
	}
	if b, ok := raw["code"]; ok {
		in.SetCode = true
		var s *string
		if err := json.Unmarshal(b, &s); err == nil {
			in.Code = s
		}
	}
	if b, ok := raw["duration_minutes"]; ok {
		var n int32
		if err := json.Unmarshal(b, &n); err == nil {
			in.DurationMinutes = &n
		}
	}
	if b, ok := raw["price"]; ok {
		var s string
		if err := json.Unmarshal(b, &s); err == nil {
			in.Price = &s
		}
	}
	if b, ok := raw["vat_rate"]; ok {
		var s string
		if err := json.Unmarshal(b, &s); err == nil {
			in.VATRate = &s
		}
	}
	if b, ok := raw["currency"]; ok {
		var s string
		if err := json.Unmarshal(b, &s); err == nil {
			in.Currency = &s
		}
	}
	if b, ok := raw["is_active"]; ok {
		var v bool
		if err := json.Unmarshal(b, &v); err == nil {
			in.IsActive = &v
		}
	}
	if b, ok := raw["description"]; ok {
		var s string
		if err := json.Unmarshal(b, &s); err == nil {
			in.Description = &s
		}
	}
	if b, ok := raw["color"]; ok {
		var s string
		if err := json.Unmarshal(b, &s); err == nil {
			in.Color = &s
		}
	}

	service, err := h.svc.UpdateService(r.Context(), id, in)
	if err != nil {
		if errors.Is(err, catalogusecase.ErrNotFound) {
			response.NotFound(w, r, "Service not found")
			return
		}
		if errors.Is(err, catalogusecase.ErrConflict) {
			response.Conflict(w, r, response.CodeConflict, err.Error())
			return
		}
		if errors.Is(err, catalogusecase.ErrInvalidRequest) {
			response.BadRequest(w, r, response.CodeValidationError, err.Error())
			return
		}
		response.InternalErr(w, r, err, "failed to update service")
		return
	}
	response.JSON(w, r, http.StatusOK, service)
}

func (h *Handler) DeleteService(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(r.PathValue("uuid"))
	if err != nil {
		response.BadRequest(w, r, response.CodeValidationError, "Invalid service UUID")
		return
	}
	if err := h.svc.DeleteService(r.Context(), id); err != nil {
		if errors.Is(err, catalogusecase.ErrNotFound) {
			response.NotFound(w, r, "Service not found")
			return
		}
		response.InternalErr(w, r, err, "failed to delete service")
		return
	}
	response.JSON(w, r, http.StatusOK, map[string]any{"deleted": true})
}
