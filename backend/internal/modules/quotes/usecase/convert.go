package usecase

import (
	"context"
	"errors"
	"fmt"
	"math/big"
	"strings"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database/db"
	customersusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/customers/usecase"
	jobsusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/jobs/usecase"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
)

// Quick conversion ("Hızlı İşleme Dönüştür") maps a quote onto the jobs
// module's own create path:
//
//   - customer → job customer; vehicle → an existing customer vehicle, or a
//     new one created from the quote's plate + catalog model/year (jobs need a
//     plate and a catalog model, so only the missing fields are asked for);
//   - service lines → job service lines. The job unit price is what the
//     customer pays per unit after line + quote discounts, VAT included (job
//     prices are gross like the catalog). When that does not divide evenly the
//     line is transferred as quantity 1 at the line total so money matches;
//   - product and free-text lines are NOT transferred (jobs only carry catalog
//     services; product sales post stock + payment immediately in the sales
//     module, which is wrong before the work is done). They are listed in the
//     job notes and in the confirm dialog so nothing is silently lost.
//
// A sent / viewed quote is auto-accepted; the quote stores job_id and a
// linked lead is marked won.

type convertLine struct {
	preview     ConvertLine
	serviceUUID uuid.UUID
	qty         string
	unitPrice   string
}

type convertPlan struct {
	lines        []convertLine
	jobTotal     *big.Rat
	skippedTotal *big.Rat
	skipped      []string
}

func (s *Service) planConvert(ctx context.Context, orgID int64, row db.Quote) (convertPlan, error) {
	lines, err := s.q.ListQuoteLines(ctx, row.ID)
	if err != nil {
		return convertPlan{}, err
	}
	p := convertPlan{jobTotal: new(big.Rat), skippedTotal: new(big.Rat)}
	for _, l := range lines {
		total := ratFromNumeric(l.LineTotal)
		qty := ratFromNumeric(l.Quantity)
		cl := convertLine{preview: ConvertLine{
			Description: l.Description, LineType: l.LineType, LineTotal: total.FloatString(2),
		}}
		switch {
		case l.LineType != "service":
			cl.preview.Reason = "not_a_service"
		case !l.ServiceUuid.Valid:
			cl.preview.Reason = "service_deleted"
		default:
			if _, err := s.q.GetOrgServiceRef(ctx, db.GetOrgServiceRefParams{OrganizationID: orgID, Uuid: uuid.UUID(l.ServiceUuid.Bytes)}); err != nil {
				if !isNoRows(err) {
					return convertPlan{}, err
				}
				cl.preview.Reason = "service_deleted"
			}
		}
		if cl.preview.Reason != "" {
			cl.preview.Quantity = numStr(l.Quantity)
			cl.preview.UnitPrice = money(l.UnitPrice)
			p.skippedTotal.Add(p.skippedTotal, total)
			p.skipped = append(p.skipped, fmt.Sprintf("%s × %s = %s", l.Description, formatQtyTR(numStr(l.Quantity)), formatMoneyTR(total.FloatString(2), row.Currency)))
		} else {
			cl.preview.Included = true
			cl.serviceUUID = uuid.UUID(l.ServiceUuid.Bytes)
			unit := new(big.Rat).Quo(total, qty)
			if new(big.Rat).Mul(round2(unit), qty).Cmp(total) == 0 {
				cl.qty = strings.TrimRight(strings.TrimRight(qty.FloatString(3), "0"), ".")
				cl.unitPrice = round2(unit).FloatString(2)
			} else {
				cl.qty = "1"
				cl.unitPrice = total.FloatString(2)
			}
			cl.preview.Quantity = cl.qty
			cl.preview.UnitPrice = cl.unitPrice
			p.jobTotal.Add(p.jobTotal, total)
		}
		p.lines = append(p.lines, cl)
	}
	return p, nil
}

type vehicleDecision struct {
	vehicleUUID *uuid.UUID
	label       string
	plate       string
	create      *customersusecase.CreateVehicleInput
	missing     []string
}

