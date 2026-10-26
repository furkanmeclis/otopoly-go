package usecase

import (
	"context"
	"math/big"
	"strings"
	"time"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database/db"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/resourceevents"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
)

// ------------------------------------------------------------ references

// resolveServices maps service uuids of the organization to ids; an unknown
// (or another organization's) uuid is a validation error.
func (s *Service) resolveServices(ctx context.Context, org int64, ids []uuid.UUID) ([]int64, error) {
	ids = uniqueUUIDs(ids)
	if len(ids) == 0 {
		return []int64{}, nil
	}
	rows, err := s.q.LoyaltyResolveServices(ctx, db.LoyaltyResolveServicesParams{OrganizationID: org, Uuids: ids})
	if err != nil {
		return nil, err
	}
	if len(rows) != len(ids) {
		return nil, invalid("unknown service")
	}
	out := make([]int64, 0, len(rows))
	for _, r := range rows {
		out = append(out, r.ID)
	}
	return out, nil
}

func (s *Service) resolveCategories(ctx context.Context, org int64, ids []uuid.UUID) ([]int64, error) {
	ids = uniqueUUIDs(ids)
	if len(ids) == 0 {
		return []int64{}, nil
	}
	rows, err := s.q.LoyaltyResolveCategories(ctx, db.LoyaltyResolveCategoriesParams{OrganizationID: org, Uuids: ids})
	if err != nil {
		return nil, err
	}
	if len(rows) != len(ids) {
		return nil, invalid("unknown service category")
	}
	out := make([]int64, 0, len(rows))
	for _, r := range rows {
		out = append(out, r.ID)
	}
	return out, nil
}

func uniqueUUIDs(in []uuid.UUID) []uuid.UUID {
	seen := map[uuid.UUID]bool{}
	out := make([]uuid.UUID, 0, len(in))
	for _, id := range in {
		if id == uuid.Nil || seen[id] {
			continue
		}
		seen[id] = true
		out = append(out, id)
	}
	return out
}

// refs loads service / category names for id arrays (one query each).
type refs struct {
	services   map[int64]db.LoyaltyServicesByIDsRow
	categories map[int64]Ref
}

func (s *Service) loadRefs(ctx context.Context, org int64, serviceIDs, categoryIDs []int64) (refs, error) {
	r := refs{services: map[int64]db.LoyaltyServicesByIDsRow{}, categories: map[int64]Ref{}}
	if len(serviceIDs) > 0 {
		rows, err := s.q.LoyaltyServicesByIDs(ctx, db.LoyaltyServicesByIDsParams{OrganizationID: org, Ids: serviceIDs})
		if err != nil {
			return r, err
		}
		for _, row := range rows {
			r.services[row.ID] = row
		}
	}
	if len(categoryIDs) > 0 {
		rows, err := s.q.LoyaltyCategoriesByIDs(ctx, db.LoyaltyCategoriesByIDsParams{OrganizationID: org, Ids: categoryIDs})
		if err != nil {
			return r, err
		}
		for _, row := range rows {
			r.categories[row.ID] = Ref{UUID: row.Uuid, Name: row.Name}
		}
	}
	return r, nil
}

func (r refs) serviceRefs(ids []int64) []Ref {
	out := make([]Ref, 0, len(ids))
	for _, id := range ids {
		if row, ok := r.services[id]; ok {
			out = append(out, Ref{UUID: row.Uuid, Name: row.Name})
		}
	}
	return out
}

func (r refs) categoryRefs(ids []int64) []Ref {
	out := make([]Ref, 0, len(ids))
	for _, id := range ids {
		if ref, ok := r.categories[id]; ok {
			out = append(out, ref)
		}
	}
	return out
}

// eligible reports whether a service (and its category) is in the sets.
func eligible(serviceIDs, categoryIDs []int64, serviceID, categoryID pgtype.Int8) bool {
	if !serviceID.Valid {
		return false
	}
	for _, id := range serviceIDs {
		if id == serviceID.Int64 {
			return true
		}
	}
	if categoryID.Valid {
		for _, id := range categoryIDs {
			if id == categoryID.Int64 {
				return true
			}
		}
	}
	return false
}

func parseDate(raw *string, field string) (pgtype.Date, error) {
	if raw == nil || strings.TrimSpace(*raw) == "" {
		return pgtype.Date{}, nil
	}
	t, err := time.Parse("2006-01-02", strings.TrimSpace(*raw))
	if err != nil {
		return pgtype.Date{}, invalid("%s must be YYYY-MM-DD", field)
	}
	return pgtype.Date{Time: t, Valid: true}, nil
}

