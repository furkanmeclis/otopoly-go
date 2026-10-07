package handler

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/messaging/providers"
	messagingusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/messaging/usecase"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/entitlements"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/orgctx"
)

type ownNumberOff struct{}

func (ownNumberOff) Features(context.Context, int64) ([]entitlements.Feature, error) {
	return []entitlements.Feature{{Key: messagingusecase.FeatureOwnNumber, Kind: entitlements.KindToggle, Enabled: false}}, nil
}
func (ownNumberOff) Usage(context.Context, int64, string, string) (int64, error) { return 0, nil }
func (ownNumberOff) Consume(context.Context, int64, string, string, int64) (int64, error) {
	return 0, nil
}

// noQueries fails the test if the handler reaches the database: the
// entitlement gate must answer first.
type noQueries struct{ messagingusecase.Querier }

func newGatedHandler() *Handler {
	svc := messagingusecase.New(noQueries{}, providers.NewWhatsAppProvider(&providers.StubWhatsAppClient{}, nil), nil)
	svc.SetEntitlements(entitlements.New(ownNumberOff{}))
	return New(svc)
}

func call(t *testing.T, fn http.HandlerFunc, method, body string) (int, string) {
	t.Helper()
	r := httptest.NewRequest(method, "/", strings.NewReader(body))
	r = r.WithContext(orgctx.WithScope(r.Context(), orgctx.Scope{InternalID: 42}))
	w := httptest.NewRecorder()
	fn(w, r)
	var env struct {
		Error struct {
			Code string `json:"code"`
		} `json:"error"`
	}
	_ = json.Unmarshal(w.Body.Bytes(), &env)
	return w.Code, env.Error.Code
}

func TestConnectWithoutOwnNumberIs403(t *testing.T) {
	h := newGatedHandler()
	status, code := call(t, h.ConnectWhatsApp, http.MethodPost, "")
	if status != http.StatusForbidden || code != "FEATURE_NOT_ENTITLED" {
		t.Fatalf("connect: %d %s", status, code)
	}
}

func TestTemplateWritesWithoutOwnNumberAre403(t *testing.T) {
	h := newGatedHandler()
	for name, fn := range map[string]http.HandlerFunc{
		"save":   h.SaveTemplateByKey,
		"reset":  h.ResetTemplateByKey,
		"upsert": h.UpsertTemplate,
	} {
		status, code := call(t, fn, http.MethodPut, `{"event_type":"job.ready","channel":"whatsapp","body":"x"}`)
		if status != http.StatusForbidden || code != "FEATURE_NOT_ENTITLED" {
			t.Errorf("%s: %d %s", name, status, code)
		}
	}
}
