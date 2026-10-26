// Package handler is the HTTP layer of the loyalty and packages module.
package handler

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"

	loyaltyusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/loyalty/usecase"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/entitlements"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/pkg/apiquery"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/pkg/response"
	"github.com/google/uuid"
)

// Handler serves /v1/tenant/loyalty/* and the job / customer loyalty routes.
type Handler struct {
	svc *loyaltyusecase.Service
}

// New builds the handler.
func New(svc *loyaltyusecase.Service) *Handler { return &Handler{svc: svc} }

func writeError(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, entitlements.ErrFeatureDisabled):
		response.Error(w, r, http.StatusForbidden, response.CodeFeatureDisabled, "This feature is not included in your plan")
	case errors.Is(err, loyaltyusecase.ErrNotFound):
		response.NotFound(w, r, "not found")
	case errors.Is(err, loyaltyusecase.ErrNotApplicable):
		response.Conflict(w, r, "NOT_APPLICABLE", err.Error())
	case errors.Is(err, loyaltyusecase.ErrConflict):
		response.Conflict(w, r, response.CodeConflict, err.Error())
	case errors.Is(err, loyaltyusecase.ErrInvalidRequest):
		response.BadRequest(w, r, response.CodeValidationError, err.Error())
	default:
		response.InternalErr(w, r, err, "loyalty request failed")
	}
}

func decode(w http.ResponseWriter, r *http.Request, dst any) bool {
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 64<<10)).Decode(dst); err != nil {
		response.BadRequest(w, r, response.CodeValidationError, "invalid body")
		return false
	}
	return true
}

func pathUUID(w http.ResponseWriter, r *http.Request, name string) (uuid.UUID, bool) {
	id, err := uuid.Parse(r.PathValue(name))
	if err != nil {
		response.BadRequest(w, r, response.CodeValidationError, "invalid uuid")
		return uuid.Nil, false
	}
	return id, true
}

func listFilter(r *http.Request) (loyaltyusecase.ListFilter, apiquery.Query) {
	q := apiquery.Parse(r.URL.Query())
	f := loyaltyusecase.ListFilter{Q: q.Q, Limit: q.Limit, Offset: q.Offset}
	if v := r.URL.Query().Get("is_active"); v == "true" || v == "false" {
		b := v == "true"
		f.IsActive = &b
	}
	return f, q
}

func optUUIDParam(w http.ResponseWriter, r *http.Request, key string) (*uuid.UUID, bool) {
	v := strings.TrimSpace(r.URL.Query().Get(key))
	if v == "" {
		return nil, true
	}
	id, err := uuid.Parse(v)
	if err != nil {
		response.BadRequest(w, r, response.CodeValidationError, "invalid "+key)
		return nil, false
	}
	return &id, true
}

// ------------------------------------------------------------ overview

// Overview returns counters and upcoming renewals (?days=7).
func (h *Handler) Overview(w http.ResponseWriter, r *http.Request) {
	days, _ := strconv.Atoi(r.URL.Query().Get("days"))
	out, err := h.svc.Overview(r.Context(), days)
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.JSON(w, r, http.StatusOK, out)
}

// ------------------------------------------------------------ campaigns

func (h *Handler) ListCampaigns(w http.ResponseWriter, r *http.Request) {
	f, q := listFilter(r)
	items, total, err := h.svc.ListCampaigns(r.Context(), f)
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.JSON(w, r, http.StatusOK, apiquery.NewPage(items, total, q.Limit, q.Offset))
}

func (h *Handler) GetCampaign(w http.ResponseWriter, r *http.Request) {
	id, ok := pathUUID(w, r, "uuid")
	if !ok {
		return
	}
	out, err := h.svc.GetCampaign(r.Context(), id)
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.JSON(w, r, http.StatusOK, out)
}

func (h *Handler) CreateCampaign(w http.ResponseWriter, r *http.Request) {
	var in loyaltyusecase.CampaignInput
	if !decode(w, r, &in) {
		return
	}
	out, err := h.svc.CreateCampaign(r.Context(), in)
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.JSON(w, r, http.StatusCreated, out)
}

func (h *Handler) UpdateCampaign(w http.ResponseWriter, r *http.Request) {
	id, ok := pathUUID(w, r, "uuid")
	if !ok {
		return
	}
	var in loyaltyusecase.CampaignInput
	if !decode(w, r, &in) {
		return
	}
	out, err := h.svc.UpdateCampaign(r.Context(), id, in)
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.JSON(w, r, http.StatusOK, out)
}