func dateString(d pgtype.Date) *string {
	if !d.Valid {
		return nil
	}
	v := d.Time.Format("2006-01-02")
	return &v
}

func int4Ptr(v pgtype.Int4) *int32 {
	if !v.Valid {
		return nil
	}
	n := v.Int32
	return &n
}

func optInt4(v *int32) pgtype.Int4 {
	if v == nil {
		return pgtype.Int4{}
	}
	return pgtype.Int4{Int32: *v, Valid: true}
}

func optActor(ctx context.Context) pgtype.Int8 {
	if a := actorID(ctx); a > 0 {
		return pgtype.Int8{Int64: a, Valid: true}
	}
	return pgtype.Int8{}
}

func textFilter(q string) pgtype.Text {
	q = strings.TrimSpace(q)
	if q == "" {
		return pgtype.Text{}
	}
	return pgtype.Text{String: q, Valid: true}
}

func boolFilter(b *bool) pgtype.Bool {
	if b == nil {
		return pgtype.Bool{}
	}
	return pgtype.Bool{Bool: *b, Valid: true}
}

func currencyOf(raw string) (string, error) {
	c := strings.ToUpper(strings.TrimSpace(raw))
	if c == "" {
		return "TRY", nil
	}
	if len(c) != 3 {
		return "", invalid("currency must be a 3-letter code")
	}
	return c, nil
}

func name150(raw string) (string, error) {
	n := strings.TrimSpace(raw)
	if n == "" {
		return "", invalid("name is required")
	}
	if len([]rune(n)) > 150 {
		return "", invalid("name is limited to 150 characters")
	}
	return n, nil
}

// ------------------------------------------------------------ campaigns

type campaignFields struct {
	name, description, rewardType string
	serviceIDs, categoryIDs       []int64
	stamps                        int32
	rewardService                 pgtype.Int8
	rewardValue                   pgtype.Numeric
	from, until                   pgtype.Date
	active                        bool
	limit                         pgtype.Int4
}

func (s *Service) campaignFields(ctx context.Context, org int64, in CampaignInput) (campaignFields, error) {
	var f campaignFields
	var err error
	if f.name, err = name150(in.Name); err != nil {
		return f, err
	}
	f.description = strings.TrimSpace(in.Description)
	if in.StampsRequired < 1 || in.StampsRequired > 100 {
		return f, invalid("stamps_required must be between 1 and 100")
	}
	f.stamps = in.StampsRequired
	if f.serviceIDs, err = s.resolveServices(ctx, org, in.ServiceUUIDs); err != nil {
		return f, err
	}
	if f.categoryIDs, err = s.resolveCategories(ctx, org, in.CategoryUUIDs); err != nil {
		return f, err
	}
	if len(f.serviceIDs) == 0 && len(f.categoryIDs) == 0 {
		return f, invalid("choose at least one eligible service or category")
	}
	f.rewardType = strings.TrimSpace(in.RewardType)
	zero := numeric(new(big.Rat))
	f.rewardValue = zero
	switch f.rewardType {
	case RewardFreeService:
		if in.RewardServiceUUID == nil || *in.RewardServiceUUID == uuid.Nil {
			return f, invalid("reward_service_uuid is required for a free service reward")
		}
		ids, err := s.resolveServices(ctx, org, []uuid.UUID{*in.RewardServiceUUID})
		if err != nil {
			return f, err
		}
		f.rewardService = pgtype.Int8{Int64: ids[0], Valid: true}
	case RewardPercent, RewardFixed:
		v, ok := parseMoney(in.RewardValue)
		if !ok || v.Sign() <= 0 {
			return f, invalid("reward_value must be a positive amount")
		}
		if f.rewardType == RewardPercent && v.Cmp(big.NewRat(100, 1)) > 0 {
			return f, invalid("a percent reward is at most 100")
		}
		f.rewardValue = numeric(v)
	default:
		return f, invalid("reward_type must be free_service, percent or fixed")
	}
	if f.from, err = parseDate(in.ValidFrom, "valid_from"); err != nil {
		return f, err
	}
	if f.until, err = parseDate(in.ValidUntil, "valid_until"); err != nil {
		return f, err
	}
	if f.from.Valid && f.until.Valid && f.until.Time.Before(f.from.Time) {
		return f, invalid("valid_until is before valid_from")
	}
	f.active = in.IsActive == nil || *in.IsActive
	if in.PerCustomerLimit != nil {
		if *in.PerCustomerLimit < 1 || *in.PerCustomerLimit > 1000 {
			return f, invalid("per_customer_limit must be between 1 and 1000")
		}
		f.limit = optInt4(in.PerCustomerLimit)
	}
	return f, nil
}

