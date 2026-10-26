package usecase

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database/db"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/authctx"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/rbac"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// ActivityActor is the member who performed an activity (nil = system,
// public link or automation).
type ActivityActor struct {
	UUID    uuid.UUID `json:"uuid"`
	Name    string    `json:"name"`
	Surname string    `json:"surname"`
}

// ActivityEntry is one audit event of a customer or one of its records.
// Subject is the record kind the event is about: customer, vehicle, job,
// sale, quote, lead, cari_entry, contract (other for anything else).
type ActivityEntry struct {
	UUID         uuid.UUID      `json:"uuid"`
	Action       string         `json:"action"`
	Resource     string         `json:"resource"`
	Subject      string         `json:"subject"`
	ResourceUUID *uuid.UUID     `json:"resource_uuid"`
	Payload      map[string]any `json:"payload"`
	Actor        *ActivityActor `json:"actor"`
	CreatedAt    time.Time      `json:"created_at"`
}

// activitySubjects maps activity resource names to the record kinds of the
// customer feed.
var activitySubjects = map[string]string{
	"customer":          "customer",
	"customer_vehicle":  "vehicle",
	"jobs.job":          "job",
	"sale":              "sale",
	"quote":             "quote",
	"lead":              "lead",
	"cari.entry":        "cari_entry",
	"contract_instance": "contract",
}

// ActivitySubject returns the feed record kind of an activity resource.
func ActivitySubject(resource string) string {
	if s, ok := activitySubjects[resource]; ok {
		return s
	}
	return "other"
}

// activityScope says which related record kinds the caller may see; the
// customer itself and its vehicles need only tenant.customers.read (checked
// by the route).
type activityScope struct {
	jobs, contracts, sales, quotes, leads, cari bool
}

func activityScopeFrom(ctx context.Context) activityScope {
	p, ok := authctx.PrincipalFrom(ctx)
	if !ok {
		return activityScope{}
	}
	return activityScope{
		jobs:      p.HasPermission(rbac.PermTenantJobsRead),
		contracts: p.HasPermission(rbac.PermTenantJobsRead) && p.HasPermission(rbac.PermTenantContractsRead),
		sales:     p.HasPermission(rbac.PermTenantSalesRead),
		quotes:    p.HasPermission(rbac.PermTenantQuotesRead),
		leads:     p.HasPermission(rbac.PermTenantLeadsRead),
		cari:      p.HasPermission(rbac.PermTenantCariRead),
	}
}

// ListActivity pages the activity of a customer and its records (vehicles,
// jobs, job contracts, sales, quotes, leads, cari entries), newest first.
// Record kinds the caller cannot read are left out.
func (s *Service) ListActivity(ctx context.Context, customerUUID uuid.UUID, limit, offset int32) ([]ActivityEntry, int64, error) {
	orgID, err := s.requireOrgID(ctx)
	if err != nil {
		return nil, 0, err
	}
	row, err := s.q.GetCustomerByUUID(ctx, db.GetCustomerByUUIDParams{Uuid: customerUUID, OrganizationID: orgID})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, 0, ErrNotFound
		}
		return nil, 0, err
	}
	scope := activityScopeFrom(ctx)
	rows, err := s.q.ListCustomerActivityEvents(ctx, db.ListCustomerActivityEventsParams{
		OrganizationID: orgID, CustomerID: row.ID,
		IncludeJobs: scope.jobs, IncludeContracts: scope.contracts, IncludeSales: scope.sales,
		IncludeQuotes: scope.quotes, IncludeLeads: scope.leads, IncludeCari: scope.cari,
		LimitCount: limit, OffsetCount: offset,
	})
	if err != nil {
		return nil, 0, err
	}
	total, err := s.q.CountCustomerActivityEvents(ctx, db.CountCustomerActivityEventsParams{
		OrganizationID: orgID, CustomerID: row.ID,
		IncludeJobs: scope.jobs, IncludeContracts: scope.contracts, IncludeSales: scope.sales,
		IncludeQuotes: scope.quotes, IncludeLeads: scope.leads, IncludeCari: scope.cari,
	})
	if err != nil {
		return nil, 0, err
	}
	out := make([]ActivityEntry, 0, len(rows))
	for _, r := range rows {
		e := ActivityEntry{
			UUID: r.Uuid, Action: r.Action, Resource: r.Resource, Subject: ActivitySubject(r.Resource),
			Payload: map[string]any{}, CreatedAt: r.CreatedAt.Time,
		}
		if len(r.Payload) > 0 {
			_ = json.Unmarshal(r.Payload, &e.Payload)
			if e.Payload == nil {
				e.Payload = map[string]any{}
			}
		}
		if r.ResourceUuid.Valid {
			id := uuid.UUID(r.ResourceUuid.Bytes)
			e.ResourceUUID = &id
		}
		if r.ActorUuid.Valid {
			e.Actor = &ActivityActor{UUID: uuid.UUID(r.ActorUuid.Bytes), Name: r.ActorName.String, Surname: r.ActorSurname.String}
		}
		out = append(out, e)
	}
	return out, total, nil
}
