package usecase

import (
	"context"
	"database/sql"
	"fmt"
	"log/slog"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database/db"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// TestWebhookStatusOrdering_DB runs ApplyOutboundDeliveryStatus (the
// no-regression rules live in SQL) and the template name fallback against a
// real database, inside a rolled-back transaction.
func TestWebhookStatusOrdering_DB(t *testing.T) {
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		t.Skip("DATABASE_URL not set")
	}
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = tx.Rollback(context.Background()) })

	var orgID int64
	slug := "wh-" + strings.ReplaceAll(uuid.NewString(), "-", "")[:12]
	if err := tx.QueryRow(ctx, `INSERT INTO organizations (slug, name) VALUES ($1,'WH') RETURNING id`, slug).Scan(&orgID); err != nil {
		t.Fatal(err)
	}
	wamid := "wamid.DB-" + uuid.NewString()
	if _, err := tx.Exec(ctx, `INSERT INTO outbound_messages (organization_id, event_type, channel, recipient_phone, status, provider_reference)
		VALUES ($1, 'job.ready', 'whatsapp', '905321112233', 'sent', $2)`, orgID, wamid); err != nil {
		t.Fatal(err)
	}
	wh := NewWebhook(db.New(tx), testBox(t), slog.New(slog.DiscardHandler))

	type row struct {
		status, code, pricing string
		billable              sql.NullBool
		at                    time.Time
	}
	read := func() row {
		var r row
		var at *time.Time
		if err := tx.QueryRow(ctx, `SELECT COALESCE(delivery_status,''), COALESCE(error_code,''), COALESCE(pricing_category,''), billable, delivery_status_at
			FROM outbound_messages WHERE provider_reference=$1`, wamid).Scan(&r.status, &r.code, &r.pricing, &r.billable, &at); err != nil {
			t.Fatal(err)
		}
		if at != nil {
			r.at = at.UTC()
		}
		return r
	}
	push := func(status string, ts int64, extra string) WebhookResult {
		body := fmt.Sprintf(`{"entry":[{"changes":[{"field":"messages","value":{"statuses":[{"id":%q,"status":%q,"timestamp":"%d"%s}]}}]}]}`,
			wamid, status, ts, extra)
		return wh.Process(ctx, []byte(body))
	}
	at := func(ts int64) time.Time { return time.Unix(ts, 0).UTC() }

	push("sent", 100, `,"pricing":{"billable":true,"category":"utility"}`)
	if r := read(); r.status != "sent" || r.pricing != "utility" || !r.billable.Bool || !r.at.Equal(at(100)) {
		t.Fatalf("sent: %+v", r)
	}
	push("read", 300, "")
	if r := read(); r.status != "read" || !r.at.Equal(at(300)) {
		t.Fatalf("read: %+v", r)
	}
	// Late delivered after read: no regression (pricing still recorded).
	push("delivered", 200, `,"pricing":{"billable":false,"category":"authentication"}`)
	if r := read(); r.status != "read" || !r.at.Equal(at(300)) || r.pricing != "authentication" || r.billable.Bool {
		t.Fatalf("late delivered: %+v", r)
	}
	// Idempotent redelivery.
	push("read", 400, "")
	if r := read(); r.status != "read" || !r.at.Equal(at(300)) {
		t.Fatalf("duplicate read: %+v", r)
	}
	// Failed is always recorded with the Meta error code …
	push("failed", 500, `,"errors":[{"code":131026}]`)
	if r := read(); r.status != "failed" || r.code != "undeliverable" || !r.at.Equal(at(500)) {
		t.Fatalf("failed: %+v", r)
	}
	// … and later non-failed statuses do not override it.
	push("delivered", 600, "")
	if r := read(); r.status != "failed" || r.code != "undeliverable" {
		t.Fatalf("after failed: %+v", r)
	}
	if res := wh.Process(ctx, []byte(`{"entry":[{"changes":[{"field":"messages","value":{"statuses":[{"id":"wamid.nobody","status":"read","timestamp":"1"}]}}]}]}`)); res.Statuses != 0 || res.Ignored != 1 {
		t.Fatalf("unknown wamid: %+v", res)
	}

	// Template status: meta id unknown → effective (override) name + language.
	if _, err := tx.Exec(ctx, `INSERT INTO whatsapp_cloud_templates (key, meta_name, override_name, language, category, status)
		VALUES ('test.webhook', 'otopoly_test_webhook', 'manual_test_webhook', 'tr', 'UTILITY', 'pending')`); err != nil {
		t.Fatal(err)
	}
	res := wh.Process(ctx, []byte(`{"entry":[{"changes":[{"field":"message_template_status_update","value":{"event":"REJECTED",
		"message_template_id":99887766,"message_template_name":"manual_test_webhook","message_template_language":"tr","reason":"INVALID_FORMAT"}}]}]}`))
	var status, reason, metaID string
	if err := tx.QueryRow(ctx, `SELECT status, COALESCE(rejected_reason,''), meta_template_id FROM whatsapp_cloud_templates WHERE key='test.webhook'`).
		Scan(&status, &reason, &metaID); err != nil {
		t.Fatal(err)
	}
	if res.Templates != 1 || status != "rejected" || reason != "INVALID_FORMAT" || metaID != "99887766" {
		t.Fatalf("by name: res=%+v status=%s reason=%s id=%s", res, status, reason, metaID)
	}
	// Now matched by the stored id.
	wh.Process(ctx, []byte(`{"entry":[{"changes":[{"field":"message_template_status_update","value":{"event":"APPROVED","message_template_id":99887766,"reason":"NONE"}}]}]}`))
	if err := tx.QueryRow(ctx, `SELECT status, COALESCE(rejected_reason,'') FROM whatsapp_cloud_templates WHERE key='test.webhook'`).
		Scan(&status, &reason); err != nil && err != pgx.ErrNoRows {
		t.Fatal(err)
	}
	if status != "approved" || reason != "" {
		t.Fatalf("by id: status=%s reason=%s", status, reason)
	}
}
