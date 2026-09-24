package usecase

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database/db"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

func mapConversation(c db.AiConversation) Conversation {
	out := Conversation{
		UUID: c.Uuid, Title: c.Title, MessageCount: c.MessageCount,
		CreatedAt: c.CreatedAt.Time, UpdatedAt: c.UpdatedAt.Time,
	}
	if c.LastMessageAt.Valid {
		t := c.LastMessageAt.Time
		out.LastMessageAt = &t
	}
	return out
}

func mapMessage(m db.AiMessage) MessageView {
	blocks := json.RawMessage(m.Ui)
	if len(blocks) == 0 || !json.Valid(blocks) {
		blocks = json.RawMessage("[]")
	}
	return MessageView{UUID: m.Uuid, Role: m.Role, Status: m.Status, Blocks: blocks, CreatedAt: m.CreatedAt.Time}
}

// ListConversations lists the current user's conversations in this organization.
func (s *Service) ListConversations(ctx context.Context, limit, offset int32, q string) ([]Conversation, int64, error) {
	p, scope, err := principalScope(ctx)
	if err != nil {
		return nil, 0, err
	}
	var qText pgtype.Text
	if t := strings.TrimSpace(q); t != "" {
		qText = pgtype.Text{String: t, Valid: true}
	}
	rows, err := s.store.ListAIConversations(ctx, db.ListAIConversationsParams{
		OrganizationID: scope.InternalID, UserID: p.UserInternal, Q: qText, LimitCount: limit, OffsetCount: offset,
	})
	if err != nil {
		return nil, 0, err
	}
	total, err := s.store.CountAIConversations(ctx, db.CountAIConversationsParams{
		OrganizationID: scope.InternalID, UserID: p.UserInternal, Q: qText,
	})
	if err != nil {
		return nil, 0, err
	}
	out := make([]Conversation, 0, len(rows))
	for _, r := range rows {
		out = append(out, mapConversation(r))
	}
	return out, total, nil
}

// CreateConversation starts a new conversation.
func (s *Service) CreateConversation(ctx context.Context, title string) (Conversation, error) {
	p, scope, err := principalScope(ctx)
	if err != nil {
		return Conversation{}, err
	}
	title = strings.TrimSpace(title)
	if len([]rune(title)) > 200 {
		return Conversation{}, invalid("title is too long (max 200)")
	}
	count, err := s.store.CountAIConversations(ctx, db.CountAIConversationsParams{
		OrganizationID: scope.InternalID, UserID: p.UserInternal,
	})
	if err != nil {
		return Conversation{}, err
	}
	if count >= MaxConversationsPerUser {
		return Conversation{}, fmt.Errorf("%w: at most %d conversations; delete old ones first", ErrConversationLimit, MaxConversationsPerUser)
	}
	row, err := s.store.CreateAIConversation(ctx, db.CreateAIConversationParams{
		OrganizationID: scope.InternalID, UserID: p.UserInternal, Title: title,
	})
	if err != nil {
		return Conversation{}, err
	}
	return mapConversation(row), nil
}

func (s *Service) loadConversation(ctx context.Context, id uuid.UUID) (db.AiConversation, error) {
	p, scope, err := principalScope(ctx)
	if err != nil {
		return db.AiConversation{}, err
	}
	row, err := s.store.GetAIConversation(ctx, db.GetAIConversationParams{
		Uuid: id, OrganizationID: scope.InternalID, UserID: p.UserInternal,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return db.AiConversation{}, ErrNotFound
	}
	return row, err
}

// GetConversation returns a conversation with its UI messages.
func (s *Service) GetConversation(ctx context.Context, id uuid.UUID) (ConversationDetail, error) {
	conv, err := s.loadConversation(ctx, id)
	if err != nil {
		return ConversationDetail{}, err
	}
	// Confirm cards past their expiry resolve as "not executed"; actions left
	// "executing" by a crashed server resolve as "outcome unknown".
	s.expireActions(ctx, conv, false)
	s.recoverStaleActions(ctx, &conv.ID)
	msgs, err := s.store.ListAIMessages(ctx, conv.ID)
	if err != nil {
		return ConversationDetail{}, err
	}
	out := ConversationDetail{Conversation: mapConversation(conv), Messages: make([]MessageView, 0, len(msgs))}
	for _, m := range msgs {
		out.Messages = append(out.Messages, mapMessage(m))
	}
	return out, nil
}

// RenameConversation sets the title.
func (s *Service) RenameConversation(ctx context.Context, id uuid.UUID, title string) (Conversation, error) {
	title = strings.TrimSpace(title)
	if title == "" {
		return Conversation{}, invalid("title is required")
	}
	if len([]rune(title)) > 200 {
		return Conversation{}, invalid("title is too long (max 200)")
	}
	conv, err := s.loadConversation(ctx, id)
	if err != nil {
		return Conversation{}, err
	}
	row, err := s.store.UpdateAIConversationTitle(ctx, db.UpdateAIConversationTitleParams{ID: conv.ID, Title: title})
	if err != nil {
		return Conversation{}, err
	}
	return mapConversation(row), nil
}

// DeleteConversation soft-deletes a conversation.
func (s *Service) DeleteConversation(ctx context.Context, id uuid.UUID) error {
	conv, err := s.loadConversation(ctx, id)
	if err != nil {
		return err
	}
	return s.store.SoftDeleteAIConversation(ctx, conv.ID)
}
