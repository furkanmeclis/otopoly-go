package invoice

import (
	"context"
	"fmt"
	"math"
	"math/big"
	"regexp"
	"strings"
	"time"
	"unicode"

	ubltr "github.com/furkanmeclis/go-ubltr"
	"github.com/furkanmeclis/go-ubltr/builder"
	"github.com/furkanmeclis/go-ubltr/codelist"
)

type Party struct {
	Name            string `json:"name"`
	TaxID           string `json:"tax_id"`
	TaxOffice       string `json:"tax_office"`
	Address         string `json:"address"`
	City            string `json:"city"`
	Email           string `json:"email"`
	Phone           string `json:"phone"`
	Website         string `json:"website"`
	FirstName       string `json:"first_name,omitempty"`
	FamilyName      string `json:"family_name,omitempty"`
	IsFinalConsumer bool   `json:"is_final_consumer,omitempty"`
}

type Profile struct {
	Name      string
	TaxID     string
	TaxOffice string
	Address   string
	City      string
	Email     string
}

type Line struct {
	Kind   string `json:"kind"`
	Label  string `json:"label"`
	Amount string `json:"amount"`
}

type Input struct {
	UUID     string
	Number   string
	IssueAt  time.Time
	Seller   Party
	Buyer    Party
	Lines    []Line
	VATRate  int
	OrderRef string
	XSLT     []byte
}

type Totals struct {
	Subtotal      string `json:"subtotal"`
	DiscountTotal string `json:"discount_total"`
	VATTotal      string `json:"vat_total"`
	GrandTotal    string `json:"grand_total"`
}

var digitsRE = regexp.MustCompile(`^\d+$`)

func Build(in Input) ([]byte, Totals, error) {
	if strings.TrimSpace(in.Number) == "" {
		return nil, Totals{}, fmt.Errorf("invoice: number is required")
	}
	if err := validateParty(in.Seller, true); err != nil {
		return nil, Totals{}, fmt.Errorf("invoice: seller: %w", err)
	}
	if err := validateParty(in.Buyer, false); err != nil {
		return nil, Totals{}, fmt.Errorf("invoice: buyer: %w", err)
	}
	if in.VATRate < 0 || in.VATRate > 100 {
		return nil, Totals{}, fmt.Errorf("invoice: invalid VAT rate")
	}
	amounts, err := computeTotals(in.Lines, in.VATRate)
	if err != nil {
		return nil, Totals{}, err
	}
	issueAt := in.IssueAt
	if issueAt.IsZero() {
		issueAt = time.Now()
	}
	issueDate := issueAt.Format("2006-01-02")

	qty, err := builder.QuantityIn(codelist.UnitC62, "1")
	if err != nil {
		return nil, Totals{}, err
	}
	price, err := builder.MoneyIn(codelist.TRY, centsString(amounts.subtotalNet))
	if err != nil {
		return nil, Totals{}, err
	}
	line := builder.NewInvoiceLineBuilder().
		Name(planLabel(in.Lines)).
		Quantity(qty).
		Price(price).
		Tax(builder.NewTaxBuilder().KDV(fmt.Sprintf("%d", in.VATRate)))
	if amounts.discountNet > 0 {
		disc, err := builder.MoneyIn(codelist.TRY, centsString(amounts.discountNet))
		if err != nil {
			return nil, Totals{}, err
		}
		line.Allowance(disc, discountLabel(in.Lines))
	}

	doc, err := builder.NewInvoiceBuilder().
		Profile(codelist.ProfileEArsivFatura).
		Type(codelist.InvoiceTypeSatis).
		ID(in.Number).
		UUID(strings.TrimSpace(in.UUID)).
		IssueDate(issueDate).
		IssueTime(issueAt.Format("15:04:05")).
		Currency(codelist.TRY).
		Note("Sipariş referansı: " + strings.TrimSpace(in.OrderRef)).
		SupplierBuilder(partyBuilder(in.Seller)).
		CustomerBuilder(partyBuilder(in.Buyer)).
		Line(line).
		Build()
	if err != nil {
		return nil, Totals{}, err
	}
	if len(in.XSLT) > 0 {
		if err := ubltr.AddAttachment(doc, ubltr.Attachment{
			ID:          "invoice.xslt",
			IssueDate:   issueDate,
			Type:        "XSLT",
			Description: "GIB invoice stylesheet",
			Filename:    "invoice.xslt",
			MIME:        "application/xml",
			Data:        in.XSLT,
		}); err != nil {
			return nil, Totals{}, err
		}
	}
	xml, err := ubltr.Marshal(doc)
	if err != nil {
		return nil, Totals{}, err
	}
	if err := ubltr.ValidateXSD(context.Background(), xml); err != nil {
		return nil, Totals{}, err
	}
	return xml, Totals{
		Subtotal:      centsString(amounts.subtotalNet),
		DiscountTotal: centsString(amounts.discountNet),
		VATTotal:      centsString(amounts.vat),
		GrandTotal:    centsString(amounts.grandGross),
	}, nil
}