func (s *Service) mapCampaign(row db.LoyaltyCampaign, r refs) Campaign {
	c := Campaign{
		UUID: row.Uuid, Name: row.Name, Description: row.Description,
		Services: r.serviceRefs(row.ServiceIds), Categories: r.categoryRefs(row.CategoryIds),
		StampsRequired: row.StampsRequired, RewardType: row.RewardType, RewardValue: numMoney(row.RewardValue),
		ValidFrom: dateString(row.ValidFrom), ValidUntil: dateString(row.ValidUntil), IsActive: row.IsActive,
		PerCustomerLimit: int4Ptr(row.PerCustomerLimit), CreatedAt: row.CreatedAt.Time, UpdatedAt: row.UpdatedAt.Time,
	}
	if row.RewardServiceID.Valid {
		if svc, ok := r.services[row.RewardServiceID.Int64]; ok {
			c.RewardService = &Ref{UUID: svc.Uuid, Name: svc.Name}
		}
	}
	return c
}

func campaignRefIDs(rows []db.LoyaltyCampaign) ([]int64, []int64) {
	var sids, cids []int64
	for _, row := range rows {
		sids = append(sids, row.ServiceIds...)
		cids = append(cids, row.CategoryIds...)
		if row.RewardServiceID.Valid {
			sids = append(sids, row.RewardServiceID.Int64)
		}
	}
	return sids, cids
}

func (s *Service) mapCampaigns(ctx context.Context, org int64, rows []db.LoyaltyCampaign) ([]Campaign, error) {
	sids, cids := campaignRefIDs(rows)
	r, err := s.loadRefs(ctx, org, sids, cids)
	if err != nil {
		return nil, err
	}
	out := make([]Campaign, 0, len(rows))
	for _, row := range rows {
		out = append(out, s.mapCampaign(row, r))
	}
	return out, nil
}

// ListCampaigns lists stamp campaigns.
func (s *Service) ListCampaigns(ctx context.Context, f ListFilter) ([]Campaign, int64, error) {
	org, err := orgID(ctx)
	if err != nil {
		return nil, 0, err
	}
	rows, err := s.q.ListLoyaltyCampaigns(ctx, db.ListLoyaltyCampaignsParams{
		OrganizationID: org, IsActive: boolFilter(f.IsActive), Q: textFilter(f.Q), LimitCount: f.Limit, OffsetCount: f.Offset,
	})
	if err != nil {
		return nil, 0, err
	}
	total, err := s.q.CountLoyaltyCampaigns(ctx, db.CountLoyaltyCampaignsParams{OrganizationID: org, IsActive: boolFilter(f.IsActive), Q: textFilter(f.Q)})
	if err != nil {
		return nil, 0, err
	}
	out, err := s.mapCampaigns(ctx, org, rows)
	return out, total, err
}

// GetCampaign returns one campaign.
func (s *Service) GetCampaign(ctx context.Context, id uuid.UUID) (Campaign, error) {
	org, err := orgID(ctx)
	if err != nil {
		return Campaign{}, err
	}
	row, err := s.q.GetLoyaltyCampaign(ctx, db.GetLoyaltyCampaignParams{Uuid: id, OrganizationID: org})
	if err != nil {
		return Campaign{}, notFound(err)
	}
	out, err := s.mapCampaigns(ctx, org, []db.LoyaltyCampaign{row})
	if err != nil {
		return Campaign{}, err
	}
	return out[0], nil
}

