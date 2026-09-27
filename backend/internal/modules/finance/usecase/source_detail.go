package usecase

import (
	"context"
	"errors"
	"time"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database/db"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// SourceDetail describes the document behind a finance transaction.
type SourceDetail struct {
	// Kind: service_job | product_sale | purchase | cari_payment.
	Kind string `json:"kind"`
	// UUID is the job / sale / purchase / cari account to link to.
	UUID     uuid.UUID    `json:"uuid"`
	Title    string       `json:"title"`
	Subtitle string       `json:"subtitle,omitempty"`
	Plate    string       `json:"plate,omitempty"`
	Date     *time.Time   `json:"date,omitempty"`
	Total    string       `json:"total,omitempty"`
	Currency string       `json:"currency,omitempty"`
	Lines    []SourceLine `json:"lines"`
}

// SourceLine is one item of the source document.
type SourceLine struct {
	// Type: service | product | custom (job lines) or product (sale / purchase).
	Type      string `json:"type"`
	Name      string `json:"name"`
	Qty       string `json:"qty"`
	UnitPrice string `json:"unit_price"`
	LineTotal string `json:"line_total"`
}

// sourceDetail resolves the source document; unknown kinds or rows that no
// longer exist return nil so the transaction itself still renders.
func (s *Service) sourceDetail(ctx context.Context, orgID int64, kind string, id uuid.UUID) (*SourceDetail, error) {
	d, err := s.loadSourceDetail(ctx, orgID, kind, id)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	return d, err
}

func (s *Service) loadSourceDetail(ctx context.Context, orgID int64, kind string, id uuid.UUID) (*SourceDetail, error) {
	switch kind {
	case SourceServiceJob:
		job, err := s.q.GetFinanceSourceJob(ctx, db.GetFinanceSourceJobParams{PaymentUuid: id, OrganizationID: orgID})
		if err != nil {
			return nil, err
		}
		rows, err := s.q.ListFinanceSourceJobLines(ctx, db.ListFinanceSourceJobLinesParams{OrganizationID: orgID, JobID: job.ID})
		if err != nil {
			return nil, err
		}
		d := &SourceDetail{
			Kind: kind, UUID: job.Uuid, Title: job.CustomerName, Subtitle: job.VehicleLabel, Plate: job.Plate,
			Total: numericToString(job.TotalAmount), Currency: job.Currency, Lines: make([]SourceLine, 0, len(rows)),
		}
		if job.StartedAt.Valid {
			t := job.StartedAt.Time
			d.Date = &t
		}
		for _, r := range rows {
			d.Lines = append(d.Lines, SourceLine{Type: r.LineType, Name: r.Name, Qty: numericToString(r.Qty),
				UnitPrice: numericToString(r.UnitPrice), LineTotal: numericToString(r.LineTotal)})
		}
		return d, nil
	case SourceProductSale:
		sale, err := s.q.GetFinanceSourceSale(ctx, db.GetFinanceSourceSaleParams{Uuid: id, OrganizationID: orgID})
		if err != nil {
			return nil, err
		}
		rows, err := s.q.ListFinanceSourceSaleLines(ctx, db.ListFinanceSourceSaleLinesParams{OrganizationID: orgID, SaleID: sale.ID})
		if err != nil {
			return nil, err
		}
		d := &SourceDetail{
			Kind: kind, UUID: sale.Uuid, Title: sale.CustomerName,
			Total: numericToString(sale.TotalAmount), Currency: sale.Currency, Lines: make([]SourceLine, 0, len(rows)),
		}
		if sale.SoldAt.Valid {
			t := sale.SoldAt.Time
			d.Date = &t
		}
		for _, r := range rows {
			d.Lines = append(d.Lines, SourceLine{Type: "product", Name: r.Name, Qty: numericToString(r.Qty),
				UnitPrice: numericToString(r.UnitPrice), LineTotal: numericToString(r.LineTotal)})
		}
		return d, nil
	case SourcePurchase:
		p, err := s.q.GetFinanceSourcePurchase(ctx, db.GetFinanceSourcePurchaseParams{Uuid: id, OrganizationID: orgID})
		if err != nil {
			return nil, err
		}
		rows, err := s.q.ListFinanceSourcePurchaseLines(ctx, db.ListFinanceSourcePurchaseLinesParams{OrganizationID: orgID, PurchaseID: p.ID})
		if err != nil {
			return nil, err
		}
		d := &SourceDetail{
			Kind: kind, UUID: p.Uuid, Title: p.SupplierName,
			Total: numericToString(p.TotalAmount), Currency: p.Currency, Lines: make([]SourceLine, 0, len(rows)),
		}
		if p.PurchasedAt.Valid {
			t := p.PurchasedAt.Time
			d.Date = &t
		}
		for _, r := range rows {
			d.Lines = append(d.Lines, SourceLine{Type: "product", Name: r.Name, Qty: numericToString(r.Qty),
				UnitPrice: numericToString(r.UnitCost), LineTotal: numericToString(r.LineTotal)})
		}
		return d, nil
	case SourceCariPayment:
		c, err := s.q.GetFinanceSourceCari(ctx, db.GetFinanceSourceCariParams{Uuid: id, OrganizationID: orgID})
		if err != nil {
			return nil, err
		}
		return &SourceDetail{Kind: kind, UUID: c.AccountUuid, Title: c.CustomerName, Subtitle: c.Description, Lines: []SourceLine{}}, nil
	}
	return nil, nil
}
