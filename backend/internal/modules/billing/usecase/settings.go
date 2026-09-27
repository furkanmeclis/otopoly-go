package usecase

import (
	"context"
	"fmt"
	"regexp"
	"strings"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database/db"
)

var ibanRE = regexp.MustCompile(`^TR\d{24}$`)

type PaymentSettings struct {
	BankName            string `json:"bank_name"`
	AccountHolder       string `json:"account_holder"`
	IBAN                string `json:"iban"`
	PaymentInstructions string `json:"payment_instructions"`
	OrderTTLDays        int32  `json:"order_ttl_days"`
	GraceDays           int32  `json:"grace_days"`
	VATRate             int32  `json:"vat_rate"`
}

func (s *Service) GetPaymentSettings(ctx context.Context) (PaymentSettings, error) {
	row, err := s.q.GetBillingSettings(ctx)
	if err != nil {
		return PaymentSettings{}, err
	}
	return mapPaymentSettings(row), nil
}

func (s *Service) UpdatePaymentSettings(ctx context.Context, in PaymentSettings) (PaymentSettings, error) {
	iban, err := normalizeIBAN(in.IBAN)
	if err != nil {
		return PaymentSettings{}, err
	}
	if in.OrderTTLDays < 1 || in.OrderTTLDays > 30 {
		return PaymentSettings{}, fmt.Errorf("%w: order_ttl_days must be between 1 and 30", ErrInvalidRequest)
	}
	if in.GraceDays < 0 || in.GraceDays > 30 {
		return PaymentSettings{}, fmt.Errorf("%w: grace_days must be between 0 and 30", ErrInvalidRequest)
	}
	if in.VATRate < 0 || in.VATRate > 100 {
		return PaymentSettings{}, fmt.Errorf("%w: vat_rate must be between 0 and 100", ErrInvalidRequest)
	}
	row, err := s.q.UpdatePaymentSettings(ctx, db.UpdatePaymentSettingsParams{
		BankName:            strings.TrimSpace(in.BankName),
		AccountHolder:       strings.TrimSpace(in.AccountHolder),
		Iban:                iban,
		PaymentInstructions: strings.TrimSpace(in.PaymentInstructions),
		OrderTtlDays:        in.OrderTTLDays,
		GraceDays:           in.GraceDays,
		VatRate:             in.VATRate,
	})
	if err != nil {
		return PaymentSettings{}, err
	}
	return mapPaymentSettings(row), nil
}

func mapPaymentSettings(row db.BillingSetting) PaymentSettings {
	return PaymentSettings{
		BankName:            row.BankName,
		AccountHolder:       row.AccountHolder,
		IBAN:                row.Iban,
		PaymentInstructions: row.PaymentInstructions,
		OrderTTLDays:        row.OrderTtlDays,
		GraceDays:           row.GraceDays,
		VATRate:             row.VatRate,
	}
}

func normalizeIBAN(raw string) (string, error) {
	iban := strings.ToUpper(strings.ReplaceAll(strings.TrimSpace(raw), " ", ""))
	if iban == "" {
		return "", nil
	}
	if !ibanRE.MatchString(iban) {
		return "", fmt.Errorf("%w: iban is invalid", ErrInvalidRequest)
	}
	return iban, nil
}
