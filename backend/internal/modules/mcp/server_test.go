package mcp

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database/db"
	aitools "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/ai/tools"
	oauthmodel "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/oauth/model"
	oauthusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/oauth/usecase"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/activity"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/authctx"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/orgctx"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/rbac"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

func TestMaskArguments(t *testing.T) {
	got := MaskArguments(json.RawMessage(`{"customer_name":"Ali Veli","phone":"+905321234567","status":"open",
		"limit":5,"q":"ali","notes":"x","number":"TK-0001","items":[{"customer_email":"a@b.co"}],
		"free":"call +90 532 123 45 67","flag":true,"date":"2026-10-07","customer_uuid":"7b6e1d2c-0000-4000-8000-000000000000"}`))
	raw, _ := json.Marshal(got)
	s := string(raw)
	for _, leak := range []string{"Ali Veli", "905321234567", "a@b.co", "532 123", `"ali"`} {
		if strings.Contains(s, leak) {
			t.Fatalf("personal value %q logged: %s", leak, s)
		}
	}
	m := got.(map[string]any)
	if m["status"] != "open" || m["limit"] != float64(5) || m["number"] != "TK-0001" || m["flag"] != true || m["date"] != "2026-10-07" ||
		m["customer_uuid"] != "7b6e1d2c-0000-4000-8000-000000000000" {
		t.Fatalf("non-personal values changed: %s", s)
	}
	if MaskArguments(json.RawMessage(`{bad`)) != Masked {
		t.Fatal("invalid JSON must not be logged")
	}
	if long := MaskArguments(json.RawMessage(`{"status":"` + strings.Repeat("x", 100) + `"}`)).(map[string]any)["status"].(string); len([]rune(long)) != 65 {
		t.Fatalf("long value not cut: %d", len([]rune(long)))
	}
}

func TestBearer(t *testing.T) {
	for in, want := range map[string]string{"Bearer abc": "abc", "bearer  abc ": "abc", "Basic abc": "", "": "", "Bearer": ""} {
		if got := bearer(in); got != want {
			t.Fatalf("bearer(%q) = %q, want %q", in, got, want)
		}
	}
}

// --- fakes ---------------------------------------------------------------------

type fakeTokens struct {
	tok oauthmodel.AccessToken
	err error
}

func (f fakeTokens) ValidateAccessToken(_ context.Context, raw, resource string) (oauthmodel.AccessToken, error) {
	if raw != "good" {
		return oauthmodel.AccessToken{}, oauthusecase.ErrUnauthorized
	}
	if f.err != nil {
		return oauthmodel.AccessToken{}, f.err
	}
	t := f.tok
	t.Resource = resource
	return t, nil
}

func (fakeTokens) ResourceMetadataURL(resource string) string {
	return "https://app.test/.well-known/oauth-protected-resource" + resource
}

type fakeResolver struct {
	p   Principal
	err error
}

func (f fakeResolver) Resolve(_ context.Context, tok oauthmodel.AccessToken) (Principal, error) {
	p := f.p
	p.Scopes = tok.Scopes
	return p, f.err
}

type fakeLimiter struct {
	limits map[string]int
	deny   string
}

func (f *fakeLimiter) Allow(_ context.Context, action, _ string, limit int, _ time.Duration) (bool, time.Duration) {
	f.limits[action] = limit
	if action == f.deny {
		return false, 90 * time.Second
	}
	return true, 0
}

type staticSet []aitools.Tool

func (s staticSet) Tools(context.Context, Principal) ([]aitools.Tool, error) { return s, nil }

type recorder struct{ events []map[string]any }

func (r *recorder) Record(_ context.Context, _ *int64, action, _ string, _ *uuid.UUID, payload map[string]any, _ *http.Request) {
	payload["action"] = action
	r.events = append(r.events, payload)
}

// readTool echoes the organization scope it ran with.
type readTool struct{}

func (readTool) Spec() aitools.Spec {
	return aitools.Spec{Name: "list_things", Description: "List things.", Kind: aitools.KindRead, Feature: aitools.FeatureChat,
		InputSchema: map[string]any{"type": "object", "additionalProperties": false,
			"properties": map[string]any{"q": map[string]any{"type": "string", "maxLength": 10}}}}
}

