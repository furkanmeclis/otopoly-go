package mcp_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"testing"

	aitools "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/ai/tools"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/mcp"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/mcp/orgtools"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/mcp/platformtools"
	oauthmodel "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/oauth/model"
)

// Interface-embedding stubs: the parity test only reads Specs.
type (
	nopCustomers      struct{ aitools.CustomerReader }
	nopSearch         struct{ aitools.CustomerSearchStore }
	nopCari           struct{ aitools.CariReader }
	nopJobs           struct{ aitools.JobsReader }
	nopReports        struct{ aitools.ReportsReader }
	nopFinance        struct{ aitools.FinanceReader }
	nopSales          struct{ aitools.SalesReader }
	nopCatalog        struct{ aitools.CatalogReader }
	nopUnpaid         struct{ aitools.UnpaidJobsReader }
	nopCariW          struct{ aitools.CariWriter }
	nopFinanceW       struct{ aitools.FinanceWriter }
	nopCustomersW     struct{ aitools.CustomersWriter }
	nopVehicleCatalog struct{ aitools.VehicleCatalog }
	nopVehicleOptions struct{ aitools.VehicleOptionStore }
	nopJobsW          struct{ aitools.JobsWriter }
	nopLookup         struct{ aitools.CatalogLookup }
	nopSalesW         struct{ aitools.SalesWriter }
	nopTodos          struct{ aitools.TodosService }
	nopReviews        struct{ aitools.ReviewsService }
	nopReorder        struct{ aitools.ReorderService }
	nopLoyalty        struct{ aitools.LoyaltyService }
	nopLeads          struct{ orgtools.Leads }
	nopQuotes         struct{ orgtools.Quotes }
	nopOrgs           struct{ platformtools.Organizations }
	nopUsers          struct{ platformtools.Users }
	nopBilling        struct{ platformtools.Billing }
	nopAI             struct{ platformtools.AIUsage }
	nopLogs           struct{ platformtools.Logs }
	nopActivity       struct{ platformtools.Activity }
)

// orgTools is every tool the business endpoint can offer: the full assistant
// registry (as wired in httpserver) plus the MCP-only tools, minus UI tools.
func orgTools() []aitools.Tool {
	reg := aitools.DefaultRegistry(aitools.Deps{
		Customers: nopCustomers{}, CustomersSearch: nopSearch{}, Cari: nopCari{}, Jobs: nopJobs{}, Reports: nopReports{},
		Finance: nopFinance{}, Sales: nopSales{}, Catalog: nopCatalog{}, UnpaidJobs: nopUnpaid{}, CariWrite: nopCariW{}, FinanceWrite: nopFinanceW{},
		CustomersWrite: nopCustomersW{}, VehicleCatalog: nopVehicleCatalog{}, VehicleOptions: nopVehicleOptions{},
		JobsWrite: nopJobsW{}, CatalogLookup: nopLookup{}, SalesWrite: nopSalesW{}, Todos: nopTodos{},
		Reviews: nopReviews{},
		Reorder: nopReorder{},
		Loyalty: nopLoyalty{},
	})
	for _, t := range orgtools.Tools(orgtools.Deps{Leads: nopLeads{}, Quotes: nopQuotes{}}) {
		reg.Register(t)
	}
	var out []aitools.Tool
	for _, t := range reg.All() {
		if t.Spec().Kind != aitools.KindUI {
			out = append(out, t)
		}
	}
	return out
}

func platformTools() []aitools.Tool {
	return platformtools.Registry(platformtools.Deps{
		Organizations: nopOrgs{}, Users: nopUsers{}, Billing: nopBilling{}, AIUsage: nopAI{}, Logs: nopLogs{},
		Activity: nopActivity{}, Health: func(context.Context) map[string]string { return nil },
	}).All()
}

// docTable returns the tool names (first backticked cell) and their kind
// column of the table between the markers in docs/MCP.md.
func docTable(t *testing.T, marker string) map[string]string {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join("..", "..", "..", "..", "docs", "MCP.md"))
	if err != nil {
		t.Fatal(err)
	}
	doc := string(raw)
	start, end := strings.Index(doc, "<!-- "+marker+":start -->"), strings.Index(doc, "<!-- "+marker+":end -->")
	if start < 0 || end < start {
		t.Fatalf("docs/MCP.md: %s markers missing", marker)
	}
	row := regexp.MustCompile("^\\| `([a-z_]+)` \\| ([a-z]+) \\|")
	out := map[string]string{}
	for _, line := range strings.Split(doc[start:end], "\n") {
		if m := row.FindStringSubmatch(line); m != nil {
			out[m[1]] = m[2]
		}
	}
	return out
}

