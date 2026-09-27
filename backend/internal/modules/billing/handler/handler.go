package handler

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"

	billingusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/billing/usecase"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/pkg/response"
	"github.com/google/uuid"
)

type Handler struct{ svc *billingusecase.Service }

func New(svc *billingusecase.Service) *Handler { return &Handler{svc: svc} }

func writeError(w http.ResponseWriter, r *http.Request, err error) {
	var open billingusecase.OrderOpenError
	var discount billingusecase.DiscountError
	var custom billingusecase.CustomFeaturesError
	switch {
	case errors.As(err, &open):
		response.ErrorWithDetails(w, r, http.StatusConflict, "ORDER_OPEN", "Open order exists", []response.Detail{{Field: "order_uuid", Message: open.OrderUUID.String()}})
	case errors.As(err, &discount):
		response.ErrorWithDetails(w, r, http.StatusUnprocessableEntity, "DISCOUNT_INVALID", discount.Message, []response.Detail{{Field: "reason", Message: discount.Reason}})
	case errors.As(err, &custom):
		response.ErrorWithDetails(w, r, http.StatusUnprocessableEntity, "CUSTOM_FEATURES_INVALID", custom.Message, []response.Detail{{Field: custom.Field, Message: custom.Message}})
	case errors.Is(err, billingusecase.ErrOrderState):
		response.Conflict(w, r, "ORDER_STATE", "Order state does not allow this operation")
	case errors.Is(err, billingusecase.ErrInvoiceState):
		response.Conflict(w, r, "INVOICE_STATE", "Invoice state does not allow this operation")
	case errors.Is(err, billingusecase.ErrXSLTInvalid):
		response.Error(w, r, http.StatusUnprocessableEntity, "XSLT_INVALID", err.Error())
	case errors.Is(err, billingusecase.ErrInvoiceProfile):
		response.Error(w, r, http.StatusUnprocessableEntity, "INVOICE_PROFILE_INVALID", err.Error())
	case errors.Is(err, billingusecase.ErrPlanUnavailable):
		response.Conflict(w, r, "PLAN_UNAVAILABLE", "Plan is unavailable")
	case errors.Is(err, billingusecase.ErrNotFound):
		response.NotFound(w, r, "not found")
	case errors.Is(err, billingusecase.ErrInvalidRequest):
		response.BadRequest(w, r, response.CodeValidationError, err.Error())
	case errors.Is(err, billingusecase.ErrConflict):
		response.Conflict(w, r, response.CodeConflict, err.Error())
	default:
		response.InternalErr(w, r, err, "request failed")
	}
}

func listResponse(items any, total int64, limit, offset int32) map[string]any {
	return map[string]any{"items": items, "total": total, "limit": limit, "offset": offset}
}

func paging(r *http.Request) (int32, int32) {
	limit64, _ := strconv.ParseInt(r.URL.Query().Get("limit"), 10, 32)
	offset64, _ := strconv.ParseInt(r.URL.Query().Get("offset"), 10, 32)
	limit := int32(limit64)
	offset := int32(offset64)
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	if offset < 0 {
		offset = 0
	}
	return limit, offset
}

func decode(w http.ResponseWriter, r *http.Request, v any) bool {
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
	if err := json.NewDecoder(r.Body).Decode(v); err != nil {
		response.BadRequest(w, r, response.CodeValidationError, "invalid JSON body")
		return false
	}
	return true
}

func pathUUID(w http.ResponseWriter, r *http.Request) (uuid.UUID, bool) {
	id, err := uuid.Parse(r.PathValue("uuid"))
	if err != nil {
		response.BadRequest(w, r, response.CodeValidationError, "plan uuid is invalid")
		return uuid.Nil, false
	}
	return id, true
}

func (h *Handler) TenantOverview(w http.ResponseWriter, r *http.Request) {
	out, err := h.svc.Overview(r.Context())
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.JSON(w, r, http.StatusOK, out)
}

func (h *Handler) TenantPlans(w http.ResponseWriter, r *http.Request) {
	out, err := h.svc.ListPlans(r.Context(), true)
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.JSON(w, r, http.StatusOK, out)
}

func (h *Handler) PlatformListFeatures(w http.ResponseWriter, r *http.Request) {
	includeInactive := r.URL.Query().Get("include_inactive") == "true"
	out, err := h.svc.ListFeatures(r.Context(), includeInactive)
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.JSON(w, r, http.StatusOK, out)
}

func (h *Handler) PlatformCreateFeature(w http.ResponseWriter, r *http.Request) {
	var in billingusecase.DisplayFeatureInput
	if !decode(w, r, &in) {
		return
	}
	out, err := h.svc.CreateDisplayFeature(r.Context(), in)
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.JSON(w, r, http.StatusCreated, out)
}

