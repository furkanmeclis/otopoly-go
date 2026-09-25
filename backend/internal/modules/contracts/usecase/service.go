package usecase

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database/db"
	financeusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/finance/usecase"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/activity"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/authctx"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/events"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/i18n"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/orgctx"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/pdfrender"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/resourcemeta"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/storage"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/queue"
	"github.com/google/uuid"
	"github.com/hibiken/asynq"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

var (
	ErrNotFound       = errors.New("not found")
	ErrInvalidRequest = errors.New("invalid request")
	ErrConflict       = errors.New("conflict")
)

// QueueClient schedules background contract tasks.
type QueueClient interface {
	Enqueue(task *asynq.Task, opts ...asynq.Option) (*asynq.TaskInfo, error)
}

// Service orchestrates contract presets, templates, instances, signing, and PDF execution.
type Service struct {
	pool          *pgxpool.Pool
	q             *db.Queries
	act           *activity.Recorder
	storage       storage.Driver
	pdf           *pdfrender.Client
	queue         QueueClient
	publicBaseURL string
	bus           events.Bus
	otp           OTPSender
}

// SetEventBus attaches the platform event bus to the contracts service.
func (s *Service) SetEventBus(bus events.Bus) { s.bus = bus }

func (s *Service) publishIfBus(ctx context.Context, name string, payload map[string]any) {
	if s.bus == nil {
		return
	}
	_ = s.bus.Publish(ctx, events.New(name).WithPayload(payload))
}

// New builds a contracts service.
func New(
	pool *pgxpool.Pool,
	q *db.Queries,
	act *activity.Recorder,
	store storage.Driver,
	pdf *pdfrender.Client,
	queueClient QueueClient,
	publicBaseURL string,
) *Service {
	return &Service{
		pool:          pool,
		q:             q,
		act:           act,
		storage:       store,
		pdf:           pdf,
		queue:         queueClient,
		publicBaseURL: strings.TrimRight(strings.TrimSpace(publicBaseURL), "/"),
	}
}

func (s *Service) PlatformResourceMeta() resourcemeta.ResourceMeta {
	return resourcemeta.PlatformContractPresets()
}

func (s *Service) TenantResourceMeta() resourcemeta.ResourceMeta {
	return resourcemeta.TenantContracts()
}

func (s *Service) requireOrgID(ctx context.Context) (int64, error) {
	scope, ok := orgctx.ScopeFrom(ctx)
	if !ok || scope.InternalID <= 0 {
		return 0, errors.New("organization context required")
	}
	return scope.InternalID, nil
}

func (s *Service) requireOrgScope(ctx context.Context) (orgctx.Scope, error) {
	scope, ok := orgctx.ScopeFrom(ctx)
	if !ok || scope.InternalID <= 0 {
		return orgctx.Scope{}, errors.New("organization context required")
	}
	return scope, nil
}

func (s *Service) actorID(ctx context.Context) (int64, error) {
	p, ok := authctx.PrincipalFrom(ctx)
	if !ok || p.UserInternal <= 0 {
		return 0, fmt.Errorf("%w: authenticated user required", ErrInvalidRequest)
	}
	return p.UserInternal, nil
}

func (s *Service) recordActivity(ctx context.Context, action, resource string, resourceUUID *uuid.UUID, payload map[string]any) {
	if s.act == nil {
		return
	}
	var actorID *int64
	if p, ok := authctx.PrincipalFrom(ctx); ok && p.UserInternal > 0 {
		id := p.UserInternal
		actorID = &id
	}
	s.act.Record(ctx, actorID, action, resource, resourceUUID, payload, nil)
}

func (s *Service) objectURL(objectKey string) *string {
	key := strings.TrimSpace(objectKey)
	if s.publicBaseURL == "" || key == "" {
		return nil
	}
	u := s.publicBaseURL + "/" + strings.TrimLeft(key, "/")
	return &u
}

func (s *Service) instancePDFURL(instanceUUID uuid.UUID, pdfKey pgtype.Text) *string {
	if !pdfKey.Valid || strings.TrimSpace(pdfKey.String) == "" {
		return nil
	}
	u := fmt.Sprintf("/v1/tenant/contracts/instances/%s/pdf", instanceUUID.String())
	return &u
}

func (s *Service) enqueueExecutePDF(ctx context.Context, instanceID int64) error {
	if s.queue == nil {
		return s.ExecutePDF(ctx, instanceID)
	}
	task, err := queue.NewContractExecutePDFTask(instanceID)
	if err != nil {
		return err
	}
	_, err = s.queue.Enqueue(task, asynq.Queue(queue.QueueContracts))
	return err
}

// --- Presets (platform) ---

func (s *Service) ListPresets(ctx context.Context, limit, offset int32, filters PresetFilters) ([]Preset, int64, error) {
	sort := strings.TrimSpace(filters.Sort)
	if sort == "" {
		sort = "-created_at"
	}
	switch sort {
	case "title", "-title", "created_at", "-created_at":
	default:
		return nil, 0, fmt.Errorf("%w: unsupported sort", ErrInvalidRequest)
	}
	params := db.ListContractPresetsParams{
		Sort:        sort,
		OffsetCount: offset,
		LimitCount:  limit,
	}
	if filters.Q != "" {
		params.Q = pgtype.Text{String: filters.Q, Valid: true}
	}
	if filters.IsActive != nil {
		params.IsActive = pgtype.Bool{Bool: *filters.IsActive, Valid: true}
	}
	rows, err := s.q.ListContractPresets(ctx, params)
	if err != nil {
		return nil, 0, err
	}
	total, err := s.q.CountContractPresets(ctx, db.CountContractPresetsParams{
		Q:        params.Q,
		IsActive: params.IsActive,
	})
	if err != nil {
		return nil, 0, err
	}
	out := make([]Preset, 0, len(rows))
	for _, row := range rows {
		out = append(out, mapPreset(row))
	}
	return out, total, nil
}

func (s *Service) GetPreset(ctx context.Context, id uuid.UUID) (Preset, error) {
	row, err := s.q.GetContractPresetByUUID(ctx, id)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Preset{}, ErrNotFound
		}
		return Preset{}, err
	}
	return mapPreset(row), nil
}

