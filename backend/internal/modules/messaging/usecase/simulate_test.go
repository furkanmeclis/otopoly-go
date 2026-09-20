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

	svc := messagingusecase.New(
		q,
		providers.NewWhatsAppProvider(&providers.StubWhatsAppClient{}, nil),
		&providers.NoopSMSProvider{},
	)

	result, err := svc.Simulate(ctx, 1, model.SimulateInput{
		Mode:  model.SimulateModeJobLifecycle,
		Phone: "05063857026",
		Vars: map[string]string{
			"customer_name": "Hüseyin Ülken",
			"plate":         "34PVN868",
			"business_name": "Tech Oto",
			"amount":        "1.250,00",
			"currency":      "TRY",
			"job_id":        "JOB-DEMO-001",
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
		if item.Status != model.OutboundStatusSent {
			t.Fatalf("event %s status=%s err=%s", item.EventType, item.Status, item.ErrorMessage)
		}
		if item.Body == "" || strings.Contains(item.Body, "{{") {
			t.Fatalf("event %s body not rendered: %q", item.EventType, item.Body)
		}
	}
}
