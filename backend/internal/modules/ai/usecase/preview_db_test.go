package usecase

import (
	"context"
	"testing"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database/db"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database/dbtest"
)

// TouchAIConversation stores the preview and keeps the previous one when a
// turn has no text.
func TestTouchConversationPreviewDB(t *testing.T) {
	fx := dbtest.NewFixtures(t)
	ctx := context.Background()
	q := db.New(fx.Pool)
	org, user := fx.Organization(), fx.User()
	conv, err := q.CreateAIConversation(ctx, db.CreateAIConversationParams{OrganizationID: org.ID, UserID: user.ID})
	if err != nil {
		t.Fatal(err)
	}
	if conv.LastMessagePreview != "" || conv.LastMessageAt.Valid {
		t.Fatalf("new conversation: %+v", conv)
	}
	for _, p := range []string{"Merhaba", ""} {
		if err := q.TouchAIConversation(ctx, db.TouchAIConversationParams{ID: conv.ID, Added: 1, Preview: p}); err != nil {
			t.Fatal(err)
		}
	}
	rows, err := q.ListAIConversations(ctx, db.ListAIConversationsParams{OrganizationID: org.ID, UserID: user.ID, LimitCount: 10})
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) != 1 || rows[0].LastMessagePreview != "Merhaba" || rows[0].MessageCount != 2 || !rows[0].LastMessageAt.Valid {
		t.Fatalf("rows: %+v", rows)
	}
}