func (s *Service) CreatePreset(ctx context.Context, in CreatePresetInput) (Preset, error) {
	title := strings.TrimSpace(in.Title)
	if title == "" {
		return Preset{}, fmt.Errorf("%w: title is required", ErrInvalidRequest)
	}
	actor, _ := s.actorID(ctx)
	sigReq := true
	if in.SignatureRequired != nil {
		sigReq = *in.SignatureRequired
	}
	active := true
	if in.IsActive != nil {
		active = *in.IsActive
	}
	category := strings.TrimSpace(in.Category)
	if category == "" {
		category = "general"
	}
	vars, err := marshalVariables(in.Variables)
	if err != nil {
		return Preset{}, err
	}
	slots, err := marshalSignerSlots(in.SignerSlots)
	if err != nil {
		return Preset{}, err
	}
	row, err := s.q.CreateContractPreset(ctx, db.CreateContractPresetParams{
		Title:             title,
		Description:       strings.TrimSpace(in.Description),
		Category:          category,
		ContentJson:       rawOrEmptyObject(in.ContentJSON),
		ContentHtml:       in.ContentHTML,
		Variables:         vars,
		SignerSlots:       slots,
		SignatureRequired: sigReq,
		IsActive:          active,
		CreatedBy:         pgtype.Int8{Int64: actor, Valid: actor > 0},
		OtpRequired:       boolOr(in.OTPRequired, true),
	})
	if err != nil {
		return Preset{}, err
	}
	s.recordActivity(ctx, "platform.contract_preset.create", "contract_preset", &row.Uuid, map[string]any{"title": row.Title})
	return mapPreset(row), nil
}

func (s *Service) PatchPreset(ctx context.Context, id uuid.UUID, in PatchPresetInput) (Preset, error) {
	params := db.UpdateContractPresetParams{Uuid: id}
	if in.Title != nil {
		title := strings.TrimSpace(*in.Title)
		if title == "" {
			return Preset{}, fmt.Errorf("%w: title is required", ErrInvalidRequest)
		}
		params.Title = pgtype.Text{String: title, Valid: true}
	}
	if in.Description != nil {
		params.Description = pgtype.Text{String: strings.TrimSpace(*in.Description), Valid: true}
	}
	if in.Category != nil {
		cat := strings.TrimSpace(*in.Category)
		if cat == "" {
			cat = "general"
		}
		params.Category = pgtype.Text{String: cat, Valid: true}
	}
	if in.ContentJSON != nil {
		params.ContentJson = rawOrEmptyObject(*in.ContentJSON)
	}
	if in.ContentHTML != nil {
		params.ContentHtml = pgtype.Text{String: *in.ContentHTML, Valid: true}
	}
	if in.Variables != nil {
		vars, err := marshalVariables(*in.Variables)
		if err != nil {
			return Preset{}, err
		}
		params.Variables = vars
	}
	if in.SignerSlots != nil {
		slots, err := marshalSignerSlots(*in.SignerSlots)
		if err != nil {
			return Preset{}, err
		}
		params.SignerSlots = slots
	}
	if in.SignatureRequired != nil {
		params.SignatureRequired = pgtype.Bool{Bool: *in.SignatureRequired, Valid: true}
	}
	if in.OTPRequired != nil {
		params.OtpRequired = pgtype.Bool{Bool: *in.OTPRequired, Valid: true}
	}
	if in.IsActive != nil {
		params.IsActive = pgtype.Bool{Bool: *in.IsActive, Valid: true}
	}
	row, err := s.q.UpdateContractPreset(ctx, params)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Preset{}, ErrNotFound
		}
		return Preset{}, err
	}
	s.recordActivity(ctx, "platform.contract_preset.update", "contract_preset", &row.Uuid, map[string]any{"title": row.Title})
	return mapPreset(row), nil
}

func (s *Service) DeletePreset(ctx context.Context, id uuid.UUID) error {
	row, err := s.q.GetContractPresetByUUID(ctx, id)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound
		}
		return err
	}
	if err := s.q.SoftDeleteContractPreset(ctx, id); err != nil {
		return err
	}
	s.recordActivity(ctx, "platform.contract_preset.delete", "contract_preset", &id, map[string]any{"title": row.Title})
	return nil
}

// --- Templates (tenant) ---

func (s *Service) ListTemplates(ctx context.Context, limit, offset int32, filters TemplateFilters) ([]Template, int64, error) {
	orgID, err := s.requireOrgID(ctx)
	if err != nil {
		return nil, 0, err
	}
	sort := strings.TrimSpace(filters.Sort)
	if sort == "" {
		sort = "-created_at"
	}
	switch sort {
	case "title", "-title", "created_at", "-created_at":
	default:
		return nil, 0, fmt.Errorf("%w: unsupported sort", ErrInvalidRequest)
	}
	params := db.ListContractTemplatesParams{
		OrganizationID: orgID,
		Sort:           sort,
		OffsetCount:    offset,
		LimitCount:     limit,
	}
	if filters.Q != "" {
		params.Q = pgtype.Text{String: filters.Q, Valid: true}
	}
	if filters.IsActive != nil {
		params.IsActive = pgtype.Bool{Bool: *filters.IsActive, Valid: true}
	}
	rows, err := s.q.ListContractTemplates(ctx, params)
	if err != nil {
		return nil, 0, err
	}
	total, err := s.q.CountContractTemplates(ctx, db.CountContractTemplatesParams{
		OrganizationID: orgID,
		Q:              params.Q,
		IsActive:       params.IsActive,
	})
	if err != nil {
		return nil, 0, err
	}
	out := make([]Template, 0, len(rows))
	for _, row := range rows {
		out = append(out, mapTemplate(row))
	}
	return out, total, nil
}

func (s *Service) GetTemplate(ctx context.Context, id uuid.UUID) (Template, error) {
	orgID, err := s.requireOrgID(ctx)
	if err != nil {
		return Template{}, err
	}
	row, err := s.q.GetContractTemplateByUUID(ctx, db.GetContractTemplateByUUIDParams{
		Uuid: id, OrganizationID: orgID,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Template{}, ErrNotFound
		}
		return Template{}, err
	}
	return mapTemplate(row), nil
}

