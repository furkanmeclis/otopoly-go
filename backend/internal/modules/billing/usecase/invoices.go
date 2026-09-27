package usecase

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"regexp"
	"strings"
	"time"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database/db"
	billinginvoice "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/billing/invoice"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/orgctx"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/storage"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

const maxXSLTBytes int64 = 2 << 20

type invoiceArtifacts struct {
	buyer        billinginvoice.Party
	seller       billinginvoice.Party
	lines        []billinginvoice.Line
	totals       billinginvoice.Totals
	xmlKey       string
	pdfKey       string
	xsltVersion  string
	pdfErrorNote string
}

func (s *Service) IssueInvoice(ctx context.Context, orderID int64) (*Invoice, error) {
	if existing, err := s.q.GetInvoiceByOrder(ctx, orderID); err == nil {
		out := mapInvoiceAdmin(invoiceJoined{
			row: invoiceFromOrderRow(existing), orderUUID: existing.OrderUuid, orderReference: existing.OrderReference,
			orgUUID: existing.OrganizationUuid, orgSlug: existing.OrganizationSlug, orgName: existing.OrganizationName, includeOrg: true,
		})
		return &out, nil
	} else if !errors.Is(err, pgx.ErrNoRows) {
		return nil, err
	}
	order, err := s.q.GetOrderForInvoice(ctx, orderID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	if order.Status != "approved" {
		return nil, ErrOrderState
	}
	if numericString(order.Total) == "0.00" {
		return nil, nil
	}
	settings, err := s.q.GetSellerSettings(ctx)
	if err != nil {
		return nil, err
	}
	year := order.ReviewedAt.Time.Year()
	if year == 0 {
		year = time.Now().Year()
	}
	series := invoiceSeries(settings.InvoiceSeries)
	seq, err := s.q.NextInvoiceNumber(ctx, db.NextInvoiceNumberParams{Series: series, Year: int32(year)})
	if err != nil {
		return nil, err
	}
	number := fmt.Sprintf("%s%d%09d", series, year, seq)
	invUUID := uuid.New()
	art, err := s.buildInvoiceArtifacts(ctx, order, settings, invUUID, number)
	status := "issued"
	errMsg := ""
	if err != nil {
		status = "failed"
		errMsg = err.Error()
	}
	if art.pdfErrorNote != "" {
		errMsg = art.pdfErrorNote
	}
	buyerJSON, _ := json.Marshal(art.buyer)
	sellerJSON, _ := json.Marshal(art.seller)
	linesJSON, _ := json.Marshal(art.lines)
	row, createErr := s.q.CreateInvoice(ctx, db.CreateInvoiceParams{
		Uuid: invUUID, OrganizationID: order.OrganizationID, OrderID: order.ID, Number: number,
		IssueDate: pgDate(time.Now()), Profile: "EARSIVFATURA", Type: "SATIS",
		Buyer: buyerJSON, Seller: sellerJSON, Lines: linesJSON,
		Subtotal: mustNumeric(art.totals.Subtotal), DiscountTotal: mustNumeric(art.totals.DiscountTotal),
		VatTotal: mustNumeric(art.totals.VATTotal), GrandTotal: mustNumeric(art.totals.GrandTotal),
		XmlObjectKey: art.xmlKey, PdfObjectKey: art.pdfKey, XsltVersion: art.xsltVersion, Status: status, Error: errMsg,
	})
	if createErr != nil {
		return nil, createErr
	}
	out := mapInvoiceAdmin(invoiceJoined{
		row: row, orderUUID: order.Uuid, orderReference: order.ReferenceCode,
		orgUUID: order.OrganizationUuid, orgSlug: order.OrganizationSlug, orgName: order.OrganizationName, includeOrg: true,
	})
	return &out, nil
}

func (s *Service) buildInvoiceArtifacts(ctx context.Context, order db.GetOrderForInvoiceRow, settings db.GetSellerSettingsRow, invUUID uuid.UUID, number string) (invoiceArtifacts, error) {
	var quoteLines []QuoteLine
	if len(order.Lines) > 0 {
		_ = json.Unmarshal(order.Lines, &quoteLines)
	}
	lines := make([]billinginvoice.Line, 0, len(quoteLines))
	for _, l := range quoteLines {
		lines = append(lines, billinginvoice.Line{Kind: l.Kind, Label: l.Label, Amount: l.Amount})
	}
	seller := billinginvoice.Party{
		Name: settings.SellerName, TaxID: settings.SellerTaxID, TaxOffice: settings.SellerTaxOffice,
		Address: settings.SellerAddress, City: settings.SellerCity, Email: settings.SellerEmail,
		Phone: settings.SellerPhone, Website: settings.SellerWebsite,
	}
	buyer := billinginvoice.BuyerFromProfile(order.OrganizationName, order.OrganizationAddress, order.OrganizationCity, billinginvoice.Profile{
		Name: order.InvoiceName, TaxID: order.InvoiceTaxID, TaxOffice: order.InvoiceTaxOffice,
		Address: order.InvoiceAddress, City: order.InvoiceCity, Email: order.InvoiceEmail,
	})
	xslt, version, err := s.currentXSLT(ctx, settings)
	if err != nil {
		return invoiceArtifacts{buyer: buyer, seller: seller, lines: lines}, err
	}
	xmlBytes, totals, err := billinginvoice.Build(billinginvoice.Input{
		UUID: invUUID.String(), Number: number, IssueAt: time.Now(), Seller: seller, Buyer: buyer,
		Lines: lines, VATRate: int(order.VatRate), OrderRef: order.ReferenceCode, XSLT: xslt,
	})
	art := invoiceArtifacts{buyer: buyer, seller: seller, lines: lines, totals: totals, xsltVersion: version}
	if err != nil {
		return art, err
	}
	if s.store == nil {
		return art, fmt.Errorf("%w: storage is not configured", ErrInvalidRequest)
	}
	year := time.Now().Year()
	xmlKey := fmt.Sprintf("billing/invoices/%d/%s.xml", year, number)
	if err := s.store.Upload(ctx, storage.File{
		Body: bytes.NewReader(xmlBytes), Size: int64(len(xmlBytes)), ContentType: "application/xml", Filename: number + ".xml",
	}, xmlKey); err != nil {
		return art, err
	}
	art.xmlKey = xmlKey
	html, err := billinginvoice.RenderHTML(ctx, xmlBytes, xslt)
	if err != nil {
		art.pdfErrorNote = "PDF render failed: " + err.Error()
		return art, nil
	}
	if s.pdf == nil {
		return art, nil
	}
	pdf, err := s.pdf.HTMLToPDF(ctx, string(html))
	if err != nil {
		art.pdfErrorNote = "PDF render failed: " + err.Error()
		return art, nil
	}
	pdfKey := fmt.Sprintf("billing/invoices/%d/%s.pdf", year, number)
	if err := s.store.Upload(ctx, storage.File{
		Body: bytes.NewReader(pdf), Size: int64(len(pdf)), ContentType: "application/pdf", Filename: number + ".pdf",
	}, pdfKey); err != nil {
		art.pdfErrorNote = "PDF store failed: " + err.Error()
		return art, nil
	}
	art.pdfKey = pdfKey
	return art, nil
}

func (s *Service) RegenerateInvoice(ctx context.Context, id uuid.UUID) (Invoice, error) {
	row, err := s.q.GetInvoiceByUUID(ctx, id)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Invoice{}, ErrNotFound
		}
		return Invoice{}, err
	}
	if row.Status == "voided" {
		return Invoice{}, ErrInvoiceState
	}
	if row.XmlObjectKey == "" {
		order, err := s.q.GetOrderForInvoice(ctx, row.OrderID)
		if err != nil {
			return Invoice{}, err
		}
		settings, err := s.q.GetSellerSettings(ctx)
		if err != nil {
			return Invoice{}, err
		}
		art, err := s.buildInvoiceArtifacts(ctx, order, settings, row.Uuid, row.Number)
		status := "issued"
		errMsg := art.pdfErrorNote
		if err != nil {
			status = "failed"
			errMsg = err.Error()
		}
		updated, err := s.q.UpdateInvoiceFiles(ctx, db.UpdateInvoiceFilesParams{
			XmlObjectKey: art.xmlKey, PdfObjectKey: art.pdfKey, XsltVersion: art.xsltVersion,
			Status: status, Error: errMsg, Uuid: row.Uuid,
		})
		if err != nil {
			return Invoice{}, err
		}
		return mapInvoiceAdmin(invoiceJoined{row: updated, orderUUID: row.OrderUuid, orderReference: row.OrderReference, orgUUID: row.OrganizationUuid, orgSlug: row.OrganizationSlug, orgName: row.OrganizationName, includeOrg: true}), nil
	}
	if s.store == nil {
		return Invoice{}, fmt.Errorf("%w: storage is not configured", ErrInvalidRequest)
	}
	body, _, err := s.store.Download(ctx, row.XmlObjectKey)
	if err != nil {
		return Invoice{}, ErrNotFound
	}
	xmlBytes, err := io.ReadAll(body)
	_ = body.Close()
	if err != nil {
		return Invoice{}, err
	}
	settings, err := s.q.GetSellerSettings(ctx)
	if err != nil {
		return Invoice{}, err
	}
	xslt, version, err := s.currentXSLT(ctx, settings)
	if err != nil {
		return Invoice{}, err
	}
	html, err := billinginvoice.RenderHTML(ctx, xmlBytes, xslt)
	if err != nil {
		return Invoice{}, fmt.Errorf("%w: %v", ErrXSLTInvalid, err)
	}
	if s.pdf == nil {
		return mapInvoiceAdmin(invoiceJoined{row: invoiceFromUUIDRow(row), orderUUID: row.OrderUuid, orderReference: row.OrderReference, orgUUID: row.OrganizationUuid, orgSlug: row.OrganizationSlug, orgName: row.OrganizationName, includeOrg: true}), nil
	}
	pdf, err := s.pdf.HTMLToPDF(ctx, string(html))
	if err != nil {
		return Invoice{}, err
	}
	key := fmt.Sprintf("billing/invoices/%d/%s.pdf", time.Now().Year(), row.Number)
	if err := s.store.Upload(ctx, storage.File{Body: bytes.NewReader(pdf), Size: int64(len(pdf)), ContentType: "application/pdf", Filename: row.Number + ".pdf"}, key); err != nil {
		return Invoice{}, err
	}
	updated, err := s.q.UpdateInvoiceFiles(ctx, db.UpdateInvoiceFilesParams{
		XmlObjectKey: row.XmlObjectKey, PdfObjectKey: key, XsltVersion: version, Status: "issued", Error: "", Uuid: row.Uuid,
	})
	if err != nil {
		return Invoice{}, err
	}
	return mapInvoiceAdmin(invoiceJoined{row: updated, orderUUID: row.OrderUuid, orderReference: row.OrderReference, orgUUID: row.OrganizationUuid, orgSlug: row.OrganizationSlug, orgName: row.OrganizationName, includeOrg: true}), nil
}

