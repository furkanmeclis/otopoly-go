package usecase

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"io"
	"math/big"
	"net/http"
	"strings"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database/db"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/storage"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
)

const maxLogoBytes = 2 << 20

func orgAddress(org db.Organization) string {
	parts := make([]string, 0, 3)
	for _, p := range []string{org.Address, org.District, org.City} {
		if s := strings.TrimSpace(p); s != "" {
			parts = append(parts, s)
		}
	}
	return strings.Join(parts, ", ")
}

func (s *Service) logoDataURI(ctx context.Context, org db.Organization) string {
	if s.storage == nil || !org.LogoObjectKey.Valid || strings.TrimSpace(org.LogoObjectKey.String) == "" {
		return ""
	}
	rc, _, err := s.storage.Download(ctx, org.LogoObjectKey.String)
	if err != nil {
		return ""
	}
	defer func() { _ = rc.Close() }()
	data, err := io.ReadAll(io.LimitReader(rc, maxLogoBytes+1))
	if err != nil || len(data) == 0 || len(data) > maxLogoBytes {
		return ""
	}
	ct := http.DetectContentType(data)
	if strings.HasPrefix(ct, "text/xml") || strings.HasPrefix(ct, "text/plain") {
		// SVG sniffs as text; only allow it when it clearly is one.
		if bytes.Contains(data[:min(len(data), 512)], []byte("<svg")) {
			ct = "image/svg+xml"
		}
	}
	if !strings.HasPrefix(ct, "image/") {
		return ""
	}
	return "data:" + ct + ";base64," + base64.StdEncoding.EncodeToString(data)
}

// buildDoc gathers everything printed on the quote.
func (s *Service) buildDoc(ctx context.Context, row db.Quote) (pdfDoc, error) {
	org, err := s.q.GetOrganizationByID(ctx, row.OrganizationID)
	if err != nil {
		return pdfDoc{}, err
	}
	refs, err := s.q.GetQuoteRefs(ctx, row.ID)
	if err != nil {
		return pdfDoc{}, err
	}
	lines, err := s.q.ListQuoteLines(ctx, row.ID)
	if err != nil {
		return pdfDoc{}, err
	}
	d := pdfDoc{
		Number: row.Number, Status: row.Status, IssuedAt: row.CreatedAt.Time.In(s.loc),
		OrgName: org.Name, OrgAddress: orgAddress(org), OrgPhone: org.Phone, OrgEmail: org.Email,
		OrgWebsite: org.Website, OrgTagline: org.Tagline, OrgFooter: org.FooterText,
		PrimaryColor: org.PrimaryColor, LogoDataURI: s.logoDataURI(ctx, org),
		CustomerName: refs.CustomerName, CustomerPhone: refs.CustomerPhone, CustomerEmail: refs.CustomerEmail,
		CustomerTaxID: refs.CustomerTaxID, CustomerTaxOff: refs.CustomerTaxOffice,
		VehiclePlate: row.VehiclePlate, VehicleLabel: row.VehicleLabel,
		Currency: row.Currency, PricesIncludeVAT: row.PricesIncludeVat,
		Subtotal: money(row.Subtotal), DiscountTotal: money(row.DiscountTotal),
		VATTotal: money(row.VatTotal), GrandTotal: money(row.GrandTotal),
		Notes: row.Notes, Terms: row.Terms, ShareURL: s.ShareURL(row.ShareToken),
	}
	if row.ValidUntil.Valid {
		v := row.ValidUntil.Time
		d.ValidUntil = &v
	}
	for _, l := range lines {
		disc := new(big.Rat).Add(ratFromNumeric(l.LineDiscount), ratFromNumeric(l.QuoteDiscountShare))
		d.Lines = append(d.Lines, pdfLine{
			Description: l.Description, Quantity: numStr(l.Quantity), Unit: l.Unit,
			UnitPrice: money(l.UnitPrice), Discount: disc.FloatString(2), VATRate: numStr(l.VatRate),
			Total: money(l.LineTotal),
		})
	}
	return d, nil
}

// QuoteHTML renders the printable HTML for a quote (also used by tests).
func (s *Service) QuoteHTML(ctx context.Context, row db.Quote) (string, error) {
	d, err := s.buildDoc(ctx, row)
	if err != nil {
		return "", err
	}
	return buildQuoteHTML(d), nil
}

func pdfObjectKey(orgUUID, quoteUUID uuid.UUID, sha string) string {
	return fmt.Sprintf("quotes/%s/%s/%s.pdf", orgUUID.String(), quoteUUID.String(), sha[:16])
}

// ensurePDF returns the quote PDF, re-rendering only when the printed
// content changed (sha256 of the HTML). The document is stored through the
// storage driver under an API-owned key.
func (s *Service) ensurePDF(ctx context.Context, row db.Quote) ([]byte, string, error) {
	htmlDoc, err := s.QuoteHTML(ctx, row)
	if err != nil {
		return nil, "", err
	}
	sum := sha256.Sum256([]byte(htmlDoc))
	sha := hex.EncodeToString(sum[:])
	if s.storage != nil && row.PdfSha256 == sha && row.PdfObjectKey.Valid && row.PdfObjectKey.String != "" {
		if rc, _, err := s.storage.Download(ctx, row.PdfObjectKey.String); err == nil {
			data, rerr := io.ReadAll(rc)
			_ = rc.Close()
			if rerr == nil && len(data) > 0 {
				return data, row.PdfObjectKey.String, nil
			}
		}
	}
	if s.pdf == nil {
		return nil, "", ErrPDFUnavailable
	}
	data, err := s.pdf.HTMLToPDF(ctx, htmlDoc)
	if err != nil {
		return nil, "", fmt.Errorf("%w: %v", ErrPDFUnavailable, err)
	}
	key := ""
	if s.storage != nil {
		org, err := s.q.GetOrganizationByID(ctx, row.OrganizationID)
		if err == nil {
			key = pdfObjectKey(org.Uuid, row.Uuid, sha)
			if uerr := s.storage.Upload(ctx, storage.File{
				Body: bytes.NewReader(data), Size: int64(len(data)), ContentType: "application/pdf",
				Filename: row.Number + ".pdf",
			}, key); uerr != nil {
				s.log.Warn("quote_pdf_store_failed", "quote", row.Uuid, "error", uerr)
				key = ""
			} else {
				if row.PdfObjectKey.Valid && row.PdfObjectKey.String != "" && row.PdfObjectKey.String != key {
					_ = s.storage.Delete(ctx, row.PdfObjectKey.String)
				}
				_ = s.q.SetQuotePDF(ctx, db.SetQuotePDFParams{
					PdfObjectKey: textOf(key), PdfSha256: sha, ID: row.ID,
				})
			}
		}
	}
	return data, key, nil
}

// PDF returns the quote PDF for the tenant (download / preview).
func (s *Service) PDF(ctx context.Context, id uuid.UUID) ([]byte, string, error) {
	scope, err := s.requireOrg(ctx)
	if err != nil {
		return nil, "", err
	}
	row, err := s.q.GetQuoteRowByUUID(ctx, db.GetQuoteRowByUUIDParams{Uuid: id, OrganizationID: scope.InternalID})
	if err != nil {
		if isNoRows(err) {
			return nil, "", ErrNotFound
		}
		return nil, "", err
	}
	data, _, err := s.ensurePDF(ctx, row)
	if err != nil {
		return nil, "", err
	}
	return data, row.Number + ".pdf", nil
}

func textOf(v string) pgtype.Text { return pgtype.Text{String: v, Valid: v != ""} }