func (s *Service) CreateTemplate(ctx context.Context, in CreateTemplateInput) (Template, error) {
	orgID, err := s.requireOrgID(ctx)
	if err != nil {
		return Template{}, err
	}
	actor, err := s.actorID(ctx)
	if err != nil {
		return Template{}, err
	}
	title := strings.TrimSpace(in.Title)
	if title == "" {
		return Template{}, fmt.Errorf("%w: title is required", ErrInvalidRequest)
	}
	var presetID pgtype.Int8
	if in.PresetUUID != nil && *in.PresetUUID != uuid.Nil {
		preset, err := s.q.GetContractPresetByUUID(ctx, *in.PresetUUID)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return Template{}, fmt.Errorf("%w: preset not found", ErrInvalidRequest)
			}
			return Template{}, err
		}
		presetID = pgtype.Int8{Int64: preset.ID, Valid: true}
	}
	sigReq := true
	if in.SignatureRequired != nil {
		sigReq = *in.SignatureRequired
	}
	active := true
	if in.IsActive != nil {
		active = *in.IsActive
	}
	category := strings.TrimSpace(in.Category)
	if category == "" {
		category = "general"
	}
	vars, err := marshalVariables(in.Variables)
	if err != nil {
		return Template{}, err
	}
	slots, err := marshalSignerSlots(in.SignerSlots)
	if err != nil {
		return Template{}, err
	}
	row, err := s.q.CreateContractTemplate(ctx, db.CreateContractTemplateParams{
		OrganizationID:    orgID,
		PresetID:          presetID,
		Title:             title,
		Description:       strings.TrimSpace(in.Description),
		Category:          category,
		ContentJson:       rawOrEmptyObject(in.ContentJSON),
		ContentHtml:       in.ContentHTML,
		Variables:         vars,
		SignerSlots:       slots,
		SignatureRequired: sigReq,
		IsActive:          active,
		CreatedBy:         actor,
		OtpRequired:       boolOr(in.OTPRequired, true),
	})
	if err != nil {
		return Template{}, err
	}
	s.recordActivity(ctx, "tenant.contract_template.create", "contract_template", &row.Uuid, map[string]any{"title": row.Title})
	return mapTemplate(row), nil
}

func (s *Service) CloneTemplate(ctx context.Context, in CloneTemplateInput) (Template, error) {
	orgID, err := s.requireOrgID(ctx)
	if err != nil {
		return Template{}, err
	}
	actor, err := s.actorID(ctx)
	if err != nil {
		return Template{}, err
	}
	if in.PresetUUID == uuid.Nil {
		return Template{}, fmt.Errorf("%w: preset_uuid is required", ErrInvalidRequest)
	}
	preset, err := s.q.GetContractPresetByUUID(ctx, in.PresetUUID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Template{}, ErrNotFound
		}
		return Template{}, err
	}
	title := strings.TrimSpace(in.Title)
	if title == "" {
		title = preset.Title
	}
	row, err := s.q.CreateContractTemplate(ctx, db.CreateContractTemplateParams{
		OrganizationID:    orgID,
		PresetID:          pgtype.Int8{Int64: preset.ID, Valid: true},
		Title:             title,
		Description:       preset.Description,
		Category:          preset.Category,
		ContentJson:       preset.ContentJson,
		ContentHtml:       preset.ContentHtml,
		Variables:         preset.Variables,
		SignerSlots:       preset.SignerSlots,
		SignatureRequired: preset.SignatureRequired,
		IsActive:          true,
		CreatedBy:         actor,
		OtpRequired:       preset.OtpRequired,
	})
	if err != nil {
		return Template{}, err
	}
	s.recordActivity(ctx, "tenant.contract_template.clone", "contract_template", &row.Uuid, map[string]any{
		"title": row.Title, "preset_uuid": in.PresetUUID.String(),
	})
	return mapTemplate(row), nil
}

func (s *Service) PatchTemplate(ctx context.Context, id uuid.UUID, in PatchTemplateInput) (Template, error) {
	orgID, err := s.requireOrgID(ctx)
	if err != nil {
		return Template{}, err
	}
	params := db.UpdateContractTemplateParams{Uuid: id, OrganizationID: orgID}
	if in.Title != nil {
		title := strings.TrimSpace(*in.Title)
		if title == "" {
			return Template{}, fmt.Errorf("%w: title is required", ErrInvalidRequest)
		}
		params.Title = pgtype.Text{String: title, Valid: true}
	}
	if in.Description != nil {
		params.Description = pgtype.Text{String: strings.TrimSpace(*in.Description), Valid: true}
	}
	if in.Category != nil {
		cat := strings.TrimSpace(*in.Category)
		if cat == "" {
			cat = "general"
		}
		params.Category = pgtype.Text{String: cat, Valid: true}
	}
	if in.ContentJSON != nil {
		params.ContentJson = rawOrEmptyObject(*in.ContentJSON)
	}
	if in.ContentHTML != nil {
		params.ContentHtml = pgtype.Text{String: *in.ContentHTML, Valid: true}
	}
	if in.Variables != nil {
		vars, err := marshalVariables(*in.Variables)
		if err != nil {
			return Template{}, err
		}
		params.Variables = vars
	}
	if in.SignerSlots != nil {
		slots, err := marshalSignerSlots(*in.SignerSlots)
		if err != nil {
			return Template{}, err
		}
		params.SignerSlots = slots
	}
	if in.SignatureRequired != nil {
		params.SignatureRequired = pgtype.Bool{Bool: *in.SignatureRequired, Valid: true}
	}
	if in.OTPRequired != nil {
		params.OtpRequired = pgtype.Bool{Bool: *in.OTPRequired, Valid: true}
	}
	if in.IsActive != nil {
		params.IsActive = pgtype.Bool{Bool: *in.IsActive, Valid: true}
	}
	row, err := s.q.UpdateContractTemplate(ctx, params)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Template{}, ErrNotFound
		}
		return Template{}, err
	}
	s.recordActivity(ctx, "tenant.contract_template.update", "contract_template", &row.Uuid, map[string]any{"title": row.Title})
	return mapTemplate(row), nil
}

func (s *Service) DeleteTemplate(ctx context.Context, id uuid.UUID) error {
	orgID, err := s.requireOrgID(ctx)
	if err != nil {
		return err
	}
	row, err := s.q.GetContractTemplateByUUID(ctx, db.GetContractTemplateByUUIDParams{
		Uuid: id, OrganizationID: orgID,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound
		}
		return err
	}
	if err := s.q.SoftDeleteContractTemplate(ctx, db.SoftDeleteContractTemplateParams{
		Uuid: id, OrganizationID: orgID,
	}); err != nil {
		return err
	}
	s.recordActivity(ctx, "tenant.contract_template.delete", "contract_template", &id, map[string]any{"title": row.Title})
	return nil
}

// --- Instances ---

func (s *Service) ListInstances(ctx context.Context, limit, offset int32, filters InstanceFilters) ([]Instance, int64, error) {
	orgID, err := s.requireOrgID(ctx)
	if err != nil {
		return nil, 0, err
	}
	params := db.ListContractInstancesParams{
		OrganizationID: orgID,
		OffsetCount:    offset,
		LimitCount:     limit,
	}
	if filters.Q != "" {
		params.Q = pgtype.Text{String: filters.Q, Valid: true}
	}
	if filters.Status != "" {
		params.Status = pgtype.Text{String: filters.Status, Valid: true}
	}
	if filters.SubjectType != "" {
		params.SubjectType = pgtype.Text{String: filters.SubjectType, Valid: true}
	}
	if filters.SubjectUUID != nil {
		params.SubjectUuid = pgtype.UUID{Bytes: *filters.SubjectUUID, Valid: true}
	}
	rows, err := s.q.ListContractInstances(ctx, params)
	if err != nil {
		return nil, 0, err
	}
	total, err := s.q.CountContractInstances(ctx, db.CountContractInstancesParams{
		OrganizationID: orgID,
		Status:         params.Status,
		SubjectType:    params.SubjectType,
		SubjectUuid:    params.SubjectUuid,
		Q:              params.Q,
	})
	if err != nil {
		return nil, 0, err
	}
	out := make([]Instance, 0, len(rows))
	for _, row := range rows {
		out = append(out, s.mapInstance(row, nil, nil, nil))
	}
	return out, total, nil
}

