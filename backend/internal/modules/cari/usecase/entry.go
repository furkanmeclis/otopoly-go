package usecase

import (
	"context"
	"errors"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database/db"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// EntryInfo is one ledger entry with where it came from: SourceType is ""
// for entries made on the cari page (charges, collections, adjustments) and
// the module name (service_job, product_sale, …) for entries a document posted.
type EntryInfo struct {
	Entry
	SourceType   string    `json:"source_type,omitempty"`
	CustomerUUID uuid.UUID `json:"customer_uuid"`
	CustomerName string    `json:"customer_name"`
}

// GetEntry returns one ledger entry of the organization; another
// organization's entry answers ErrNotFound.
func (s *Service) GetEntry(ctx context.Context, entryUUID uuid.UUID) (EntryInfo, error) {
	orgID, err := s.requireOrgID(ctx)
	if err != nil {
		return EntryInfo{}, err
	}
	row, err := s.q.GetCariEntryByUUID(ctx, db.GetCariEntryByUUIDParams{Uuid: entryUUID, OrganizationID: orgID})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return EntryInfo{}, ErrNotFound
		}
		return EntryInfo{}, err
	}
	info := EntryInfo{Entry: mapGetEntry(row), CustomerUUID: row.CustomerUuid, CustomerName: row.CustomerName}
	if row.SourceType.Valid {
		info.SourceType = row.SourceType.String
	}
	return info, nil
}

// GetByCustomer returns the cari account of a customer (by customer uuid);
// another organization's customer answers ErrNotFound.
func (s *Service) GetByCustomer(ctx context.Context, customerUUID uuid.UUID) (AccountDetail, error) {
	orgID, err := s.requireOrgID(ctx)
	if err != nil {
		return AccountDetail{}, err
	}
	customer, err := s.q.GetCustomerByUUID(ctx, db.GetCustomerByUUIDParams{Uuid: customerUUID, OrganizationID: orgID})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return AccountDetail{}, ErrNotFound
		}
		return AccountDetail{}, err
	}
	acc, err := s.q.GetCariAccountByCustomerID(ctx, db.GetCariAccountByCustomerIDParams{CustomerID: customer.ID, OrganizationID: orgID})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return AccountDetail{}, ErrNotFound
		}
		return AccountDetail{}, err
	}
	return s.Get(ctx, acc.Uuid)
}
