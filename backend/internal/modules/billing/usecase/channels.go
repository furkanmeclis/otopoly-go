package usecase

import (
	"context"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database/db"
)

type Channel interface {
	Kind() string
	Instructions(ctx context.Context, order db.BillingOrder, settings db.BillingSetting) (BankInstructions, error)
}

type bankTransfer struct{}

func (bankTransfer) Kind() string { return "bank_transfer" }

func (bankTransfer) Instructions(_ context.Context, order db.BillingOrder, settings db.BillingSetting) (BankInstructions, error) {
	return BankInstructions{
		BankName:            settings.BankName,
		AccountHolder:       settings.AccountHolder,
		IBAN:                settings.Iban,
		Amount:              numericString(order.Total),
		ReferenceCode:       order.ReferenceCode,
		PaymentInstructions: settings.PaymentInstructions,
	}, nil
}

func channelFor(kind string) Channel {
	switch kind {
	case "bank_transfer", "":
		return bankTransfer{}
	default:
		return bankTransfer{}
	}
}
