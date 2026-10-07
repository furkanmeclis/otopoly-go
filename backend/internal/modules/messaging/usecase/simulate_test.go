package usecase_test

import (
	"context"
	"os"
	"strings"
	"testing"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database/db"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/messaging/model"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/messaging/providers"
	messagingusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/messaging/usecase"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

func TestSimulateJobLifecycle_Stub(t *testing.T) {
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		t.Skip("DATABASE_URL not set")
	}
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatalf("pool: %v", err)
	}
	t.Cleanup(pool.Close)
	q := db.New(pool)

	// Own connected session (no entitlement service → own number entitled).
	var orgID int64
	slug := "sim-" + strings.ReplaceAll(uuid.NewString(), "-", "")[:12]
	if err := pool.QueryRow(ctx, `INSERT INTO organizations (slug, name) VALUES ($1,'Sim') RETURNING id`, slug).Scan(&orgID); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _, _ = pool.Exec(context.Background(), `DELETE FROM organizations WHERE id=$1`, orgID) })
	if _, err := pool.Exec(ctx, `INSERT INTO whatsapp_sessions (organization_id, status, jid) VALUES ($1,'connected','905000000000@s.whatsapp.net')`, orgID); err != nil {
		t.Fatal(err)
	}

	svc := messagingusecase.New(
		q,
		providers.NewWhatsAppProvider(&providers.StubWhatsAppClient{}, nil),
		&providers.NoopSMSProvider{},
	)

	result, err := svc.Simulate(ctx, orgID, model.SimulateInput{
		Mode:  model.SimulateModeJobLifecycle,
		Phone: "05063857026",
		Vars: map[string]string{
			"customer_name":  "Hüseyin Ülken",
			"plate":          "34PVN868",
			"business_name":  "Tech Oto",
			"amount":         "1.250,00",
			"currency":       "TRY",
			"job_id":         "JOB-DEMO-001",
			"contract_title": "Hizmet Sözleşmesi",
		},
	})
	if err != nil {
		t.Fatalf("simulate: %v", err)
	}
	if len(result.Items) != len(model.JobLifecycleEvents()) {
		t.Fatalf("items=%d", len(result.Items))
	}
	for _, item := range result.Items {
		if item.Status != model.OutboundStatusSent || item.SenderKind != model.SenderOrgOwn {
			t.Fatalf("event %s status=%s err=%s", item.EventType, item.Status, item.ErrorMessage)
		}
		if item.Body == "" || strings.Contains(item.Body, "{{") {
			t.Fatalf("event %s body not rendered: %q", item.EventType, item.Body)
		}
	}
}
