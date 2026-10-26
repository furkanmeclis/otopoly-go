package usecase

import (
	"context"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/ai/tools"
)

// MCPGate is the tool gate of the MCP server (docs/MCP.md). The model runs
// in the MCP client, so the assistant's provider switches (chat enabled,
// configured, quota) do not apply; the platform admin's per-tool switches and
// the actions / todos feature switches do. UI-only tools (charts, plans) are
// never offered over MCP.
func (s *Service) MCPGate(ctx context.Context) (tools.Gate, error) {
	row, err := s.store.GetAISettings(ctx)
	if err != nil {
		return tools.Gate{}, err
	}
	enabled := s.toolEnabledMap(row)
	return tools.Gate{
		FeatureEnabled: func(feat tools.Feature) bool {
			switch feat {
			case tools.FeatureChat:
				return true
			case tools.FeatureActions:
				return row.ActionsEnabled
			case tools.FeatureTodos:
				return row.TodosEnabled
			}
			return false
		},
		ToolEnabled: func(name string) bool {
			on, ok := enabled[name]
			return !ok || on
		},
	}, nil
}