func (s *Service) VoidInvoice(ctx context.Context, id uuid.UUID) (Invoice, error) {
	row, err := s.q.GetInvoiceByUUID(ctx, id)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Invoice{}, ErrNotFound
		}
		return Invoice{}, err
	}
	if row.Status == "voided" {
		return Invoice{}, ErrInvoiceState
	}
	updated, err := s.q.SetInvoiceStatus(ctx, db.SetInvoiceStatusParams{
		Status: "voided", Error: row.Error, VoidedAt: pgTimeValue(time.Now()), VoidedBy: currentUserID(ctx), Uuid: id,
	})
	if err != nil {
		return Invoice{}, err
	}
	return mapInvoiceAdmin(invoiceJoined{row: updated, orderUUID: row.OrderUuid, orderReference: row.OrderReference, orgUUID: row.OrganizationUuid, orgSlug: row.OrganizationSlug, orgName: row.OrganizationName, includeOrg: true}), nil
}

func (s *Service) IssueInvoiceForOrderUUID(ctx context.Context, id uuid.UUID) (*Invoice, error) {
	order, err := s.q.GetOrderByUUID(ctx, id)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	return s.IssueInvoice(ctx, order.ID)
}

func (s *Service) ListInvoicesForOrg(ctx context.Context, limit, offset int32) (InvoiceList, error) {
	scope := orgctx.MustScope(ctx)
	limit, offset = normalizeLimitOffset(limit, offset)
	rows, err := s.q.ListInvoicesForOrg(ctx, db.ListInvoicesForOrgParams{OrganizationID: scope.InternalID, Limit: limit, Offset: offset})
	if err != nil {
		return InvoiceList{}, err
	}
	total, err := s.q.CountInvoicesForOrg(ctx, scope.InternalID)
	if err != nil {
		return InvoiceList{}, err
	}
	items := make([]Invoice, 0, len(rows))
	for _, row := range rows {
		items = append(items, mapInvoiceOrg(row))
	}
	return InvoiceList{Items: items, Total: total, Limit: limit, Offset: offset}, nil
}

