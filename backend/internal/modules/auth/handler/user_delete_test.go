package handler_test

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	authmodule "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/auth"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/auth/handler"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/auth/usecase"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/authctx"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/jwt"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/rbac"
	"github.com/google/uuid"
)

type principalLoader map[string]authctx.Principal

func (l principalLoader) LoadPrincipal(_ *http.Request, claims jwt.Claims) (authctx.Principal, error) {
	p, ok := l[claims.Subject]
	if !ok {
		return authctx.Principal{}, errors.New("unknown user")
	}
	return p, nil
}

type errEnvelope struct {
	Error struct {
		Code    string `json:"code"`
		Details []struct {
			Field   string `json:"field"`
			Message string `json:"message"`
			Code    string `json:"code"`
		} `json:"details"`
	} `json:"error"`
}

// newRouteEnv mounts the auth routes with a repository that panics when
// reached, so only middleware and guards that run before the use case answer.
func newRouteEnv(t *testing.T, perms ...string) (*http.ServeMux, string, uuid.UUID) {
	t.Helper()
	tm, err := jwt.NewManager("test-secret-key-32-bytes-minimum!", time.Minute, time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	actor := uuid.New()
	tok, _, err := tm.IssueAccess(jwt.AccessInput{UserID: actor})
	if err != nil {
		t.Fatal(err)
	}
	loader := principalLoader{actor.String(): {UserID: actor, UserInternal: 7, Permissions: perms}}
	h := handler.New(usecase.New(nil, tm), nil, nil, nil, nil, "adapter-secret", nil, nil)
	mux := http.NewServeMux()
	authmodule.RegisterRoutes(mux, h, tm, loader, nil)
	return mux, tok, actor
}

func call(mux *http.ServeMux, method, path, tok string) (*httptest.ResponseRecorder, errEnvelope) {
	req := httptest.NewRequest(method, path, nil)
	req.Header.Set("Authorization", "Bearer "+tok)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	var env errEnvelope
	_ = json.Unmarshal(rec.Body.Bytes(), &env)
	return rec, env
}

func TestDeletePlatformUserRequiresDeletePermission(t *testing.T) {
	mux, tok, _ := newRouteEnv(t, rbac.PermPlatformUsersRead, rbac.PermPlatformUsersWrite)
	target := uuid.New().String()
	for _, tc := range []struct{ method, path string }{
		{http.MethodDelete, "/v1/platform/users/" + target},
		{http.MethodPost, "/v1/platform/users/" + target + "/restore"},
	} {
		rec, _ := call(mux, tc.method, tc.path, tok)
		if rec.Code != http.StatusForbidden {
			t.Fatalf("%s %s without platform.users.delete: status %d", tc.method, tc.path, rec.Code)
		}
	}
}

func TestDeletePlatformUserRejectsSelf(t *testing.T) {
	mux, tok, actor := newRouteEnv(t, rbac.PermPlatformUsersDelete)
	rec, env := call(mux, http.MethodDelete, "/v1/platform/users/"+actor.String(), tok)
	if rec.Code != http.StatusConflict || env.Error.Code != "CANNOT_DELETE_SELF" {
		t.Fatalf("self delete: status %d code %q", rec.Code, env.Error.Code)
	}
}
