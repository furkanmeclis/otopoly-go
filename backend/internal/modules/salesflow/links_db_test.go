package salesflow_test

import (
	"context"
	"errors"
	"os"
	"strings"
	"testing"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database/db"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/salesflow"
	todosusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/todos/usecase"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// TestLinks_DB checks the real queries: org scoping, soft-deleted leads and
// the FK (ON DELETE SET NULL) added by migration 000057.
func TestLinks_DB(t *testing.T) {
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		t.Skip("DATABASE_URL not set")
	}
	bg := context.Background()
	pool, err := pgxpool.New(bg, dsn)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	if err := pool.Ping(bg); err != nil {
		t.Skipf("database unavailable: %v", err)
	}
	suffix := strings.ReplaceAll(uuid.NewString(), "-", "")[:12]
	scan := func(sql string, dest any, args ...any) {
		t.Helper()
		if err := pool.QueryRow(bg, sql, args...).Scan(dest); err != nil {
			t.Fatalf("fixture %q: %v", sql, err)
		}
	}
	var orgA, orgB, cust, leadID, deletedLead, quoteID int64
	var leadUUID, deletedUUID, quoteUUID uuid.UUID
	scan(`INSERT INTO organizations (slug, name) VALUES ($1, 'A') RETURNING id`, &orgA, "sf-a-"+suffix)
	scan(`INSERT INTO organizations (slug, name) VALUES ($1, 'B') RETURNING id`, &orgB, "sf-b-"+suffix)
	t.Cleanup(func() { _, _ = pool.Exec(bg, `DELETE FROM organizations WHERE id = ANY($1)`, []int64{orgA, orgB}) })
	scan(`INSERT INTO customers (organization_id, name, phone) VALUES ($1, 'Ahmet', '0532') RETURNING id`, &cust, orgA)
	scan(`INSERT INTO leads (organization_id, customer_id, interest) VALUES ($1, $2, 'Seramik') RETURNING id`, &leadID, orgA, cust)
	scan(`SELECT uuid FROM leads WHERE id = $1`, &leadUUID, leadID)
	scan(`INSERT INTO leads (organization_id, customer_id, deleted_at) VALUES ($1, $2, now()) RETURNING id`, &deletedLead, orgA, cust)
	scan(`SELECT uuid FROM leads WHERE id = $1`, &deletedUUID, deletedLead)
	scan(`INSERT INTO quotes (organization_id, number, customer_id, share_token) VALUES ($1, 'TKL-T-1', $2, $3) RETURNING id`, &quoteID, orgA, cust, "tok"+suffix)
	scan(`SELECT uuid FROM quotes WHERE id = $1`, &quoteUUID, quoteID)

	l := salesflow.NewLinks(db.New(pool))
	if id, err := l.ResolveLead(bg, orgA, leadUUID); err != nil || id != leadID {
		t.Fatalf("resolve own lead: %d %v", id, err)
	}
	if _, err := l.ResolveLead(bg, orgB, leadUUID); !errors.Is(err, todosusecase.ErrLinkNotFound) {
		t.Fatalf("cross-org lead: %v", err)
	}
	if _, err := l.ResolveLead(bg, orgA, deletedUUID); !errors.Is(err, todosusecase.ErrLinkNotFound) {
		t.Fatalf("deleted lead: %v", err)
	}
	if _, err := l.ResolveQuote(bg, orgB, quoteUUID); !errors.Is(err, todosusecase.ErrLinkNotFound) {
		t.Fatalf("cross-org quote: %v", err)
	}
	if id, err := l.ResolveQuote(bg, orgA, quoteUUID); err != nil || id != quoteID {
		t.Fatalf("resolve own quote: %d %v", id, err)
	}
	leads, err := l.DescribeLeads(bg, orgA, []int64{leadID, deletedLead})
	if err != nil || len(leads) != 1 || leads[leadID].Label != "Ahmet — Seramik" || leads[leadID].UUID != leadUUID {
		t.Fatalf("describe leads: %+v %v", leads, err)
	}
	if other, _ := l.DescribeLeads(bg, orgB, []int64{leadID}); len(other) != 0 {
		t.Fatalf("labels leaked across orgs: %+v", other)
	}
	quotes, err := l.DescribeQuotes(bg, orgA, []int64{quoteID})
	if err != nil || quotes[quoteID].Label != "TKL-T-1 · Ahmet" {
		t.Fatalf("describe quotes: %+v %v", quotes, err)
	}

	// FK: todos.quote_id must reference an existing quote.
	_, err = pool.Exec(bg, `INSERT INTO todos (organization_id, title, quote_id) VALUES ($1, 'x', -1)`, orgA)
	if err == nil || !strings.Contains(err.Error(), "fk_todos_quote") {
		t.Fatalf("fk_todos_quote not enforced: %v", err)
	}
}