// CreateCampaign adds a stamp campaign.
func (s *Service) CreateCampaign(ctx context.Context, in CampaignInput) (Campaign, error) {
	org, err := orgID(ctx)
	if err != nil {
		return Campaign{}, err
	}
	f, err := s.campaignFields(ctx, org, in)
	if err != nil {
		return Campaign{}, err
	}
	row, err := s.q.CreateLoyaltyCampaign(ctx, db.CreateLoyaltyCampaignParams{
		OrganizationID: org, Name: f.name, Description: f.description, ServiceIds: f.serviceIDs, CategoryIds: f.categoryIDs,
		StampsRequired: f.stamps, RewardType: f.rewardType, RewardServiceID: f.rewardService, RewardValue: f.rewardValue,
		ValidFrom: f.from, ValidUntil: f.until, IsActive: f.active, PerCustomerLimit: f.limit, CreatedBy: optActor(ctx),
	})
	if err != nil {
		return Campaign{}, err
	}
	s.record(ctx, "loyalty.campaign.create", "loyalty.campaign", row.Uuid, map[string]any{"name": row.Name})
	s.emit(ctx, resourceevents.TenantLoyaltyPrograms, resourceevents.ActionCreated, row.Uuid.String())
	return s.GetCampaign(ctx, row.Uuid)
}

// UpdateCampaign replaces a campaign. Stamps already earned stay.
func (s *Service) UpdateCampaign(ctx context.Context, id uuid.UUID, in CampaignInput) (Campaign, error) {
	org, err := orgID(ctx)
	if err != nil {
		return Campaign{}, err
	}
	if _, err := s.q.GetLoyaltyCampaign(ctx, db.GetLoyaltyCampaignParams{Uuid: id, OrganizationID: org}); err != nil {
		return Campaign{}, notFound(err)
	}
	f, err := s.campaignFields(ctx, org, in)
	if err != nil {
		return Campaign{}, err
	}
	row, err := s.q.UpdateLoyaltyCampaign(ctx, db.UpdateLoyaltyCampaignParams{
		Uuid: id, OrganizationID: org, Name: f.name, Description: f.description, ServiceIds: f.serviceIDs, CategoryIds: f.categoryIDs,
		StampsRequired: f.stamps, RewardType: f.rewardType, RewardServiceID: f.rewardService, RewardValue: f.rewardValue,
		ValidFrom: f.from, ValidUntil: f.until, IsActive: f.active, PerCustomerLimit: f.limit,
	})
	if err != nil {
		return Campaign{}, notFound(err)
	}
	s.record(ctx, "loyalty.campaign.update", "loyalty.campaign", row.Uuid, map[string]any{"name": row.Name})
	s.emit(ctx, resourceevents.TenantLoyaltyPrograms, resourceevents.ActionUpdated, row.Uuid.String())
	return s.GetCampaign(ctx, row.Uuid)
}

// DeleteCampaign archives a campaign (stamp history is kept).
func (s *Service) DeleteCampaign(ctx context.Context, id uuid.UUID) error {
	org, err := orgID(ctx)
	if err != nil {
		return err
	}
	row, err := s.q.SoftDeleteLoyaltyCampaign(ctx, db.SoftDeleteLoyaltyCampaignParams{Uuid: id, OrganizationID: org})
	if err != nil {
		return notFound(err)
	}
	s.record(ctx, "loyalty.campaign.delete", "loyalty.campaign", row.Uuid, map[string]any{"name": row.Name})
	s.emit(ctx, resourceevents.TenantLoyaltyPrograms, resourceevents.ActionDeleted, row.Uuid.String())
	return nil
}

// ------------------------------------------------------------ packages

type packageFields struct {
	name, description, currency string
	price                       pgtype.Numeric
	validity                    pgtype.Int4
	active                      bool
	items                       []struct {
		serviceID int64
		qty       int32
	}
}

