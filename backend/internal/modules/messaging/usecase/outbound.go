package usecase

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"path"
	"strings"
	"time"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database/db"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/messaging/model"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/messaging/providers"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/entitlements"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/orgctx"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/storage"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/queue"
	"github.com/google/uuid"
	"github.com/hibiken/asynq"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

// MaxAttachmentBytes caps documents sent over WhatsApp.
const MaxAttachmentBytes = 20 << 20

// OutboundStatusSending marks a row claimed by a sender.
const OutboundStatusSending = "sending"

// Enqueuer schedules background tasks.
type Enqueuer interface {
	Enqueue(task *asynq.Task, opts ...asynq.Option) (*asynq.TaskInfo, error)
}

// DocumentSender is implemented by channels that can send attachments.
type DocumentSender interface {
	SendDocument(ctx context.Context, phone string, doc providers.Document) (string, error)
}

// SetQueue enables queued sends (worker → API hop). Without it sends run inline.
func (s *Service) SetQueue(enq Enqueuer) *Service {
	s.enq = enq
	return s
}

// OutboundOutcome is the final result of a queued WhatsApp/SMS send.
type OutboundOutcome struct {
	OrgID       int64
	EventType   string
	Channel     string
	SubjectType string
	// SubjectUUID is the sender's reference (for notification-center sends:
	// the scheduled notification uuid).
	SubjectUUID *uuid.UUID
	Sent        bool
	Error       string
}

// OutboundObserver receives final outcomes of queued sends (asynq path only:
// inline sends report errors to their caller directly).
type OutboundObserver func(ctx context.Context, o OutboundOutcome)

// SetOutboundObserver installs the observer (nil disables it).
func (s *Service) SetOutboundObserver(fn OutboundObserver) *Service {
	s.observer = fn
	return s
}

// SetStorage enables attachment upload/download.
func (s *Service) SetStorage(store storage.Driver) *Service {
	s.store = store
	return s
}

// OutboundAttachment is persisted with a queued message.
type OutboundAttachment struct {
	ObjectKey string `json:"object_key,omitempty"`
	FileName  string `json:"file_name"`
	MimeType  string `json:"mime_type"`
	// Data is only used inline (never persisted).
	Data []byte `json:"-"`
}

// OutboundRequest is a rendered WhatsApp/SMS message to queue.
type OutboundRequest struct {
	OrgID                   int64
	EventType               string
	Channel                 string
	Phone                   string
	Body                    string
	Attachment              *OutboundAttachment
	SubjectType             string
	SubjectUUID             *uuid.UUID
	ScheduledNotificationID int64
	// Vars are the template variables (persisted in payload) used when the
	// platform number sends the catalog entry instead of Body.
	Vars map[string]string
}

// QueueSend persists the message and hands it to the messaging queue, which
// only the API process (owner of the WhatsApp sessions) consumes. With no
// queue configured it is delivered inline and send errors are returned.
func (s *Service) QueueSend(ctx context.Context, req OutboundRequest) (uuid.UUID, error) {
	channel := strings.TrimSpace(req.Channel)
	if channel != model.ChannelWhatsApp && channel != model.ChannelSMS {
		return uuid.Nil, fmt.Errorf("%w: unsupported channel %q", ErrInvalidRequest, channel)
	}
	if strings.TrimSpace(req.Phone) == "" || req.OrgID <= 0 {
		return uuid.Nil, fmt.Errorf("%w: org and phone are required", ErrInvalidRequest)
	}
	if channel == model.ChannelWhatsApp {
		on, err := s.ent.Enabled(ctx, req.OrgID, FeatureWhatsAppEnabled)
		if err != nil {
			return uuid.Nil, err
		}
		if !on {
			return uuid.Nil, entitlements.ErrFeatureDisabled
		}
		if _, err := s.ent.Check(ctx, req.OrgID, FeatureWhatsAppMonthly, 1); err != nil {
			return uuid.Nil, err
		}
	}
	att := req.Attachment
	if att != nil {
		cp := *att
		cp.FileName = SafeFileName(cp.FileName)
		att = &cp
	}
	if att != nil && att.ObjectKey == "" && len(att.Data) > 0 {
		if len(att.Data) > MaxAttachmentBytes {
			return uuid.Nil, fmt.Errorf("%w: attachment too large", ErrInvalidRequest)
		}
		if s.store != nil {
			key, err := UploadAttachment(ctx, s.store, req.OrgID, att.FileName, att.MimeType, att.Data)
			if err != nil {
				return uuid.Nil, err
			}
			att = &OutboundAttachment{ObjectKey: key, FileName: att.FileName, MimeType: att.MimeType}
		} else if s.enq != nil {
			return uuid.Nil, fmt.Errorf("%w: attachment bytes need object storage in queued mode", ErrInvalidRequest)
		}
	}
	var attJSON []byte
	if att != nil && att.ObjectKey != "" {
		attJSON, _ = json.Marshal(att)
	}
	var schedID pgtype.Int8
	if req.ScheduledNotificationID > 0 {
		schedID = pgtype.Int8{Int64: req.ScheduledNotificationID, Valid: true}
	}
	payload := []byte(`{}`)
	if len(req.Vars) > 0 {
		if b, err := json.Marshal(req.Vars); err == nil {
			payload = b
		}
	}
	row, err := s.q.InsertQueuedOutboundMessage(ctx, db.InsertQueuedOutboundMessageParams{
		OrganizationID: req.OrgID, EventType: req.EventType, Channel: channel,
		RecipientPhone: strings.TrimSpace(req.Phone), Payload: payload,
		SubjectType: req.SubjectType, SubjectUuid: toPgtypeUUID(req.SubjectUUID),
		Body: req.Body, Attachment: attJSON, ScheduledNotificationID: schedID,
	})
	if err != nil {
		return uuid.Nil, fmt.Errorf("QueueSend insert: %w", err)
	}
	if s.enq != nil {
		task, err := queue.NewMessagingSendTask(row.ID)
		if err != nil {
			return uuid.Nil, err
		}
		if _, err := s.enq.Enqueue(task, queue.MessagingSendOptions()...); err != nil {
			return uuid.Nil, fmt.Errorf("QueueSend enqueue: %w", err)
		}
		if channel == model.ChannelWhatsApp {
			_ = s.ent.Consume(ctx, req.OrgID, FeatureWhatsAppMonthly, 1)
		}
		return row.Uuid, nil
	}
	var inline []byte
	if att != nil && att.ObjectKey == "" {
		inline = att.Data
	}
	if err := s.processOutbound(ctx, row.ID, true, inline); err != nil {
		return row.Uuid, err
	}
	if channel == model.ChannelWhatsApp {
		_ = s.ent.Consume(ctx, req.OrgID, FeatureWhatsAppMonthly, 1)
	}
	return row.Uuid, nil
}