func (s *Service) ListInvoicesAdmin(ctx context.Context, status, q string, limit, offset int32) (InvoiceList, error) {
	limit, offset = normalizeLimitOffset(limit, offset)
	status = strings.TrimSpace(status)
	if status == "all" {
		status = ""
	}
	rows, err := s.q.ListInvoices(ctx, db.ListInvoicesParams{Status: status, Q: strings.TrimSpace(q), Limit: limit, Offset: offset})
	if err != nil {
		return InvoiceList{}, err
	}
	total, err := s.q.CountInvoices(ctx, db.CountInvoicesParams{Status: status, Q: strings.TrimSpace(q)})
	if err != nil {
		return InvoiceList{}, err
	}
	items := make([]Invoice, 0, len(rows))
	for _, row := range rows {
		items = append(items, mapInvoiceList(row))
	}
	return InvoiceList{Items: items, Total: total, Limit: limit, Offset: offset}, nil
}

func (s *Service) OpenInvoiceFile(ctx context.Context, id uuid.UUID, kind string, platform bool) (io.ReadCloser, string, string, int64, error) {
	var key, number string
	if platform {
		row, err := s.q.GetInvoiceByUUID(ctx, id)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return nil, "", "", 0, ErrNotFound
			}
			return nil, "", "", 0, err
		}
		key, number = invoiceKey(row.XmlObjectKey, row.PdfObjectKey, kind), row.Number
	} else {
		scope := orgctx.MustScope(ctx)
		row, err := s.q.GetInvoiceByUUIDForOrg(ctx, db.GetInvoiceByUUIDForOrgParams{Uuid: id, OrganizationID: scope.InternalID})
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return nil, "", "", 0, ErrNotFound
			}
			return nil, "", "", 0, err
		}
		key, number = invoiceKey(row.XmlObjectKey, row.PdfObjectKey, kind), row.Number
	}
	if key == "" || s.store == nil {
		return nil, "", "", 0, ErrNotFound
	}
	body, size, err := s.store.Download(ctx, key)
	if err != nil {
		return nil, "", "", 0, ErrNotFound
	}
	ctype := "application/pdf"
	ext := "pdf"
	if kind == "xml" {
		ctype, ext = "application/xml", "xml"
	}
	return body, ctype, number + "." + ext, size, nil
}