func (s *Service) decideVehicle(ctx context.Context, orgID int64, row db.Quote, refs db.GetQuoteRefsRow, in ConvertInput) (vehicleDecision, error) {
	var d vehicleDecision
	pick := in.VehicleUUID
	if pick == nil && refs.VehicleUuid.Valid {
		id := uuid.UUID(refs.VehicleUuid.Bytes)
		pick = &id
	}
	if pick != nil && *pick != uuid.Nil {
		v, err := s.q.GetOrgCustomerVehicleRef(ctx, db.GetOrgCustomerVehicleRefParams{OrganizationID: orgID, Uuid: *pick})
		if err != nil {
			if isNoRows(err) {
				return d, fmt.Errorf("%w: vehicle not found", ErrInvalidRequest)
			}
			return d, err
		}
		if v.CustomerID != row.CustomerID {
			return d, fmt.Errorf("%w: vehicle belongs to another customer", ErrInvalidRequest)
		}
		id := v.Uuid
		d.vehicleUUID = &id
		d.plate = v.Plate
		d.label = fmt.Sprintf("%s %s %d", v.BrandName, v.ModelName, v.Year)
		return d, nil
	}
	plate := row.VehiclePlate
	if strings.TrimSpace(in.Plate) != "" {
		p, err := NormalizePlate(in.Plate)
		if err != nil {
			return d, err
		}
		plate = p
	}
	var modelUUID *uuid.UUID
	if refs.VehicleModelUuid.Valid {
		id := uuid.UUID(refs.VehicleModelUuid.Bytes)
		modelUUID = &id
	}
	if in.ModelUUID != nil && *in.ModelUUID != uuid.Nil {
		modelUUID = in.ModelUUID
	}
	year := 0
	if row.VehicleYear.Valid {
		year = int(row.VehicleYear.Int16)
	}
	if in.Year != nil {
		year = *in.Year
	}
	if plate == "" {
		d.missing = append(d.missing, "plate")
	}
	if modelUUID == nil || year == 0 {
		d.missing = append(d.missing, "model")
	}
	d.plate = plate
	d.label = row.VehicleLabel
	if len(d.missing) == 0 {
		d.create = &customersusecase.CreateVehicleInput{Plate: plate, ModelUUID: *modelUUID, Year: year}
	}
	return d, nil
}

func (s *Service) loadConvertible(ctx context.Context, id uuid.UUID) (int64, db.Quote, db.GetQuoteRefsRow, error) {
	scope, err := s.requireOrg(ctx)
	if err != nil {
		return 0, db.Quote{}, db.GetQuoteRefsRow{}, err
	}
	row, err := s.q.GetQuoteRowByUUID(ctx, db.GetQuoteRowByUUIDParams{Uuid: id, OrganizationID: scope.InternalID})
	if err != nil {
		if isNoRows(err) {
			return 0, db.Quote{}, db.GetQuoteRefsRow{}, ErrNotFound
		}
		return 0, db.Quote{}, db.GetQuoteRefsRow{}, err
	}
	refs, err := s.q.GetQuoteRefs(ctx, row.ID)
	if err != nil {
		return 0, db.Quote{}, db.GetQuoteRefsRow{}, err
	}
	return scope.InternalID, row, refs, nil
}

