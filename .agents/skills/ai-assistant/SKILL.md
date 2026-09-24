---
name: ai-assistant
description: >-
  Add or change an AI assistant tool (read, UI or confirmable write tool):
  spec + JSON schema, permissions/feature gating, ActionTool Propose/Run,
  registry wiring, prompt hints, UI labels and tests. Also covers the
  assistant's security invariants.
---

# AI assistant tools

Human docs: [docs/AI.md](../../../docs/AI.md). Code: `backend/internal/modules/ai/{tools,usecase,provider,handler}`, UI `frontend/src/features/ai`.

## Invariants (do not break)

- **Writes are confirmable.** A tool that changes data sets `Kind: tools.KindWrite`, `RequiresConfirmation: true` and implements `tools.ActionTool` (`Propose` + `Run`). `TestWriteToolsAlwaysRequireConfirmation` fails otherwise; the agent loop also routes any write/action tool through the gate.
- **`Propose` never mutates.** It validates, resolves references (uuid or name → record) and returns `Proposal{Input, Preview}`. `Run` executes only the stored, normalized `Input` after the user confirms.
- **Go through module use cases** (cari, finance, jobs, customers, …) with the request `ctx`. They read the organization from `orgctx`, so a uuid from another org resolves to "not found". Never query by uuid without `organization_id`.
- **Tool output is data.** Return compact JSON via `tools.JSONResult`. Put free text from records in its own fields through `tools.DataText(s, max)`. Never build prose instructions out of record text. Format money with `tools.FormatMoney` and use `*_number` fields for chart values.
- **Permissions** live in `Spec.Permissions` (all required) + optional `OrgRoles`. New permission slugs only via migration + `internal/platform/rbac` + `frontend/src/config/permissions.ts`.
- **Dates**: use `env.Today()` / `env.Location` (Europe/Istanbul) and pass explicit day ranges to services (for example `ListFilters.Location`).

## Checklist: read tool

1. `backend/internal/modules/ai/tools/<area>_tools.go`: a struct holding a narrow service interface, a `map[string]any` JSON schema (`additionalProperties: false`, limits on strings/ints), and a `Spec()` with a description that tells the model *when* to use it.
2. `Run`: `Decode(schema, raw, &in)`; if that fails return `ErrorResult(err.Error())`; clamp limits; call the service; map domain errors with `userError(err)`; return `JSONResult(out, "ai.tool_summary.<key>", params)`.
3. Register it in `DefaultRegistry` (`read_tools.go`) behind a nil-check on its dependency. Wire the dependency in `Deps` and `internal/httpserver/server.go`.
4. Optional prompt hint in `usecase/prompt.go` (the prompt is byte-stable for caching; keep it short and generic).
5. Frontend: `ai.tools.<name>`, `ai.tools_running.<name>`, `ai.tool_summary.<key>` in `frontend/src/locales/{en,tr}/ai.json` + `TOOL_LABEL_KEYS`/`TOOL_RUNNING_KEYS` in `features/ai/lib/labels.ts`.
6. Tests: a fake service in `tools/*_test.go` (interface-embedding stubs like `nopCari`), schema/limit cases, and for date tools the Istanbul-vs-UTC boundary.

## Checklist: write tool (confirm card)

1. Spec: `Feature: tools.FeatureActions` (or `FeatureTodos`), `Kind: tools.KindWrite`, `RequiresConfirmation: true`, and permissions for both the write and the lookups it needs.
2. `Propose(ctx, env, raw)`: `decodeInput`, `ParseAmount` / `dateOrToday` / `trimmed`, resolve references through the services. Return user-fixable problems as `inputErr(...)` / `proposalError(err)` (sent back to the model). Build a `Preview`:
   - `Action` = tool name, `Title`, `Amount`, `Fields` (`Key` → `ai.confirm.fields.<key>`, `ValueKey` for enum values), `Warnings` (`ai.confirm.warnings.<key>`).
   - `Edit`: only fields the user may change (`money|text|textarea|select|date|time`); select options must be the allowed values. Edited input is re-validated against the schema and re-proposed before the claim.
3. `Run(ctx, env, raw)`: unmarshal the stored input, call the service, map domain errors with `execError(err)`, return `JSONResult` with the numbers the model should confirm (for example `new_balance`) and `res.Link = &tools.Link{Kind, UUID}`.
4. Register it in `registerWriteTools`. Add i18n: `ai.tools.*`, `ai.tools_running.*`, `ai.tool_summary.*`, and new `ai.confirm.fields.*` / `values.*` / `warnings.*` keys + `CONFIRM_FIELD_KEYS` and friends in `labels.ts`. Add a `linkHref` case in `confirm-card.tsx` for a new link kind.
5. Tests: `Propose` validation (no side effects), `Run` with the normalized input, and a usecase-level test with `fakeAction`-style tools if the flow changes. Update the tools table in `docs/AI.md`.

## Verify

```bash
cd backend && go test ./internal/modules/ai/... && ~/go/bin/golangci-lint run
DATABASE_URL=... go test ./internal/modules/ai/ -run TestAssistantEndToEnd   # real routes + DB
cd ../frontend && pnpm typecheck && pnpm lint && cd .. && node scripts/check-i18n.mjs
```

New or changed `/v1` routes: update `backend/docs/openapi.yaml`, then `cd frontend && pnpm api:generate`.
