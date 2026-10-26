package mcp

import (
	"context"
	"fmt"

	aitools "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/ai/tools"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/orgctx"
)

// ToolSet lists the tools a principal may use on one endpoint, sorted by
// name.
type ToolSet interface {
	Tools(ctx context.Context, p Principal) ([]aitools.Tool, error)
}

// IsWrite reports whether a tool changes data: write kind, confirmation
// flag or an action tool (the same rule as the assistant's confirmation gate).
func IsWrite(t aitools.Tool) bool {
	spec := t.Spec()
	if spec.Kind == aitools.KindWrite || spec.RequiresConfirmation {
		return true
	}
	_, ok := t.(aitools.ActionTool)
	return ok
}

// Entitled is implemented by tools that need a plan toggle of the
// organization (e.g. module.quotes for leads and quotes).
type Entitled interface {
	Entitlement() string
}

// FeatureChecker reports a plan toggle (entitlements.Service).
type FeatureChecker interface {
	Enabled(ctx context.Context, orgID int64, key string) (bool, error)
}

// OrgTools is the business tool set of /mcp/org: the AI assistant registry
// (the same tools, permissions and organization isolation as the panel
// assistant) plus MCP-only read tools, without UI-only tools. Write tools
// are offered only with the mcp:write scope on a writable subscription.
type OrgTools struct {
	Registry *aitools.Registry
	// Gate returns the platform tool switches (ai usecase MCPGate); nil
	// allows every tool.
	Gate     func(ctx context.Context) (aitools.Gate, error)
	Features FeatureChecker
}

// Tools implements ToolSet.
func (o OrgTools) Tools(ctx context.Context, p Principal) ([]aitools.Tool, error) {
	if o.Registry == nil || p.Scope.InternalID <= 0 {
		return nil, nil
	}
	gate := aitools.Gate{}
	if o.Gate != nil {
		g, err := o.Gate(ctx)
		if err != nil {
			return nil, fmt.Errorf("mcp: tool gate: %w", err)
		}
		gate = g
	}
	entitled := map[string]bool{}
	var out []aitools.Tool
	for _, t := range o.Registry.Available(p.Auth, p.Scope, gate) {
		if t.Spec().Kind == aitools.KindUI {
			continue
		}
		if IsWrite(t) && !p.CanWrite() {
			continue
		}
		if e, ok := t.(Entitled); ok && o.Features != nil {
			key := e.Entitlement()
			on, seen := entitled[key]
			if !seen {
				var err error
				on, err = o.Features.Enabled(ctx, p.Scope.InternalID, key)
				if err != nil {
					return nil, fmt.Errorf("mcp: entitlement %s: %w", key, err)
				}
				entitled[key] = on
			}
			if !on {
				continue
			}
		}
		out = append(out, t)
	}
	return out, nil
}

// PlatformTools is the tool set of /mcp/platform: read tools over platform
// resources, each behind its platform.* read permission.
type PlatformTools struct {
	Registry *aitools.Registry
}

// Tools implements ToolSet.
func (pt PlatformTools) Tools(_ context.Context, p Principal) ([]aitools.Tool, error) {
	if pt.Registry == nil {
		return nil, nil
	}
	var out []aitools.Tool
	for _, t := range pt.Registry.Available(p.Auth, orgctx.Scope{}, aitools.Gate{}) {
		if IsWrite(t) || t.Spec().Kind == aitools.KindUI {
			continue
		}
		out = append(out, t)
	}
	return out, nil
}