func (s *Service) GetInvoiceProfile(ctx context.Context) (InvoiceProfile, error) {
	scope := orgctx.MustScope(ctx)
	row, err := s.q.GetInvoiceProfile(ctx, scope.InternalID)
	if err != nil {
		return InvoiceProfile{}, err
	}
	return InvoiceProfile{InvoiceName: row.InvoiceName, InvoiceTaxID: row.InvoiceTaxID, InvoiceTaxOffice: row.InvoiceTaxOffice, InvoiceAddress: row.InvoiceAddress, InvoiceCity: row.InvoiceCity, InvoiceEmail: row.InvoiceEmail}, nil
}

func (s *Service) UpdateInvoiceProfile(ctx context.Context, in InvoiceProfile) (InvoiceProfile, error) {
	scope := orgctx.MustScope(ctx)
	if err := validateInvoiceProfile(in); err != nil {
		return InvoiceProfile{}, err
	}
	row, err := s.q.UpdateInvoiceProfile(ctx, db.UpdateInvoiceProfileParams{
		ID: scope.InternalID, InvoiceName: strings.TrimSpace(in.InvoiceName), InvoiceTaxID: strings.TrimSpace(in.InvoiceTaxID),
		InvoiceTaxOffice: strings.TrimSpace(in.InvoiceTaxOffice), InvoiceAddress: strings.TrimSpace(in.InvoiceAddress),
		InvoiceCity: strings.TrimSpace(in.InvoiceCity), InvoiceEmail: strings.TrimSpace(in.InvoiceEmail),
	})
	if err != nil {
		return InvoiceProfile{}, err
	}
	return InvoiceProfile{InvoiceName: row.InvoiceName, InvoiceTaxID: row.InvoiceTaxID, InvoiceTaxOffice: row.InvoiceTaxOffice, InvoiceAddress: row.InvoiceAddress, InvoiceCity: row.InvoiceCity, InvoiceEmail: row.InvoiceEmail}, nil
}

