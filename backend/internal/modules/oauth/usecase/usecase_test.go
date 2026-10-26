package usecase

import (
	"errors"
	"net/url"
	"slices"
	"strings"
	"testing"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/oauth/model"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/authctx"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/rbac"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/pkg/apiquery"
)

func TestS256AndVerifier(t *testing.T) {
	// RFC 7636 appendix B.
	if got := S256("dBjftJeZ4CVP-mJ92K1PvOEcyHUQhDQKjJIFRb2x3sg"); got != "um-i7Mc0Tq1gUOihU3FyJtXLMTeyO9o15F5cLc1G5zw" {
		t.Fatalf("S256 = %q", got)
	}
	for v, want := range map[string]bool{
		strings.Repeat("a", 43):           true,
		strings.Repeat("a", 128):          true,
		strings.Repeat("a", 42):           false,
		strings.Repeat("a", 129):          false,
		strings.Repeat("a", 42) + "-._~":  true,
		strings.Repeat("a", 42) + " ":     false,
		strings.Repeat("a", 42) + "+":     false,
		strings.Repeat("ğ", 43):           false,
		"dBjftJeZ4CVP-mJ92K1PvOEcyHUQhDQ": false,
	} {
		if got := ValidVerifier(v); got != want {
			t.Errorf("ValidVerifier(%q) = %v, want %v", v, got, want)
		}
	}
}

func TestValidRedirect(t *testing.T) {
	for raw, want := range map[string]bool{
		"https://claude.ai/api/mcp/auth_callback":            true,
		"http://localhost:33418/callback":                    true,
		"http://127.0.0.1:6274/oauth/callback":               true,
		"http://[::1]:8080/cb":                               true,
		"cursor://anysphere.cursor-retrieval/oauth/callback": true,
		"http://example.com/cb":                              false,
		"https://claude.ai/cb#frag":                          false,
		"https://user:pw@claude.ai/cb":                       false,
		"javascript:alert(1)":                                false,
		"data:text/html,x":                                   false,
		"/relative":                                          false,
		"https://":                                           false,
	} {
		if got := ValidRedirect(raw); got != want {
			t.Errorf("ValidRedirect(%q) = %v, want %v", raw, got, want)
		}
	}
}

func TestValidateRegistration(t *testing.T) {
	ok := model.RegisterInput{RedirectURIs: []string{"https://claude.ai/api/mcp/auth_callback"}, TokenEndpointAuthMethod: "none",
		GrantTypes: []string{"authorization_code", "refresh_token"}, ResponseTypes: []string{"code"}}
	if err := ValidateRegistration(ok); err != nil {
		t.Fatal(err)
	}
	cases := map[string]func(*model.RegisterInput){
		"no redirect":     func(in *model.RegisterInput) { in.RedirectURIs = nil },
		"bad redirect":    func(in *model.RegisterInput) { in.RedirectURIs = []string{"http://evil.example/cb"} },
		"secret client":   func(in *model.RegisterInput) { in.TokenEndpointAuthMethod = "client_secret_basic" },
		"implicit grant":  func(in *model.RegisterInput) { in.GrantTypes = []string{"implicit"} },
		"token response":  func(in *model.RegisterInput) { in.ResponseTypes = []string{"token"} },
		"too many uris":   func(in *model.RegisterInput) { in.RedirectURIs = slices.Repeat([]string{"https://a.example/cb"}, 11) },
		"client creds":    func(in *model.RegisterInput) { in.GrantTypes = []string{"client_credentials"} },
		"fragment in uri": func(in *model.RegisterInput) { in.RedirectURIs = []string{"https://a.example/cb#x"} },
	}
	for name, mutate := range cases {
		in := ok
		mutate(&in)
		var oe *model.Error
		if err := ValidateRegistration(in); !errors.As(err, &oe) || oe.Status != 400 {
			t.Errorf("%s: err = %v", name, err)
		}
	}
}

