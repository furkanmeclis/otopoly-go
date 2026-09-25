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