func (s *Service) packageFields(ctx context.Context, org int64, in PackageInput) (packageFields, error) {
	var f packageFields
	var err error
	if f.name, err = name150(in.Name); err != nil {
		return f, err
	}
	f.description = strings.TrimSpace(in.Description)
	price, ok := parseMoney(in.Price)
	if !ok || price.Sign() <= 0 {
		return f, invalid("price must be a positive amount")
	}
	f.price = numeric(price)
	if f.currency, err = currencyOf(in.Currency); err != nil {
		return f, err
	}
	if in.ValidityDays != nil {
		if *in.ValidityDays < 1 || *in.ValidityDays > 3650 {
			return f, invalid("validity_days must be between 1 and 3650")
		}
		f.validity = optInt4(in.ValidityDays)
	}
	f.active = in.IsActive == nil || *in.IsActive
	if len(in.Items) == 0 || len(in.Items) > 50 {
		return f, invalid("a package needs 1 to 50 services")
	}
	seen := map[uuid.UUID]bool{}
	ids := make([]uuid.UUID, 0, len(in.Items))
	for _, it := range in.Items {
		if it.Quantity < 1 || it.Quantity > 1000 {
			return f, invalid("quantity must be between 1 and 1000")
		}
		if seen[it.ServiceUUID] {
			return f, invalid("a service is listed twice")
		}
		seen[it.ServiceUUID] = true
		ids = append(ids, it.ServiceUUID)
	}
	rows, err := s.q.LoyaltyResolveServices(ctx, db.LoyaltyResolveServicesParams{OrganizationID: org, Uuids: ids})
	if err != nil {
		return f, err
	}
	byUUID := map[uuid.UUID]int64{}
	for _, r := range rows {
		byUUID[r.Uuid] = r.ID
	}
	for _, it := range in.Items {
		sid, ok := byUUID[it.ServiceUUID]
		if !ok {
			return f, invalid("unknown service")
		}
		f.items = append(f.items, struct {
			serviceID int64
			qty       int32
		}{sid, it.Quantity})
	}
	return f, nil
}

func (s *Service) replaceItems(ctx context.Context, q *db.Queries, org, packageID int64, f packageFields) error {
	if err := q.DeleteLoyaltyPackageItems(ctx, db.DeleteLoyaltyPackageItemsParams{PackageID: packageID, OrganizationID: org}); err != nil {
		return err
	}
	for i, it := range f.items {
		if err := q.CreateLoyaltyPackageItem(ctx, db.CreateLoyaltyPackageItemParams{
			OrganizationID: org, PackageID: packageID, ServiceID: it.serviceID, Quantity: it.qty, SortOrder: int32(i),
		}); err != nil {
			return err
		}
	}
	return nil
}

type packageRow struct {
	row  db.LoyaltyPackage
	sold int64
}

func (s *Service) mapPackages(ctx context.Context, org int64, rows []packageRow) ([]Package, error) {
	ids := make([]int64, 0, len(rows))
	for _, r := range rows {
		ids = append(ids, r.row.ID)
	}
	items := map[int64][]db.ListLoyaltyPackageItemsRow{}
	if len(ids) > 0 {
		list, err := s.q.ListLoyaltyPackageItems(ctx, db.ListLoyaltyPackageItemsParams{OrganizationID: org, PackageIds: ids})
		if err != nil {
			return nil, err
		}
		for _, it := range list {
			items[it.PackageID] = append(items[it.PackageID], it)
		}
	}
	out := make([]Package, 0, len(rows))
	for _, r := range rows {
		p := Package{
			UUID: r.row.Uuid, Name: r.row.Name, Description: r.row.Description, Price: numMoney(r.row.Price),
			Currency: r.row.Currency, ValidityDays: int4Ptr(r.row.ValidityDays), IsActive: r.row.IsActive,
			Items: []PackageItem{}, SoldCount: r.sold, CreatedAt: r.row.CreatedAt.Time, UpdatedAt: r.row.UpdatedAt.Time,
		}
		value := new(big.Rat)
		for _, it := range items[r.row.ID] {
			p.Items = append(p.Items, PackageItem{
				ServiceUUID: it.ServiceUuid, ServiceName: it.ServiceName, Quantity: it.Quantity, UnitPrice: numMoney(it.ServicePrice),
			})
			value.Add(value, new(big.Rat).Mul(ratOf(it.ServicePrice), big.NewRat(int64(it.Quantity), 1)))
		}
		p.ListValue = money(value)
		out = append(out, p)
	}
	return out, nil
}

// ListPackages lists package definitions.
func (s *Service) ListPackages(ctx context.Context, f ListFilter) ([]Package, int64, error) {
	org, err := orgID(ctx)
	if err != nil {
		return nil, 0, err
	}
	rows, err := s.q.ListLoyaltyPackages(ctx, db.ListLoyaltyPackagesParams{
		OrganizationID: org, IsActive: boolFilter(f.IsActive), Q: textFilter(f.Q), LimitCount: f.Limit, OffsetCount: f.Offset,
	})
	if err != nil {
		return nil, 0, err
	}
	total, err := s.q.CountLoyaltyPackages(ctx, db.CountLoyaltyPackagesParams{OrganizationID: org, IsActive: boolFilter(f.IsActive), Q: textFilter(f.Q)})
	if err != nil {
		return nil, 0, err
	}
	in := make([]packageRow, 0, len(rows))
	for _, r := range rows {
		in = append(in, packageRow{row: db.LoyaltyPackage{
			ID: r.ID, Uuid: r.Uuid, OrganizationID: r.OrganizationID, Name: r.Name, Description: r.Description, Price: r.Price,
			Currency: r.Currency, ValidityDays: r.ValidityDays, IsActive: r.IsActive, CreatedBy: r.CreatedBy,
			CreatedAt: r.CreatedAt, UpdatedAt: r.UpdatedAt, DeletedAt: r.DeletedAt,
		}, sold: r.SoldCount})
	}
	out, err := s.mapPackages(ctx, org, in)
	return out, total, err
}