func BuyerFromProfile(orgName, orgAddress, orgCity string, p Profile) Party {
	taxID := onlyDigits(p.TaxID)
	if taxID == "" {
		return Party{
			Name:            defaultText(p.Name, orgName, "-"),
			TaxID:           "11111111111",
			Address:         defaultText(p.Address, orgAddress, "-"),
			City:            defaultText(p.City, orgCity, "-"),
			Email:           strings.TrimSpace(p.Email),
			FirstName:       defaultText(p.Name, orgName, "-"),
			FamilyName:      "-",
			IsFinalConsumer: true,
		}
	}
	out := Party{
		Name:      strings.TrimSpace(p.Name),
		TaxID:     taxID,
		TaxOffice: strings.TrimSpace(p.TaxOffice),
		Address:   defaultText(p.Address, orgAddress, "-"),
		City:      defaultText(p.City, orgCity, "-"),
		Email:     strings.TrimSpace(p.Email),
	}
	if len(taxID) == 11 {
		out.FirstName, out.FamilyName = splitName(out.Name)
	}
	return out
}

func ValidateTaxID(s string) error {
	s = onlyDigits(s)
	switch len(s) {
	case 10:
		if !validVKN(s) {
			return fmt.Errorf("invalid VKN")
		}
	case 11:
		if !validTCKN(s) {
			return fmt.Errorf("invalid TCKN")
		}
	default:
		return fmt.Errorf("tax id must be 10 or 11 digits")
	}
	return nil
}

type computed struct {
	subtotalNet int64
	discountNet int64
	vat         int64
	grandGross  int64
}

func computeTotals(lines []Line, vatRate int) (computed, error) {
	var grossPlan, grossDiscount int64
	for _, l := range lines {
		amount, err := centsFromString(l.Amount)
		if err != nil {
			return computed{}, fmt.Errorf("invoice: line amount: %w", err)
		}
		if amount < 0 {
			amount = -amount
		}
		switch strings.TrimSpace(strings.ToLower(l.Kind)) {
		case "plan":
			grossPlan += amount
		case "proration", "discount", "credit":
			grossDiscount += amount
		}
	}
	if grossPlan <= 0 {
		return computed{}, fmt.Errorf("invoice: at least one plan line is required")
	}
	grand := grossPlan - grossDiscount
	if grand < 0 {
		grand = 0
	}
	subtotalNet := netFromGross(grossPlan, vatRate)
	grandNet := netFromGross(grand, vatRate)
	discountNet := subtotalNet - grandNet
	if discountNet < 0 {
		discountNet = 0
	}
	return computed{
		subtotalNet: subtotalNet,
		discountNet: discountNet,
		vat:         grand - grandNet,
		grandGross:  grand,
	}, nil
}

func netFromGross(grossCents int64, vatRate int) int64 {
	r := big.NewRat(grossCents, 1)
	r.Mul(r, big.NewRat(100, int64(100+vatRate)))
	return roundRatToInt(r)
}

func roundRatToInt(r *big.Rat) int64 {
	num := new(big.Int).Set(r.Num())
	den := new(big.Int).Set(r.Denom())
	q, rem := new(big.Int).QuoRem(num, den, new(big.Int))
	rem.Mul(rem, big.NewInt(2))
	if rem.Cmp(den) >= 0 {
		q.Add(q, big.NewInt(1))
	}
	return q.Int64()
}

func centsFromString(raw string) (int64, error) {
	r, ok := new(big.Rat).SetString(strings.TrimSpace(raw))
	if !ok {
		return 0, fmt.Errorf("invalid money %q", raw)
	}
	r.Mul(r, big.NewRat(100, 1))
	return roundRatToInt(r), nil
}

