package catalog

import (
	"context"
	"fmt"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database/db"
)

// SeedStore is the persistence surface used by Seed.
type SeedStore interface {
	EnsureWhatsAppCloudTemplate(ctx context.Context, arg db.EnsureWhatsAppCloudTemplateParams) (db.WhatsappCloudTemplate, error)
}

// Seed upserts one whatsapp_cloud_templates row per catalog entry (boot).
// Meta state (status, ids, rejection) and the admin override are kept.
func Seed(ctx context.Context, q SeedStore) error {
	for _, e := range All() {
		if _, err := q.EnsureWhatsAppCloudTemplate(ctx, db.EnsureWhatsAppCloudTemplateParams{
			Key: e.Key, MetaName: e.MetaName, Language: e.Language, Category: e.Category,
		}); err != nil {
			return fmt.Errorf("seed whatsapp template %s: %w", e.Key, err)
		}
	}
	return nil
}
