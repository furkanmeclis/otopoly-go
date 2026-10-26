package oauth

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/mcp"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/oauth/model"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/oauth/usecase"
)

// Both modules mount on one mux without pattern conflicts, and the public
// discovery endpoints answer without a session.
func TestRoutesMountAndDiscovery(t *testing.T) {
	mux := http.NewServeMux()
	svc := usecase.New(nil, nil, nil, "https://app.otopoly.test", nil)
	RegisterRoutes(mux, svc, nil, nil, nil)
	sets := map[string]mcp.ToolSet{model.ResourceOrg: mcp.PlatformTools{}, model.ResourcePlatform: mcp.PlatformTools{}}
	mcp.RegisterRoutes(mux, mcp.New(mcp.Config{Tokens: svc, Sets: sets}))

	for _, c := range []struct {
		method, path string
		want         int
		body         string
	}{
		{http.MethodGet, "/.well-known/oauth-authorization-server", http.StatusOK, `"registration_endpoint":"https://app.otopoly.test/oauth/register"`},
		{http.MethodGet, "/.well-known/oauth-authorization-server/mcp/org", http.StatusOK, `"issuer":"https://app.otopoly.test"`},
		{http.MethodGet, "/.well-known/oauth-protected-resource/mcp/org", http.StatusOK, `"resource":"https://app.otopoly.test/mcp/org"`},
		{http.MethodGet, "/.well-known/oauth-protected-resource/mcp/platform", http.StatusOK, `"scopes_supported":["mcp:read"]`},
		{http.MethodOptions, "/oauth/token", http.StatusNoContent, ""},
		{http.MethodPost, "/mcp/org", http.StatusUnauthorized, `"code":-32001`},
		{http.MethodPost, "/mcp/platform", http.StatusUnauthorized, ""},
	} {
		rec := httptest.NewRecorder()
		mux.ServeHTTP(rec, httptest.NewRequest(c.method, c.path, strings.NewReader(`{"jsonrpc":"2.0","id":1,"method":"tools/list"}`)))
		if rec.Code != c.want || !strings.Contains(rec.Body.String(), c.body) {
			t.Errorf("%s %s = %d %s", c.method, c.path, rec.Code, rec.Body)
		}
	}
}