func TestResolveScopes(t *testing.T) {
	cases := []struct {
		raw, resource string
		want          []string
	}{
		{"", model.ResourceOrg, []string{model.ScopeRead, model.ScopeWrite}},
		{"", model.ResourcePlatform, []string{model.ScopeRead}},
		{"mcp:read", model.ResourceOrg, []string{model.ScopeRead}},
		{"mcp:write", model.ResourceOrg, []string{model.ScopeRead, model.ScopeWrite}},
		{"mcp:write mcp:read openid", model.ResourceOrg, []string{model.ScopeRead, model.ScopeWrite}},
		{"mcp:write", model.ResourcePlatform, []string{model.ScopeRead}},
		{"unknown other", model.ResourceOrg, []string{model.ScopeRead, model.ScopeWrite}},
	}
	for _, c := range cases {
		if got := ResolveScopes(c.raw, c.resource); !slices.Equal(got, c.want) {
			t.Errorf("ResolveScopes(%q, %s) = %v, want %v", c.raw, c.resource, got, c.want)
		}
	}
}

func TestGrantedScopes(t *testing.T) {
	both := []string{model.ScopeRead, model.ScopeWrite}
	if got, _ := GrantedScopes(both, nil); !slices.Equal(got, both) {
		t.Fatalf("default = %v", got)
	}
	if got, _ := GrantedScopes(both, []string{model.ScopeRead}); !slices.Equal(got, []string{model.ScopeRead}) {
		t.Fatalf("read only = %v", got)
	}
	if got, _ := GrantedScopes(both, []string{model.ScopeWrite}); !slices.Equal(got, both) {
		t.Fatalf("write implies read = %v", got)
	}
	var ve *apiquery.ValidationError
	if _, err := GrantedScopes([]string{model.ScopeRead}, []string{model.ScopeWrite}); !errors.As(err, &ve) {
		t.Fatalf("widening must fail: %v", err)
	}
}

func TestResourcePathAndMetadata(t *testing.T) {
	s := New(nil, nil, nil, "https://app.otopoly.test/", nil)
	for raw, want := range map[string]string{
		"https://app.otopoly.test/mcp/org":       model.ResourceOrg,
		"https://app.otopoly.test/mcp/org/":      model.ResourceOrg,
		"https://APP.otopoly.test/mcp/platform":  model.ResourcePlatform,
		"https://evil.test/mcp/org":              "",
		"http://app.otopoly.test/mcp/org":        "",
		"https://app.otopoly.test/mcp/other":     "",
		"https://app.otopoly.test/mcp/org?x=1":   "",
		"/mcp/org":                               "",
		"https://app.otopoly.test/mcp/org#frag":  "",
		"https://app.otopoly.test/api/v1/health": "",
	} {
		got, ok := s.resourcePath(raw)
		if (want == "") == ok || got != want {
			t.Errorf("resourcePath(%q) = %q %v, want %q", raw, got, ok, want)
		}
	}
	md := s.AuthorizationServerMetadata()
	if md["issuer"] != "https://app.otopoly.test" || md["token_endpoint"] != "https://app.otopoly.test/oauth/token" ||
		!slices.Equal(md["code_challenge_methods_supported"].([]string), []string{"S256"}) {
		t.Fatalf("metadata = %v", md)
	}
	pr := s.ProtectedResourceMetadata(model.ResourcePlatform)
	if pr["resource"] != "https://app.otopoly.test/mcp/platform" || !slices.Equal(pr["scopes_supported"].([]string), []string{model.ScopeRead}) {
		t.Fatalf("resource metadata = %v", pr)
	}
	if u := s.ResourceMetadataURL(model.ResourceOrg); u != "https://app.otopoly.test/.well-known/oauth-protected-resource/mcp/org" {
		t.Fatalf("metadata url = %q", u)
	}
}