func (readTool) Run(ctx context.Context, env aitools.Env, _ json.RawMessage) (aitools.Result, error) {
	scope, _ := orgctx.ScopeFrom(ctx)
	p, _ := authctx.PrincipalFrom(ctx)
	return aitools.JSONResult(map[string]any{"items": []string{"a"}, "total": 3, "org": scope.Slug,
		"user": p.UserInternal, "env_org": env.Scope.InternalID}, "", nil), nil
}

// writeTool records the input Run got (the normalized Propose input).
type writeTool struct{ ran *json.RawMessage }

func (writeTool) Spec() aitools.Spec {
	return aitools.Spec{Name: "create_thing", Description: "Create a thing.", Kind: aitools.KindWrite, RequiresConfirmation: true,
		Feature: aitools.FeatureActions, InputSchema: map[string]any{"type": "object", "properties": map[string]any{
			"name": map[string]any{"type": "string", "minLength": 1}}, "required": []string{"name"}}}
}

func (w writeTool) Propose(ctx context.Context, _ aitools.Env, raw json.RawMessage) (aitools.Proposal, error) {
	var in struct{ Name string }
	_ = json.Unmarshal(raw, &in)
	if in.Name == "bad" {
		return aitools.Proposal{}, &aitools.InputError{Msg: "name is not allowed"}
	}
	if o, ok := activity.OriginFrom(ctx); !ok || o.Via != Via {
		return aitools.Proposal{}, errors.New("missing mcp origin")
	}
	return aitools.Proposal{Input: json.RawMessage(`{"name":"` + strings.ToUpper(in.Name) + `"}`),
		Preview: aitools.Preview{Action: "create_thing", Title: "Create " + in.Name}}, nil
}

func (w writeTool) Run(_ context.Context, _ aitools.Env, raw json.RawMessage) (aitools.Result, error) {
	*w.ran = raw
	res := aitools.JSONResult(map[string]any{"ok": true}, "", nil)
	res.Link = &aitools.Link{Kind: "thing", UUID: "u1"}
	return res, nil
}

func rpc(s *Server, path, auth, body string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodPost, path, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json, text/event-stream")
	if auth != "" {
		req.Header.Set("Authorization", auth)
	}
	rec := httptest.NewRecorder()
	s.ServeHTTP(rec, req)
	return rec
}

const listBody = `{"jsonrpc":"2.0","id":"r1","method":"tools/list"}`

func orgPrincipal() Principal {
	return Principal{Realm: oauthmodel.RealmOrg,
		Auth:  authctx.Principal{UserInternal: 3, Permissions: []string{rbac.PermTenantMCPConnect}},
		Scope: orgctx.Scope{InternalID: 9, Slug: "oto-1", MemberRole: "owner"}}
}

