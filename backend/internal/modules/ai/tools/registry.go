// Package tools holds the assistant's tool registry and tool implementations.
//
// A tool declares a Spec (name, JSON schema, required permissions, feature
// flag, kind) and a Run function. The agent loop offers a tool to the model
// only when the requesting user holds every permission in Spec.Permissions,
// the member role matches Spec.OrgRoles (if set), the Spec.Feature toggle is
// on and the platform admin has not disabled the tool. Every input is
// validated against Spec.InputSchema before Run.
//
// Write tools (Phase 2) set Kind=KindWrite and RequiresConfirmation=true: the
// agent loop does not call Run for them directly but hands the call to the
// ConfirmationGate (see usecase), which shows a confirm card and runs the tool
// only after the user approves.
package tools

import (
	"context"
	"encoding/json"
	"sort"
	"time"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/authctx"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/orgctx"
)

// Kind classifies a tool.
type Kind string

const (
	// KindRead tools only read data and run immediately.
	KindRead Kind = "read"
	// KindWrite tools change data; they must go through confirmation (Phase 2).
	KindWrite Kind = "write"
	// KindUI tools only produce UI output (e.g. charts).
	KindUI Kind = "ui"
)

// Feature is the platform toggle a tool belongs to.
type Feature string

const (
	FeatureChat    Feature = "chat"
	FeatureCharts  Feature = "charts"
	FeatureActions Feature = "actions"
	FeatureTodos   Feature = "todos"
)

// Spec describes a tool.
type Spec struct {
	Name        string
	Description string
	InputSchema map[string]any
	// Permissions are all required (tenant.* slugs).
	Permissions []string
	// OrgRoles optionally restricts to organization member roles (owner, staff).
	OrgRoles []string
	Feature  Feature
	Kind     Kind
	// RequiresConfirmation routes the call through the confirmation gate
	// instead of running it immediately (write tools).
	RequiresConfirmation bool
}

// Env is the execution environment for a tool call.
type Env struct {
	Principal authctx.Principal
	Scope     orgctx.Scope
	Now       time.Time
	Location  *time.Location
	// LookupResult returns the raw content of an earlier tool_result in this
	// conversation (used by render_chart to reference data without re-sending it).
	LookupResult func(toolUseID string) (string, bool)
}

// Today returns the current local date (YYYY-MM-DD).
func (e Env) Today() string { return e.Now.In(e.loc()).Format("2006-01-02") }

func (e Env) loc() *time.Location {
	if e.Location != nil {
		return e.Location
	}
	return time.UTC
}

// Chart is a chart block rendered by the UI (AppChart).
type Chart struct {
	Type        string           `json:"type"`
	Title       string           `json:"title"`
	XKey        string           `json:"x_key"`
	Series      []ChartSeries    `json:"series"`
	Rows        []map[string]any `json:"rows"`
	ValueFormat string           `json:"value_format,omitempty"`
	Currency    string           `json:"currency,omitempty"`
}

// ChartSeries is one plotted value key.
type ChartSeries struct {
	Key   string `json:"key"`
	Label string `json:"label"`
}

// Result is the outcome of a tool call.
type Result struct {
	// Content is returned to the model (compact JSON or text).
	Content string
	// SummaryKey/SummaryParams describe the result for the UI (i18n key under ai.*).
	SummaryKey    string
	SummaryParams map[string]any
	IsError       bool
	// Chart is emitted to the client as a chart block.
	Chart *Chart
}

// Tool is an executable assistant tool.
type Tool interface {
	Spec() Spec
	Run(ctx context.Context, env Env, input json.RawMessage) (Result, error)
}

// Gate filters tools by platform settings.
type Gate struct {
	FeatureEnabled func(Feature) bool
	ToolEnabled    func(name string) bool
}

// Registry is an ordered set of tools.
type Registry struct {
	byName map[string]Tool
}

// NewRegistry builds a registry; nil tools are skipped.
func NewRegistry(ts ...Tool) *Registry {
	r := &Registry{byName: map[string]Tool{}}
	for _, t := range ts {
		r.Register(t)
	}
	return r
}

// Register adds (or replaces) a tool.
func (r *Registry) Register(t Tool) {
	if t == nil {
		return
	}
	r.byName[t.Spec().Name] = t
}

// Get returns a tool by name.
func (r *Registry) Get(name string) (Tool, bool) {
	t, ok := r.byName[name]
	return t, ok
}

// All returns every registered tool sorted by name (stable order keeps the
// prompt-cache prefix byte-identical between requests).
func (r *Registry) All() []Tool {
	out := make([]Tool, 0, len(r.byName))
	for _, t := range r.byName {
		out = append(out, t)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Spec().Name < out[j].Spec().Name })
	return out
}

// Allowed reports whether a principal may use a tool under the gate.
func Allowed(spec Spec, p authctx.Principal, scope orgctx.Scope, gate Gate) bool {
	if gate.FeatureEnabled != nil && !gate.FeatureEnabled(spec.Feature) {
		return false
	}
	if gate.ToolEnabled != nil && !gate.ToolEnabled(spec.Name) {
		return false
	}
	for _, perm := range spec.Permissions {
		if !p.HasPermission(perm) {
			return false
		}
	}
	if len(spec.OrgRoles) > 0 && !p.IsSuperAdmin {
		ok := false
		for _, role := range spec.OrgRoles {
			if role == scope.MemberRole {
				ok = true
				break
			}
		}
		if !ok {
			return false
		}
	}
	return true
}

// Available returns the tools the principal may use, sorted by name.
func (r *Registry) Available(p authctx.Principal, scope orgctx.Scope, gate Gate) []Tool {
	var out []Tool
	for _, t := range r.All() {
		if Allowed(t.Spec(), p, scope, gate) {
			out = append(out, t)
		}
	}
	return out
}

// ErrorResult is a tool_result error returned to the model.
func ErrorResult(msg string) Result {
	return Result{Content: msg, IsError: true, SummaryKey: "ai.tool_summary.error"}
}

// JSONResult marshals v as compact JSON content.
func JSONResult(v any, summaryKey string, params map[string]any) Result {
	raw, err := json.Marshal(v)
	if err != nil {
		return ErrorResult("failed to encode result")
	}
	return Result{Content: string(raw), SummaryKey: summaryKey, SummaryParams: params}
}