func (h *Handler) PlatformSetFeatureActive(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		response.BadRequest(w, r, response.CodeValidationError, "feature id is invalid")
		return
	}
	var in struct {
		IsActive bool `json:"is_active"`
	}
	if !decode(w, r, &in) {
		return
	}
	if err := h.svc.SetFeatureActive(r.Context(), id, in.IsActive); err != nil {
		writeError(w, r, err)
		return
	}
	response.JSON(w, r, http.StatusOK, map[string]any{"updated": true})
}

func (h *Handler) PlatformListPlans(w http.ResponseWriter, r *http.Request) {
	_ = r.URL.Query().Get("include_inactive") == "true"
	out, err := h.svc.ListPlans(r.Context(), false)
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.JSON(w, r, http.StatusOK, out)
}

func (h *Handler) PlatformCreatePlan(w http.ResponseWriter, r *http.Request) {
	var in billingusecase.PlanInput
	if !decode(w, r, &in) {
		return
	}
	out, err := h.svc.CreatePlan(r.Context(), in)
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.JSON(w, r, http.StatusCreated, out)
}

func (h *Handler) PlatformGetPlan(w http.ResponseWriter, r *http.Request) {
	id, ok := pathUUID(w, r)
	if !ok {
		return
	}
	out, err := h.svc.GetPlan(r.Context(), id)
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.JSON(w, r, http.StatusOK, out)
}

func (h *Handler) PlatformUpdatePlan(w http.ResponseWriter, r *http.Request) {
	id, ok := pathUUID(w, r)
	if !ok {
		return
	}
	var in billingusecase.PlanInput
	if !decode(w, r, &in) {
		return
	}
	out, err := h.svc.UpdatePlan(r.Context(), id, in)
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.JSON(w, r, http.StatusOK, out)
}

func (h *Handler) PlatformDeletePlan(w http.ResponseWriter, r *http.Request) {
	id, ok := pathUUID(w, r)
	if !ok {
		return
	}
	if err := h.svc.DeletePlan(r.Context(), id); err != nil {
		writeError(w, r, err)
		return
	}
	response.JSON(w, r, http.StatusOK, map[string]any{"deleted": true})
}

func (h *Handler) PreviewOrder(w http.ResponseWriter, r *http.Request) {
	var in billingusecase.OrderInput
	if !decode(w, r, &in) {
		return
	}
	out, err := h.svc.PreviewOrder(r.Context(), in)
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.JSON(w, r, http.StatusOK, out)
}

func (h *Handler) CreateOrder(w http.ResponseWriter, r *http.Request) {
	var in billingusecase.OrderInput
	if !decode(w, r, &in) {
		return
	}
	out, err := h.svc.CreateOrder(r.Context(), in)
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.JSON(w, r, http.StatusCreated, out)
}

func (h *Handler) ListOrders(w http.ResponseWriter, r *http.Request) {
	limit, offset := paging(r)
	items, total, err := h.svc.ListOrders(r.Context(), r.URL.Query().Get("status"), limit, offset)
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.JSON(w, r, http.StatusOK, listResponse(items, total, limit, offset))
}

func (h *Handler) GetOrder(w http.ResponseWriter, r *http.Request) {
	id, ok := pathUUID(w, r)
	if !ok {
		return
	}
	out, err := h.svc.GetOrder(r.Context(), id)
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.JSON(w, r, http.StatusOK, out)
}

func (h *Handler) ReportPayment(w http.ResponseWriter, r *http.Request) {
	id, ok := pathUUID(w, r)
	if !ok {
		return
	}
	if err := r.ParseMultipartForm(11 << 20); err != nil {
		response.BadRequest(w, r, response.CodeValidationError, "invalid multipart form")
		return
	}
	file, header, err := r.FormFile("file")
	if err != nil {
		response.BadRequest(w, r, response.CodeValidationError, "file is required")
		return
	}
	defer func() { _ = file.Close() }()
	contentType := header.Header.Get("Content-Type")
	if contentType == "" {
		contentType = http.DetectContentType(make([]byte, 0))
	}
	out, err := h.svc.ReportPayment(r.Context(), id, billingusecase.ReportInput{
		Note: r.FormValue("note"), Filename: header.Filename, ContentType: contentType, Size: header.Size, Body: file,
	})
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.JSON(w, r, http.StatusOK, out)
}

func (h *Handler) CancelOrder(w http.ResponseWriter, r *http.Request) {
	id, ok := pathUUID(w, r)
	if !ok {
		return
	}
	out, err := h.svc.CancelOrder(r.Context(), id)
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.JSON(w, r, http.StatusOK, out)
}