// GetPackage returns one package definition.
func (s *Service) GetPackage(ctx context.Context, id uuid.UUID) (Package, error) {
	org, err := orgID(ctx)
	if err != nil {
		return Package{}, err
	}
	row, err := s.q.GetLoyaltyPackage(ctx, db.GetLoyaltyPackageParams{Uuid: id, OrganizationID: org})
	if err != nil {
		return Package{}, notFound(err)
	}
	out, err := s.mapPackages(ctx, org, []packageRow{{row: row}})
	if err != nil {
		return Package{}, err
	}
	return out[0], nil
}

// CreatePackage adds a package definition.
func (s *Service) CreatePackage(ctx context.Context, in PackageInput) (Package, error) {
	org, err := orgID(ctx)
	if err != nil {
		return Package{}, err
	}
	f, err := s.packageFields(ctx, org, in)
	if err != nil {
		return Package{}, err
	}
	var row db.LoyaltyPackage
	err = s.inTx(ctx, func(q *db.Queries) error {
		var err error
		row, err = q.CreateLoyaltyPackage(ctx, db.CreateLoyaltyPackageParams{
			OrganizationID: org, Name: f.name, Description: f.description, Price: f.price, Currency: f.currency,
			ValidityDays: f.validity, IsActive: f.active, CreatedBy: optActor(ctx),
		})
		if err != nil {
			return err
		}
		return s.replaceItems(ctx, q, org, row.ID, f)
	})
	if err != nil {
		return Package{}, err
	}
	s.record(ctx, "loyalty.package.create", "loyalty.package", row.Uuid, map[string]any{"name": row.Name})
	s.emit(ctx, resourceevents.TenantLoyaltyPrograms, resourceevents.ActionCreated, row.Uuid.String())
	return s.GetPackage(ctx, row.Uuid)
}

// UpdatePackage replaces a package definition (packages already sold keep
// their credits).
func (s *Service) UpdatePackage(ctx context.Context, id uuid.UUID, in PackageInput) (Package, error) {
	org, err := orgID(ctx)
	if err != nil {
		return Package{}, err
	}
	if _, err := s.q.GetLoyaltyPackage(ctx, db.GetLoyaltyPackageParams{Uuid: id, OrganizationID: org}); err != nil {
		return Package{}, notFound(err)
	}
	f, err := s.packageFields(ctx, org, in)
	if err != nil {
		return Package{}, err
	}
	var row db.LoyaltyPackage
	err = s.inTx(ctx, func(q *db.Queries) error {
		var err error
		row, err = q.UpdateLoyaltyPackage(ctx, db.UpdateLoyaltyPackageParams{
			Uuid: id, OrganizationID: org, Name: f.name, Description: f.description, Price: f.price, Currency: f.currency,
			ValidityDays: f.validity, IsActive: f.active,
		})
		if err != nil {
			return notFound(err)
		}
		return s.replaceItems(ctx, q, org, row.ID, f)
	})
	if err != nil {
		return Package{}, err
	}
	s.record(ctx, "loyalty.package.update", "loyalty.package", row.Uuid, map[string]any{"name": row.Name})
	s.emit(ctx, resourceevents.TenantLoyaltyPrograms, resourceevents.ActionUpdated, row.Uuid.String())
	return s.GetPackage(ctx, row.Uuid)
}

// DeletePackage archives a package definition.
func (s *Service) DeletePackage(ctx context.Context, id uuid.UUID) error {
	org, err := orgID(ctx)
	if err != nil {
		return err
	}
	row, err := s.q.SoftDeleteLoyaltyPackage(ctx, db.SoftDeleteLoyaltyPackageParams{Uuid: id, OrganizationID: org})
	if err != nil {
		return notFound(err)
	}
	s.record(ctx, "loyalty.package.delete", "loyalty.package", row.Uuid, map[string]any{"name": row.Name})
	s.emit(ctx, resourceevents.TenantLoyaltyPrograms, resourceevents.ActionDeleted, row.Uuid.String())
	return nil
}

