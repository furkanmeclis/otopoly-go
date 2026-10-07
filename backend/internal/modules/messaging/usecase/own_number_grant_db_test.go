package usecase_test

import (
	"context"
	"os"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// grantStatement extracts the whatsapp.own_number grant for existing plans
// from migration 000075 (the statement after its marker comment).
func grantStatement(t *testing.T) string {
	t.Helper()
	raw, err := os.ReadFile("../../../../migrations/000075_whatsapp_platform_sender.up.sql")
	if err != nil {
		t.Fatal(err)
	}
	src := string(raw)
	i := strings.Index(src, "-- Existing plans keep own-number sending")
	if i < 0 {
		t.Fatal("grant marker not found in migration 000075")
	}
	src = src[i:]
	end := strings.Index(src, "DO NOTHING;")
	if end < 0 {
		t.Fatal("grant statement end not found")
	}
	var lines []string
	for _, l := range strings.Split(src[:end+len("DO NOTHING;")], "\n") {
		if !strings.HasPrefix(strings.TrimSpace(l), "--") {
			lines = append(lines, l)
		}
	}
	return strings.Join(lines, "\n")
}

// TestOwnNumberGrant_DB runs the migration grant on fresh plans inside a
// rolled-back transaction: WhatsApp-enabled live plans get TRUE; disabled,
// deleted, undefined and trial plans are untouched; re-running is a no-op.
func TestOwnNumberGrant_DB(t *testing.T) {
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
	defer func() { _ = tx.Rollback(ctx) }()

	sfx := strings.ReplaceAll(uuid.NewString(), "-", "")[:8]
	code := func(name string) string { return name + sfx }
	if _, err := tx.Exec(ctx, `
		INSERT INTO billing_plans (code, name) VALUES ($1,'a'),($2,'b'),($3,'c'),($4,'d');
	`, code("on"), code("off"), code("del"), code("none")); err != nil {
		t.Fatal(err)
	}
	if _, err := tx.Exec(ctx, `UPDATE billing_plans SET deleted_at = NOW() WHERE code = $1`, code("del")); err != nil {
		t.Fatal(err)
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO billing_plan_features (plan_id, feature_id, value_bool)
		SELECT p.id, f.id, p.code IN ($1, $3)
		FROM billing_plans p, billing_features f
		WHERE f.key = 'whatsapp.enabled' AND p.code IN ($1, $2, $3)`, code("on"), code("off"), code("del")); err != nil {
		t.Fatal(err)
	}
	stmt := grantStatement(t)
	for i := 0; i < 2; i++ { // idempotent
		if _, err := tx.Exec(ctx, stmt); err != nil {
			t.Fatalf("grant: %v", err)
		}
	}
	got := map[string]string{}
	rows, err := tx.Query(ctx, `
		SELECT p.code, COALESCE(pf.value_bool::text, '-')
		FROM billing_plans p
		LEFT JOIN billing_plan_features pf ON pf.plan_id = p.id
			AND pf.feature_id = (SELECT id FROM billing_features WHERE key = 'whatsapp.own_number')
		WHERE p.code IN ($1,$2,$3,$4,'trial')`, code("on"), code("off"), code("del"), code("none"))
	if err != nil {
		t.Fatal(err)
	}
	for rows.Next() {
		var c, v string
		if err := rows.Scan(&c, &v); err != nil {
			t.Fatal(err)
		}
		got[strings.TrimSuffix(c, sfx)] = v
	}
	want := map[string]string{"on": "true", "off": "-", "del": "-", "none": "-", "trial": "false"}
	for k, v := range want {
		if got[k] != v {
			t.Errorf("%s: whatsapp.own_number = %s want %s (all %v)", k, got[k], v, got)
		}
	}
}