func (s *Service) GetSellerSettings(ctx context.Context) (SellerSettings, error) {
	row, err := s.q.GetSellerSettings(ctx)
	if err != nil {
		return SellerSettings{}, err
	}
	return mapSeller(row), nil
}

func (s *Service) UpdateSellerSettings(ctx context.Context, in SellerSettings) (SellerSettings, error) {
	if err := validateSeller(in); err != nil {
		return SellerSettings{}, err
	}
	row, err := s.q.UpdateSellerSettings(ctx, db.UpdateSellerSettingsParams{
		SellerName: strings.TrimSpace(in.SellerName), SellerTaxID: strings.TrimSpace(in.SellerTaxID),
		SellerTaxOffice: strings.TrimSpace(in.SellerTaxOffice), SellerAddress: strings.TrimSpace(in.SellerAddress),
		SellerCity: strings.TrimSpace(in.SellerCity), SellerEmail: strings.TrimSpace(in.SellerEmail),
		SellerPhone: strings.TrimSpace(in.SellerPhone), SellerWebsite: strings.TrimSpace(in.SellerWebsite),
		InvoiceSeries: invoiceSeries(in.InvoiceSeries),
	})
	if err != nil {
		return SellerSettings{}, err
	}
	return mapSeller(row), nil
}

func (s *Service) UploadXSLT(ctx context.Context, filename string, data []byte) (SellerSettings, error) {
	ext := strings.ToLower(strings.TrimSpace(filename))
	if !strings.HasSuffix(ext, ".xslt") && !strings.HasSuffix(ext, ".xsl") {
		return SellerSettings{}, fmt.Errorf("%w: file must be .xslt or .xsl", ErrInvalidRequest)
	}
	if len(data) == 0 || int64(len(data)) > maxXSLTBytes {
		return SellerSettings{}, fmt.Errorf("%w: XSLT must be at most 2 MB", ErrInvalidRequest)
	}
	if _, err := billinginvoice.RenderHTML(ctx, billinginvoice.SampleXML(), data); err != nil {
		return SellerSettings{}, fmt.Errorf("%w: %v", ErrXSLTInvalid, err)
	}
	if s.store == nil {
		return SellerSettings{}, fmt.Errorf("%w: storage is not configured", ErrInvalidRequest)
	}
	key := fmt.Sprintf("billing/xslt/%d.xslt", time.Now().Unix())
	if err := s.store.Upload(ctx, storage.File{Body: bytes.NewReader(data), Size: int64(len(data)), ContentType: "application/xml", Filename: "invoice.xslt"}, key); err != nil {
		return SellerSettings{}, err
	}
	row, err := s.q.SetXSLT(ctx, db.SetXSLTParams{XsltObjectKey: key, XsltUploadedAt: pgTimeValue(time.Now())})
	if err != nil {
		return SellerSettings{}, err
	}
	return mapSeller(row), nil
}

