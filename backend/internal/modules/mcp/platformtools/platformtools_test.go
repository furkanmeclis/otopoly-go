package platformtools

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"

	aitools "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/ai/tools"
	logsmodel "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/logs/model"
	orgusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/organizations/usecase"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/pkg/apiquery"
	"github.com/google/uuid"
)

type fakeOrgs struct {
	gotLimit, gotOffset int32
	gotQ, gotStatus     string
}

func (f *fakeOrgs) List(_ context.Context, limit, offset int32, q, status string) ([]orgusecase.Organization, int64, error) {
	f.gotLimit, f.gotOffset, f.gotQ, f.gotStatus = limit, offset, q, status
	return []orgusecase.Organization{{Slug: "oto", Name: "Oto"}}, 41, nil
}

func (f *fakeOrgs) Overview(context.Context, uuid.UUID) (orgusecase.Overview, error) {
	return orgusecase.Overview{}, orgusecase.ErrNotFound
}

type fakeLogs struct{ got logsmodel.ListFilter }

func (f *fakeLogs) List(_ context.Context, _ apiquery.Query, filter logsmodel.ListFilter) ([]logsmodel.Log, int64, error) {
	f.got = filter
	return nil, 0, nil
}

func (f *fakeLogs) Stats(context.Context) (logsmodel.Stats, error) { return logsmodel.Stats{}, nil }

func run(t *testing.T, r *aitools.Registry, name, input string) aitools.Result {
	t.Helper()
	tool, ok := r.Get(name)
	if !ok {
		t.Fatalf("%s not registered", name)
	}
	res, err := tool.Run(context.Background(), aitools.Env{Now: time.Date(2026, 10, 26, 12, 0, 0, 0, time.UTC)}, json.RawMessage(input))
	if err != nil {
		t.Fatalf("%s: %v", name, err)
	}
	return res
}

func TestPlatformTools(t *testing.T) {
	orgs, logs := &fakeOrgs{}, &fakeLogs{}
	r := Registry(Deps{Organizations: orgs, Logs: logs, Health: func(context.Context) map[string]string {
		return map[string]string{"postgres": "ok", "redis": "down"}
	}})
	res := run(t, r, "list_organizations", `{"q":" oto ","status":"active","limit":500}`)
	if !res.IsError {
		t.Fatalf("limit above maximum must fail validation: %s", res.Content)
	}
	res = run(t, r, "list_organizations", `{"q":" oto ","status":"active","limit":5,"offset":10}`)
	if res.IsError || orgs.gotLimit != 5 || orgs.gotOffset != 10 || orgs.gotQ != "oto" || orgs.gotStatus != "active" ||
		!strings.Contains(res.Content, `"total":41`) {
		t.Fatalf("list = %s %+v", res.Content, orgs)
	}
	if res := run(t, r, "get_organization", `{"organization_uuid":"`+uuid.NewString()+`"}`); !res.IsError || !strings.Contains(res.Content, "not found") {
		t.Fatalf("missing organization = %+v", res)
	}
	if res := run(t, r, "list_logs", `{"levels":["error"],"since_hour":2}`); res.IsError || logs.got.CreatedFrom == nil ||
		!logs.got.CreatedFrom.Equal(time.Date(2026, 10, 26, 10, 0, 0, 0, time.UTC)) || logs.got.Levels[0] != "error" {
		t.Fatalf("logs = %+v %+v", res, logs.got)
	}
	if res := run(t, r, "system_health", `{}`); res.IsError || !strings.Contains(res.Content, `"status":"degraded"`) {
		t.Fatalf("health = %s", res.Content)
	}
	if _, ok := r.Get("list_users"); ok {
		t.Fatal("nil dependency must leave its tools out")
	}
}
