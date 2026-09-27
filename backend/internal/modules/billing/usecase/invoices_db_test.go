package usecase

import (
	"context"
	"errors"
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
	if _, err := svc.UpdateSellerSettings(ctx, SellerSettings{
		SellerName: "Teknik Yazilim A.S.", SellerTaxID: "1234567890", SellerTaxOffice: "Maslak",
		SellerAddress: "Buyukdere Cad. No:1", SellerCity: "Istanbul", SellerEmail: "muhasebe@example.com",
		InvoiceSeries: "TWD",
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
	_, q, _, ctx := newOrdersDBFixture(t)
	series := "T" + strings.ToUpper(uuid.NewString()[:2])
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