func (h *Handler) DeleteCampaign(w http.ResponseWriter, r *http.Request) {
	id, ok := pathUUID(w, r, "uuid")
	if !ok {
		return
	}
	if err := h.svc.DeleteCampaign(r.Context(), id); err != nil {
		writeError(w, r, err)
		return
	}
	response.JSON(w, r, http.StatusOK, map[string]bool{"deleted": true})
}

// ------------------------------------------------------------ packages

func (h *Handler) ListPackages(w http.ResponseWriter, r *http.Request) {
	f, q := listFilter(r)
	items, total, err := h.svc.ListPackages(r.Context(), f)
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.JSON(w, r, http.StatusOK, apiquery.NewPage(items, total, q.Limit, q.Offset))
}

func (h *Handler) GetPackage(w http.ResponseWriter, r *http.Request) {
	id, ok := pathUUID(w, r, "uuid")
	if !ok {
		return
	}
	out, err := h.svc.GetPackage(r.Context(), id)
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.JSON(w, r, http.StatusOK, out)
}

func (h *Handler) CreatePackage(w http.ResponseWriter, r *http.Request) {
	var in loyaltyusecase.PackageInput
	if !decode(w, r, &in) {
		return
	}
	out, err := h.svc.CreatePackage(r.Context(), in)
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.JSON(w, r, http.StatusCreated, out)
}

func (h *Handler) UpdatePackage(w http.ResponseWriter, r *http.Request) {
	id, ok := pathUUID(w, r, "uuid")
	if !ok {
		return
	}
	var in loyaltyusecase.PackageInput
	if !decode(w, r, &in) {
		return
	}
	out, err := h.svc.UpdatePackage(r.Context(), id, in)
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.JSON(w, r, http.StatusOK, out)
}

func (h *Handler) DeletePackage(w http.ResponseWriter, r *http.Request) {
	id, ok := pathUUID(w, r, "uuid")
	if !ok {
		return
	}
	if err := h.svc.DeletePackage(r.Context(), id); err != nil {
		writeError(w, r, err)
		return
	}
	response.JSON(w, r, http.StatusOK, map[string]bool{"deleted": true})
}

// ------------------------------------------------------------ plans

func (h *Handler) ListPlans(w http.ResponseWriter, r *http.Request) {
	f, q := listFilter(r)
	items, total, err := h.svc.ListPlans(r.Context(), f)
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.JSON(w, r, http.StatusOK, apiquery.NewPage(items, total, q.Limit, q.Offset))
}