// ------------------------------------------------------------ subscription plans

type planFields struct {
	name, description, currency string
	price                       pgtype.Numeric
	months                      int32
	uses                        pgtype.Int4
	serviceIDs, categoryIDs     []int64
	active                      bool
}

func (s *Service) planFields(ctx context.Context, org int64, in PlanInput) (planFields, error) {
	var f planFields
	var err error
	if f.name, err = name150(in.Name); err != nil {
		return f, err
	}
	f.description = strings.TrimSpace(in.Description)
	price, ok := parseMoney(in.Price)
	if !ok || price.Sign() <= 0 {
		return f, invalid("price must be a positive amount")
	}
	f.price = numeric(price)
	if f.currency, err = currencyOf(in.Currency); err != nil {
		return f, err
	}
	f.months = in.PeriodMonths
	if f.months == 0 {
		f.months = 1
	}
	if f.months < 1 || f.months > 12 {
		return f, invalid("period_months must be between 1 and 12")
	}
	if in.UsesPerPeriod != nil {
		if *in.UsesPerPeriod < 1 || *in.UsesPerPeriod > 1000 {
			return f, invalid("uses_per_period must be between 1 and 1000 (omit for unlimited)")
		}
		f.uses = optInt4(in.UsesPerPeriod)
	}
	if f.serviceIDs, err = s.resolveServices(ctx, org, in.ServiceUUIDs); err != nil {
		return f, err
	}
	if f.categoryIDs, err = s.resolveCategories(ctx, org, in.CategoryUUIDs); err != nil {
		return f, err
	}
	if len(f.serviceIDs) == 0 && len(f.categoryIDs) == 0 {
		return f, invalid("choose at least one eligible service or category")
	}
	f.active = in.IsActive == nil || *in.IsActive
	return f, nil
}

func mapPlan(row db.LoyaltySubscriptionPlan, active int64, r refs) Plan {
	return Plan{
		UUID: row.Uuid, Name: row.Name, Description: row.Description, Price: numMoney(row.Price), Currency: row.Currency,
		PeriodMonths: row.PeriodMonths, UsesPerPeriod: int4Ptr(row.UsesPerPeriod),
		Services: r.serviceRefs(row.ServiceIds), Categories: r.categoryRefs(row.CategoryIds),
		IsActive: row.IsActive, ActiveCount: active, CreatedAt: row.CreatedAt.Time, UpdatedAt: row.UpdatedAt.Time,
	}
}

// ListPlans lists subscription plans.
func (s *Service) ListPlans(ctx context.Context, f ListFilter) ([]Plan, int64, error) {
	org, err := orgID(ctx)
	if err != nil {
		return nil, 0, err
	}
	rows, err := s.q.ListLoyaltySubscriptionPlans(ctx, db.ListLoyaltySubscriptionPlansParams{
		OrganizationID: org, IsActive: boolFilter(f.IsActive), Q: textFilter(f.Q), LimitCount: f.Limit, OffsetCount: f.Offset,
	})
	if err != nil {
		return nil, 0, err
	}
	total, err := s.q.CountLoyaltySubscriptionPlans(ctx, db.CountLoyaltySubscriptionPlansParams{OrganizationID: org, IsActive: boolFilter(f.IsActive), Q: textFilter(f.Q)})
	if err != nil {
		return nil, 0, err
	}
	var sids, cids []int64
	for _, row := range rows {
		sids = append(sids, row.ServiceIds...)
		cids = append(cids, row.CategoryIds...)
	}
	r, err := s.loadRefs(ctx, org, sids, cids)
	if err != nil {
		return nil, 0, err
	}
	out := make([]Plan, 0, len(rows))
	for _, row := range rows {
		out = append(out, mapPlan(db.LoyaltySubscriptionPlan{
			ID: row.ID, Uuid: row.Uuid, OrganizationID: row.OrganizationID, Name: row.Name, Description: row.Description,
			Price: row.Price, Currency: row.Currency, PeriodMonths: row.PeriodMonths, UsesPerPeriod: row.UsesPerPeriod,
			ServiceIds: row.ServiceIds, CategoryIds: row.CategoryIds, IsActive: row.IsActive, CreatedBy: row.CreatedBy,
			CreatedAt: row.CreatedAt, UpdatedAt: row.UpdatedAt, DeletedAt: row.DeletedAt,
		}, row.ActiveCount, r))
	}
	return out, total, nil
}

