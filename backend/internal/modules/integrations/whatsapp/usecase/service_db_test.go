package usecase

import (
	"bytes"
	"context"
	"os"
	"testing"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database/db"
	"github.com/jackc/pgx/v5/pgxpool"
)

// TestPatchDBStoresCiphertextAndKeepsOmitted runs the real SQL (COALESCE
// partial update) and inspects the raw BYTEA columns. Restores the row after.
func TestPatchDBStoresCiphertextAndKeepsOmitted(t *testing.T) {
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

	const snapshot = `CREATE TEMP TABLE wa_settings_snapshot AS SELECT * FROM platform_whatsapp_settings`
	conn, err := pool.Acquire(ctx)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(conn.Release)
	if _, err := conn.Exec(ctx, snapshot); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_, _ = conn.Exec(ctx, `DELETE FROM platform_whatsapp_settings`)
		_, _ = conn.Exec(ctx, `INSERT INTO platform_whatsapp_settings SELECT * FROM wa_settings_snapshot`)
		_, _ = conn.Exec(ctx, `DROP TABLE wa_settings_snapshot`)
	})

	q := db.New(conn)
	svc := New(q, testBox(t), "https://app.example.test")
	if _, err := svc.Patch(ctx, nil, cloudPatch()); err != nil {
		t.Fatalf("Patch: %v", err)
	}

	var token, secret, verify []byte
	if err := conn.QueryRow(ctx,
		`SELECT access_token_enc, app_secret_enc, webhook_verify_token_enc FROM platform_whatsapp_settings WHERE id = 1`,
	).Scan(&token, &secret, &verify); err != nil {
		t.Fatal(err)
	}
	for name, pair := range map[string][2][]byte{
		"access_token": {token, []byte("token-plain")},
		"app_secret":   {secret, []byte("secret-plain")},
		"verify_token": {verify, []byte("verify-plain")},
	} {
		if len(pair[0]) == 0 || bytes.Contains(pair[0], pair[1]) {
			t.Fatalf("%s: raw column empty or plaintext: %q", name, pair[0])
		}
	}

	if _, err := svc.Patch(ctx, nil, PatchInput{DisplayPhone: ptr("+90 500")}); err != nil {
		t.Fatalf("Patch: %v", err)
	}
	var tokenAfter []byte
	if err := conn.QueryRow(ctx, `SELECT access_token_enc FROM platform_whatsapp_settings WHERE id = 1`).Scan(&tokenAfter); err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(token, tokenAfter) {
		t.Fatal("omitted access token was overwritten")
	}

	conf, err := svc.CloudConfigReader().Read(ctx)
	if err != nil || conf.AccessToken != "token-plain" || conf.PhoneNumberID != "phone-id-1" {
		t.Fatalf("reader: %v %+v", err, conf)
	}
}