// ProcessOutbound delivers one queued row (asynq handler in the API process).
// Returns an error to trigger an asynq retry; on the final attempt the row is
// marked failed. Non-retryable send errors (configuration, template, Meta
// policy) fail the row at once and are wrapped in asynq.SkipRetry.
func (s *Service) ProcessOutbound(ctx context.Context, id int64, final bool) error {
	err := s.processOutboundObserved(ctx, id, final, nil, s.observer)
	if err != nil && !model.IsRetryable(err) {
		return fmt.Errorf("%w: %w", asynq.SkipRetry, err)
	}
	return err
}

func (s *Service) processOutbound(ctx context.Context, id int64, final bool, inlineData []byte) error {
	return s.processOutboundObserved(ctx, id, final, inlineData, nil)
}

func (s *Service) processOutboundObserved(ctx context.Context, id int64, final bool, inlineData []byte, observe OutboundObserver) error {
	row, err := s.q.ClaimOutboundMessage(ctx, id)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil // already sent / claimed by another delivery
	}
	if err != nil {
		return err
	}
	ctx = orgctx.WithScope(ctx, orgctx.Scope{InternalID: row.OrganizationID})
	res, sendErr := s.sendOutbound(ctx, row, inlineData)
	if sendErr != nil && !model.IsRetryable(sendErr) {
		final = true
	}
	params := db.FinishOutboundMessageParams{ID: row.ID}
	if sendErr == nil {
		params.Status = model.OutboundStatusSent
		params.ProviderReference = res.Ref
		params.SentAt = pgtype.Timestamptz{Time: time.Now().UTC(), Valid: true}
	} else {
		params.ErrorMessage = sendErr.Error()
		params.Status = model.OutboundStatusQueued
		if final {
			params.Status = model.OutboundStatusFailed
		}
	}
	if _, err := s.q.FinishOutboundMessage(ctx, params); err != nil {
		return fmt.Errorf("finish outbound: %w", err)
	}
	s.recordSender(ctx, row.ID, res, sendErr)
	if observe != nil && (sendErr == nil || final) {
		o := OutboundOutcome{
			OrgID: row.OrganizationID, EventType: row.EventType, Channel: row.Channel,
			SubjectType: row.SubjectType, Sent: sendErr == nil, Error: params.ErrorMessage,
		}
		if row.SubjectUuid.Valid {
			id := uuid.UUID(row.SubjectUuid.Bytes)
			o.SubjectUUID = &id
		}
		observe(ctx, o)
	}
	return sendErr
}

