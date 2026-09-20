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
	GetJobMessaging(ctx context.Context, jobUUID uuid.UUID) (db.GetJobOrgAndPhoneByUUIDRow, error)
	GetSaleMessaging(ctx context.Context, saleUUID uuid.UUID) (db.GetSaleOrgAndPhoneByUUIDRow, error)
	GetContractMessaging(ctx context.Context, instanceUUID uuid.UUID) (db.GetContractInstanceMessagingByUUIDRow, error)
}

// resolverQuerier is the DB surface needed by DBPhoneResolver.
type resolverQuerier interface {
	GetJobOrgAndPhoneByUUID(ctx context.Context, argUuid uuid.UUID) (db.GetJobOrgAndPhoneByUUIDRow, error)
	GetSaleOrgAndPhoneByUUID(ctx context.Context, argUuid uuid.UUID) (db.GetSaleOrgAndPhoneByUUIDRow, error)
	GetContractInstanceMessagingByUUID(ctx context.Context, argUuid uuid.UUID) (db.GetContractInstanceMessagingByUUIDRow, error)
}

// DBPhoneResolver implements PhoneResolver using live DB queries.
type DBPhoneResolver struct {
	q resolverQuerier
}

// NewDBPhoneResolver creates a DBPhoneResolver backed by the given querier.
func NewDBPhoneResolver(q resolverQuerier) *DBPhoneResolver {
	return &DBPhoneResolver{q: q}
}

func (r *DBPhoneResolver) GetJobMessaging(ctx context.Context, jobUUID uuid.UUID) (db.GetJobOrgAndPhoneByUUIDRow, error) {
	return r.q.GetJobOrgAndPhoneByUUID(ctx, jobUUID)
}

func (r *DBPhoneResolver) GetSaleMessaging(ctx context.Context, saleUUID uuid.UUID) (db.GetSaleOrgAndPhoneByUUIDRow, error) {
	return r.q.GetSaleOrgAndPhoneByUUID(ctx, saleUUID)
}

func (r *DBPhoneResolver) GetContractMessaging(ctx context.Context, instanceUUID uuid.UUID) (db.GetContractInstanceMessagingByUUIDRow, error) {
	return r.q.GetContractInstanceMessagingByUUID(ctx, instanceUUID)
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

	bus.Subscribe(events.JobsCreated, func(ctx context.Context, event events.Event) error {
		return handleJobEvent(ctx, svc, resolver, event, messagingmodel.EventJobCreated, log)
	})
	bus.Subscribe(events.JobsReady, func(ctx context.Context, event events.Event) error {
		return handleJobEvent(ctx, svc, resolver, event, messagingmodel.EventJobReady, log)
	})
	bus.Subscribe(events.JobsDelivered, func(ctx context.Context, event events.Event) error {
		return handleJobEvent(ctx, svc, resolver, event, messagingmodel.EventJobDelivered, log)
	})
	bus.Subscribe(events.JobsClosed, func(ctx context.Context, event events.Event) error {
		return handleJobEvent(ctx, svc, resolver, event, messagingmodel.EventJobPaid, log)
	})
	bus.Subscribe(events.JobsCancelled, func(ctx context.Context, event events.Event) error {
		return handleJobEvent(ctx, svc, resolver, event, messagingmodel.EventJobCancelled, log)
	})
	bus.Subscribe(events.ContractsInstanceSigned, func(ctx context.Context, event events.Event) error {
		return handleContractSigned(ctx, svc, resolver, event, log)
	})
	bus.Subscribe(events.SalesCreated, func(ctx context.Context, event events.Event) error {
		return handleSaleCreated(ctx, svc, resolver, event, log)
	})
}