func (s *Service) ResetXSLT(ctx context.Context) (SellerSettings, error) {
	row, err := s.q.SetXSLT(ctx, db.SetXSLTParams{})
	if err != nil {
		return SellerSettings{}, err
	}
	return mapSeller(row), nil
}

func (s *Service) currentXSLT(ctx context.Context, settings db.GetSellerSettingsRow) ([]byte, string, error) {
	if settings.XsltObjectKey == "" {
		xslt := billinginvoice.DefaultXSLT()
		return xslt, sha1Hex(xslt), nil
	}
	if s.store == nil {
		return nil, "", fmt.Errorf("%w: storage is not configured", ErrInvalidRequest)
	}
	body, _, err := s.store.Download(ctx, settings.XsltObjectKey)
	if err != nil {
		return nil, "", err
	}
	defer func() { _ = body.Close() }()
	data, err := io.ReadAll(body)
	if err != nil {
		return nil, "", err
	}
	return data, sha1Hex(data), nil
}

func validateInvoiceProfile(in InvoiceProfile) error {
	if strings.TrimSpace(in.InvoiceTaxID) == "" {
		return nil
	}
	if err := billinginvoice.ValidateTaxID(in.InvoiceTaxID); err != nil {
		return fmt.Errorf("%w: %v", ErrInvoiceProfile, err)
	}
	return nil
}

func validateSeller(in SellerSettings) error {
	if strings.TrimSpace(in.SellerTaxID) != "" {
		if err := billinginvoice.ValidateTaxID(in.SellerTaxID); err != nil || len(onlyDigits(in.SellerTaxID)) != 10 {
			return fmt.Errorf("%w: seller VKN is invalid", ErrInvoiceProfile)
		}
	}
	return nil
}

func onlyDigits(s string) string {
	var b strings.Builder
	for _, r := range s {
		if r >= '0' && r <= '9' {
			b.WriteRune(r)
		}
	}
	return b.String()
}

func invoiceSeries(s string) string {
	s = strings.ToUpper(strings.TrimSpace(s))
	if !regexp.MustCompile(`^[A-Z0-9]{3}$`).MatchString(s) {
		return "TWD"
	}
	return s
}

func invoiceKey(xmlKey, pdfKey, kind string) string {
	if kind == "xml" {
		return xmlKey
	}
	return pdfKey
}

func pgDate(t time.Time) pgtype.Date {
	return pgtype.Date{Time: t, Valid: true}
}

type invoiceJoined struct {
	row            db.BillingInvoice
	orderUUID      uuid.UUID
	orderReference string
	orgUUID        uuid.UUID
	orgSlug        string
	orgName        string
	includeOrg     bool
}

func mapInvoiceAdmin(r invoiceJoined) Invoice {
	out := mapInvoiceBase(r.row, r.orderUUID, r.orderReference)
	if r.includeOrg {
		out.Organization = &OrganizationRef{UUID: r.orgUUID, Slug: r.orgSlug, Name: r.orgName}
	}
	return out
}

