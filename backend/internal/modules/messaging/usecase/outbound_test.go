package usecase_test

import (
	"bytes"
	"context"
	"errors"
	"io"
	"os"
	"strings"
	"testing"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database/db"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/messaging/catalog"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/messaging/cloud"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/messaging/model"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/messaging/providers"
	messagingusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/messaging/usecase"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/storage"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

type recordingWA struct {
	providers.StubWhatsAppClient
	docs  []providers.Document
	texts []string
	fail  error
}

func (r *recordingWA) Send(_ context.Context, _ string, body string) (string, error) {
	if r.fail != nil {
		return "", r.fail
	}
	r.texts = append(r.texts, body)
	return "txt", nil
}

func (r *recordingWA) SendDocument(_ context.Context, _ string, doc providers.Document) (string, error) {
	if r.fail != nil {
		return "", r.fail
	}
	r.docs = append(r.docs, doc)
	return "doc", nil
}

type memStore struct {
	storage.Driver
	objects map[string][]byte
}

func (m *memStore) Upload(_ context.Context, f storage.File, path string) error {
	b, _ := io.ReadAll(f.Body)
	m.objects[path] = b
	return nil
}

func (m *memStore) Download(_ context.Context, path string) (io.ReadCloser, int64, error) {
	b, ok := m.objects[path]
	if !ok {
		return nil, 0, errors.New("missing")
	}
	return io.NopCloser(bytes.NewReader(b)), int64(len(b)), nil
}

func TestQueueSendWithDocument_DB(t *testing.T) {
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
	var orgID int64
	slug := "out-" + strings.ReplaceAll(uuid.NewString(), "-", "")[:12]
	if err := pool.QueryRow(ctx, `INSERT INTO organizations (slug, name) VALUES ($1,'Out') RETURNING id`, slug).Scan(&orgID); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _, _ = pool.Exec(context.Background(), `DELETE FROM organizations WHERE id=$1`, orgID) })
	if _, err := pool.Exec(ctx, `INSERT INTO whatsapp_sessions (organization_id, status, jid) VALUES ($1,'connected','905000000000@s.whatsapp.net')`, orgID); err != nil {
		t.Fatal(err)
	}
	wa := &recordingWA{}
	store := &memStore{objects: map[string][]byte{}}
	svc := messagingusecase.New(db.New(pool), providers.NewWhatsAppProvider(wa, nil), &providers.NoopSMSProvider{}).SetStorage(store)

	pdf := []byte("%PDF-1.4 fake")
	id, err := svc.QueueSend(ctx, messagingusecase.OutboundRequest{
		OrgID: orgID, EventType: model.EventQuoteSent, Channel: model.ChannelWhatsApp, Phone: "05321112233",
		Body:       "Teklifiniz ektedir",
		Attachment: &messagingusecase.OutboundAttachment{Data: pdf, FileName: "../teklif.pdf", MimeType: "application/pdf"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(wa.docs) != 1 || !bytes.Equal(wa.docs[0].Data, pdf) || wa.docs[0].FileName != "teklif.pdf" || wa.docs[0].Caption != "Teklifiniz ektedir" {
		t.Fatalf("docs = %+v", wa.docs)
	}
	var status, body string
	var att []byte
	_ = pool.QueryRow(ctx, `SELECT status, body, attachment FROM outbound_messages WHERE uuid=$1`, id).Scan(&status, &body, &att)
	if status != "sent" || body != "Teklifiniz ektedir" || !bytes.Contains(att, []byte("notifications/attachments/")) {
		t.Fatalf("row = %s %q %s", status, body, att)
	}

	// Failure on the final attempt marks the row failed; a replay is a no-op.
	wa.fail = errors.New("offline")
	id2, err := svc.QueueSend(ctx, messagingusecase.OutboundRequest{
		OrgID: orgID, EventType: model.EventQuoteReminder, Channel: model.ChannelWhatsApp, Phone: "05321112233", Body: "x",
	})
	if err == nil {
		t.Fatal("inline send error expected")
	}
	_ = pool.QueryRow(ctx, `SELECT status FROM outbound_messages WHERE uuid=$1`, id2).Scan(&status)
	if status != "failed" {
		t.Fatalf("status = %s", status)
	}
}

type dbCloud struct{ msgs []cloud.TemplateMessage }

func (c *dbCloud) SendTemplate(_ context.Context, _ string, m cloud.TemplateMessage) (string, error) {
	c.msgs = append(c.msgs, m)
	return "wamid.DB1", nil
}

// TestPlatformCloudSendPersistsSender_DB: an org without an own session
// falls back to the Cloud platform number; the outbound row stores the wamid,
// sender_kind and template_name, and a non-approved template fails with
// error_code template_not_approved.
func TestPlatformCloudSendPersistsSender_DB(t *testing.T) {
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
	q := db.New(pool)
	var orgID int64
	slug := "pc-" + strings.ReplaceAll(uuid.NewString(), "-", "")[:12]
	if err := pool.QueryRow(ctx, `INSERT INTO organizations (slug, name) VALUES ($1,'PC') RETURNING id`, slug).Scan(&orgID); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _, _ = pool.Exec(context.Background(), `DELETE FROM organizations WHERE id=$1`, orgID) })

	// Singleton settings + template rows are global: snapshot and restore.
	prev, err := q.GetPlatformWhatsAppSettings(ctx)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `UPDATE platform_whatsapp_settings SET provider=$1, phone_number_id=$2, access_token_enc=$3 WHERE id=1`,
			prev.Provider, prev.PhoneNumberID, prev.AccessTokenEnc)
	})
	if _, err := pool.Exec(ctx, `UPDATE platform_whatsapp_settings SET provider='cloud', phone_number_id='PN-TEST', access_token_enc='x' WHERE id=1`); err != nil {
		t.Fatal(err)
	}
	if err := catalog.Seed(ctx, q); err != nil {
		t.Fatal(err)
	}
	var prevStatus string
	_ = pool.QueryRow(ctx, `SELECT status FROM whatsapp_cloud_templates WHERE key='job.ready'`).Scan(&prevStatus)
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `UPDATE whatsapp_cloud_templates SET status=$1 WHERE key='job.ready'`, prevStatus)
	})

	fc := &dbCloud{}
	svc := messagingusecase.New(q, nil, nil).SetCloudSender(fc)
	send := func() uuid.UUID {
		id, _ := svc.QueueSend(ctx, messagingusecase.OutboundRequest{
			OrgID: orgID, EventType: model.EventJobReady, Channel: model.ChannelWhatsApp, Phone: "05321112233",
			Body: "org text", Vars: map[string]string{"customer_name": "Ali", "plate": "34 A 1", "business_name": "PC", "job_id": "J9"},
		})
		return id
	}
	type outRow struct{ status, ref, kind, tpl, code string }
	read := func(id uuid.UUID) outRow {
		var r outRow
		if err := pool.QueryRow(ctx, `SELECT status, provider_reference, COALESCE(sender_kind,''), COALESCE(template_name,''), COALESCE(error_code,'')
			FROM outbound_messages WHERE uuid=$1`, id).Scan(&r.status, &r.ref, &r.kind, &r.tpl, &r.code); err != nil {
			t.Fatal(err)
		}
		return r
	}

	if _, err := pool.Exec(ctx, `UPDATE whatsapp_cloud_templates SET status='pending' WHERE key='job.ready'`); err != nil {
		t.Fatal(err)
	}
	if r := read(send()); r.status != "failed" || r.kind != model.SenderPlatformCloud || r.code != model.ErrCodeTemplateNotApproved || r.ref != "" {
		t.Fatalf("pending template row = %+v", r)
	}

	if _, err := pool.Exec(ctx, `UPDATE whatsapp_cloud_templates SET status='approved' WHERE key='job.ready'`); err != nil {
		t.Fatal(err)
	}
	if r := read(send()); r.status != "sent" || r.ref != "wamid.DB1" || r.kind != model.SenderPlatformCloud || r.tpl != "otopoly_job_ready" || r.code != "" {
		t.Fatalf("approved template row = %+v", r)
	}
	if len(fc.msgs) != 1 || strings.Join(fc.msgs[0].BodyParams, "|") != "Ali|34 A 1|PC|J9" {
		t.Fatalf("cloud msgs = %+v", fc.msgs)
	}
}
