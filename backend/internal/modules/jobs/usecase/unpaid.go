package usecase

import (
	"context"
	"errors"
	"time"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database/db"
	financeusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/finance/usecase"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// UnpaidJob is a job of a customer that has not been paid yet (payment
// status unpaid, not cancelled or voided).
type UnpaidJob struct {
	UUID         uuid.UUID  `json:"uuid"`
	Plate        string     `json:"plate"`
	VehicleLabel string     `json:"vehicle_label"`
	Status       string     `json:"status"`
	TotalAmount  string     `json:"total_amount"`
	Currency     string     `json:"currency"`
	StartedAt    time.Time  `json:"started_at"`
	DeliveredAt  *time.Time `json:"delivered_at,omitempty"`
}

// UnpaidJobs lists a customer's unpaid jobs (newest first, up to limit) with
// the count and sum over all of them. The rule matches the customer summary's
// unpaid_amount, so the assistant and the customer page show the same debt.
type UnpaidJobs struct {
	Jobs        []UnpaidJob `json:"jobs"`
	Count       int64       `json:"count"`
	TotalAmount string      `json:"total_amount"`
}

// UnpaidByCustomer returns the customer's unpaid jobs. Another organization's
// customer answers ErrNotFound.
func (s *Service) UnpaidByCustomer(ctx context.Context, customerUUID uuid.UUID, limit int32) (UnpaidJobs, error) {
	orgID, err := s.requireOrgID(ctx)
	if err != nil {
		return UnpaidJobs{}, err
	}
	customer, err := s.q.GetCustomerByUUID(ctx, db.GetCustomerByUUIDParams{Uuid: customerUUID, OrganizationID: orgID})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return UnpaidJobs{}, ErrNotFound
		}
		return UnpaidJobs{}, err
	}
	if limit <= 0 || limit > 50 {
		limit = 10
	}
	rows, err := s.q.ListUnpaidServiceJobsByCustomer(ctx, db.ListUnpaidServiceJobsByCustomerParams{
		OrganizationID: orgID, CustomerID: customer.ID, LimitCount: limit,
	})
	if err != nil {
		return UnpaidJobs{}, err
	}
	sum, err := s.q.SumUnpaidServiceJobsByCustomer(ctx, db.SumUnpaidServiceJobsByCustomerParams{
		OrganizationID: orgID, CustomerID: customer.ID,
	})
	if err != nil {
		return UnpaidJobs{}, err
	}
	out := UnpaidJobs{Jobs: make([]UnpaidJob, 0, len(rows)), Count: sum.JobCount, TotalAmount: financeusecase.NumericToString(sum.TotalAmount)}
	for _, r := range rows {
		j := UnpaidJob{
			UUID: r.Uuid, Plate: r.Plate, VehicleLabel: r.VehicleLabel, Status: r.Status,
			TotalAmount: financeusecase.NumericToString(r.TotalAmount), Currency: r.Currency, StartedAt: r.StartedAt.Time,
		}
		if r.DeliveredAt.Valid {
			t := r.DeliveredAt.Time
			j.DeliveredAt = &t
		}
		out.Jobs = append(out.Jobs, j)
	}
	return out, nil
}

// UnpaidTotal is a customer's unpaid job count and sum.
type UnpaidTotal struct {
	Count       int64  `json:"count"`
	TotalAmount string `json:"total_amount"`
}

// UnpaidTotalsByCustomers returns the unpaid job count and sum per customer
// uuid (customers without unpaid jobs are left out) in one query.
func (s *Service) UnpaidTotalsByCustomers(ctx context.Context, customerUUIDs []uuid.UUID) (map[uuid.UUID]UnpaidTotal, error) {
	orgID, err := s.requireOrgID(ctx)
	if err != nil {
		return nil, err
	}
	out := map[uuid.UUID]UnpaidTotal{}
	if len(customerUUIDs) == 0 {
		return out, nil
	}
	rows, err := s.q.SumUnpaidServiceJobsByCustomers(ctx, db.SumUnpaidServiceJobsByCustomersParams{OrganizationID: orgID, CustomerUuids: customerUUIDs})
	if err != nil {
		return nil, err
	}
	for _, r := range rows {
		out[r.CustomerUuid] = UnpaidTotal{Count: r.JobCount, TotalAmount: financeusecase.NumericToString(r.TotalAmount)}
	}
	return out, nil
}
