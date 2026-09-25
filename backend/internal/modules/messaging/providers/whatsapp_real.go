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
	"go.mau.fi/whatsmeow/proto/waCompanionReg"
	"go.mau.fi/whatsmeow/proto/waE2E"
	wastore "go.mau.fi/whatsmeow/store"
	"go.mau.fi/whatsmeow/store/sqlstore"
	"go.mau.fi/whatsmeow/types"
	"go.mau.fi/whatsmeow/types/events"
	waLog "go.mau.fi/whatsmeow/util/log"
	"google.golang.org/protobuf/proto"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/messaging/model"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/orgctx"
)

const companionOSName = "Mac OS"

func init() {
	wastore.SetOSInfo(companionOSName, wastore.GetWAVersion())
	wastore.DeviceProps.PlatformType = waCompanionReg.DeviceProps_CHROME.Enum()
}

// SessionCallback is called when a WhatsApp session connects or disconnects.
type SessionCallback func(orgID int64, jid, phone, displayName string, connected bool)

// QRCallback is called when a new QR code is available for pairing.
type QRCallback func(orgID int64, code string, expiresAt time.Time)

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
	onQR      QRCallback
}

// NewRealWhatsAppClientManager creates a manager backed by the given Postgres DSN.
func NewRealWhatsAppClientManager(
	dsn string,
	log *slog.Logger,
	onSession SessionCallback,
	onQR QRCallback,
) (*RealWhatsAppClientManager, error) {
	sqlDB, err := sql.Open("pgx", dsn)
	if err != nil {
		return nil, fmt.Errorf("whatsapp sqlstore open: %w", err)
	}
	waLogger := waLog.Stdout("WhatsApp", "INFO", true)
	if log != nil {
		waLogger = slogAdapter{log: log}
	}
	container := sqlstore.NewWithDB(sqlDB, "postgres", waLogger)
	if err := container.Upgrade(context.Background()); err != nil {
		_ = sqlDB.Close()
		return nil, fmt.Errorf("whatsapp sqlstore upgrade: %w", err)
	}
	return &RealWhatsAppClientManager{
		entries:   make(map[int64]*orgEntry),
		container: container,
		log:       log,
		onSession: onSession,
		onQR:      onQR,
	}, nil
}

type slogAdapter struct {
	log *slog.Logger
}

func (s slogAdapter) Warnf(msg string, args ...interface{}) {
	if s.log != nil {
		s.log.Warn(fmt.Sprintf(msg, args...))
	}
}
func (s slogAdapter) Errorf(msg string, args ...interface{}) {
	if s.log != nil {
		s.log.Error(fmt.Sprintf(msg, args...))
	}
}
func (s slogAdapter) Infof(msg string, args ...interface{}) {
	if s.log != nil {
		s.log.Info(fmt.Sprintf(msg, args...))
	}
}
func (s slogAdapter) Debugf(msg string, args ...interface{}) {
	if s.log != nil {
		s.log.Debug(fmt.Sprintf(msg, args...))
	}
}
func (s slogAdapter) Sub(string) waLog.Logger { return s }

// AsClient returns an OrgContextClient that satisfies WhatsAppClient.
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