func TestServerGate(t *testing.T) {
	tok := oauthmodel.AccessToken{Family: uuid.New(), OrganizationID: 9, UserID: 3, Scopes: []string{oauthmodel.ScopeRead}}
	lim := &fakeLimiter{limits: map[string]int{}}
	sets := map[string]ToolSet{oauthmodel.ResourceOrg: staticSet{readTool{}}, oauthmodel.ResourcePlatform: staticSet{}}
	s := New(Config{Tokens: fakeTokens{tok: tok}, Principals: fakeResolver{p: orgPrincipal()}, Sets: sets, Limiter: lim})

	rec := rpc(s, "/mcp/org", "", listBody)
	if rec.Code != http.StatusUnauthorized ||
		rec.Header().Get("WWW-Authenticate") != `Bearer resource_metadata="https://app.test/.well-known/oauth-protected-resource/mcp/org"` {
		t.Fatalf("no token = %d %q", rec.Code, rec.Header().Get("WWW-Authenticate"))
	}
	if rec := rpc(s, "/mcp/org", "Bearer bad", listBody); rec.Code != http.StatusUnauthorized || !strings.Contains(rec.Header().Get("WWW-Authenticate"), `error="invalid_token"`) {
		t.Fatalf("bad token = %d %q", rec.Code, rec.Header().Get("WWW-Authenticate"))
	}
	if rec := rpc(s, "/mcp/dealer", "Bearer good", listBody); rec.Code != http.StatusNotFound {
		t.Fatalf("unknown endpoint = %d", rec.Code)
	}
	if rec := rpc(s, "/mcp/org", "Bearer good", listBody); rec.Code != http.StatusOK ||
		lim.limits["mcp_token"] != TokenRequestsPerMinute || lim.limits["mcp_org"] != OrgRequestsPerHour {
		t.Fatalf("allowed = %d %s limits %v", rec.Code, rec.Body, lim.limits)
	}

	lim.deny = "mcp_org"
	rec = rpc(s, "/mcp/org", "Bearer good", listBody)
	var body struct {
		JSONRPC string `json:"jsonrpc"`
		ID      string `json:"id"`
		Error   struct {
			Code int `json:"code"`
		} `json:"error"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &body)
	if rec.Code != http.StatusTooManyRequests || body.JSONRPC != "2.0" || body.ID != "r1" || body.Error.Code != CodeRateLimited ||
		rec.Header().Get("Retry-After") != "90" {
		t.Fatalf("org limit = %d %s %q", rec.Code, rec.Body, rec.Header().Get("Retry-After"))
	}

	off := New(Config{Tokens: fakeTokens{tok: tok, err: oauthusecase.ErrFeatureDisabled}, Principals: fakeResolver{}, Sets: sets})
	if rec := rpc(off, "/mcp/org", "Bearer good", listBody); rec.Code != http.StatusForbidden {
		t.Fatalf("plan off = %d", rec.Code)
	}
	gone := New(Config{Tokens: fakeTokens{tok: tok}, Principals: fakeResolver{err: ErrForbidden}, Sets: sets})
	if rec := rpc(gone, "/mcp/org", "Bearer good", listBody); rec.Code != http.StatusForbidden {
		t.Fatalf("membership lost = %d", rec.Code)
	}
}

type rpcResult struct {
	Result struct {
		Tools []struct {
			Name        string         `json:"name"`
			Description string         `json:"description"`
			Annotations map[string]any `json:"annotations"`
		} `json:"tools"`
		IsError           bool           `json:"isError"`
		StructuredContent map[string]any `json:"structuredContent"`
		Content           []struct {
			Text string `json:"text"`
		} `json:"content"`
	} `json:"result"`
	Error *struct {
		Message string `json:"message"`
	} `json:"error"`
}

func decode(t *testing.T, rec *httptest.ResponseRecorder) rpcResult {
	t.Helper()
	var out rpcResult
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatalf("decode %d %s: %v", rec.Code, rec.Body, err)
	}
	return out
}

func call(name, args string) string {
	return `{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"` + name + `","arguments":` + args + `}}`
}

func TestToolsListAndCall(t *testing.T) {
	var ran json.RawMessage
	write := writeTool{ran: &ran}
	rec := &recorder{}
	tok := oauthmodel.AccessToken{Family: uuid.New(), OrganizationID: 9, UserID: 3, ClientID: "mcp_c",
		Scopes: []string{oauthmodel.ScopeRead, oauthmodel.ScopeWrite}}
	s := New(Config{Tokens: fakeTokens{tok: tok}, Principals: fakeResolver{p: orgPrincipal()},
		Sets: map[string]ToolSet{oauthmodel.ResourceOrg: staticSet{readTool{}, write}}, Activity: rec})

	list := decode(t, rpc(s, "/mcp/org", "Bearer good", listBody))
	if len(list.Result.Tools) != 2 {
		t.Fatalf("tools = %+v", list)
	}
	for _, tl := range list.Result.Tools {
		ro, _ := tl.Annotations["readOnlyHint"].(bool)
		destructive, _ := tl.Annotations["destructiveHint"].(bool)
		switch tl.Name {
		case "list_things":
			if !ro || destructive {
				t.Errorf("read tool annotations = %v", tl.Annotations)
			}
		case "create_thing":
			if ro || !destructive || !strings.Contains(tl.Description, "changes data") {
				t.Errorf("write tool = %+v", tl)
			}
		}
	}

	res := decode(t, rpc(s, "/mcp/org", "Bearer good", call("list_things", `{"q":"a"}`)))
	sc := res.Result.StructuredContent
	if res.Result.IsError || sc["org"] != "oto-1" || sc["user"] != float64(3) || sc["env_org"] != float64(9) ||
		res.Result.Content[0].Text != "list_things: 1 of 3 items." {
		t.Fatalf("read call = %+v", res)
	}
	if res := decode(t, rpc(s, "/mcp/org", "Bearer good", call("list_things", `{"q":"far too long query"}`))); !res.Result.IsError {
		t.Fatalf("schema violation must fail: %+v", res)
	}

	res = decode(t, rpc(s, "/mcp/org", "Bearer good", call("create_thing", `{"name":"x"}`)))
	if res.Result.IsError || string(ran) != `{"name":"X"}` || res.Result.StructuredContent["change"] == nil || res.Result.StructuredContent["record"] == nil {
		t.Fatalf("write call = %+v ran=%s", res, ran)
	}
	if res := decode(t, rpc(s, "/mcp/org", "Bearer good", call("create_thing", `{"name":"bad"}`))); !res.Result.IsError ||
		res.Result.StructuredContent["error"].(map[string]any)["code"] != CodeInvalidInput {
		t.Fatalf("propose input error = %+v", res)
	}
	if res := decode(t, rpc(s, "/mcp/org", "Bearer good", call("drop_tables", `{}`))); !res.Result.IsError ||
		res.Result.StructuredContent["error"].(map[string]any)["code"] != CodeToolNotAllowed {
		t.Fatalf("unknown tool = %+v", res)
	}

	if len(rec.events) != 5 {
		t.Fatalf("audit events = %d", len(rec.events))
	}
	last := rec.events[len(rec.events)-1]
	if last["action"] != ActionToolCalled || last["result"] != OutcomeNotAllowed || last["client_id"] != "mcp_c" || last["organization_id"] != int64(9) {
		t.Fatalf("audit = %v", last)
	}

	// A read-only token never runs a write tool, even if the set offered it.
	ro := New(Config{Tokens: fakeTokens{tok: oauthmodel.AccessToken{OrganizationID: 9, UserID: 3, Scopes: []string{oauthmodel.ScopeRead}}},
		Principals: fakeResolver{p: orgPrincipal()}, Sets: map[string]ToolSet{oauthmodel.ResourceOrg: staticSet{write}}})
	ran = nil
	if res := decode(t, rpc(ro, "/mcp/org", "Bearer good", call("create_thing", `{"name":"x"}`))); !res.Result.IsError || ran != nil {
		t.Fatalf("read-only token ran a write tool: %+v", res)
	}
}

// --- tool sets --------------------------------------------------------------------

type uiTool struct{}

func (uiTool) Spec() aitools.Spec {
	return aitools.Spec{Name: "render_chart", Kind: aitools.KindUI, Feature: aitools.FeatureChat, InputSchema: map[string]any{"type": "object"}}
}
func (uiTool) Run(context.Context, aitools.Env, json.RawMessage) (aitools.Result, error) {
	return aitools.Result{}, nil
}

type permTool struct {
	name, perm string
	entitled   string
}

func (p permTool) Spec() aitools.Spec {
	return aitools.Spec{Name: p.name, Kind: aitools.KindRead, Feature: aitools.FeatureChat, Permissions: []string{p.perm},
		InputSchema: map[string]any{"type": "object"}}
}
func (permTool) Run(context.Context, aitools.Env, json.RawMessage) (aitools.Result, error) {
	return aitools.Result{}, nil
}

type entitledTool struct{ permTool }

func (e entitledTool) Entitlement() string { return e.entitled }

type features map[string]bool

func (f features) Enabled(_ context.Context, _ int64, key string) (bool, error) {
	on, ok := f[key]
	return !ok || on, nil
}

func names(ts []aitools.Tool) string {
	out := make([]string, 0, len(ts))
	for _, t := range ts {
		out = append(out, t.Spec().Name)
	}
	return strings.Join(out, ",")
}

func TestOrgTools(t *testing.T) {
	var ran json.RawMessage
	reg := aitools.NewRegistry(readTool{}, writeTool{ran: &ran}, uiTool{},
		permTool{name: "read_finance", perm: rbac.PermTenantFinanceRead},
		entitledTool{permTool{name: "list_leads", perm: rbac.PermTenantLeadsRead, entitled: "module.quotes"}})
	set := OrgTools{Registry: reg, Features: features{"module.quotes": false}}
	p := orgPrincipal()
	p.Auth.Permissions = append(p.Auth.Permissions, rbac.PermTenantLeadsRead)
	p.Scopes = []string{oauthmodel.ScopeRead}
	ctx := context.Background()

	got, _ := set.Tools(ctx, p)
	if names(got) != "list_things" {
		t.Fatalf("read scope, no finance permission, quotes off = %s", names(got))
	}
	p.Scopes = append(p.Scopes, oauthmodel.ScopeWrite)
	set.Features = features{}
	if got, _ := set.Tools(ctx, p); names(got) != "create_thing,list_leads,list_things" {
		t.Fatalf("write scope + quotes on = %s", names(got))
	}
	p.ReadOnly = true
	if got, _ := set.Tools(ctx, p); names(got) != "list_leads,list_things" {
		t.Fatalf("read-only subscription = %s", names(got))
	}
	set.Gate = func(context.Context) (aitools.Gate, error) {
		return aitools.Gate{ToolEnabled: func(n string) bool { return n != "list_things" }}, nil
	}
	if got, _ := set.Tools(ctx, p); names(got) != "list_leads" {
		t.Fatalf("platform switch = %s", names(got))
	}
	if got, _ := set.Tools(ctx, Principal{}); len(got) != 0 {
		t.Fatal("no organization scope must give no tools")
	}

	pt := PlatformTools{Registry: aitools.NewRegistry(
		permTool{name: "list_organizations", perm: rbac.PermPlatformOrganizationsRead},
		permTool{name: "list_logs", perm: rbac.PermPlatformLogsRead}, writeTool{ran: &ran})}
	admin := Principal{Auth: authctx.Principal{Permissions: []string{rbac.PermPlatformLogsRead}}}
	if got, _ := pt.Tools(ctx, admin); names(got) != "list_logs" {
		t.Fatalf("platform tools = %s", names(got))
	}
	if got, _ := pt.Tools(ctx, Principal{Auth: authctx.Principal{IsSuperAdmin: true}}); names(got) != "list_logs,list_organizations" {
		t.Fatalf("super admin platform tools = %s", names(got))
	}
}

// --- principal ----------------------------------------------------------------------

type fakeQ struct {
	user   db.User
	member *db.GetOrganizationMemberByUserAndOrgUUIDRow
}

func (f fakeQ) GetUserByID(context.Context, int64) (db.User, error) { return f.user, nil }
func (f fakeQ) GetOrganizationByID(_ context.Context, id int64) (db.Organization, error) {
	return db.Organization{ID: id, Uuid: uuid.New()}, nil
}
func (f fakeQ) GetOrganizationMemberByUserAndOrgUUID(context.Context, db.GetOrganizationMemberByUserAndOrgUUIDParams) (db.GetOrganizationMemberByUserAndOrgUUIDRow, error) {
	if f.member == nil {
		return db.GetOrganizationMemberByUserAndOrgUUIDRow{}, pgx.ErrNoRows
	}
	return *f.member, nil
}

type fakeAccess struct {
	perms []string
	super bool
}

func (f fakeAccess) ResolveUserAccess(context.Context, int64) ([]string, bool, []string, error) {
	return []string{"organization_owner"}, f.super, f.perms, nil
}

func TestStoreResolver(t *testing.T) {
	ctx := context.Background()
	user := db.User{ID: 3, Uuid: uuid.New(), Status: "active", Email: "u@test"}
	member := db.GetOrganizationMemberByUserAndOrgUUIDRow{OrganizationID: 9, OrganizationUuid: uuid.New(), OrganizationSlug: "oto",
		OrganizationName: "Oto", OrganizationStatus: "active", Role: "staff", SubscriptionStatus: "active"}
	connect := fakeAccess{perms: []string{rbac.PermTenantMCPConnect, rbac.PermTenantJobsRead}}
	orgTok := oauthmodel.AccessToken{UserID: 3, OrganizationID: 9, Resource: oauthmodel.ResourceOrg, Scopes: []string{oauthmodel.ScopeRead, oauthmodel.ScopeWrite}}

	p, err := StoreResolver{Q: fakeQ{user: user, member: &member}, Access: connect}.Resolve(ctx, orgTok)
	if err != nil || p.Scope.InternalID != 9 || p.Scope.MemberRole != "staff" || p.Auth.UserInternal != 3 ||
		!p.Auth.HasPermission(rbac.PermTenantJobsRead) || p.Auth.OrganizationUUID == nil || !p.CanWrite() {
		t.Fatalf("org principal = %+v %v", p, err)
	}
	readOnly := member
	readOnly.SubscriptionStatus = "read_only"
	if p, _ := (StoreResolver{Q: fakeQ{user: user, member: &readOnly}, Access: connect}).Resolve(ctx, orgTok); p.CanWrite() {
		t.Fatal("read-only subscription must not write")
	}

	suspended := member
	suspended.OrganizationStatus = "suspended"
	ended := member
	ended.AccessEndsAt = pgtype.Timestamptz{Time: time.Now().Add(-time.Hour), Valid: true}
	disabled := user
	disabled.Status = "disabled"
	platformTok := oauthmodel.AccessToken{UserID: 3, Resource: oauthmodel.ResourcePlatform, Scopes: []string{oauthmodel.ScopeRead}}
	for name, c := range map[string]struct {
		q   fakeQ
		acc fakeAccess
		tok oauthmodel.AccessToken
	}{
		"membership lost":          {fakeQ{user: user}, connect, orgTok},
		"connect permission lost":  {fakeQ{user: user, member: &member}, fakeAccess{perms: []string{rbac.PermTenantJobsRead}}, orgTok},
		"suspended":                {fakeQ{user: user, member: &suspended}, connect, orgTok},
		"access window closed":     {fakeQ{user: user, member: &ended}, connect, orgTok},
		"user disabled":            {fakeQ{user: disabled, member: &member}, connect, orgTok},
		"platform without perm":    {fakeQ{user: user}, connect, platformTok},
		"org token without org id": {fakeQ{user: user, member: &member}, connect, oauthmodel.AccessToken{UserID: 3, Resource: oauthmodel.ResourceOrg}},
	} {
		if _, err := (StoreResolver{Q: c.q, Access: c.acc}).Resolve(ctx, c.tok); !errors.Is(err, ErrForbidden) {
			t.Errorf("%s: err = %v, want ErrForbidden", name, err)
		}
	}
	p, err = StoreResolver{Q: fakeQ{user: user}, Access: fakeAccess{super: true}}.Resolve(ctx, platformTok)
	if err != nil || p.Realm != oauthmodel.RealmPlatform || p.Scope.InternalID != 0 || p.CanWrite() {
		t.Fatalf("platform principal = %+v %v", p, err)
	}
}

func TestToolCounter(t *testing.T) {
	c := ToolCounter{Principals: fakeResolver{p: orgPrincipal()}, Sets: map[string]ToolSet{oauthmodel.ResourceOrg: staticSet{readTool{}, uiTool{}}}}
	if n, err := c.CountTools(context.Background(), 3, 9, oauthmodel.ResourceOrg, nil); err != nil || n != 2 {
		t.Fatalf("count = %d %v", n, err)
	}
	if n, _ := c.CountTools(context.Background(), 3, 9, oauthmodel.ResourcePlatform, nil); n != 0 {
		t.Fatalf("unknown set = %d", n)
	}
	c.Principals = fakeResolver{err: ErrForbidden}
	if n, err := c.CountTools(context.Background(), 3, 9, oauthmodel.ResourceOrg, nil); err != nil || n != 0 {
		t.Fatalf("forbidden = %d %v", n, err)
	}
}

func TestSummary(t *testing.T) {
	if got := Summary("x", map[string]any{"items": []any{1, 2}, "total": float64(5)}, false); got != "x: 2 of 5 items." {
		t.Fatal(got)
	}
	if got := Summary("x", map[string]any{"jobs": []any{1}}, false); got != "x: 1 items." {
		t.Fatal(got)
	}
	if got := Summary("x", map[string]any{}, true); !strings.Contains(got, "saved") {
		t.Fatal(got)
	}
}

func TestDescriptionRewritesAssistantWording(t *testing.T) {
	var ran json.RawMessage
	w := describedWrite{writeTool{ran: &ran}}
	got := Description(w)
	if strings.Contains(got, "Propose") || strings.Contains(got, "confirmation card") || !strings.HasPrefix(got, "Changes data: a thing.") {
		t.Fatalf("description = %q", got)
	}
}

type describedWrite struct{ writeTool }

func (d describedWrite) Spec() aitools.Spec {
	s := d.writeTool.Spec()
	s.Description = "Propose a thing. Shows a confirmation card."
	return s
}
