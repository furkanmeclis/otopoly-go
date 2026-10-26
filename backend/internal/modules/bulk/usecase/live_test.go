package usecase

import (
	"context"
	"fmt"
	"testing"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/bulkengine"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/orgctx"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/resourceevents"
	"github.com/google/uuid"
)

func TestCollectLiveCapsOnePastMax(t *testing.T) {
	t.Parallel()
	var ids []string
	for i := 0; i < resourceevents.MaxUUIDs+20; i++ {
		ids = collectLive(ids, fmt.Sprintf("id-%d", i))
	}
	ids = collectLive(ids, "")
	if len(ids) != resourceevents.MaxUUIDs+1 {
		t.Fatalf("len = %d, want %d", len(ids), resourceevents.MaxUUIDs+1)
	}
}

func TestLiveJobScope(t *testing.T) {
	t.Parallel()
	org := uuid.New()
	ctx := liveJobScope(context.Background(), bulkengine.BulkTarget{Query: map[string]string{"organization_uuid": org.String()}})
	if sc, ok := orgctx.ScopeFrom(ctx); !ok || sc.UUID != org {
		t.Fatalf("scope = %+v %v", sc, ok)
	}
	if _, ok := orgctx.ScopeFrom(liveJobScope(context.Background(), bulkengine.BulkTarget{})); ok {
		t.Fatal("no organization in the target: no scope")
	}
	existing := orgctx.WithScope(context.Background(), orgctx.Scope{InternalID: 3, UUID: uuid.New()})
	if got := liveJobScope(existing, bulkengine.BulkTarget{Query: map[string]string{"organization_uuid": org.String()}}); got != existing {
		t.Fatal("an existing scope must win")
	}
}