func (h *Handler) OpenReceipt(w http.ResponseWriter, r *http.Request) {
	h.openReceipt(w, r, false)
}

func (h *Handler) PlatformOpenReceipt(w http.ResponseWriter, r *http.Request) {
	h.openReceipt(w, r, true)
}

func (h *Handler) openReceipt(w http.ResponseWriter, r *http.Request, platform bool) {
	id, ok := pathUUID(w, r)
	if !ok {
		return
	}
	var ref string
	if platform {
		order, err := h.svc.GetOrderAdmin(r.Context(), id)
		if err != nil {
			writeError(w, r, err)
			return
		}
		ref = order.ReferenceCode
	} else {
		order, err := h.svc.GetOrder(r.Context(), id)
		if err != nil {
			writeError(w, r, err)
			return
		}
		ref = order.ReferenceCode
	}
	body, ctype, _, err := h.svc.OpenReceipt(r.Context(), id, platform)
	if err != nil {
		writeError(w, r, err)
		return
	}
	defer func() { _ = body.Close() }()
	w.Header().Set("Content-Type", ctype)
	w.Header().Set("Content-Disposition", fmt.Sprintf(`inline; filename="dekont-%s.%s"`, ref, receiptExt(ctype)))
	w.Header().Set("Cache-Control", "private, no-store")
	_, _ = io.Copy(w, body)
}

func (h *Handler) PlatformListOrders(w http.ResponseWriter, r *http.Request) {
	limit, offset := paging(r)
	items, total, err := h.svc.ListOrdersAdmin(r.Context(), r.URL.Query().Get("status"), r.URL.Query().Get("q"), limit, offset)
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.JSON(w, r, http.StatusOK, listResponse(items, total, limit, offset))
}

func (h *Handler) PlatformOrdersSummary(w http.ResponseWriter, r *http.Request) {
	out, err := h.svc.OrdersSummary(r.Context())
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.JSON(w, r, http.StatusOK, out)
}

func (h *Handler) PlatformGetOrder(w http.ResponseWriter, r *http.Request) {
	id, ok := pathUUID(w, r)
	if !ok {
		return
	}
	out, err := h.svc.GetOrderAdmin(r.Context(), id)
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.JSON(w, r, http.StatusOK, out)
}

func (h *Handler) PlatformCreateOrder(w http.ResponseWriter, r *http.Request) {
	var in billingusecase.AdminOrderInput
	if !decode(w, r, &in) {
		return
	}
	out, err := h.svc.CreateOrderAdmin(r.Context(), in)
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.JSON(w, r, http.StatusCreated, out)
}

func (h *Handler) PlatformApproveOrder(w http.ResponseWriter, r *http.Request) {
	id, ok := pathUUID(w, r)
	if !ok {
		return
	}
	var in struct {
		Note string `json:"note"`
	}
	if !decode(w, r, &in) {
		return
	}
	out, err := h.svc.ApproveOrder(r.Context(), id, in.Note)
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.JSON(w, r, http.StatusOK, out)
}

func (h *Handler) PlatformRejectOrder(w http.ResponseWriter, r *http.Request) {
	id, ok := pathUUID(w, r)
	if !ok {
		return
	}
	var in struct {
		Reason string `json:"reason"`
	}
	if !decode(w, r, &in) {
		return
	}
	out, err := h.svc.RejectOrder(r.Context(), id, in.Reason)
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.JSON(w, r, http.StatusOK, out)
}

func (h *Handler) PlatformListSubscriptions(w http.ResponseWriter, r *http.Request) {
	limit, offset := paging(r)
	var planUUID *uuid.UUID
	if raw := strings.TrimSpace(r.URL.Query().Get("plan_uuid")); raw != "" {
		id, err := uuid.Parse(raw)
		if err != nil {
			response.BadRequest(w, r, response.CodeValidationError, "plan_uuid is invalid")
			return
		}
		planUUID = &id
	}
	var expiringWithin int32
	if raw := strings.TrimSpace(r.URL.Query().Get("expiring_within_days")); raw != "" {
		n, err := strconv.ParseInt(raw, 10, 32)
		if err != nil || n < 0 {
			response.BadRequest(w, r, response.CodeValidationError, "expiring_within_days is invalid")
			return
		}
		expiringWithin = int32(n)
	}
	items, total, err := h.svc.ListSubscriptionsAdmin(r.Context(), billingusecase.AdminSubscriptionFilters{
		Status: r.URL.Query().Get("status"), Q: r.URL.Query().Get("q"), PlanUUID: planUUID, ExpiringWithinDays: expiringWithin,
	}, limit, offset)
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.JSON(w, r, http.StatusOK, listResponse(items, total, limit, offset))
}