func centsString(cents int64) string {
	sign := ""
	if cents < 0 {
		sign = "-"
		cents = -cents
	}
	return fmt.Sprintf("%s%d.%02d", sign, cents/100, cents%100)
}

func partyBuilder(p Party) *builder.PartyBuilder {
	pb := builder.NewPartyBuilder().
		Name(strings.TrimSpace(p.Name)).
		TaxOffice(strings.TrimSpace(p.TaxOffice)).
		Email(strings.TrimSpace(p.Email)).
		Phone(strings.TrimSpace(p.Phone)).
		Website(strings.TrimSpace(p.Website)).
		AddressBuilder(builder.NewAddressBuilder().
			Street(defaultText(p.Address, "-")).
			District("-").
			City(defaultText(p.City, "-")).
			Country("Türkiye").
			CountryCode("TR"))
	if len(onlyDigits(p.TaxID)) == 10 {
		pb.VKN(onlyDigits(p.TaxID))
	} else {
		pb.TCKN(onlyDigits(p.TaxID))
		first, family := p.FirstName, p.FamilyName
		if strings.TrimSpace(first) == "" || strings.TrimSpace(family) == "" {
			first, family = splitName(p.Name)
		}
		pb.Person(first, family)
	}
	return pb
}

func validateParty(p Party, seller bool) error {
	if strings.TrimSpace(p.Name) == "" {
		return fmt.Errorf("name is required")
	}
	if strings.TrimSpace(p.Address) == "" || strings.TrimSpace(p.City) == "" {
		return fmt.Errorf("address and city are required")
	}
	if err := ValidateTaxID(p.TaxID); err != nil {
		return err
	}
	if seller && len(onlyDigits(p.TaxID)) != 10 {
		return fmt.Errorf("seller VKN is required")
	}
	return nil
}

func validTCKN(s string) bool {
	if !digitsRE.MatchString(s) || len(s) != 11 || s[0] == '0' {
		return false
	}
	d := digits(s)
	odd := d[0] + d[2] + d[4] + d[6] + d[8]
	even := d[1] + d[3] + d[5] + d[7]
	if ((odd*7 - even) % 10) != d[9] {
		return false
	}
	sum := 0
	for i := 0; i < 10; i++ {
		sum += d[i]
	}
	return sum%10 == d[10]
}

func validVKN(s string) bool {
	if !digitsRE.MatchString(s) || len(s) != 10 {
		return false
	}
	d := digits(s)
	sum := 0
	for i := 0; i < 9; i++ {
		v := (d[i] + 9 - i) % 10
		if v != 9 {
			v = (v * int(math.Pow(2, float64(9-i)))) % 9
		}
		sum += v
	}
	check := (10 - (sum % 10)) % 10
	return check == d[9]
}

func digits(s string) []int {
	out := make([]int, len(s))
	for i, r := range s {
		out[i] = int(r - '0')
	}
	return out
}

func onlyDigits(s string) string {
	var b strings.Builder
	for _, r := range s {
		if unicode.IsDigit(r) {
			b.WriteRune(r)
		}
	}
	return b.String()
}

func splitName(name string) (string, string) {
	fields := strings.Fields(name)
	if len(fields) == 0 {
		return "-", "-"
	}
	if len(fields) == 1 {
		return fields[0], "-"
	}
	return strings.Join(fields[:len(fields)-1], " "), fields[len(fields)-1]
}

func defaultText(values ...string) string {
	for _, v := range values {
		if strings.TrimSpace(v) != "" {
			return strings.TrimSpace(v)
		}
	}
	return ""
}

func planLabel(lines []Line) string {
	for _, l := range lines {
		if strings.EqualFold(strings.TrimSpace(l.Kind), "plan") && strings.TrimSpace(l.Label) != "" {
			return strings.TrimSpace(l.Label)
		}
	}
	return "Abonelik"
}

func discountLabel(lines []Line) string {
	parts := []string{}
	for _, l := range lines {
		switch strings.TrimSpace(strings.ToLower(l.Kind)) {
		case "proration", "discount", "credit":
			if strings.TrimSpace(l.Label) != "" {
				parts = append(parts, strings.TrimSpace(l.Label))
			}
		}
	}
	if len(parts) == 0 {
		return "İndirim"
	}
	return strings.Join(parts, ", ")
}