func (m *RealWhatsAppClientManager) buildClient(orgID int64, reuseJID string) *whatsmeow.Client {
	var device *wastore.Device
	if strings.TrimSpace(reuseJID) != "" {
		if jid, err := types.ParseJID(reuseJID); err == nil {
			if d, err := m.container.GetDevice(context.Background(), jid); err == nil && d != nil {
				device = d
			}
		}
	}
	if device == nil {
		device = m.container.NewDevice()
	}
	cli := whatsmeow.NewClient(device, waLog.Stdout("WhatsApp", "INFO", true))
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

// RestoreSession reconnects a previously paired org from sqlstore using its JID.
func (m *RealWhatsAppClientManager) RestoreSession(orgID int64, jid string) error {
	if strings.TrimSpace(jid) == "" {
		return fmt.Errorf("empty jid")
	}
	entry := m.getOrCreate(orgID)
	entry.mu.Lock()
	defer entry.mu.Unlock()
	if entry.client != nil && entry.client.IsConnected() && entry.client.Store.ID != nil {
		return nil
	}
	if entry.client != nil {
		entry.client.Disconnect()
		entry.client = nil
	}
	cli := m.buildClient(orgID, jid)
	if cli.Store.ID == nil {
		return fmt.Errorf("no stored whatsapp device for org %d jid %s", orgID, jid)
	}
	entry.client = cli
	if err := cli.Connect(); err != nil {
		return fmt.Errorf("whatsapp restore connect: %w", err)
	}
	if m.log != nil {
		m.log.Info("whatsapp_session_restored", "org_id", orgID, "jid", jid)
	}
	return nil
}

// OrgContextClient implements WhatsAppClient by reading org ID from context.
type OrgContextClient struct {
	mgr *RealWhatsAppClientManager
}

// StartPairing begins WhatsMeow connect in the background and returns immediately.
// QR codes are delivered via the manager's onQR callback.
func (c *OrgContextClient) StartPairing(ctx context.Context) error {
	scope, ok := orgctx.ScopeFrom(ctx)
	if !ok {
		return fmt.Errorf("no org scope in context")
	}
	orgID := scope.InternalID

	entry := c.mgr.getOrCreate(orgID)
	entry.mu.Lock()
	if entry.client != nil {
		entry.client.Disconnect()
		entry.client = nil
	}
	cli := c.mgr.buildClient(orgID, "")
	entry.client = cli
	entry.mu.Unlock()

	bg := context.Background()
	qrChan, err := cli.GetQRChannel(bg)
	if err != nil {
		// Already logged in — try connecting the existing device.
		if strings.Contains(err.Error(), "already logged in") || cli.Store.ID != nil {
			if err := cli.Connect(); err != nil {
				return fmt.Errorf("whatsapp connect: %w", err)
			}
			return nil
		}
		return fmt.Errorf("GetQRChannel: %w", err)
	}
	if err := cli.Connect(); err != nil {
		return fmt.Errorf("whatsapp connect: %w", err)
	}

	go c.consumeQR(orgID, qrChan)
	return nil
}

func (c *OrgContextClient) consumeQR(orgID int64, qrChan <-chan whatsmeow.QRChannelItem) {
	for item := range qrChan {
		switch item.Event {
		case "code":
			expires := time.Now().Add(item.Timeout)
			if item.Timeout <= 0 {
				expires = time.Now().Add(60 * time.Second)
			}
			if c.mgr.onQR != nil {
				c.mgr.onQR(orgID, item.Code, expires)
			}
		case "success":
			return
		case "timeout":
			if c.mgr.log != nil {
				c.mgr.log.Warn("whatsapp_qr_timeout", "org_id", orgID)
			}
			return
		default:
			if strings.HasPrefix(item.Event, "err-") && c.mgr.log != nil {
				c.mgr.log.Error("whatsapp_qr_error", "org_id", orgID, "event", item.Event)
			}
		}
	}
}

// GenerateQR starts pairing asynchronously and returns an empty QR payload.
// Callers should poll session status for the actual code.
func (c *OrgContextClient) GenerateQR(ctx context.Context) (model.QRCodeResponse, error) {
	if err := c.StartPairing(ctx); err != nil {
		return model.QRCodeResponse{}, err
	}
	return model.QRCodeResponse{}, nil
}

// liveClient returns the connected client for the org in ctx.
func (c *OrgContextClient) liveClient(ctx context.Context) (*whatsmeow.Client, error) {
	scope, ok := orgctx.ScopeFrom(ctx)
	if !ok {
		return nil, fmt.Errorf("no org scope in context")
	}
	c.mgr.mu.RLock()
	entry, exists := c.mgr.entries[scope.InternalID]
	connected := exists && entry.client != nil && entry.client.IsConnected()
	c.mgr.mu.RUnlock()
	if !connected {
		return nil, fmt.Errorf("whatsapp not connected for org %d (reconnect from messaging settings if backend restarted)", scope.InternalID)
	}
	return entry.client, nil
}

func (c *OrgContextClient) Send(ctx context.Context, phone, body string) (string, error) {
	cli, err := c.liveClient(ctx)
	if err != nil {
		return "", err
	}
	normalized, err := normalizeWhatsAppPhone(phone)
	if err != nil {
		return "", err
	}
	jid := types.NewJID(normalized, types.DefaultUserServer)
	msg := &waE2E.Message{Conversation: proto.String(body)}
	resp, err := cli.SendMessage(ctx, jid, msg)
	if err != nil {
		return "", fmt.Errorf("whatsapp send: %w", err)
	}
	return resp.ID, nil
}

// SendDocument uploads the file to WhatsApp media servers and sends a
// DocumentMessage (caption = message body). Failures are returned so the
// messaging queue can retry with backoff.
func (c *OrgContextClient) SendDocument(ctx context.Context, phone string, doc Document) (string, error) {
	cli, err := c.liveClient(ctx)
	if err != nil {
		return "", err
	}
	normalized, err := normalizeWhatsAppPhone(phone)
	if err != nil {
		return "", err
	}
	uploaded, err := cli.Upload(ctx, doc.Data, whatsmeow.MediaDocument)
	if err != nil {
		return "", fmt.Errorf("whatsapp upload: %w", err)
	}
	mime := doc.MimeType
	if mime == "" {
		mime = "application/octet-stream"
	}
	msg := &waE2E.Message{DocumentMessage: &waE2E.DocumentMessage{
		URL:           proto.String(uploaded.URL),
		DirectPath:    proto.String(uploaded.DirectPath),
		MediaKey:      uploaded.MediaKey,
		Mimetype:      proto.String(mime),
		FileEncSHA256: uploaded.FileEncSHA256,
		FileSHA256:    uploaded.FileSHA256,
		FileLength:    proto.Uint64(uploaded.FileLength),
		FileName:      proto.String(doc.FileName),
		Title:         proto.String(doc.FileName),
	}}
	if strings.TrimSpace(doc.Caption) != "" {
		msg.DocumentMessage.Caption = proto.String(doc.Caption)
	}
	jid := types.NewJID(normalized, types.DefaultUserServer)
	resp, err := cli.SendMessage(ctx, jid, msg)
	if err != nil {
		return "", fmt.Errorf("whatsapp send document: %w", err)
	}
	return resp.ID, nil
}

func normalizeWhatsAppPhone(phone string) (string, error) {
	digits := strings.Map(func(r rune) rune {
		if r >= '0' && r <= '9' {
			return r
		}
		return -1
	}, strings.TrimSpace(phone))
	if digits == "" {
		return "", fmt.Errorf("empty phone number")
	}
	// TR local mobiles: 05XXXXXXXXX → 905XXXXXXXXX
	if strings.HasPrefix(digits, "0") && len(digits) == 11 {
		digits = "90" + digits[1:]
	}
	if len(digits) < 10 {
		return "", fmt.Errorf("invalid phone number")
	}
	return digits, nil
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
		if entry.client.IsConnected() {
			_ = entry.client.Logout(ctx)
		}
		entry.client.Disconnect()
	}
	return nil
}

func (c *OrgContextClient) IsConnected() bool {
	c.mgr.mu.RLock()
	defer c.mgr.mu.RUnlock()
	for _, entry := range c.mgr.entries {
		if entry.client != nil && entry.client.IsConnected() && entry.client.Store.ID != nil {
			return true
		}
	}
	return false
}

// IsConnectedForOrg reports whether a specific organization client is live.
func (c *OrgContextClient) IsConnectedForOrg(orgID int64) bool {
	c.mgr.mu.RLock()
	entry, exists := c.mgr.entries[orgID]
	c.mgr.mu.RUnlock()
	return exists && entry.client != nil && entry.client.IsConnected() && entry.client.Store.ID != nil
}

// RestoreSession reconnects a stored device for the organization.
func (c *OrgContextClient) RestoreSession(orgID int64, jid string) error {
	return c.mgr.RestoreSession(orgID, jid)
}
