package invoice

import (
	"bytes"
	"context"
	"strings"
	"testing"
	"time"
)

func testInput() Input {
	return Input{
		UUID:    "2b8f4e42-f52f-4c8f-a9b2-6c2be0ddf101",
		Number:  "TWD2026000000001",
		IssueAt: time.Date(2026, 9, 27, 14, 30, 0, 0, time.FixedZone("TRT", 3*60*60)),
		Seller: Party{
			Name: "Teknik Yazilim A.S.", TaxID: "1234567890", TaxOffice: "Maslak",
			Address: "Buyukdere Cad. No:1", City: "Istanbul", Email: "muhasebe@example.com",
		},
		Buyer: Party{
			Name: "Otokoop Servis A.S.", TaxID: "9000068418", TaxOffice: "Kadikoy",
			Address: "Bagdat Cad. No:2", City: "Istanbul", Email: "finans@example.com",
		},
		Lines: []Line{
			{Kind: "plan", Label: "Pro yıllık abonelik", Amount: "16200.00"},
			{Kind: "discount", Label: "Yıllık indirim", Amount: "1620.00"},
		},
		VATRate:  20,
		OrderRef: "OTO-123456",
		XSLT:     DefaultXSLT(),
	}
}

func TestMapTotalsMatchOrder(t *testing.T) {
	xml, totals, err := Build(testInput())
	if err != nil {
		t.Fatalf("Build: %v", err)
	}
	if totals.Subtotal != "13500.00" {
		t.Fatalf("subtotal = %s", totals.Subtotal)
	}
	if totals.DiscountTotal != "1350.00" {
		t.Fatalf("discount total = %s", totals.DiscountTotal)
	}
	if totals.VATTotal != "2430.00" {
		t.Fatalf("vat total = %s", totals.VATTotal)
	}
	if totals.GrandTotal != "14580.00" {
		t.Fatalf("grand total = %s", totals.GrandTotal)
	}
	if !bytes.Contains(xml, []byte("PayableAmount")) || !bytes.Contains(xml, []byte(">14580.00</PayableAmount>")) {
		t.Fatal("XML payable amount does not match order total")
	}
}

func TestBuyerFallback(t *testing.T) {
	p := BuyerFromProfile("Oto Tamir", "Sanayi Sitesi", "Ankara", Profile{})
	if p.TaxID != "11111111111" {
		t.Fatalf("tax id = %q", p.TaxID)
	}
	if p.Name != "Oto Tamir" {
		t.Fatalf("name = %q", p.Name)
	}
	if p.Address != "Sanayi Sitesi" || p.City != "Ankara" {
		t.Fatalf("address/city = %q/%q", p.Address, p.City)
	}
}

func TestBuyerVKNvsTCKN(t *testing.T) {
	vkn := BuyerFromProfile("", "", "", Profile{
		Name: "Oto A.S.", TaxID: "9000068418", TaxOffice: "Kadikoy", Address: "Adres", City: "Istanbul",
	})
	if vkn.TaxID != "9000068418" || vkn.Name != "Oto A.S." || vkn.FirstName != "" || vkn.FamilyName != "" {
		t.Fatalf("unexpected VKN party: %+v", vkn)
	}
	tckn := BuyerFromProfile("", "", "", Profile{
		Name: "Ayse Yilmaz", TaxID: "10000000146", Address: "Adres", City: "Istanbul",
	})
	if tckn.TaxID != "10000000146" || tckn.FirstName != "Ayse" || tckn.FamilyName != "Yilmaz" {
		t.Fatalf("unexpected TCKN party: %+v", tckn)
	}
}

func TestValidateTaxID(t *testing.T) {
	valid := []string{"9000068418", "1234567890", "10000000146"}
	for _, id := range valid {
		if err := ValidateTaxID(id); err != nil {
			t.Fatalf("ValidateTaxID(%s): %v", id, err)
		}
	}
	invalid := []string{"", "123", "1111111111", "10000000145", "abcdefghij"}
	for _, id := range invalid {
		if err := ValidateTaxID(id); err == nil {
			t.Fatalf("ValidateTaxID(%s) succeeded", id)
		}
	}
}

func TestRenderDefaultXSLT(t *testing.T) {
	xml, _, err := Build(testInput())
	if err != nil {
		t.Fatalf("Build: %v", err)
	}
	html, err := RenderHTML(context.Background(), xml, DefaultXSLT())
	if err != nil {
		t.Fatalf("RenderHTML: %v", err)
	}
	if !strings.Contains(string(html), "TWD2026000000001") {
		t.Fatal("rendered HTML does not contain invoice number")
	}
}

func TestXSDValid(t *testing.T) {
	if _, _, err := Build(testInput()); err != nil {
		t.Fatalf("Build: %v", err)
	}
}