func mapInvoiceOrg(row db.ListInvoicesForOrgRow) Invoice {
	return mapInvoiceBase(db.BillingInvoice{
		ID: row.ID, Uuid: row.Uuid, OrganizationID: row.OrganizationID, OrderID: row.OrderID, Number: row.Number,
		IssueDate: row.IssueDate, Profile: row.Profile, Type: row.Type, Buyer: row.Buyer, Seller: row.Seller,
		Lines: row.Lines, Subtotal: row.Subtotal, DiscountTotal: row.DiscountTotal, VatTotal: row.VatTotal,
		GrandTotal: row.GrandTotal, XmlObjectKey: row.XmlObjectKey, PdfObjectKey: row.PdfObjectKey,
		XsltVersion: row.XsltVersion, Status: row.Status, Error: row.Error, VoidedAt: row.VoidedAt,
		VoidedBy: row.VoidedBy, CreatedAt: row.CreatedAt, UpdatedAt: row.UpdatedAt,
	}, row.OrderUuid, row.OrderReference)
}

func mapInvoiceList(row db.ListInvoicesRow) Invoice {
	out := mapInvoiceBase(db.BillingInvoice{
		ID: row.ID, Uuid: row.Uuid, OrganizationID: row.OrganizationID, OrderID: row.OrderID, Number: row.Number,
		IssueDate: row.IssueDate, Profile: row.Profile, Type: row.Type, Buyer: row.Buyer, Seller: row.Seller,
		Lines: row.Lines, Subtotal: row.Subtotal, DiscountTotal: row.DiscountTotal, VatTotal: row.VatTotal,
		GrandTotal: row.GrandTotal, XmlObjectKey: row.XmlObjectKey, PdfObjectKey: row.PdfObjectKey,
		XsltVersion: row.XsltVersion, Status: row.Status, Error: row.Error, VoidedAt: row.VoidedAt,
		VoidedBy: row.VoidedBy, CreatedAt: row.CreatedAt, UpdatedAt: row.UpdatedAt,
	}, row.OrderUuid, row.OrderReference)
	out.Organization = &OrganizationRef{UUID: row.OrganizationUuid, Slug: row.OrganizationSlug, Name: row.OrganizationName}
	return out
}

func invoiceFromOrgAdminRow(row db.ListInvoicesForOrgAdminRow) Invoice {
	out := mapInvoiceBase(db.BillingInvoice{
		ID: row.ID, Uuid: row.Uuid, OrganizationID: row.OrganizationID, OrderID: row.OrderID, Number: row.Number,
		IssueDate: row.IssueDate, Profile: row.Profile, Type: row.Type, Buyer: row.Buyer, Seller: row.Seller,
		Lines: row.Lines, Subtotal: row.Subtotal, DiscountTotal: row.DiscountTotal, VatTotal: row.VatTotal,
		GrandTotal: row.GrandTotal, XmlObjectKey: row.XmlObjectKey, PdfObjectKey: row.PdfObjectKey,
		XsltVersion: row.XsltVersion, Status: row.Status, Error: row.Error, VoidedAt: row.VoidedAt,
		VoidedBy: row.VoidedBy, CreatedAt: row.CreatedAt, UpdatedAt: row.UpdatedAt,
	}, row.OrderUuid, row.OrderReference)
	out.Organization = &OrganizationRef{UUID: row.OrganizationUuid, Slug: row.OrganizationSlug, Name: row.OrganizationName}
	return out
}

func mapInvoiceBase(row db.BillingInvoice, orderUUID uuid.UUID, orderReference string) Invoice {
	var buyer billinginvoice.Party
	_ = json.Unmarshal(row.Buyer, &buyer)
	return Invoice{
		UUID: row.Uuid, Number: row.Number, IssueDate: row.IssueDate.Time.Format("2006-01-02"),
		Status: row.Status, OrderUUID: orderUUID, OrderReference: orderReference,
		Buyer:    InvoiceBuyer{Name: buyer.Name, TaxID: buyer.TaxID, TaxOffice: buyer.TaxOffice, IsFinalConsumer: buyer.IsFinalConsumer},
		Subtotal: numericString(row.Subtotal), DiscountTotal: numericString(row.DiscountTotal),
		VATTotal: numericString(row.VatTotal), GrandTotal: numericString(row.GrandTotal),
		HasXML: row.XmlObjectKey != "", HasPDF: row.PdfObjectKey != "", Error: row.Error, CreatedAt: row.CreatedAt.Time,
	}
}