func (s *Service) sendOutbound(ctx context.Context, row db.OutboundMessage, inlineData []byte) (deliveryResult, error) {
	if row.Channel != model.ChannelWhatsApp {
		// SMS carries the text only.
		sender, ok := s.channels[row.Channel]
		if !ok {
			return deliveryResult{}, fmt.Errorf("%w: %s", ErrChannelUnavailable, row.Channel)
		}
		ref, err := sender.Send(ctx, row.RecipientPhone, row.Body)
		return deliveryResult{Ref: ref}, err
	}
	// Queued rows come from QueueSend, which checked and counted
	// whatsapp.monthly; the platform gate re-checks whatsapp.enabled.
	d := outboundDelivery{
		OrgID: row.OrganizationID, EventType: row.EventType, Phone: row.RecipientPhone, Body: row.Body,
		QuotaReserved: true,
	}
	_ = json.Unmarshal(row.Payload, &d.Vars)
	var att OutboundAttachment
	hasAtt := len(row.Attachment) > 0 && json.Unmarshal(row.Attachment, &att) == nil && att.ObjectKey != ""
	if hasAtt || len(inlineData) > 0 {
		data := inlineData
		if len(data) == 0 {
			b, err := s.downloadAttachment(ctx, att.ObjectKey)
			if err != nil {
				return deliveryResult{}, err
			}
			data = b
		}
		name := att.FileName
		if name == "" {
			name = "document.pdf"
		}
		d.Doc = &providers.Document{Data: data, FileName: name, MimeType: att.MimeType}
	}
	return s.deliverWhatsApp(ctx, d)
}

// ListOutbound returns the organization's outbound log (newest first).
func (s *Service) ListOutbound(ctx context.Context, orgID int64, limit, offset int32) ([]model.OutboundMessage, int64, error) {
	rows, err := s.q.ListOutboundMessagesByOrg(ctx, db.ListOutboundMessagesByOrgParams{
		OrganizationID: orgID, RowLimit: limit, RowOffset: offset,
	})
	if err != nil {
		return nil, 0, fmt.Errorf("ListOutbound: %w", err)
	}
	total, err := s.q.CountOutboundMessagesByOrg(ctx, orgID)
	if err != nil {
		return nil, 0, fmt.Errorf("ListOutbound count: %w", err)
	}
	out := make([]model.OutboundMessage, 0, len(rows))
	for _, r := range rows {
		out = append(out, mapOutbound(r))
	}
	return out, total, nil
}

func mapOutbound(r db.OutboundMessage) model.OutboundMessage {
	m := model.OutboundMessage{
		UUID: r.Uuid, EventType: r.EventType, Channel: r.Channel, RecipientPhone: r.RecipientPhone,
		Status: r.Status, ProviderReference: r.ProviderReference, ErrorMessage: r.ErrorMessage,
		SubjectType: r.SubjectType, SenderKind: r.SenderKind.String, TemplateName: r.TemplateName.String,
		DeliveryStatus: r.DeliveryStatus.String, ErrorCode: r.ErrorCode.String,
	}
	if r.SubjectUuid.Valid {
		id := uuid.UUID(r.SubjectUuid.Bytes)
		m.SubjectUUID = &id
	}
	if r.SentAt.Valid {
		t := r.SentAt.Time
		m.SentAt = &t
	}
	if r.DeliveryStatusAt.Valid {
		t := r.DeliveryStatusAt.Time
		m.DeliveryStatusAt = &t
	}
	if r.CreatedAt.Valid {
		m.CreatedAt = r.CreatedAt.Time
	}
	return m
}

func (s *Service) downloadAttachment(ctx context.Context, key string) ([]byte, error) {
	if s.store == nil {
		return nil, fmt.Errorf("attachment storage not configured")
	}
	rc, _, err := s.store.Download(ctx, key)
	if err != nil {
		return nil, fmt.Errorf("attachment download: %w", err)
	}
	defer func() { _ = rc.Close() }()
	data, err := io.ReadAll(io.LimitReader(rc, MaxAttachmentBytes+1))
	if err != nil {
		return nil, fmt.Errorf("attachment read: %w", err)
	}
	if len(data) > MaxAttachmentBytes {
		return nil, fmt.Errorf("attachment too large")
	}
	return data, nil
}

// UploadAttachment stores bytes under an org-scoped key and returns it.
func UploadAttachment(ctx context.Context, store storage.Driver, orgID int64, fileName, mime string, data []byte) (string, error) {
	name := SafeFileName(fileName)
	key := fmt.Sprintf("notifications/attachments/%d/%s/%s", orgID, uuid.NewString(), name)
	if mime == "" {
		mime = "application/octet-stream"
	}
	if err := store.Upload(ctx, storage.File{
		Body: bytes.NewReader(data), Size: int64(len(data)), ContentType: mime, Filename: name,
	}, key); err != nil {
		return "", fmt.Errorf("attachment upload: %w", err)
	}
	return key, nil
}

// SafeFileName strips directories from a client/module supplied file name.
func SafeFileName(fileName string) string {
	name := path.Base(strings.ReplaceAll(strings.TrimSpace(fileName), "\\", "/"))
	if name == "" || name == "." || name == "/" || name == ".." {
		return "document"
	}
	return name
}
