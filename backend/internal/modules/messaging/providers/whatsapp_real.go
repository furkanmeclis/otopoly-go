package providers

import (
	"context"
	"database/sql"
	"fmt"
	"log/slog"
	"strings"
	"sync"
	"time"

	_ "github.com/jackc/pgx/v5/stdlib"
	"go.mau.fi/whatsmeow"
	"go.mau.fi/whatsmeow/proto/waE2E"
	"go.mau.fi/whatsmeow/store/sqlstore"
	"go.mau.fi/whatsmeow/types"
	"go.mau.fi/whatsmeow/types/events"
	waLog "go.mau.fi/whatsmeow/util/log"
	"google.golang.org/protobuf/proto"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/messaging/model"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/orgctx"
)

// SessionCallback is called when a WhatsApp session connects or disconnects.
type SessionCallback func(orgID int64, jid, phone, displayName string, connected bool)

type orgEntry struct {
	mu     sync.Mutex
	client *whatsmeow.Client
}

// RealWhatsAppClientManager manages one whatsmeow client per organization.
type RealWhatsAppClientManager struct {
	mu        sync.RWMutex
	entries   map[int64]*orgEntry
	container *sqlstore.Container
	log       *slog.Logger
	onSession SessionCallback
}

// NewRealWhatsAppClientManager creates a manager backed by the given Postgres DSN.
// whatsmeow tables (whatsmeow_*) are auto-created on first use.
func NewRealWhatsAppClientManager(dsn string, log *slog.Logger, onSession SessionCallback) (*RealWhatsAppClientManager, error) {
	sqlDB, err := sql.Open("pgx", dsn)
	if err != nil {
		return nil, fmt.Errorf("whatsapp sqlstore open: %w", err)
	}
	container := sqlstore.NewWithDB(sqlDB, "postgres", waLog.Noop)
	if err := container.Upgrade(context.Background()); err != nil {
		_ = sqlDB.Close()
		return nil, fmt.Errorf("whatsapp sqlstore upgrade: %w", err)
	}
	return &RealWhatsAppClientManager{
		entries:   make(map[int64]*orgEntry),
		container: container,
		log:       log,
		onSession: onSession,
	}, nil
}

// AsClient returns an OrgContextClient that satisfies WhatsAppClient using
// this manager, routing calls by the organisation ID in the request context.
func (m *RealWhatsAppClientManager) AsClient() *OrgContextClient {
	return &OrgContextClient{mgr: m}
}

func (m *RealWhatsAppClientManager) getOrCreate(orgID int64) *orgEntry {
	m.mu.Lock()
	defer m.mu.Unlock()
	if e, ok := m.entries[orgID]; ok {
		return e
	}
	e := &orgEntry{}
	m.entries[orgID] = e
	return e
}

func (m *RealWhatsAppClientManager) buildClient(orgID int64) *whatsmeow.Client {
	device := m.container.NewDevice()
	cli := whatsmeow.NewClient(device, waLog.Noop)
	cli.AddEventHandler(func(evt interface{}) {
		switch evt.(type) {
		case *events.Connected:
			if m.onSession != nil && cli.Store.ID != nil {
				m.onSession(orgID, cli.Store.ID.String(), cli.Store.ID.User, cli.Store.PushName, true)
			}
		case *events.LoggedOut:
			if m.onSession != nil {
				m.onSession(orgID, "", "", "", false)
			}
			m.mu.Lock()
			delete(m.entries, orgID)
			m.mu.Unlock()
		}
	})
	return cli
}

// OrgContextClient implements WhatsAppClient by reading org ID from context.
type OrgContextClient struct {
	mgr *RealWhatsAppClientManager
}

func (c *OrgContextClient) GenerateQR(ctx context.Context) (model.QRCodeResponse, error) {
	scope, ok := orgctx.ScopeFrom(ctx)
	if !ok {
		return model.QRCodeResponse{}, fmt.Errorf("no org scope in context")
	}
	orgID := scope.InternalID

	entry := c.mgr.getOrCreate(orgID)
	entry.mu.Lock()
	defer entry.mu.Unlock()

	if entry.client != nil {
		entry.client.Disconnect()
		entry.client = nil
	}

	cli := c.mgr.buildClient(orgID)
	entry.client = cli

	qrChan, err := cli.GetQRChannel(ctx)
	if err != nil {
		return model.QRCodeResponse{}, fmt.Errorf("GetQRChannel: %w", err)
	}
	if err := cli.Connect(); err != nil {
		return model.QRCodeResponse{}, fmt.Errorf("whatsapp connect: %w", err)
	}

	timeout := time.After(60 * time.Second)
	for {
		select {
		case item, ok := <-qrChan:
			if !ok {
				return model.QRCodeResponse{}, fmt.Errorf("QR channel closed")
			}
			switch item.Event {
			case "code":
				return model.QRCodeResponse{
					Code:      item.Code,
					ExpiresAt: time.Now().Add(item.Timeout),
				}, nil
			case "success":
				return model.QRCodeResponse{}, fmt.Errorf("already paired")
			case "timeout":
				return model.QRCodeResponse{}, fmt.Errorf("QR expired before scan")
			default:
				if strings.HasPrefix(item.Event, "err-") {
					return model.QRCodeResponse{}, fmt.Errorf("QR error: %s", item.Event)
				}
			}
		case <-timeout:
			return model.QRCodeResponse{}, fmt.Errorf("timeout waiting for WhatsApp QR")
		case <-ctx.Done():
			return model.QRCodeResponse{}, ctx.Err()
		}
	}
}

func (c *OrgContextClient) Send(ctx context.Context, phone, body string) (string, error) {
	scope, ok := orgctx.ScopeFrom(ctx)
	if !ok {
		return "", fmt.Errorf("no org scope in context")
	}

	c.mgr.mu.RLock()
	entry, exists := c.mgr.entries[scope.InternalID]
	c.mgr.mu.RUnlock()
	if !exists || entry.client == nil || !entry.client.IsConnected() {
		return "", fmt.Errorf("whatsapp not connected for org %d", scope.InternalID)
	}

	normalized := strings.TrimPrefix(strings.ReplaceAll(phone, " ", ""), "+")
	jid := types.NewJID(normalized, types.DefaultUserServer)
	msg := &waE2E.Message{Conversation: proto.String(body)}
	resp, err := entry.client.SendMessage(ctx, jid, msg)
	if err != nil {
		return "", fmt.Errorf("whatsapp send: %w", err)
	}
	return resp.ID, nil
}

func (c *OrgContextClient) Disconnect(ctx context.Context) error {
	scope, ok := orgctx.ScopeFrom(ctx)
	if !ok {
		return fmt.Errorf("no org scope in context")
	}

	c.mgr.mu.Lock()
	entry, exists := c.mgr.entries[scope.InternalID]
	if exists {
		delete(c.mgr.entries, scope.InternalID)
	}
	c.mgr.mu.Unlock()

	if exists && entry.client != nil {
		entry.client.Disconnect()
	}
	return nil
}

func (c *OrgContextClient) IsConnected() bool { return false }