func (s *Service) GetInstance(ctx context.Context, id uuid.UUID) (Instance, error) {
	orgID, err := s.requireOrgID(ctx)
	if err != nil {
		return Instance{}, err
	}
	row, err := s.q.GetContractInstanceByUUID(ctx, db.GetContractInstanceByUUIDParams{
		Uuid: id, OrganizationID: orgID,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Instance{}, ErrNotFound
		}
		return Instance{}, err
	}
	signers, err := s.q.ListContractSignersByInstance(ctx, row.ID)
	if err != nil {
		return Instance{}, err
	}
	sigs, err := s.q.ListContractSignaturesByInstance(ctx, row.ID)
	if err != nil {
		return Instance{}, err
	}
	media, err := s.q.ListContractMediaByInstance(ctx, row.ID)
	if err != nil {
		return Instance{}, err
	}
	return s.mapInstance(row, signers, sigs, media), nil
}

func (s *Service) CreateInstance(ctx context.Context, in CreateInstanceInput) (Instance, error) {
	scope, err := s.requireOrgScope(ctx)
	if err != nil {
		return Instance{}, err
	}
	actor, err := s.actorID(ctx)
	if err != nil {
		return Instance{}, err
	}
	subjectType := strings.TrimSpace(in.SubjectType)
	if subjectType == "" {
		subjectType = "service_job"
	}
	if subjectType != "service_job" {
		return Instance{}, fmt.Errorf("%w: unsupported subject_type", ErrInvalidRequest)
	}
	if in.TemplateUUID == uuid.Nil || in.SubjectUUID == uuid.Nil {
		return Instance{}, fmt.Errorf("%w: template_uuid and subject_uuid are required", ErrInvalidRequest)
	}

	tmpl, err := s.q.GetContractTemplateByUUID(ctx, db.GetContractTemplateByUUIDParams{
		Uuid: in.TemplateUUID, OrganizationID: scope.InternalID,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Instance{}, fmt.Errorf("%w: template not found", ErrNotFound)
		}
		return Instance{}, err
	}
	if !tmpl.IsActive {
		return Instance{}, fmt.Errorf("%w: template is inactive", ErrInvalidRequest)
	}

	job, err := s.q.GetServiceJobByUUID(ctx, db.GetServiceJobByUUIDParams{
		Uuid: in.SubjectUUID, OrganizationID: scope.InternalID,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Instance{}, fmt.Errorf("%w: service job not found", ErrNotFound)
		}
		return Instance{}, err
	}
	org, err := s.q.GetOrganizationByID(ctx, scope.InternalID)
	if err != nil {
		return Instance{}, err
	}
	customerEmail := ""
	if customer, cerr := s.q.GetCustomerByUUID(ctx, db.GetCustomerByUUIDParams{
		Uuid: job.CustomerUuid, OrganizationID: scope.InternalID,
	}); cerr == nil {
		customerEmail = customer.Email
	}

	resolved := resolveContractVariables(job, org, customerEmail)
	contentHTML := replaceVariables(tmpl.ContentHtml, resolved)
	resolvedJSON, err := json.Marshal(resolved)
	if err != nil {
		return Instance{}, err
	}
	title := strings.TrimSpace(in.Title)
	if title == "" {
		title = tmpl.Title
	}
	slots, err := unmarshalSignerSlots(tmpl.SignerSlots)
	if err != nil {
		return Instance{}, err
	}

	locale := "tr"
	actorName := ""
	if user, uerr := s.q.GetUserByID(ctx, actor); uerr == nil {
		locale = string(i18n.Normalize(user.Locale))
		actorName = strings.TrimSpace(user.Name + " " + user.Surname)
	}

	status := "pending"
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return Instance{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	qtx := s.q.WithTx(tx)

	nextNumber, err := qtx.NextContractInstanceNumber(ctx, scope.InternalID)
	if err != nil {
		return Instance{}, err
	}

	row, err := qtx.CreateContractInstance(ctx, db.CreateContractInstanceParams{
		OrganizationID:    scope.InternalID,
		TemplateID:        pgtype.Int8{Int64: tmpl.ID, Valid: true},
		Title:             title,
		SubjectType:       subjectType,
		SubjectUuid:       in.SubjectUUID,
		ContentJson:       tmpl.ContentJson,
		ContentHtml:       contentHTML,
		VariablesResolved: resolvedJSON,
		SignatureRequired: tmpl.SignatureRequired,
		Status:            status,
		CreatedBy:         actor,
		Number:            nextNumber,
		Locale:            locale,
		OtpRequired:       tmpl.OtpRequired,
	})
	if err != nil {
		return Instance{}, err
	}

	for i, slot := range slots {
		role := strings.TrimSpace(slot.Role)
		label := strings.TrimSpace(slot.Label)
		if role == "" || label == "" {
			continue
		}
		suggestedName, phone := suggestSigner(role, job, actorName)
		if _, err := qtx.CreateContractSigner(ctx, db.CreateContractSignerParams{
			OrganizationID: scope.InternalID,
			InstanceID:     row.ID,
			Role:           role,
			Label:          label,
			Required:       slot.Required,
			SortOrder:      int32(i),
			Status:         "pending",
			SuggestedName:  suggestedName,
			Phone:          phone,
		}); err != nil {
			return Instance{}, err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return Instance{}, err
	}

	s.recordActivity(ctx, "tenant.contract_instance.create", "contract_instance", &row.Uuid, map[string]any{
		"title": row.Title, "subject_uuid": in.SubjectUUID.String(),
	})

	pending, err := s.q.CountPendingRequiredSigners(ctx, row.ID)
	if err != nil {
		return Instance{}, err
	}
	if !tmpl.SignatureRequired || pending == 0 {
		if err := s.enqueueExecutePDF(ctx, row.ID); err != nil {
			_ = s.q.SetContractInstancePDFError(ctx, db.SetContractInstancePDFErrorParams{
				ID: row.ID, PdfError: err.Error(),
			})
		}
	}

	return s.GetInstance(ctx, row.Uuid)
}

func (s *Service) VoidInstance(ctx context.Context, id uuid.UUID) (Instance, error) {
	orgID, err := s.requireOrgID(ctx)
	if err != nil {
		return Instance{}, err
	}
	actor, err := s.actorID(ctx)
	if err != nil {
		return Instance{}, err
	}
	row, err := s.q.GetContractInstanceByUUID(ctx, db.GetContractInstanceByUUIDParams{
		Uuid: id, OrganizationID: orgID,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Instance{}, ErrNotFound
		}
		return Instance{}, err
	}
	if row.Status != "draft" && row.Status != "pending" {
		return Instance{}, fmt.Errorf("%w: only draft/pending contracts can be voided", ErrConflict)
	}
	now := time.Now()
	updated, err := s.q.UpdateContractInstanceStatus(ctx, db.UpdateContractInstanceStatusParams{
		ID:             row.ID,
		OrganizationID: orgID,
		Status:         "voided",
		VoidedAt:       pgtype.Timestamptz{Time: now, Valid: true},
		VoidedBy:       pgtype.Int8{Int64: actor, Valid: true},
	})
	if err != nil {
		return Instance{}, err
	}
	s.recordActivity(ctx, "tenant.contract_instance.void", "contract_instance", &id, map[string]any{"title": updated.Title})
	return s.GetInstance(ctx, id)
}

func (s *Service) Sign(ctx context.Context, instanceUUID, signerUUID uuid.UUID, in SignInput) (Instance, error) {
	scope, err := s.requireOrgScope(ctx)
	if err != nil {
		return Instance{}, err
	}
	actor, err := s.actorID(ctx)
	if err != nil {
		return Instance{}, err
	}
	displayName := strings.TrimSpace(in.DisplayName)
	if displayName == "" {
		return Instance{}, fmt.Errorf("%w: display_name is required", ErrInvalidRequest)
	}
	pngRaw := stripDataURL(in.SignaturePNGBase64)
	if pngRaw == "" {
		return Instance{}, fmt.Errorf("%w: signature_png_base64 is required", ErrInvalidRequest)
	}
	pngBytes, err := base64.StdEncoding.DecodeString(pngRaw)
	if err != nil {
		// try raw URL-encoding-safe alphabet
		pngBytes, err = base64.RawStdEncoding.DecodeString(pngRaw)
		if err != nil {
			return Instance{}, fmt.Errorf("%w: signature_png_base64 is invalid", ErrInvalidRequest)
		}
	}
	if len(pngBytes) == 0 {
		return Instance{}, fmt.Errorf("%w: signature image is empty", ErrInvalidRequest)
	}

	inst, err := s.q.GetContractInstanceByUUID(ctx, db.GetContractInstanceByUUIDParams{
		Uuid: instanceUUID, OrganizationID: scope.InternalID,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Instance{}, ErrNotFound
		}
		return Instance{}, err
	}
	if inst.Status != "pending" && inst.Status != "draft" {
		return Instance{}, fmt.Errorf("%w: contract is not open for signing", ErrConflict)
	}

	signer, err := s.q.GetContractSignerByUUID(ctx, db.GetContractSignerByUUIDParams{
		Uuid: signerUUID, OrganizationID: scope.InternalID, InstanceID: inst.ID,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Instance{}, ErrNotFound
		}
		return Instance{}, err
	}
	if signer.Status == "signed" {
		return Instance{}, fmt.Errorf("%w: signer already signed", ErrConflict)
	}
	if signerRequiresOTP(inst, signer) && !signerOTPFresh(signer, time.Now()) {
		return Instance{}, fmt.Errorf("%w: verify the WhatsApp code before signing", ErrOTPRequired)
	}

	objectKey := storage.ContractSignatureObjectKey(scope.UUID, inst.Uuid, signer.Uuid)
	if err := s.storage.Upload(ctx, storage.File{
		Body:        bytes.NewReader(pngBytes),
		Size:        int64(len(pngBytes)),
		ContentType: "image/png",
		Filename:    signer.Uuid.String() + ".png",
	}, objectKey); err != nil {
		return Instance{}, fmt.Errorf("upload signature: %w", err)
	}
	sum := sha256.Sum256(pngBytes)
	shaHex := hex.EncodeToString(sum[:])

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return Instance{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	qtx := s.q.WithTx(tx)

	if _, err := qtx.CreateContractSignature(ctx, db.CreateContractSignatureParams{
		OrganizationID: scope.InternalID,
		InstanceID:     inst.ID,
		SignerID:       signer.ID,
		DisplayName:    displayName,
		ObjectKey:      objectKey,
		ContentSha256:  shaHex,
		SignedByUserID: actor,
		IpAddress:      strings.TrimSpace(in.IPAddress),
		UserAgent:      strings.TrimSpace(in.UserAgent),
	}); err != nil {
		return Instance{}, err
	}
	if _, err := qtx.MarkContractSignerSigned(ctx, signer.ID); err != nil {
		return Instance{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return Instance{}, err
	}

	s.recordActivity(ctx, "tenant.contract_instance.sign", "contract_instance", &inst.Uuid, map[string]any{
		"signer_uuid": signerUUID.String(), "display_name": displayName,
	})

	pending, err := s.q.CountPendingRequiredSigners(ctx, inst.ID)
	if err != nil {
		return Instance{}, err
	}
	if pending == 0 {
		if err := s.enqueueExecutePDF(ctx, inst.ID); err != nil {
			_ = s.q.SetContractInstancePDFError(ctx, db.SetContractInstancePDFErrorParams{
				ID: inst.ID, PdfError: err.Error(),
			})
		}
		subjectUUIDStr := ""
		if inst.SubjectUuid != (uuid.UUID{}) {
			subjectUUIDStr = inst.SubjectUuid.String()
		}
		s.publishIfBus(ctx, events.ContractsInstanceSigned, map[string]any{
			"instance_uuid": inst.Uuid.String(),
			"subject_type":  inst.SubjectType,
			"subject_uuid":  subjectUUIDStr,
			"org_id":        scope.InternalID,
		})
	}
	return s.GetInstance(ctx, instanceUUID)
}

func (s *Service) UploadMedia(ctx context.Context, instanceUUID uuid.UUID, in UploadMediaInput) (Media, error) {
	scope, err := s.requireOrgScope(ctx)
	if err != nil {
		return Media{}, err
	}
	actor, err := s.actorID(ctx)
	if err != nil {
		return Media{}, err
	}
	if len(in.Body) == 0 {
		return Media{}, fmt.Errorf("%w: file is required", ErrInvalidRequest)
	}
	inst, err := s.q.GetContractInstanceByUUID(ctx, db.GetContractInstanceByUUIDParams{
		Uuid: instanceUUID, OrganizationID: scope.InternalID,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Media{}, ErrNotFound
		}
		return Media{}, err
	}
	if inst.Status == "executed" || inst.Status == "voided" {
		return Media{}, fmt.Errorf("%w: cannot attach media to %s contract", ErrConflict, inst.Status)
	}

	// Never trust the client Content-Type or file extension: media lands in a
	// publicly readable bucket, so HTML/SVG uploads would be served as active
	// content. Sniff the bytes and allow only raster images and PDF.
	ct, ext, ok := sniffContractMedia(in.Body)
	if !ok {
		return Media{}, fmt.Errorf("%w: file must be a JPEG, PNG, WebP, GIF image or a PDF", ErrInvalidRequest)
	}
	mediaUUID := uuid.New()
	objectKey := storage.ContractMediaObjectKey(scope.UUID, inst.Uuid, mediaUUID, ext)
	if err := s.storage.Upload(ctx, storage.File{
		Body:        bytes.NewReader(in.Body),
		Size:        int64(len(in.Body)),
		ContentType: ct,
		Filename:    in.FileName,
	}, objectKey); err != nil {
		return Media{}, fmt.Errorf("upload media: %w", err)
	}

	existing, err := s.q.ListContractMediaByInstance(ctx, inst.ID)
	if err != nil {
		return Media{}, err
	}
	row, err := s.q.CreateContractMedia(ctx, db.CreateContractMediaParams{
		OrganizationID: scope.InternalID,
		InstanceID:     inst.ID,
		ObjectKey:      objectKey,
		ContentType:    ct,
		FileName:       strings.TrimSpace(in.FileName),
		ByteSize:       int64(len(in.Body)),
		Caption:        strings.TrimSpace(in.Caption),
		SortOrder:      int32(len(existing)),
		UploadedBy:     actor,
	})
	if err != nil {
		return Media{}, err
	}
	s.recordActivity(ctx, "tenant.contract_instance.media_upload", "contract_instance", &inst.Uuid, map[string]any{
		"media_uuid": row.Uuid.String(),
	})
	return s.mapMedia(row), nil
}

func (s *Service) DeleteMedia(ctx context.Context, instanceUUID, mediaUUID uuid.UUID) error {
	orgID, err := s.requireOrgID(ctx)
	if err != nil {
		return err
	}
	inst, err := s.q.GetContractInstanceByUUID(ctx, db.GetContractInstanceByUUIDParams{
		Uuid: instanceUUID, OrganizationID: orgID,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound
		}
		return err
	}
	if inst.Status == "executed" || inst.Status == "voided" {
		return fmt.Errorf("%w: cannot delete media from %s contract", ErrConflict, inst.Status)
	}
	media, err := s.q.GetContractMediaByUUID(ctx, db.GetContractMediaByUUIDParams{
		Uuid: mediaUUID, OrganizationID: orgID, InstanceID: inst.ID,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound
		}
		return err
	}
	if err := s.q.DeleteContractMedia(ctx, db.DeleteContractMediaParams{
		Uuid: mediaUUID, OrganizationID: orgID, InstanceID: inst.ID,
	}); err != nil {
		return err
	}
	if s.storage != nil && media.ObjectKey != "" {
		_ = s.storage.Delete(ctx, media.ObjectKey)
	}
	s.recordActivity(ctx, "tenant.contract_instance.media_delete", "contract_instance", &inst.Uuid, map[string]any{
		"media_uuid": mediaUUID.String(),
	})
	return nil
}

// DownloadPDF returns the executed PDF stream for an instance.
func (s *Service) DownloadPDF(ctx context.Context, instanceUUID uuid.UUID) (io.ReadCloser, string, string, error) {
	orgID, err := s.requireOrgID(ctx)
	if err != nil {
		return nil, "", "", err
	}
	inst, err := s.q.GetContractInstanceByUUID(ctx, db.GetContractInstanceByUUIDParams{
		Uuid: instanceUUID, OrganizationID: orgID,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, "", "", ErrNotFound
		}
		return nil, "", "", err
	}
	if !inst.PdfObjectKey.Valid || strings.TrimSpace(inst.PdfObjectKey.String) == "" {
		return nil, "", "", fmt.Errorf("%w: pdf not ready", ErrNotFound)
	}
	rc, _, err := s.storage.Download(ctx, inst.PdfObjectKey.String)
	if err != nil {
		return nil, "", "", err
	}
	filename := sanitizeFileName(inst.Title) + ".pdf"
	return rc, "application/pdf", filename, nil
}

// ExecutePDF renders and stores the executed PDF for an instance (worker entrypoint).
func (s *Service) ExecutePDF(ctx context.Context, instanceID int64) error {
	inst, err := s.q.GetContractInstanceByID(ctx, instanceID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound
		}
		return err
	}
	if inst.Status == "voided" {
		return nil
	}
	if inst.Status == "executed" && inst.PdfObjectKey.Valid && inst.PdfObjectKey.String != "" {
		return nil
	}

	org, err := s.q.GetOrganizationByID(ctx, inst.OrganizationID)
	if err != nil {
		return err
	}
	signers, err := s.q.ListContractSignersByInstance(ctx, inst.ID)
	if err != nil {
		return err
	}
	sigs, err := s.q.ListContractSignaturesByInstance(ctx, inst.ID)
	if err != nil {
		return err
	}
	mediaRows, err := s.q.ListContractMediaByInstance(ctx, inst.ID)
	if err != nil {
		return err
	}

	sigBySigner := make(map[int64]db.ContractSignature, len(sigs))
	for _, sig := range sigs {
		sigBySigner[sig.SignerID] = sig
	}

	embeds := make([]signatureEmbed, 0, len(signers))
	for _, signer := range signers {
		emb := signatureEmbed{Label: signer.Label, Role: signer.Role}
		if signer.OtpVerifiedAt.Valid {
			emb.OTPChannel = signer.OtpChannel
			emb.OTPPhoneMasked = maskPhone(signer.OtpPhone)
			emb.OTPVerifiedAt = signer.OtpVerifiedAt.Time
		}
		if sig, ok := sigBySigner[signer.ID]; ok {
			emb.DisplayName = sig.DisplayName
			emb.SignedAt = sig.SignedAt.Time
			if data, err := s.downloadBytes(ctx, sig.ObjectKey); err == nil && len(data) > 0 {
				emb.PNGBase64 = base64.StdEncoding.EncodeToString(data)
			}
		}
		embeds = append(embeds, emb)
	}

	mediaEmbeds := make([]mediaEmbed, 0, len(mediaRows))
	for _, m := range mediaRows {
		emb := mediaEmbed{
			Caption:     m.Caption,
			ContentType: m.ContentType,
			FileName:    m.FileName,
		}
		if data, err := s.downloadBytes(ctx, m.ObjectKey); err == nil && len(data) > 0 {
			emb.DataBase64 = base64.StdEncoding.EncodeToString(data)
		}
		mediaEmbeds = append(mediaEmbeds, emb)
	}

	htmlDoc := buildContractHTML(contractPDFOptions{
		Title:        inst.Title,
		NumberLabel:  formatContractNumber(inst.Number),
		ContentHTML:  inst.ContentHtml,
		OrgName:      org.Name,
		OrgAddress:   formatOrgFullAddress(org),
		OrgPhone:     org.Phone,
		OrgEmail:     org.Email,
		PrimaryColor: org.PrimaryColor,
		Locale:       i18n.Normalize(inst.Locale),
		CreatedAt:    inst.CreatedAt.Time,
		Signatures:   embeds,
		Media:        mediaEmbeds,
	})
	pdfBytes, err := s.pdf.HTMLToPDF(ctx, htmlDoc)
	if err != nil {
		_ = s.q.SetContractInstancePDFError(ctx, db.SetContractInstancePDFErrorParams{
			ID: inst.ID, PdfError: err.Error(),
		})
		return err
	}

	objectKey := storage.ContractExecutedPDFObjectKey(org.Uuid, inst.Uuid)
	if err := s.storage.Upload(ctx, storage.File{
		Body:        bytes.NewReader(pdfBytes),
		Size:        int64(len(pdfBytes)),
		ContentType: "application/pdf",
		Filename:    "executed.pdf",
	}, objectKey); err != nil {
		_ = s.q.SetContractInstancePDFError(ctx, db.SetContractInstancePDFErrorParams{
			ID: inst.ID, PdfError: err.Error(),
		})
		return err
	}

	sum := sha256.Sum256([]byte(htmlDoc))
	shaHex := hex.EncodeToString(sum[:])
	now := time.Now()
	_, err = s.q.UpdateContractInstanceStatus(ctx, db.UpdateContractInstanceStatusParams{
		ID:             inst.ID,
		OrganizationID: inst.OrganizationID,
		Status:         "executed",
		ContentSha256:  pgtype.Text{String: shaHex, Valid: true},
		PdfObjectKey:   pgtype.Text{String: objectKey, Valid: true},
		PdfError:       pgtype.Text{String: "", Valid: true},
		ExecutedAt:     pgtype.Timestamptz{Time: now, Valid: true},
	})
	return err
}

func (s *Service) downloadBytes(ctx context.Context, objectKey string) ([]byte, error) {
	if s.storage == nil || strings.TrimSpace(objectKey) == "" {
		return nil, fmt.Errorf("no storage")
	}
	rc, _, err := s.storage.Download(ctx, objectKey)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rc.Close() }()
	return io.ReadAll(rc)
}

// --- mappers / helpers ---

func mapPreset(row db.ContractPreset) Preset {
	return Preset{
		UUID:              row.Uuid,
		Title:             row.Title,
		Description:       row.Description,
		Category:          row.Category,
		ContentJSON:       rawOrEmptyObject(row.ContentJson),
		ContentHTML:       row.ContentHtml,
		Variables:         mustUnmarshalVariables(row.Variables),
		SignerSlots:       mustUnmarshalSignerSlots(row.SignerSlots),
		SignatureRequired: row.SignatureRequired,
		OTPRequired:       row.OtpRequired,
		IsActive:          row.IsActive,
		CreatedAt:         row.CreatedAt.Time,
		UpdatedAt:         row.UpdatedAt.Time,
	}
}

func mapTemplate(row db.ContractTemplate) Template {
	return Template{
		UUID:              row.Uuid,
		Title:             row.Title,
		Description:       row.Description,
		Category:          row.Category,
		ContentJSON:       rawOrEmptyObject(row.ContentJson),
		ContentHTML:       row.ContentHtml,
		Variables:         mustUnmarshalVariables(row.Variables),
		SignerSlots:       mustUnmarshalSignerSlots(row.SignerSlots),
		SignatureRequired: row.SignatureRequired,
		OTPRequired:       row.OtpRequired,
		IsActive:          row.IsActive,
		CreatedAt:         row.CreatedAt.Time,
		UpdatedAt:         row.UpdatedAt.Time,
	}
}

func (s *Service) mapInstance(
	row db.ContractInstance,
	signers []db.ContractSigner,
	sigs []db.ContractSignature,
	media []db.ContractMedium,
) Instance {
	out := Instance{
		UUID:              row.Uuid,
		Number:            row.Number,
		NumberLabel:       formatContractNumber(row.Number),
		Locale:            row.Locale,
		Title:             row.Title,
		SubjectType:       row.SubjectType,
		SubjectUUID:       row.SubjectUuid,
		ContentJSON:       rawOrEmptyObject(row.ContentJson),
		ContentHTML:       row.ContentHtml,
		VariablesResolved: mustUnmarshalStringMap(row.VariablesResolved),
		SignatureRequired: row.SignatureRequired,
		OTPRequired:       row.OtpRequired,
		Status:            row.Status,
		PDFError:          row.PdfError,
		PDFURL:            s.instancePDFURL(row.Uuid, row.PdfObjectKey),
		CreatedAt:         row.CreatedAt.Time,
		UpdatedAt:         row.UpdatedAt.Time,
	}
	if row.ContentSha256.Valid && row.ContentSha256.String != "" {
		v := row.ContentSha256.String
		out.ContentSHA256 = &v
	}
	if row.PdfObjectKey.Valid && row.PdfObjectKey.String != "" {
		v := row.PdfObjectKey.String
		out.PDFObjectKey = &v
	}
	if row.ExecutedAt.Valid {
		t := row.ExecutedAt.Time
		out.ExecutedAt = &t
	}
	if row.VoidedAt.Valid {
		t := row.VoidedAt.Time
		out.VoidedAt = &t
	}

	now := time.Now()
	signerUUIDByID := make(map[int64]uuid.UUID, len(signers))
	if len(signers) > 0 {
		out.Signers = make([]Signer, 0, len(signers))
		for _, sg := range signers {
			signerUUIDByID[sg.ID] = sg.Uuid
			item := Signer{
				UUID:          sg.Uuid,
				Role:          sg.Role,
				Label:         sg.Label,
				Required:      sg.Required,
				SortOrder:     sg.SortOrder,
				Status:        sg.Status,
				SuggestedName: sg.SuggestedName,
				Phone:         sg.Phone,
				OTPRequired:   signerRequiresOTP(row, sg),
				OTPVerified:   signerOTPFresh(sg, now) || (sg.Status == "signed" && sg.OtpVerifiedAt.Valid),
				OTPChannel:    sg.OtpChannel,
				CreatedAt:     sg.CreatedAt.Time,
				UpdatedAt:     sg.UpdatedAt.Time,
			}
			if sg.OtpVerifiedAt.Valid {
				t := sg.OtpVerifiedAt.Time
				item.OTPVerifiedAt = &t
				item.OTPPhoneMasked = maskPhone(sg.OtpPhone)
			}
			out.Signers = append(out.Signers, item)
		}
	}
	if len(sigs) > 0 {
		out.Signatures = make([]Signature, 0, len(sigs))
		for _, sig := range sigs {
			out.Signatures = append(out.Signatures, Signature{
				UUID:           sig.Uuid,
				SignerUUID:     signerUUIDByID[sig.SignerID],
				DisplayName:    sig.DisplayName,
				ObjectKey:      sig.ObjectKey,
				URL:            s.objectURL(sig.ObjectKey),
				ContentSHA256:  sig.ContentSha256,
				SignedByUserID: sig.SignedByUserID,
				IPAddress:      sig.IpAddress,
				UserAgent:      sig.UserAgent,
				SignedAt:       sig.SignedAt.Time,
			})
		}
	}
	if len(media) > 0 {
		out.Media = make([]Media, 0, len(media))
		for _, m := range media {
			out.Media = append(out.Media, s.mapMedia(m))
		}
	}
	return out
}

func (s *Service) mapMedia(row db.ContractMedium) Media {
	return Media{
		UUID:        row.Uuid,
		ObjectKey:   row.ObjectKey,
		URL:         s.objectURL(row.ObjectKey),
		ContentType: row.ContentType,
		FileName:    row.FileName,
		ByteSize:    row.ByteSize,
		Caption:     row.Caption,
		SortOrder:   row.SortOrder,
		CreatedAt:   row.CreatedAt.Time,
	}
}

func rawOrEmptyObject(raw []byte) json.RawMessage {
	if len(bytes.TrimSpace(raw)) == 0 {
		return json.RawMessage(`{}`)
	}
	return json.RawMessage(raw)
}

func resolveContractVariables(
	job db.GetServiceJobByUUIDRow,
	org db.Organization,
	customerEmail string,
) map[string]string {
	return map[string]string{
		"customer_name":    job.CustomerName,
		"customer_phone":   job.CustomerPhone,
		"customer_email":   customerEmail,
		"plate":            job.Plate,
		"vehicle_label":    job.VehicleLabel,
		"job_total":        financeusecase.NumericToString(job.TotalAmount),
		"job_currency":     job.Currency,
		"job_notes":        job.Notes,
		"org_name":         org.Name,
		"org_phone":        org.Phone,
		"org_email":        org.Email,
		"org_address":      org.Address,
		"org_city":         org.City,
		"org_district":     org.District,
		"org_full_address": formatOrgFullAddress(org),
		"org_website":      org.Website,
		"today":            time.Now().Format("02.01.2006"),
	}
}

// suggestSigner resolves the pre-filled name/phone for a signer slot.
func suggestSigner(role string, job db.GetServiceJobByUUIDRow, actorName string) (name, phone string) {
	switch role {
	case "customer":
		return strings.TrimSpace(job.CustomerName), strings.TrimSpace(job.CustomerPhone)
	case "staff":
		if n := strings.TrimSpace(job.AssigneeName); n != "" {
			return n, ""
		}
		return actorName, ""
	default:
		return "", ""
	}
}

func boolOr(v *bool, fallback bool) bool {
	if v == nil {
		return fallback
	}
	return *v
}

func formatOrgFullAddress(org db.Organization) string {
	parts := make([]string, 0, 3)
	if s := strings.TrimSpace(org.Address); s != "" {
		parts = append(parts, s)
	}
	if s := strings.TrimSpace(org.District); s != "" {
		parts = append(parts, s)
	}
	if s := strings.TrimSpace(org.City); s != "" {
		parts = append(parts, s)
	}
	return strings.Join(parts, ", ")
}

func marshalVariables(vars []string) ([]byte, error) {
	if vars == nil {
		vars = []string{}
	}
	return json.Marshal(vars)
}

func marshalSignerSlots(slots []SignerSlot) ([]byte, error) {
	if slots == nil {
		slots = []SignerSlot{}
	}
	return json.Marshal(slots)
}

func unmarshalSignerSlots(raw []byte) ([]SignerSlot, error) {
	if len(bytes.TrimSpace(raw)) == 0 {
		return []SignerSlot{}, nil
	}
	var slots []SignerSlot
	if err := json.Unmarshal(raw, &slots); err != nil {
		return nil, fmt.Errorf("%w: invalid signer_slots", ErrInvalidRequest)
	}
	return slots, nil
}

func mustUnmarshalSignerSlots(raw []byte) []SignerSlot {
	slots, err := unmarshalSignerSlots(raw)
	if err != nil {
		return []SignerSlot{}
	}
	return slots
}

func mustUnmarshalVariables(raw []byte) []string {
	if len(bytes.TrimSpace(raw)) == 0 {
		return []string{}
	}
	var vars []string
	if err := json.Unmarshal(raw, &vars); err != nil {
		return []string{}
	}
	return vars
}

func mustUnmarshalStringMap(raw []byte) map[string]string {
	out := map[string]string{}
	if len(bytes.TrimSpace(raw)) == 0 {
		return out
	}
	_ = json.Unmarshal(raw, &out)
	if out == nil {
		out = map[string]string{}
	}
	return out
}

func stripDataURL(s string) string {
	s = strings.TrimSpace(s)
	if strings.HasPrefix(s, "data:") {
		if i := strings.Index(s, ","); i >= 0 {
			return s[i+1:]
		}
	}
	return s
}

// sniffContractMedia detects the media type from content and returns the
// canonical content type and extension for allowed attachment types.
func sniffContractMedia(body []byte) (contentType, ext string, ok bool) {
	head := body
	if len(head) > 512 {
		head = head[:512]
	}
	switch http.DetectContentType(head) {
	case "image/jpeg":
		return "image/jpeg", "jpg", true
	case "image/png":
		return "image/png", "png", true
	case "image/webp":
		return "image/webp", "webp", true
	case "image/gif":
		return "image/gif", "gif", true
	case "application/pdf":
		return "application/pdf", "pdf", true
	default:
		return "", "", false
	}
}

func sanitizeFileName(name string) string {
	name = strings.TrimSpace(name)
	if name == "" {
		return "contract"
	}
	var b strings.Builder
	for _, r := range name {
		switch {
		case r >= 'a' && r <= 'z', r >= 'A' && r <= 'Z', r >= '0' && r <= '9', r == '-', r == '_':
			b.WriteRune(r)
		case r == ' ':
			b.WriteByte('_')
		}
	}
	out := b.String()
	if out == "" {
		return "contract"
	}
	return out
}
