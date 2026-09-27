package usecase

import (
	"context"
	"errors"
	"github.com/jackc/pgx/v5/pgxpool"
	"strings"
	"sync"
	"testing"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database/db"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/orgctx"
	"github.com/google/uuid"
)

func TestInvoicesDBIssueRegenerateVoidAndXSLT(t *testing.T) {
	svc, q, pool, ctx := newOrdersDBFixture(t)
	store := newReceiptStore()
	svc.SetStorage(store)
	svc.SetPDFRenderer(fakeInvoicePDF{err: errors.New("gotenberg down")})
	restoreBillingSettings(t, pool)
	if _, err := svc.UpdateSellerSettings(ctx, SellerSettings{
		SellerName: "Teknik Yazilim A.S.", SellerTaxID: "1234567890", SellerTaxOffice: "Maslak",
		SellerAddress: "Buyukdere Cad. No:1", SellerCity: "Istanbul", SellerEmail: "muhasebe@example.com",
		InvoiceSeries: "TST",
	}); err != nil {
		t.Fatal(err)
	}
	plan := createBillingTestPlan(t, svc, "invoice_issue", "500.00")
	org := createBillingTestOrg(t, q, pool)
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM billing_invoices WHERE organization_id = $1`, org.ID)
	})
	if _, err := q.UpdateInvoiceProfile(ctx, db.UpdateInvoiceProfileParams{
		ID: org.ID, InvoiceName: "Otokoop Servis A.S.", InvoiceTaxID: "9000068418",
		InvoiceTaxOffice: "Kadikoy", InvoiceAddress: "Bagdat Cad. No:2", InvoiceCity: "Istanbul",
	}); err != nil {
		t.Fatal(err)
	}
	octx := orgctx.WithScope(ctx, orgctx.Scope{InternalID: org.ID, UUID: org.Uuid, Slug: org.Slug, Name: org.Name})
	order, err := svc.CreateOrder(octx, OrderInput{PlanUUID: plan.UUID, Period: "monthly"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := svc.ReportPayment(octx, order.UUID, ReportInput{
		Filename: "receipt.pdf", ContentType: "application/pdf", Size: 7, Body: strings.NewReader("receipt"),
	}); err != nil {
		t.Fatal(err)
	}
	approved, err := svc.ApproveOrder(ctx, order.UUID, "ok")
	if err != nil {
		t.Fatal(err)
	}
	if approved.InvoiceUUID == nil {
		t.Fatal("approved order missing invoice_uuid")
	}
	inv, err := q.GetInvoiceByUUID(ctx, *approved.InvoiceUUID)
	if err != nil {
		t.Fatal(err)
	}
	if inv.Status != "issued" || inv.XmlObjectKey == "" || inv.PdfObjectKey != "" || !strings.Contains(inv.Error, "gotenberg down") {
		t.Fatalf("invoice after pdf error = %+v", inv)
	}
	svc.SetPDFRenderer(fakeInvoicePDF{data: []byte("%PDF-1.7")})
	regenerated, err := svc.RegenerateInvoice(ctx, inv.Uuid)
	if err != nil {
		t.Fatal(err)
	}
	if !regenerated.HasPDF {
		t.Fatalf("regenerated = %+v", regenerated)
	}
	voided, err := svc.VoidInvoice(ctx, inv.Uuid)
	if err != nil {
		t.Fatal(err)
	}
	if voided.Status != "voided" {
		t.Fatalf("voided = %+v", voided)
	}
	if _, err := svc.VoidInvoice(ctx, inv.Uuid); !errors.Is(err, ErrInvoiceState) {
		t.Fatalf("second void err=%v", err)
	}
	if _, err := svc.UploadXSLT(ctx, "bad.xslt", []byte(`<xsl:stylesheet>`)); !errors.Is(err, ErrXSLTInvalid) {
		t.Fatalf("bad xslt err=%v", err)
	}
}

func TestInvoicesDBNextInvoiceNumberConcurrent(t *testing.T) {
	_, q, pool, ctx := newOrdersDBFixture(t)
	series := "T" + strings.ToUpper(uuid.NewString()[:2])
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM billing_invoice_counters WHERE series = $1`, series)
	})
	const year int32 = 2026
	var wg sync.WaitGroup
	nums := make(chan int64, 2)
	errs := make(chan error, 2)
	for i := 0; i < 2; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			n, err := q.NextInvoiceNumber(ctx, db.NextInvoiceNumberParams{Series: series, Year: year})
			if err != nil {
				errs <- err
				return
			}
			nums <- n
		}()
	}
	wg.Wait()
	close(nums)
	close(errs)
	for err := range errs {
		t.Fatal(err)
	}
	seen := map[int64]bool{}
	for n := range nums {
		if seen[n] {
			t.Fatalf("duplicate number %d", n)
		}
		seen[n] = true
	}
	if len(seen) != 2 {
		t.Fatalf("numbers = %+v", seen)
	}
}

type fakeInvoicePDF struct {
	data []byte
	err  error
}

func (f fakeInvoicePDF) HTMLToPDF(context.Context, string) ([]byte, error) {
	if f.err != nil {
		return nil, f.err
	}
	if len(f.data) == 0 {
		return []byte("%PDF-1.7"), nil
	}
	return f.data, nil
}

// restoreBillingSettings snapshots the platform billing settings singleton and
// the TST test-series counter, and puts both back when the test ends, so the
// test never changes a developer's real seller details or invoice numbering.
func restoreBillingSettings(t *testing.T, pool *pgxpool.Pool) {
	t.Helper()
	ctx := context.Background()
	var snapshot []byte
	if err := pool.QueryRow(ctx, `SELECT row_to_json(s)::text FROM billing_settings s WHERE id = 1`).Scan(&snapshot); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `
			UPDATE billing_settings s SET
				seller_name = j.seller_name, seller_tax_id = j.seller_tax_id, seller_tax_office = j.seller_tax_office,
				seller_address = j.seller_address, seller_city = j.seller_city, seller_email = j.seller_email,
				seller_phone = j.seller_phone, seller_website = j.seller_website, invoice_series = j.invoice_series,
				xslt_object_key = j.xslt_object_key, xslt_uploaded_at = j.xslt_uploaded_at
			FROM json_populate_record(NULL::billing_settings, $1::json) j
			WHERE s.id = 1`, string(snapshot))
		_, _ = pool.Exec(context.Background(), `DELETE FROM billing_invoice_counters WHERE series = 'TST'`)
	})
}
