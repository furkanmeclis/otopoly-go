package usecase

import (
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5/pgtype"
)

// Sectors are the business types an organization may declare (mirrors
// chk_organizations_sector).
var Sectors = []string{"car_wash", "detailing", "ppf_tint", "auto_service", "tyres", "other"}

// ValidSector reports whether s is a known sector.
func ValidSector(s string) bool {
	for _, v := range Sectors {
		if v == s {
			return true
		}
	}
	return false
}

// sectorArg converts an optional sector ("" = none) into the column value.
func sectorArg(raw string) (pgtype.Text, error) {
	s := strings.TrimSpace(raw)
	if s == "" {
		return pgtype.Text{}, nil
	}
	if !ValidSector(s) {
		return pgtype.Text{}, fmt.Errorf("%w: sector must be one of %s", ErrInvalidRequest, strings.Join(Sectors, ", "))
	}
	return pgtype.Text{String: s, Valid: true}, nil
}

func sectorPtr(t pgtype.Text) *string {
	if !t.Valid || t.String == "" {
		return nil
	}
	s := t.String
	return &s
}