func (h *Handler) PlatformDashboard(w http.ResponseWriter, r *http.Request) {
	out, err := h.svc.Dashboard(r.Context())
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.JSON(w, r, http.StatusOK, out)
}

func (h *Handler) PlatformSubscriptionDetail(w http.ResponseWriter, r *http.Request) {
	id, ok := pathUUID(w, r)
	if !ok {
		return
	}
	out, err := h.svc.SubscriptionDetail(r.Context(), id)
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.JSON(w, r, http.StatusOK, out)
}

func (h *Handler) PlatformCreateSubscription(w http.ResponseWriter, r *http.Request) {
	var in billingusecase.AdminSubscriptionInput
	if !decode(w, r, &in) {
		return
	}
	out, err := h.svc.CreateSubscriptionAdmin(r.Context(), in)
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.JSON(w, r, http.StatusCreated, out)
}

func (h *Handler) PlatformUpdateSubscription(w http.ResponseWriter, r *http.Request) {
	id, ok := pathUUID(w, r)
	if !ok {
		return
	}
	var in billingusecase.AdminSubscriptionPatch
	if !decode(w, r, &in) {
		return
	}
	out, err := h.svc.UpdateSubscriptionAdmin(r.Context(), id, in)
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.JSON(w, r, http.StatusOK, out)
}

func (h *Handler) PlatformListDiscountCodes(w http.ResponseWriter, r *http.Request) {
	limit, offset := paging(r)
	items, total, err := h.svc.ListDiscountCodes(r.Context(), r.URL.Query().Get("q"), limit, offset)
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.JSON(w, r, http.StatusOK, listResponse(items, total, limit, offset))
}

func (h *Handler) PlatformCreateDiscountCode(w http.ResponseWriter, r *http.Request) {
	var in billingusecase.DiscountInput
	if !decode(w, r, &in) {
		return
	}
	out, err := h.svc.CreateDiscountCode(r.Context(), in)
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.JSON(w, r, http.StatusCreated, out)
}

func (h *Handler) PlatformGetDiscountCode(w http.ResponseWriter, r *http.Request) {
	id, ok := pathUUID(w, r)
	if !ok {
		return
	}
	out, err := h.svc.GetDiscountCode(r.Context(), id)
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.JSON(w, r, http.StatusOK, out)
}

func (h *Handler) PlatformUpdateDiscountCode(w http.ResponseWriter, r *http.Request) {
	id, ok := pathUUID(w, r)
	if !ok {
		return
	}
	var in billingusecase.DiscountInput
	if !decode(w, r, &in) {
		return
	}
	out, err := h.svc.UpdateDiscountCode(r.Context(), id, in)
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.JSON(w, r, http.StatusOK, out)
}

func (h *Handler) PlatformDeleteDiscountCode(w http.ResponseWriter, r *http.Request) {
	id, ok := pathUUID(w, r)
	if !ok {
		return
	}
	before, err := h.svc.GetDiscountCode(r.Context(), id)
	if err != nil {
		writeError(w, r, err)
		return
	}
	if err := h.svc.DeleteDiscountCode(r.Context(), id); err != nil {
		writeError(w, r, err)
		return
	}
	after, err := h.svc.GetDiscountCode(r.Context(), id)
	if err != nil {
		before.IsActive = false
		response.JSON(w, r, http.StatusOK, before)
		return
	}
	response.JSON(w, r, http.StatusOK, after)
}

func (h *Handler) PlatformGetSettings(w http.ResponseWriter, r *http.Request) {
	out, err := h.svc.GetPaymentSettings(r.Context())
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.JSON(w, r, http.StatusOK, out)
}

func (h *Handler) PlatformUpdateSettings(w http.ResponseWriter, r *http.Request) {
	var in billingusecase.PaymentSettings
	if !decode(w, r, &in) {
		return
	}
	out, err := h.svc.UpdatePaymentSettings(r.Context(), in)
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.JSON(w, r, http.StatusOK, out)
}

func (h *Handler) GetInvoiceProfile(w http.ResponseWriter, r *http.Request) {
	out, err := h.svc.GetInvoiceProfile(r.Context())
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.JSON(w, r, http.StatusOK, out)
}

func (h *Handler) UpdateInvoiceProfile(w http.ResponseWriter, r *http.Request) {
	var in billingusecase.InvoiceProfile
	if !decode(w, r, &in) {
		return
	}
	out, err := h.svc.UpdateInvoiceProfile(r.Context(), in)
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.JSON(w, r, http.StatusOK, out)
}

