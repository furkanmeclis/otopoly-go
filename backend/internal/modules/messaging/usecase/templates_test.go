package usecase_test

import (
	"context"
	"errors"
	"os"
	"strings"
	"testing"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database/db"
	messagingusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/messaging/usecase"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

func TestTemplateOverridesAndDefaults_DB(t *testing.T) {
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
	slug := "tpl-" + strings.ReplaceAll(uuid.NewString(), "-", "")[:12]
	if err := pool.QueryRow(ctx, `INSERT INTO organizations (slug, name) VALUES ($1,'Tpl') RETURNING id`, slug).Scan(&orgID); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _, _ = pool.Exec(context.Background(), `DELETE FROM organizations WHERE id=$1`, orgID) })
	svc := messagingusecase.New(db.New(pool), nil, nil)

	// System defaults for both locales.
	en, ok, err := svc.ResolveTemplate(ctx, orgID, "quote.sent", "whatsapp", "en")
	if err != nil || !ok || en.Custom || !strings.Contains(en.Body, "{{quote_number}}") || !strings.HasPrefix(en.Body, "Dear") {
		t.Fatalf("en default = %+v %v", en, err)
	}

	// Unknown placeholders are rejected with details.
	_, err = svc.SaveTemplate(ctx, orgID, "quote.sent", "whatsapp", "tr", messagingusecase.SaveTemplateInput{Body: "Merhaba {{musteri}}"})
	var verr *messagingusecase.ValidationError
	if !errors.As(err, &verr) || len(verr.Unknown) != 1 || verr.Unknown[0] != "musteri" || !errors.Is(err, messagingusecase.ErrInvalidRequest) {
		t.Fatalf("validation err = %v", err)
	}
	// Unsupported channel for the type.
	if _, err := svc.SaveTemplate(ctx, orgID, "job.created", "email", "tr", messagingusecase.SaveTemplateInput{Body: "x"}); !errors.Is(err, messagingusecase.ErrInvalidRequest) {
		t.Fatalf("channel err = %v", err)
	}

	inactive := false
	if _, err := svc.SaveTemplate(ctx, orgID, "quote.sent", "whatsapp", "tr", messagingusecase.SaveTemplateInput{
		Subject: "Teklif", Body: "Sayın {{customer_name}}, teklif {{quote_number}}", IsActive: &inactive,
	}); err != nil {
		t.Fatal(err)
	}
	tr, _, _ := svc.ResolveTemplate(ctx, orgID, "quote.sent", "whatsapp", "tr")
	if !tr.Custom || tr.Active || tr.Body != "Sayın {{customer_name}}, teklif {{quote_number}}" {
		t.Fatalf("override = %+v", tr)
	}
	cat, err := svc.TemplateCatalog(ctx, orgID)
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, typ := range cat {
		if typ.Type != "quote.sent" {
			continue
		}
		if len(typ.Placeholders) == 0 || len(typ.Templates) != len(typ.Channels)*2 {
			t.Fatalf("catalog entry = %+v", typ)
		}
		for _, e := range typ.Templates {
			if e.Channel == "whatsapp" && e.Locale == "tr" {
				found = e.IsCustom && !e.IsActive && e.DefaultBody != e.Body
			}
		}
	}
	if !found {
		t.Fatal("override missing from catalog")
	}
	reset, err := svc.ResetTemplate(ctx, orgID, "quote.sent", "whatsapp", "tr")
	if err != nil || reset.IsCustom || reset.Body != reset.DefaultBody || reset.Body == "" {
		t.Fatalf("reset = %+v %v", reset, err)
	}
	tr, _, _ = svc.ResolveTemplate(ctx, orgID, "quote.sent", "whatsapp", "tr")
	if tr.Custom || !tr.Active {
		t.Fatalf("after reset = %+v", tr)
	}
}