func handleJobEvent(
	ctx context.Context,
	svc *messagingusecase.Service,
	resolver PhoneResolver,
	event events.Event,
	eventType string,
	log *slog.Logger,
) error {
	jobUUIDStr, _ := event.Payload["job_uuid"].(string)
	if jobUUIDStr == "" {
		return nil
	}
	jobUUID, err := uuid.Parse(jobUUIDStr)
	if err != nil {
		return nil
	}
	row, err := resolver.GetJobMessaging(ctx, jobUUID)
	if err != nil || row.CustomerPhone == "" || row.OrganizationID == 0 {
		return nil
	}
	subjectUUID := jobUUID
	vars := map[string]string{
		"customer_name": row.CustomerName,
		"business_name": row.BusinessName,
		"amount":        row.TotalAmount,
		"currency":      row.Currency,
		"job_id":        row.JobUuid,
		"plate":         row.Plate,
	}
	dispatchErr := svc.Dispatch(ctx, messagingmodel.DispatchInput{
		OrgID:          row.OrganizationID,
		EventType:      eventType,
		RecipientPhone: row.CustomerPhone,
		Vars:           vars,
		SubjectType:    "service_job",
		SubjectUUID:    &subjectUUID,
	})
	if dispatchErr != nil {
		log.Error("messaging_dispatch_failed", "event_type", eventType, "error", dispatchErr, "job_uuid", jobUUIDStr)
	}
	return nil
}

func handleContractSigned(ctx context.Context, svc *messagingusecase.Service, resolver PhoneResolver, event events.Event, log *slog.Logger) error {
	instanceUUIDStr, _ := event.Payload["instance_uuid"].(string)
	if instanceUUIDStr == "" {
		return nil
	}
	instanceUUID, err := uuid.Parse(instanceUUIDStr)
	if err != nil {
		return nil
	}
	inst, err := resolver.GetContractMessaging(ctx, instanceUUID)
	if err != nil || inst.OrganizationID == 0 {
		return nil
	}
	if inst.SubjectType != "service_job" || inst.SubjectUuid == (uuid.UUID{}) {
		return nil
	}
	jobUUID := inst.SubjectUuid
	job, err := resolver.GetJobMessaging(ctx, jobUUID)
	if err != nil || job.CustomerPhone == "" {
		return nil
	}

	dispatchErr := svc.Dispatch(ctx, messagingmodel.DispatchInput{
		OrgID:          inst.OrganizationID,
		EventType:      messagingmodel.EventContractSigned,
		RecipientPhone: job.CustomerPhone,
		Vars: map[string]string{
			"customer_name":  job.CustomerName,
			"business_name":  inst.BusinessName,
			"contract_title": inst.ContractTitle,
			"instance_uuid":  inst.InstanceUuid,
			"plate":          job.Plate,
			"job_id":         job.JobUuid,
		},
		SubjectType: "contract_instance",
		SubjectUUID: &instanceUUID,
	})
	if dispatchErr != nil {
		log.Error("messaging_dispatch_contract_signed_failed", "error", dispatchErr, "instance_uuid", instanceUUIDStr)
	}
	return nil
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
	row, err := resolver.GetSaleMessaging(ctx, saleUUID)
	if err != nil || row.CustomerPhone == "" || row.OrganizationID == 0 {
		return nil
	}

	subjectUUID := saleUUID
	dispatchErr := svc.Dispatch(ctx, messagingmodel.DispatchInput{
		OrgID:          row.OrganizationID,
		EventType:      messagingmodel.EventSaleCreated,
		RecipientPhone: row.CustomerPhone,
		Vars: map[string]string{
			"customer_name": row.CustomerName,
			"business_name": row.BusinessName,
			"amount":        row.TotalAmount,
			"currency":      row.Currency,
			"sale_uuid":     row.SaleUuid,
			"plate":         "",
		},
		SubjectType: "product_sale",
		SubjectUUID: &subjectUUID,
	})
	if dispatchErr != nil {
		log.Error("messaging_dispatch_sale_created_failed", "error", dispatchErr, "sale_uuid", saleUUIDStr)
	}
	return nil
}
