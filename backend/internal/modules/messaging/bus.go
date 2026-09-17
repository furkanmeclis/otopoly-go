package messaging

import (
	"context"
	"log/slog"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database/db"
	messagingmodel "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/messaging/model"
	messagingusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/messaging/usecase"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/events"
	"github.com/google/uuid"
)

// PhoneResolver looks up customer org ID and phone number from domain objects.
type PhoneResolver interface {
	GetJobOrgAndPhone(ctx context.Context, jobUUID uuid.UUID) (orgID int64, phone string, err error)
	GetSaleOrgAndPhone(ctx context.Context, saleUUID uuid.UUID) (orgID int64, phone string, err error)
}

// resolverQuerier is the DB surface needed by DBPhoneResolver.
type resolverQuerier interface {
	GetJobOrgAndPhoneByUUID(ctx context.Context, argUuid uuid.UUID) (db.GetJobOrgAndPhoneByUUIDRow, error)
	GetSaleOrgAndPhoneByUUID(ctx context.Context, argUuid uuid.UUID) (db.GetSaleOrgAndPhoneByUUIDRow, error)
}

// DBPhoneResolver implements PhoneResolver using live DB queries.
type DBPhoneResolver struct {
	q resolverQuerier
}

// NewDBPhoneResolver creates a DBPhoneResolver backed by the given querier.
func NewDBPhoneResolver(q resolverQuerier) *DBPhoneResolver {
	return &DBPhoneResolver{q: q}
}

func (r *DBPhoneResolver) GetJobOrgAndPhone(ctx context.Context, jobUUID uuid.UUID) (int64, string, error) {
	row, err := r.q.GetJobOrgAndPhoneByUUID(ctx, jobUUID)
	if err != nil {
		return 0, "", err
	}
	return row.OrganizationID, row.CustomerPhone, nil
}

func (r *DBPhoneResolver) GetSaleOrgAndPhone(ctx context.Context, saleUUID uuid.UUID) (int64, string, error) {
	row, err := r.q.GetSaleOrgAndPhoneByUUID(ctx, saleUUID)
	if err != nil {
		return 0, "", err
	}
	return row.OrganizationID, row.CustomerPhone, nil
}

// RegisterEventHandlers attaches messaging dispatch listeners to the platform bus.
// All handlers are fail-soft: they log errors but always return nil.
func RegisterEventHandlers(bus events.Bus, svc *messagingusecase.Service, resolver PhoneResolver, log *slog.Logger) {
	if bus == nil || svc == nil {
		return
	}
	if log == nil {
		log = slog.Default()
	}

	bus.Subscribe(events.JobsClosed, func(ctx context.Context, event events.Event) error {
		return handleJobClosed(ctx, svc, resolver, event, log)
	})
	bus.Subscribe(events.ContractsInstanceSigned, func(ctx context.Context, event events.Event) error {
		return handleContractSigned(ctx, svc, resolver, event, log)
	})
	bus.Subscribe(events.SalesCreated, func(ctx context.Context, event events.Event) error {
		return handleSaleCreated(ctx, svc, resolver, event, log)
	})
}

func handleJobClosed(ctx context.Context, svc *messagingusecase.Service, resolver PhoneResolver, event events.Event, log *slog.Logger) error {
	jobUUIDStr, _ := event.Payload["job_uuid"].(string)
	if jobUUIDStr == "" {
		return nil
	}
	jobUUID, err := uuid.Parse(jobUUIDStr)
	if err != nil {
		return nil
	}
	orgID, phone, err := resolver.GetJobOrgAndPhone(ctx, jobUUID)
	if err != nil || phone == "" || orgID == 0 {
		return nil // fail-soft: customer has no phone or job not found
	}

	subjectUUID := jobUUID
	dispatchErr := svc.Dispatch(ctx, messagingmodel.DispatchInput{
		OrgID:          orgID,
		EventType:      messagingmodel.EventJobCompleted,
		RecipientPhone: phone,
		Vars: map[string]string{
			"job_uuid": jobUUIDStr,
		},
		SubjectType: "service_job",
		SubjectUUID: &subjectUUID,
	})
	if dispatchErr != nil {
		log.Error("messaging_dispatch_job_closed_failed", "error", dispatchErr, "job_uuid", jobUUIDStr)
	}
	return nil // fail-soft
}

func handleContractSigned(ctx context.Context, svc *messagingusecase.Service, resolver PhoneResolver, event events.Event, log *slog.Logger) error {
	orgIDRaw, _ := event.Payload["org_id"]
	var orgID int64
	switch v := orgIDRaw.(type) {
	case int64:
		orgID = v
	case float64:
		orgID = int64(v)
	case int:
		orgID = int64(v)
	}
	if orgID == 0 {
		return nil
	}

	subjectType, _ := event.Payload["subject_type"].(string)
	subjectUUIDStr, _ := event.Payload["subject_uuid"].(string)
	instanceUUIDStr, _ := event.Payload["instance_uuid"].(string)

	if subjectType != "service_job" || subjectUUIDStr == "" {
		return nil // only support job-linked contracts for now
	}
	subjectUUID, err := uuid.Parse(subjectUUIDStr)
	if err != nil {
		return nil
	}

	_, phone, err := resolver.GetJobOrgAndPhone(ctx, subjectUUID)
	if err != nil || phone == "" {
		return nil // fail-soft
	}

	var instanceUUIDPtr *uuid.UUID
	if instanceUUIDStr != "" {
		if id, parseErr := uuid.Parse(instanceUUIDStr); parseErr == nil {
			instanceUUIDPtr = &id
		}
	}

	dispatchErr := svc.Dispatch(ctx, messagingmodel.DispatchInput{
		OrgID:          orgID,
		EventType:      messagingmodel.EventContractSigned,
		RecipientPhone: phone,
		Vars: map[string]string{
			"instance_uuid": instanceUUIDStr,
		},
		SubjectType: "contract_instance",
		SubjectUUID: instanceUUIDPtr,
	})
	if dispatchErr != nil {
		log.Error("messaging_dispatch_contract_signed_failed", "error", dispatchErr, "instance_uuid", instanceUUIDStr)
	}
	return nil // fail-soft
}

func handleSaleCreated(ctx context.Context, svc *messagingusecase.Service, resolver PhoneResolver, event events.Event, log *slog.Logger) error {
	saleUUIDStr, _ := event.Payload["uuid"].(string)
	if saleUUIDStr == "" {
		return nil
	}
	saleUUID, err := uuid.Parse(saleUUIDStr)
	if err != nil {
		return nil
	}
	orgID, phone, err := resolver.GetSaleOrgAndPhone(ctx, saleUUID)
	if err != nil || phone == "" || orgID == 0 {
		return nil // fail-soft: sale has no customer phone
	}

	subjectUUID := saleUUID
	dispatchErr := svc.Dispatch(ctx, messagingmodel.DispatchInput{
		OrgID:          orgID,
		EventType:      messagingmodel.EventSaleCreated,
		RecipientPhone: phone,
		Vars: map[string]string{
			"sale_uuid": saleUUIDStr,
		},
		SubjectType: "product_sale",
		SubjectUUID: &subjectUUID,
	})
	if dispatchErr != nil {
		log.Error("messaging_dispatch_sale_created_failed", "error", dispatchErr, "sale_uuid", saleUUIDStr)
	}
	return nil // fail-soft
}
