package handler

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/auth/usecase"
)

func TestPublicAccountDeletionHandlers(t *testing.T) {
	h := newTestHandler(t, stubRepo{})

	// Unknown email: same answer as a known one.
	rec, env := do(t, h.RequestPublicAccountDeletion, "/v1/auth/account/deletion/request", `{"email":"nobody@example.com"}`, nil)
	if rec.Code != http.StatusOK || !env.Success {
		t.Fatalf("request: %d %s", rec.Code, rec.Body.String())
	}
	rec, env = do(t, h.ConfirmPublicAccountDeletion, "/v1/auth/account/deletion/confirm", `{"email":"nobody@example.com","code":"123456"}`, nil)
	if rec.Code != http.StatusBadRequest || env.Error.Code != "INVALID_EMAIL_CODE" {
		t.Fatalf("confirm: %d %s", rec.Code, rec.Body.String())
	}
	rec, _ = do(t, h.RequestAccountRecovery, "/v1/auth/account/recovery/request", `{"email":"nobody@example.com"}`, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("recovery request: %d %s", rec.Code, rec.Body.String())
	}
	rec, env = do(t, h.ConfirmAccountRecovery, "/v1/auth/account/recovery/confirm", `{"email":"nobody@example.com","code":"123456"}`, nil)
	if rec.Code != http.StatusBadRequest || env.Error.Code != "INVALID_EMAIL_CODE" {
		t.Fatalf("recovery confirm: %d %s", rec.Code, rec.Body.String())
	}
	rec, env = do(t, h.RequestPublicAccountDeletion, "/v1/auth/account/deletion/request", `{"email":"x","extra":1}`, nil)
	if rec.Code != http.StatusBadRequest || env.Error.Code != "VALIDATION_ERROR" {
		t.Fatalf("unknown field: %d %s", rec.Code, rec.Body.String())
	}
}

func TestPendingDeletionErrorDetails(t *testing.T) {
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/v1/auth/login", nil)
	writeUsecaseError(rec, req, &usecase.PendingDeletionError{ScheduledOn: "2026-12-10"})
	var env envelope
	_ = json.Unmarshal(rec.Body.Bytes(), &env)
	if rec.Code != http.StatusForbidden || env.Error.Code != "ACCOUNT_DEACTIVATED" {
		t.Fatalf("got %d %s", rec.Code, rec.Body.String())
	}
	got := map[string]string{}
	for _, d := range env.Error.Details {
		got[d.Field] = d.Message
	}
	if got["deletion_scheduled_on"] != "2026-12-10" || got["recoverable"] != "true" {
		t.Fatalf("details: %v", got)
	}
}

func TestDeletionResponseShape(t *testing.T) {
	res := deletionResponse(usecase.DeletionResult{ScheduledOn: "2026-12-10"})
	if res.Status != "scheduled" || res.GraceDays != usecase.AccountDeletionGraceDays || res.OwnedOrganizations == nil {
		t.Fatalf("%+v", res)
	}
}