// GetPlan returns one plan.
func (s *Service) GetPlan(ctx context.Context, id uuid.UUID) (Plan, error) {
	org, err := orgID(ctx)
	if err != nil {
		return Plan{}, err
	}
	row, err := s.q.GetLoyaltySubscriptionPlan(ctx, db.GetLoyaltySubscriptionPlanParams{Uuid: id, OrganizationID: org})
	if err != nil {
		return Plan{}, notFound(err)
	}
	r, err := s.loadRefs(ctx, org, row.ServiceIds, row.CategoryIds)
	if err != nil {
		return Plan{}, err
	}
	return mapPlan(row, 0, r), nil
}

// CreatePlan adds a subscription plan.
func (s *Service) CreatePlan(ctx context.Context, in PlanInput) (Plan, error) {
	org, err := orgID(ctx)
	if err != nil {
		return Plan{}, err
	}
	f, err := s.planFields(ctx, org, in)
	if err != nil {
		return Plan{}, err
	}
	row, err := s.q.CreateLoyaltySubscriptionPlan(ctx, db.CreateLoyaltySubscriptionPlanParams{
		OrganizationID: org, Name: f.name, Description: f.description, Price: f.price, Currency: f.currency,
		PeriodMonths: f.months, UsesPerPeriod: f.uses, ServiceIds: f.serviceIDs, CategoryIds: f.categoryIDs,
		IsActive: f.active, CreatedBy: optActor(ctx),
	})
	if err != nil {
		return Plan{}, err
	}
	s.record(ctx, "loyalty.plan.create", "loyalty.plan", row.Uuid, map[string]any{"name": row.Name})
	s.emit(ctx, resourceevents.TenantLoyaltyPrograms, resourceevents.ActionCreated, row.Uuid.String())
	return s.GetPlan(ctx, row.Uuid)
}

// UpdatePlan replaces a plan. Running subscriptions keep their price,
// period and included uses; eligibility follows the plan.
func (s *Service) UpdatePlan(ctx context.Context, id uuid.UUID, in PlanInput) (Plan, error) {
	org, err := orgID(ctx)
	if err != nil {
		return Plan{}, err
	}
	if _, err := s.q.GetLoyaltySubscriptionPlan(ctx, db.GetLoyaltySubscriptionPlanParams{Uuid: id, OrganizationID: org}); err != nil {
		return Plan{}, notFound(err)
	}
	f, err := s.planFields(ctx, org, in)
	if err != nil {
		return Plan{}, err
	}
	row, err := s.q.UpdateLoyaltySubscriptionPlan(ctx, db.UpdateLoyaltySubscriptionPlanParams{
		Uuid: id, OrganizationID: org, Name: f.name, Description: f.description, Price: f.price, Currency: f.currency,
		PeriodMonths: f.months, UsesPerPeriod: f.uses, ServiceIds: f.serviceIDs, CategoryIds: f.categoryIDs, IsActive: f.active,
	})
	if err != nil {
		return Plan{}, notFound(err)
	}
	s.record(ctx, "loyalty.plan.update", "loyalty.plan", row.Uuid, map[string]any{"name": row.Name})
	s.emit(ctx, resourceevents.TenantLoyaltyPrograms, resourceevents.ActionUpdated, row.Uuid.String())
	return s.GetPlan(ctx, row.Uuid)
}

// DeletePlan archives a plan (running subscriptions continue).
func (s *Service) DeletePlan(ctx context.Context, id uuid.UUID) error {
	org, err := orgID(ctx)
	if err != nil {
		return err
	}
	row, err := s.q.SoftDeleteLoyaltySubscriptionPlan(ctx, db.SoftDeleteLoyaltySubscriptionPlanParams{Uuid: id, OrganizationID: org})
	if err != nil {
		return notFound(err)
	}
	s.record(ctx, "loyalty.plan.delete", "loyalty.plan", row.Uuid, map[string]any{"name": row.Name})
	s.emit(ctx, resourceevents.TenantLoyaltyPrograms, resourceevents.ActionDeleted, row.Uuid.String())
	return nil
}