// ConvertPreview shows what quick conversion would create.
func (s *Service) ConvertPreview(ctx context.Context, id uuid.UUID) (ConvertPreview, error) {
	orgID, row, refs, err := s.loadConvertible(ctx, id)
	if err != nil {
		return ConvertPreview{}, err
	}
	out := ConvertPreview{
		CustomerName: refs.CustomerName, Currency: row.Currency, LeadUUID: optUUID(refs.LeadUuid),
		WillAccept: row.Status == StatusSent || row.Status == StatusViewed,
		Missing:    []string{}, CustomerVehicle: []Ref{}, Lines: []ConvertLine{},
	}
	switch {
	case row.JobID.Valid:
		out.Blocker = "already_converted"
	case !isConvertible(row.Status):
		out.Blocker = "status"
	}
	plan, err := s.planConvert(ctx, orgID, row)
	if err != nil {
		return ConvertPreview{}, err
	}
	for _, l := range plan.lines {
		out.Lines = append(out.Lines, l.preview)
	}
	out.JobTotal = plan.jobTotal.FloatString(2)
	out.SkippedTotal = plan.skippedTotal.FloatString(2)
	if plan.jobTotal.Sign() == 0 && !anyIncluded(plan) && out.Blocker == "" {
		out.Blocker = "no_service_lines"
	}
	vd, err := s.decideVehicle(ctx, orgID, row, refs, ConvertInput{})
	if err != nil {
		return ConvertPreview{}, err
	}
	out.VehicleUUID, out.VehicleLabel, out.Plate = vd.vehicleUUID, vd.label, vd.plate
	out.CreatesVehicle = vd.create != nil
	out.Missing = append(out.Missing, vd.missing...)
	if vd.vehicleUUID == nil {
		vehicles, err := s.q.ListCustomerVehicles(ctx, db.ListCustomerVehiclesParams{CustomerID: row.CustomerID, OrganizationID: orgID})
		if err != nil {
			return ConvertPreview{}, err
		}
		for _, v := range vehicles {
			out.CustomerVehicle = append(out.CustomerVehicle, Ref{UUID: v.Uuid, Label: fmt.Sprintf("%s · %s %s", v.Plate, v.BrandName, v.ModelName)})
		}
	}
	out.CanConvert = out.Blocker == ""
	return out, nil
}

func anyIncluded(p convertPlan) bool {
	for _, l := range p.lines {
		if l.preview.Included {
			return true
		}
	}
	return false
}