func TestValidateAuthorize(t *testing.T) {
	s := New(nil, nil, nil, "https://app.otopoly.test", nil)
	good := model.AuthorizeInput{ResponseType: "code", CodeChallengeMethod: "S256", CodeChallenge: strings.Repeat("a", 43)}
	res, sc, err := s.validateAuthorize(good)
	if err != nil || res != model.ResourceOrg || !slices.Equal(sc, []string{model.ScopeRead, model.ScopeWrite}) {
		t.Fatalf("missing resource defaults to /mcp/org: %q %v %v", res, sc, err)
	}
	good.Resource = "https://app.otopoly.test/mcp/platform"
	if res, sc, err := s.validateAuthorize(good); err != nil || res != model.ResourcePlatform || !slices.Equal(sc, []string{model.ScopeRead}) {
		t.Fatalf("platform = %q %v %v", res, sc, err)
	}
	for name, mutate := range map[string]func(*model.AuthorizeInput){
		"plain pkce":     func(in *model.AuthorizeInput) { in.CodeChallengeMethod = "plain" },
		"no pkce":        func(in *model.AuthorizeInput) { in.CodeChallenge = "" },
		"token response": func(in *model.AuthorizeInput) { in.ResponseType = "token" },
		"foreign target": func(in *model.AuthorizeInput) { in.Resource = "https://evil.test/mcp/org" },
	} {
		in := good
		mutate(&in)
		var oe *model.Error
		if _, _, err := s.validateAuthorize(in); !errors.As(err, &oe) || !oe.Redirectable {
			t.Errorf("%s: err = %v (must be a redirectable OAuth error)", name, err)
		}
	}
}

func TestErrorRedirect(t *testing.T) {
	s := New(nil, nil, nil, "https://app.otopoly.test", nil)
	to, err := s.errorRedirect("https://claude.ai/cb?x=1", "st", model.ErrAccessDenied, "denied")
	if err != nil {
		t.Fatal(err)
	}
	u, _ := url.Parse(to)
	q := u.Query()
	if q.Get("error") != "access_denied" || q.Get("state") != "st" || q.Get("iss") != "https://app.otopoly.test" || q.Get("x") != "1" {
		t.Fatalf("redirect = %s", to)
	}
	code, err := s.codeRedirect("http://127.0.0.1:9/cb", "c0de", "")
	if err != nil || !strings.Contains(code, "code=c0de") || strings.Contains(code, "state=") {
		t.Fatalf("code redirect = %s %v", code, err)
	}
}

func TestPlatformAllowedAndFilters(t *testing.T) {
	if PlatformAllowed(authctx.Principal{Permissions: []string{rbac.PermTenantMCPConnect}}) {
		t.Fatal("tenant permission must not open the platform endpoint")
	}
	if !PlatformAllowed(authctx.Principal{Permissions: []string{rbac.PermPlatformMCPConnect}}) || !PlatformAllowed(authctx.Principal{IsSuperAdmin: true}) {
		t.Fatal("platform permission / super admin must open the platform endpoint")
	}
	f, err := ParseGrantFilter(url.Values{"realm": {"platform"}, "q": {" claude "}, "limit": {"5"}})
	if err != nil || f.Resource != model.ResourcePlatform || f.Q != "claude" || f.Limit != 5 {
		t.Fatalf("grant filter = %+v %v", f, err)
	}
	if _, err := ParseGrantFilter(url.Values{"realm": {"dealer"}}); err == nil {
		t.Fatal("unknown realm accepted")
	}
	if _, err := ParseGrantFilter(url.Values{"organization_uuid": {"x"}}); err == nil {
		t.Fatal("bad organization uuid accepted")
	}
	if c, err := ParseClientFilter(url.Values{"status": {"revoked"}}); err != nil || c.Status != "revoked" {
		t.Fatalf("client filter = %+v %v", c, err)
	}
	if _, err := ParseClientFilter(url.Values{"status": {"x"}}); err == nil {
		t.Fatal("unknown status accepted")
	}
}
