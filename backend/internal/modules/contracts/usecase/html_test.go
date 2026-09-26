package usecase

import (
	"strings"
	"testing"
	"time"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/i18n"
)

func TestBuildContractHTMLWhitePaperLogoAndPhotoOrder(t *testing.T) {
	doc := buildContractHTML(contractPDFOptions{
		Title:         "Araç Kabul Sözleşmesi",
		ContentHTML:   "<p>Metin</p>",
		OrgName:       "Tek Oto",
		OrgLogoBase64: "iVBORw0KGgo=",
		OrgLogoMIME:   "image/png",
		PrimaryColor:  "#E8704A",
		Locale:        i18n.LocaleTR,
		CreatedAt:     time.Date(2026, 9, 26, 0, 0, 0, 0, time.UTC),
		Signatures:    []signatureEmbed{{Label: "Müşteri"}},
		Media:         []mediaEmbed{{FileName: "on.jpg", ContentType: "image/jpeg", DataBase64: "AAAA"}},
	})

	if strings.Contains(strings.ToUpper(doc), "#FFFCF8") {
		t.Fatal("contract PDF still uses the cream paper background")
	}
	if !strings.Contains(doc, "background:#FFFFFF") {
		t.Fatal("expected white paper background")
	}
	if !strings.Contains(doc, `class="logo"`) || strings.Contains(doc, `<div class="mark">`) {
		t.Fatal("expected org logo instead of the initial mark")
	}
	photos := strings.Index(doc, `class="media-grid"`)
	sigs := strings.Index(doc, `class="sig-grid"`)
	if photos < 0 || sigs < 0 || photos > sigs {
		t.Fatalf("photos should render before signatures (photos=%d sigs=%d)", photos, sigs)
	}
}

func TestBuildContractHTMLFallsBackToInitialMark(t *testing.T) {
	doc := buildContractHTML(contractPDFOptions{Title: "X", OrgName: "Tek Oto", Locale: i18n.LocaleTR})
	if !strings.Contains(doc, `<div class="mark">T</div>`) {
		t.Fatal("expected initial mark when no logo is configured")
	}
}