// Convert creates a job from the quote via the jobs module and links it.
func (s *Service) Convert(ctx context.Context, id uuid.UUID, in ConvertInput) (ConvertResult, error) {
	if s.jobs == nil {
		return ConvertResult{}, fmt.Errorf("%w: jobs module not wired", ErrConflict)
	}
	orgID, _, _, err := s.loadConvertible(ctx, id)
	if err != nil {
		return ConvertResult{}, err
	}
	// Row lock serialises concurrent conversions of the same quote; the jobs
	// create path runs in its own transaction while we hold it.
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return ConvertResult{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := s.q.WithTx(tx)
	row, err := q.GetQuoteRowByUUIDForUpdate(ctx, db.GetQuoteRowByUUIDForUpdateParams{Uuid: id, OrganizationID: orgID})
	if err != nil {
		if isNoRows(err) {
			return ConvertResult{}, ErrNotFound
		}
		return ConvertResult{}, err
	}
	if row.JobID.Valid {
		return ConvertResult{}, fmt.Errorf("%w: quote was already converted", ErrConflict)
	}
	if !isConvertible(row.Status) {
		return ConvertResult{}, fmt.Errorf("%w: a %s quote cannot be converted", ErrInvalidTransition, row.Status)
	}
	refs, err := q.GetQuoteRefs(ctx, row.ID)
	if err != nil {
		return ConvertResult{}, err
	}
	plan, err := s.planConvert(ctx, orgID, row)
	if err != nil {
		return ConvertResult{}, err
	}
	if !anyIncluded(plan) {
		return ConvertResult{}, fmt.Errorf("%w: quote has no catalog service lines to transfer", ErrConflict)
	}
	vd, err := s.decideVehicle(ctx, orgID, row, refs, in)
	if err != nil {
		return ConvertResult{}, err
	}
	if vd.vehicleUUID == nil && vd.create == nil {
		return ConvertResult{}, fmt.Errorf("%w: missing %s", ErrVehicleRequired, strings.Join(vd.missing, ", "))
	}
	if vd.create != nil {
		if s.vehicles == nil {
			return ConvertResult{}, fmt.Errorf("%w: vehicle creation not wired", ErrConflict)
		}
		v, err := s.vehicles.AddVehicle(ctx, refs.CustomerUuid, *vd.create)
		if err != nil {
			switch {
			case errors.Is(err, customersusecase.ErrConflict):
				return ConvertResult{}, fmt.Errorf("%w: plate is already registered", ErrConflict)
			case errors.Is(err, customersusecase.ErrInvalidRequest), errors.Is(err, customersusecase.ErrNotFound):
				return ConvertResult{}, fmt.Errorf("%w: %v", ErrInvalidRequest, err)
			}
			return ConvertResult{}, err
		}
		id := v.UUID
		vd.vehicleUUID = &id
	}

	notes := []string{fmt.Sprintf("Teklif %s", row.Number)}
	if len(plan.skipped) > 0 {
		notes = append(notes, "Aktarılmayan kalemler: "+strings.Join(plan.skipped, "; "))
	}
	if n := strings.TrimSpace(in.Notes); n != "" {
		notes = append(notes, n)
	}
	jobIn := jobsusecase.CreateInput{
		CustomerUUID: refs.CustomerUuid, VehicleUUID: *vd.vehicleUUID, Currency: row.Currency,
		Notes: truncate(strings.Join(notes, "\n"), 4000), AssigneeUUID: in.AssigneeUUID,
	}
	if jobIn.AssigneeUUID == nil && row.LeadID.Valid {
		if lead, err := q.GetLeadRefByID(ctx, row.LeadID.Int64); err == nil && lead.AssigneeUserID.Valid {
			if u, err := q.GetUserByID(ctx, lead.AssigneeUserID.Int64); err == nil {
				id := u.Uuid
				jobIn.AssigneeUUID = &id
			}
		}
	}
	for _, l := range plan.lines {
		if !l.preview.Included {
			continue
		}
		price, qty := l.unitPrice, l.qty
		jobIn.Lines = append(jobIn.Lines, jobsusecase.CreateLineInput{ServiceUUID: l.serviceUUID, UnitPrice: &price, Qty: &qty})
	}
	job, err := s.jobs.Create(ctx, jobIn)
	if err != nil {
		switch {
		case errors.Is(err, jobsusecase.ErrInvalidRequest), errors.Is(err, jobsusecase.ErrNotFound):
			return ConvertResult{}, fmt.Errorf("%w: %v", ErrInvalidRequest, err)
		case errors.Is(err, jobsusecase.ErrConflict):
			return ConvertResult{}, fmt.Errorf("%w: %v", ErrConflict, err)
		}
		return ConvertResult{}, err
	}
	jobRow, err := q.GetServiceJobByUUID(ctx, db.GetServiceJobByUUIDParams{Uuid: job.UUID, OrganizationID: orgID})
	if err != nil {
		return ConvertResult{}, err
	}

	var cancelled []db.QuoteReminder
	if row.Status == StatusSent || row.Status == StatusViewed {
		if row, cancelled, err = s.transitionTx(ctx, q, row, StatusAccepted, transitionOpts{note: "Hızlı işleme dönüştürüldü"}); err != nil {
			return ConvertResult{}, err
		}
	}
	row, err = q.LinkQuoteJob(ctx, db.LinkQuoteJobParams{JobID: pgtype.Int8{Int64: jobRow.ID, Valid: true}, ID: row.ID, OrganizationID: orgID})
	if err != nil {
		if isNoRows(err) {
			return ConvertResult{}, fmt.Errorf("%w: quote was already converted", ErrConflict)
		}
		return ConvertResult{}, err
	}
	if err := s.addEvent(ctx, q, orgID, row.ID, eventOpts{kind: "converted", from: row.Status, to: row.Status, body: jobRow.Uuid.String()}); err != nil {
		return ConvertResult{}, err
	}
	if row.LeadID.Valid {
		if _, err := q.CreateLeadEvent(ctx, db.CreateLeadEventParams{
			OrganizationID: orgID, LeadID: row.LeadID.Int64, Kind: "job_created",
			RefType: "job", RefUuid: pgtype.UUID{Bytes: jobRow.Uuid, Valid: true}, RefLabel: jobRow.Plate,
			ActorUserID: actorID(ctx),
		}); err != nil {
			return ConvertResult{}, err
		}
		if err := s.setLeadStatus(ctx, q, orgID, row.LeadID, "won", row, true); err != nil {
			return ConvertResult{}, err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return ConvertResult{}, err
	}
	s.afterReminderChange(ctx, row, cancelled, nil)
	s.record(ctx, "tenant.quote.convert", row.Uuid, map[string]any{"number": row.Number, "job_uuid": jobRow.Uuid.String()})
	detail, err := s.loadDetail(ctx, row)
	if err != nil {
		return ConvertResult{}, err
	}
	return ConvertResult{JobUUID: jobRow.Uuid, Quote: detail}, nil
}