func invoiceFromOrderRow(row db.GetInvoiceByOrderRow) db.BillingInvoice {
	return db.BillingInvoice{
		ID: row.ID, Uuid: row.Uuid, OrganizationID: row.OrganizationID, OrderID: row.OrderID, Number: row.Number,
		IssueDate: row.IssueDate, Profile: row.Profile, Type: row.Type, Buyer: row.Buyer, Seller: row.Seller,
		Lines: row.Lines, Subtotal: row.Subtotal, DiscountTotal: row.DiscountTotal, VatTotal: row.VatTotal,
		GrandTotal: row.GrandTotal, XmlObjectKey: row.XmlObjectKey, PdfObjectKey: row.PdfObjectKey,
		XsltVersion: row.XsltVersion, Status: row.Status, Error: row.Error, VoidedAt: row.VoidedAt,
		VoidedBy: row.VoidedBy, CreatedAt: row.CreatedAt, UpdatedAt: row.UpdatedAt,
	}
}

func invoiceFromUUIDRow(row db.GetInvoiceByUUIDRow) db.BillingInvoice {
	return db.BillingInvoice{
		ID: row.ID, Uuid: row.Uuid, OrganizationID: row.OrganizationID, OrderID: row.OrderID, Number: row.Number,
		IssueDate: row.IssueDate, Profile: row.Profile, Type: row.Type, Buyer: row.Buyer, Seller: row.Seller,
		Lines: row.Lines, Subtotal: row.Subtotal, DiscountTotal: row.DiscountTotal, VatTotal: row.VatTotal,
		GrandTotal: row.GrandTotal, XmlObjectKey: row.XmlObjectKey, PdfObjectKey: row.PdfObjectKey,
		XsltVersion: row.XsltVersion, Status: row.Status, Error: row.Error, VoidedAt: row.VoidedAt,
		VoidedBy: row.VoidedBy, CreatedAt: row.CreatedAt, UpdatedAt: row.UpdatedAt,
	}
}

func mapSeller(row any) SellerSettings {
	var out SellerSettings
	var uploaded pgtype.Timestamptz
	switch r := row.(type) {
	case db.GetSellerSettingsRow:
		out = SellerSettings{SellerName: r.SellerName, SellerTaxID: r.SellerTaxID, SellerTaxOffice: r.SellerTaxOffice, SellerAddress: r.SellerAddress, SellerCity: r.SellerCity, SellerEmail: r.SellerEmail, SellerPhone: r.SellerPhone, SellerWebsite: r.SellerWebsite, InvoiceSeries: r.InvoiceSeries}
		out.XSLT.Custom = r.XsltObjectKey != ""
		uploaded = r.XsltUploadedAt
	case db.UpdateSellerSettingsRow:
		out = SellerSettings{SellerName: r.SellerName, SellerTaxID: r.SellerTaxID, SellerTaxOffice: r.SellerTaxOffice, SellerAddress: r.SellerAddress, SellerCity: r.SellerCity, SellerEmail: r.SellerEmail, SellerPhone: r.SellerPhone, SellerWebsite: r.SellerWebsite, InvoiceSeries: r.InvoiceSeries}
		out.XSLT.Custom = r.XsltObjectKey != ""
		uploaded = r.XsltUploadedAt
	case db.SetXSLTRow:
		out = SellerSettings{SellerName: r.SellerName, SellerTaxID: r.SellerTaxID, SellerTaxOffice: r.SellerTaxOffice, SellerAddress: r.SellerAddress, SellerCity: r.SellerCity, SellerEmail: r.SellerEmail, SellerPhone: r.SellerPhone, SellerWebsite: r.SellerWebsite, InvoiceSeries: r.InvoiceSeries}
		out.XSLT.Custom = r.XsltObjectKey != ""
		uploaded = r.XsltUploadedAt
	}
	if uploaded.Valid {
		t := uploaded.Time
		out.XSLT.UploadedAt = &t
	}
	return out
}
