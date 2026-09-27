package middleware

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/entitlements"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/orgctx"
)

type fakeStore struct{ feats []entitlements.Feature }

func (f fakeStore) Features(context.Context, int64) ([]entitlements.Feature, error) {
	return f.feats, nil
}
func (fakeStore) Usage(context.Context, int64, string, string) (int64, error) { return 0, nil }
func (fakeStore) Consume(context.Context, int64, string, string, int64) (int64, error) {
	return 0, nil
}

func TestRequireFeature(t *testing.T) {
	off := entitlements.New(fakeStore{feats: []entitlements.Feature{{Key: "module.contracts", Kind: entitlements.KindToggle, Enabled: false}}})
	ok := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusOK) })
	ctx := orgctx.WithScope(context.Background(), orgctx.Scope{InternalID: 7})
	req := httptest.NewRequest("GET", "/x", nil).WithContext(ctx)

	rec := httptest.NewRecorder()
	RequireFeature(off, "module.contracts")(ok).ServeHTTP(rec, req)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("disabled toggle must 403, got %d %s", rec.Code, rec.Body.String())
	}

	rec = httptest.NewRecorder()
	RequireFeature(nil, "module.contracts")(ok).ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("nil service must allow, got %d", rec.Code)
	}

	rec = httptest.NewRecorder()
	RequireFeature(off, "module.quotes")(ok).ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("undefined toggle must allow, got %d", rec.Code)
	}
}