func (h *Handler) ListInvoices(w http.ResponseWriter, r *http.Request) {
	limit, offset := paging(r)
	out, err := h.svc.ListInvoicesForOrg(r.Context(), limit, offset)
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.JSON(w, r, http.StatusOK, out)
}

func (h *Handler) OpenInvoicePDF(w http.ResponseWriter, r *http.Request) {
	h.openInvoiceFile(w, r, "pdf", false)
}

func (h *Handler) PlatformListInvoices(w http.ResponseWriter, r *http.Request) {
	limit, offset := paging(r)
	out, err := h.svc.ListInvoicesAdmin(r.Context(), r.URL.Query().Get("status"), r.URL.Query().Get("q"), limit, offset)
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.JSON(w, r, http.StatusOK, out)
}

func (h *Handler) PlatformOpenInvoiceXML(w http.ResponseWriter, r *http.Request) {
	h.openInvoiceFile(w, r, "xml", true)
}

func (h *Handler) PlatformOpenInvoicePDF(w http.ResponseWriter, r *http.Request) {
	h.openInvoiceFile(w, r, "pdf", true)
}

func (h *Handler) openInvoiceFile(w http.ResponseWriter, r *http.Request, kind string, platform bool) {
	id, ok := pathUUID(w, r)
	if !ok {
		return
	}
	body, ctype, filename, _, err := h.svc.OpenInvoiceFile(r.Context(), id, kind, platform)
	if err != nil {
		writeError(w, r, err)
		return
	}
	defer func() { _ = body.Close() }()
	w.Header().Set("Content-Type", ctype)
	w.Header().Set("Content-Disposition", fmt.Sprintf(`inline; filename="%s"`, filename))
	w.Header().Set("Cache-Control", "private, no-store")
	_, _ = io.Copy(w, body)
}

func (h *Handler) PlatformRegenerateInvoice(w http.ResponseWriter, r *http.Request) {
	id, ok := pathUUID(w, r)
	if !ok {
		return
	}
	out, err := h.svc.RegenerateInvoice(r.Context(), id)
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.JSON(w, r, http.StatusOK, out)
}

func (h *Handler) PlatformVoidInvoice(w http.ResponseWriter, r *http.Request) {
	id, ok := pathUUID(w, r)
	if !ok {
		return
	}
	out, err := h.svc.VoidInvoice(r.Context(), id)
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.JSON(w, r, http.StatusOK, out)
}

func (h *Handler) PlatformIssueOrderInvoice(w http.ResponseWriter, r *http.Request) {
	id, ok := pathUUID(w, r)
	if !ok {
		return
	}
	out, err := h.svc.IssueInvoiceForOrderUUID(r.Context(), id)
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.JSON(w, r, http.StatusOK, out)
}

func (h *Handler) PlatformGetSeller(w http.ResponseWriter, r *http.Request) {
	out, err := h.svc.GetSellerSettings(r.Context())
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.JSON(w, r, http.StatusOK, out)
}

func (h *Handler) PlatformUpdateSeller(w http.ResponseWriter, r *http.Request) {
	var in billingusecase.SellerSettings
	if !decode(w, r, &in) {
		return
	}
	out, err := h.svc.UpdateSellerSettings(r.Context(), in)
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.JSON(w, r, http.StatusOK, out)
}

func (h *Handler) PlatformUploadSellerXSLT(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, 2<<20)
	if err := r.ParseMultipartForm(2 << 20); err != nil {
		response.BadRequest(w, r, response.CodeValidationError, "invalid multipart form")
		return
	}
	file, header, err := r.FormFile("file")
	if err != nil {
		response.BadRequest(w, r, response.CodeValidationError, "file is required")
		return
	}
	defer func() { _ = file.Close() }()
	data, err := io.ReadAll(io.LimitReader(file, (2<<20)+1))
	if err != nil {
		writeError(w, r, err)
		return
	}
	out, err := h.svc.UploadXSLT(r.Context(), header.Filename, data)
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.JSON(w, r, http.StatusOK, out)
}

func (h *Handler) PlatformResetSellerXSLT(w http.ResponseWriter, r *http.Request) {
	out, err := h.svc.ResetXSLT(r.Context())
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.JSON(w, r, http.StatusOK, out)
}

func receiptExt(contentType string) string {
	switch strings.ToLower(strings.TrimSpace(contentType)) {
	case "application/pdf":
		return "pdf"
	case "image/jpeg":
		return "jpg"
	case "image/png":
		return "png"
	case "image/webp":
		return "webp"
	default:
		return "bin"
	}
}