func (h *Handler) GetPlan(w http.ResponseWriter, r *http.Request) {
	id, ok := pathUUID(w, r, "uuid")
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

func (h *Handler) CreatePlan(w http.ResponseWriter, r *http.Request) {
	var in loyaltyusecase.PlanInput
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

func (h *Handler) UpdatePlan(w http.ResponseWriter, r *http.Request) {
	id, ok := pathUUID(w, r, "uuid")
	if !ok {
		return
	}
	var in loyaltyusecase.PlanInput
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

func (h *Handler) DeletePlan(w http.ResponseWriter, r *http.Request) {
	id, ok := pathUUID(w, r, "uuid")
	if !ok {
		return
	}
	if err := h.svc.DeletePlan(r.Context(), id); err != nil {
		writeError(w, r, err)
		return
	}
	response.JSON(w, r, http.StatusOK, map[string]bool{"deleted": true})
}

// ------------------------------------------------------------ customer packages

func (h *Handler) ListCustomerPackages(w http.ResponseWriter, r *http.Request) {
	q := apiquery.Parse(r.URL.Query())
	cust, ok := optUUIDParam(w, r, "customer_uuid")
	if !ok {
		return
	}
	items, total, err := h.svc.ListCustomerPackages(r.Context(), loyaltyusecase.CustomerPackageFilter{
		Q: q.Q, CustomerUUID: cust, State: strings.TrimSpace(r.URL.Query().Get("state")), Limit: q.Limit, Offset: q.Offset,
	})
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.JSON(w, r, http.StatusOK, apiquery.NewPage(items, total, q.Limit, q.Offset))
}

func (h *Handler) GetCustomerPackage(w http.ResponseWriter, r *http.Request) {
	id, ok := pathUUID(w, r, "uuid")
	if !ok {
		return
	}
	out, err := h.svc.GetCustomerPackage(r.Context(), id)
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.JSON(w, r, http.StatusOK, out)
}

func (h *Handler) SellPackage(w http.ResponseWriter, r *http.Request) {
	var in loyaltyusecase.SellPackageInput
	if !decode(w, r, &in) {
		return
	}
	out, err := h.svc.SellPackage(r.Context(), in)
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.JSON(w, r, http.StatusCreated, out)
}

func (h *Handler) CancelCustomerPackage(w http.ResponseWriter, r *http.Request) {
	id, ok := pathUUID(w, r, "uuid")
	if !ok {
		return
	}
	out, err := h.svc.CancelCustomerPackage(r.Context(), id)
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.JSON(w, r, http.StatusOK, out)
}

// ------------------------------------------------------------ subscriptions

func (h *Handler) ListSubscriptions(w http.ResponseWriter, r *http.Request) {
	q := apiquery.Parse(r.URL.Query())
	cust, ok := optUUIDParam(w, r, "customer_uuid")
	if !ok {
		return
	}
	f := loyaltyusecase.SubscriptionFilter{
		Q: q.Q, CustomerUUID: cust, State: strings.TrimSpace(r.URL.Query().Get("state")), Limit: q.Limit, Offset: q.Offset,
	}
	if v := strings.TrimSpace(r.URL.Query().Get("due_within_days")); v != "" {
		n, err := strconv.Atoi(v)
		if err != nil {
			response.BadRequest(w, r, response.CodeValidationError, "invalid due_within_days")
			return
		}
		f.DueWithinDays = &n
	}
	items, total, err := h.svc.ListSubscriptions(r.Context(), f)
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.JSON(w, r, http.StatusOK, apiquery.NewPage(items, total, q.Limit, q.Offset))
}

func (h *Handler) GetSubscription(w http.ResponseWriter, r *http.Request) {
	id, ok := pathUUID(w, r, "uuid")
	if !ok {
		return
	}
	out, err := h.svc.GetSubscription(r.Context(), id)
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.JSON(w, r, http.StatusOK, out)
}

func (h *Handler) StartSubscription(w http.ResponseWriter, r *http.Request) {
	var in loyaltyusecase.StartSubscriptionInput
	if !decode(w, r, &in) {
		return
	}
	out, err := h.svc.StartSubscription(r.Context(), in)
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.JSON(w, r, http.StatusCreated, out)
}

func (h *Handler) PaySubscription(w http.ResponseWriter, r *http.Request) {
	id, ok := pathUUID(w, r, "uuid")
	if !ok {
		return
	}
	var in loyaltyusecase.PaymentInput
	if !decode(w, r, &in) {
		return
	}
	out, err := h.svc.PaySubscription(r.Context(), id, in)
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.JSON(w, r, http.StatusOK, out)
}

func (h *Handler) CancelSubscription(w http.ResponseWriter, r *http.Request) {
	id, ok := pathUUID(w, r, "uuid")
	if !ok {
		return
	}
	out, err := h.svc.CancelSubscription(r.Context(), id)
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.JSON(w, r, http.StatusOK, out)
}

// ------------------------------------------------------------ customer / job

func (h *Handler) CustomerLoyalty(w http.ResponseWriter, r *http.Request) {
	id, ok := pathUUID(w, r, "uuid")
	if !ok {
		return
	}
	out, err := h.svc.CustomerLoyalty(r.Context(), id)
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.JSON(w, r, http.StatusOK, out)
}

func (h *Handler) JobLoyalty(w http.ResponseWriter, r *http.Request) {
	id, ok := pathUUID(w, r, "uuid")
	if !ok {
		return
	}
	out, err := h.svc.JobLoyalty(r.Context(), id)
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.JSON(w, r, http.StatusOK, out)
}

func (h *Handler) ApplyToJob(w http.ResponseWriter, r *http.Request) {
	id, ok := pathUUID(w, r, "uuid")
	if !ok {
		return
	}
	var in loyaltyusecase.ApplyInput
	if !decode(w, r, &in) {
		return
	}
	out, err := h.svc.Apply(r.Context(), id, in)
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.JSON(w, r, http.StatusOK, out)
}

func (h *Handler) RevertOnJob(w http.ResponseWriter, r *http.Request) {
	id, ok := pathUUID(w, r, "uuid")
	if !ok {
		return
	}
	appID, ok := pathUUID(w, r, "applicationUuid")
	if !ok {
		return
	}
	out, err := h.svc.Revert(r.Context(), id, appID)
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.JSON(w, r, http.StatusOK, out)
}