func checkParity(t *testing.T, marker string, ts []aitools.Tool) {
	t.Helper()
	doc := docTable(t, marker)
	seen := map[string]bool{}
	for _, tl := range ts {
		name := tl.Spec().Name
		seen[name] = true
		kind := "read"
		if mcp.IsWrite(tl) {
			kind = "write"
		}
		got, ok := doc[name]
		if !ok {
			t.Errorf("%s: tool %s is not documented in docs/MCP.md", marker, name)
			continue
		}
		if got != kind {
			t.Errorf("%s: %s documented as %s, is %s", marker, name, got, kind)
		}
	}
	var extra []string
	for name := range doc {
		if !seen[name] {
			extra = append(extra, name)
		}
	}
	sort.Strings(extra)
	if len(extra) > 0 {
		t.Errorf("%s: documented tools that do not exist: %v", marker, extra)
	}
}

// The tool tables in docs/MCP.md match the registries exactly, with the
// right read / write kind.
func TestDocsListEveryTool(t *testing.T) {
	checkParity(t, "mcp-org-tools", orgTools())
	checkParity(t, "mcp-platform-tools", platformTools())
}

// Every write tool is an ActionTool (Propose before Run) and annotated
// destructive; every read tool is read only. Platform tools are all reads
// behind a platform permission.
func TestAnnotationsAndPermissions(t *testing.T) {
	writes := 0
	for _, tl := range orgTools() {
		a := mcp.Annotations(tl)
		if mcp.IsWrite(tl) {
			writes++
			if _, ok := tl.(aitools.ActionTool); !ok {
				t.Errorf("%s: write tool without Propose", tl.Spec().Name)
			}
			if a.ReadOnlyHint || a.DestructiveHint == nil || !*a.DestructiveHint {
				t.Errorf("%s: write annotations = %+v", tl.Spec().Name, a)
			}
		} else if !a.ReadOnlyHint {
			t.Errorf("%s: read tool not read only", tl.Spec().Name)
		}
		for _, p := range tl.Spec().Permissions {
			if !strings.HasPrefix(p, "tenant.") {
				t.Errorf("%s: business tool needs %s", tl.Spec().Name, p)
			}
		}
	}
	if writes < 10 {
		t.Fatalf("expected the assistant write tools, got %d", writes)
	}
	for _, tl := range platformTools() {
		spec := tl.Spec()
		if mcp.IsWrite(tl) || len(spec.Permissions) == 0 || !strings.HasPrefix(spec.Permissions[0], "platform.") {
			t.Errorf("%s: platform tool kind=%s perms=%v", spec.Name, spec.Kind, spec.Permissions)
		}
		if err := aitools.Validate(spec.InputSchema, []byte(`{}`)); err != nil && !strings.Contains(err.Error(), "required") {
			t.Errorf("%s: schema rejects {}: %v", spec.Name, err)
		}
	}
}

type allowTokens struct{}

func (allowTokens) ValidateAccessToken(_ context.Context, _, resource string) (oauthmodel.AccessToken, error) {
	return oauthmodel.AccessToken{UserID: 1, OrganizationID: 2, Resource: resource,
		Scopes: []string{oauthmodel.ScopeRead, oauthmodel.ScopeWrite}}, nil
}

func (allowTokens) ResourceMetadataURL(string) string { return "" }

type allowResolver struct{}

func (allowResolver) Resolve(_ context.Context, tok oauthmodel.AccessToken) (mcp.Principal, error) {
	return mcp.Principal{Scopes: tok.Scopes}, nil
}

type fixedSet []aitools.Tool

func (f fixedSet) Tools(context.Context, mcp.Principal) ([]aitools.Tool, error) { return f, nil }

// Every real tool registers on the SDK server (input schemas are objects)
// and is listed with its annotations.
func TestRealToolsList(t *testing.T) {
	org, platform := orgTools(), platformTools()
	s := mcp.New(mcp.Config{Tokens: allowTokens{}, Principals: allowResolver{}, Sets: map[string]mcp.ToolSet{
		oauthmodel.ResourceOrg: fixedSet(org), oauthmodel.ResourcePlatform: fixedSet(platform),
	}})
	for path, want := range map[string]int{oauthmodel.ResourceOrg: len(org), oauthmodel.ResourcePlatform: len(platform)} {
		req := httptest.NewRequest(http.MethodPost, path, strings.NewReader(`{"jsonrpc":"2.0","id":1,"method":"tools/list"}`))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Accept", "application/json, text/event-stream")
		req.Header.Set("Authorization", "Bearer x")
		rec := httptest.NewRecorder()
		s.ServeHTTP(rec, req)
		var out struct {
			Result struct {
				Tools []struct {
					Name string `json:"name"`
				} `json:"tools"`
			} `json:"result"`
		}
		if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil || len(out.Result.Tools) != want {
			t.Fatalf("%s: %d tools listed, want %d (%v) %s", path, len(out.Result.Tools), want, err, rec.Body)
		}
	}
}
