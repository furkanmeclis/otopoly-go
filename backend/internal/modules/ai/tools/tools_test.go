package tools

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/authctx"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/orgctx"
)

func TestFormatMoney(t *testing.T) {
	cases := map[[2]string]string{
		{"12345.5", "TRY"}:   "₺12.345,50",
		{"-1000", "TRY"}:     "-₺1.000,00",
		{"0", ""}:            "₺0,00",
		{"999.999", "USD"}:   "$1.000,00",
		{"1234567.8", "CHF"}: "1.234.567,80 CHF",
	}
	for in, want := range cases {
		if got := FormatMoney(in[0], in[1]); got != want {
			t.Errorf("FormatMoney(%q,%q) = %q, want %q", in[0], in[1], got, want)
		}
	}
}

func TestFoldAndPlate(t *testing.T) {
	if got := FoldTR("Hüseyin ÇELİK Işık"); got != "huseyin celik isik" {
		t.Fatalf("FoldTR = %q", got)
	}
	if got := PlateKey("34 abc-123"); got != "34ABC123" {
		t.Fatalf("PlateKey = %q", got)
	}
}

func TestValidate(t *testing.T) {
	schema := map[string]any{
		"type": "object",
		"properties": map[string]any{
			"date":   map[string]any{"type": "string", "format": "date"},
			"status": map[string]any{"type": "string", "enum": []string{"a", "b"}},
			"limit":  map[string]any{"type": "integer", "minimum": 1, "maximum": 5},
			"id":     map[string]any{"type": "string", "format": "uuid"},
			"rows":   map[string]any{"type": "array", "maxItems": 2, "items": map[string]any{"type": "object"}},
		},
		"required":             []string{"date"},
		"additionalProperties": false,
	}
	ok := []string{`{"date":"2026-09-24"}`, `{"date":"2026-09-24","status":"a","limit":5,"rows":[{},{}]}`}
	bad := []string{
		`{}`, `{"date":"24.09.2026"}`, `{"date":"2026-09-24","status":"c"}`,
		`{"date":"2026-09-24","limit":1.5}`, `{"date":"2026-09-24","limit":9}`,
		`{"date":"2026-09-24","id":"nope"}`, `{"date":"2026-09-24","x":1}`,
		`{"date":"2026-09-24","rows":[{},{},{}]}`, `not json`, `"a string"`,
	}
	for _, in := range ok {
		if err := Validate(schema, json.RawMessage(in)); err != nil {
			t.Errorf("Validate(%s) = %v, want nil", in, err)
		}
	}
	for _, in := range bad {
		if err := Validate(schema, json.RawMessage(in)); err == nil {
			t.Errorf("Validate(%s) = nil, want error", in)
		}
	}
}

func TestRegistryAllowed(t *testing.T) {
	r := NewRegistry(RenderChart{}, SearchCustomers{}, ListJobs{})
	p := authctx.Principal{Permissions: []string{"tenant.jobs.read"}}
	gate := Gate{FeatureEnabled: func(f Feature) bool { return f == FeatureChat }}
	var names []string
	for _, tool := range r.Available(p, orgctx.Scope{}, gate) {
		names = append(names, tool.Spec().Name)
	}
	if len(names) != 1 || names[0] != "list_jobs" {
		t.Fatalf("available = %v", names)
	}
	admin := authctx.Principal{IsSuperAdmin: true}
	if n := len(r.Available(admin, orgctx.Scope{}, Gate{})); n != 3 {
		t.Fatalf("super admin sees %d tools, want 3", n)
	}
}

func TestRenderChartInline(t *testing.T) {
	env := Env{Now: time.Now()}
	in := `{"type":"pie","title":"Ödeme","x_key":"name","series":[{"key":"total"}],"data":[{"name":"Nakit","total":"₺1.250,50"},{"name":"Kart","total":300}]}`
	res, err := RenderChart{}.Run(context.Background(), env, json.RawMessage(in))
	if err != nil || res.IsError {
		t.Fatalf("res = %+v, err = %v", res, err)
	}
	if res.Chart.Rows[0]["total"] != 1250.5 || res.Chart.Rows[1]["total"] != float64(300) {
		t.Fatalf("rows = %+v", res.Chart.Rows)
	}
	bad := `{"type":"pie","title":"x","x_key":"name","series":[{"key":"a"},{"key":"b"}],"data":[{"name":"n","a":1,"b":2}]}`
	if res, _ := (RenderChart{}).Run(context.Background(), env, json.RawMessage(bad)); !res.IsError {
		t.Fatal("pie with two series must fail")
	}
	missing := `{"type":"bar","title":"x","x_key":"d","series":[{"key":"v"}],"source_tool_use_id":"nope","rows_path":"rows"}`
	env.LookupResult = func(string) (string, bool) { return "", false }
	if res, _ := (RenderChart{}).Run(context.Background(), env, json.RawMessage(missing)); !res.IsError {
		t.Fatal("unknown source must fail")
	}
}
