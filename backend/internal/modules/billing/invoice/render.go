package invoice

import (
	"context"
	_ "embed"
	"sync"
	"time"

	"github.com/furkanmeclis/go-ubltr/render"
	"github.com/furkanmeclis/go-ubltr/render/xslt/helium"
)

//go:embed assets/general.xslt
var defaultXSLT []byte

var (
	sampleOnce sync.Once
	sampleXML  []byte
	sampleErr  error
)

func DefaultXSLT() []byte {
	out := make([]byte, len(defaultXSLT))
	copy(out, defaultXSLT)
	return out
}

func RenderHTML(ctx context.Context, xml, xslt []byte) ([]byte, error) {
	r, err := render.NewHTML(helium.New(), render.Style{Name: "invoice", Stylesheet: xslt})
	if err != nil {
		return nil, err
	}
	return r.Render(ctx, xml)
}

func SampleXML() []byte {
	sampleOnce.Do(func() {
		sampleXML, _, sampleErr = Build(Input{
			UUID:    "7f293ab7-0728-4d53-9785-2f2fd3da1660",
			Number:  "TWD2026000000001",
			IssueAt: time.Date(2026, 9, 27, 12, 0, 0, 0, time.FixedZone("TRT", 3*60*60)),
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
			OrderRef: "OTO-SAMPLE",
			XSLT:     defaultXSLT,
		})
	})
	if sampleErr != nil {
		return nil
	}
	out := make([]byte, len(sampleXML))
	copy(out, sampleXML)
	return out
}
