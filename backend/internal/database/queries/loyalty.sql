-- Loyalty and packages (stamp campaigns, prepaid packages, subscriptions).
-- Every query filters organization_id.

-- ------------------------------------------------------------ references

-- name: LoyaltyResolveServices :many
SELECT s.id, s.uuid, s.name, s.price, s.currency, s.category_id
FROM services s
WHERE s.organization_id = sqlc.arg(organization_id)
  AND s.uuid = ANY (sqlc.arg(uuids)::uuid[])
  AND s.deleted_at IS NULL;

-- name: LoyaltyServicesByIDs :many
SELECT s.id, s.uuid, s.name, s.price, s.currency, s.category_id
FROM services s
WHERE s.organization_id = sqlc.arg(organization_id)
  AND s.id = ANY (sqlc.arg(ids)::bigint[]);

-- name: LoyaltyResolveCategories :many
SELECT c.id, c.uuid, c.name
FROM catalog_categories c
WHERE c.organization_id = sqlc.arg(organization_id)
  AND c.uuid = ANY (sqlc.arg(uuids)::uuid[])
  AND c.kind = 'service'
  AND c.deleted_at IS NULL;

-- name: LoyaltyCategoriesByIDs :many
SELECT c.id, c.uuid, c.name
FROM catalog_categories c
WHERE c.organization_id = sqlc.arg(organization_id)
  AND c.id = ANY (sqlc.arg(ids)::bigint[]);

-- name: LoyaltyGetCustomer :one
SELECT c.id, c.uuid, c.name, c.phone
FROM customers c
WHERE c.organization_id = sqlc.arg(organization_id)
  AND c.uuid = sqlc.arg(uuid)
  AND c.deleted_at IS NULL;

-- name: LoyaltyGetCustomerByID :one
SELECT c.id, c.uuid, c.name, c.phone
FROM customers c
WHERE c.organization_id = sqlc.arg(organization_id) AND c.id = sqlc.arg(id);

-- name: LoyaltyGetVehicle :one
SELECT v.id, v.uuid, v.plate, v.customer_id
FROM customer_vehicles v
WHERE v.organization_id = sqlc.arg(organization_id)
  AND v.uuid = sqlc.arg(uuid)
  AND v.deleted_at IS NULL;

-- ------------------------------------------------------------ campaigns

-- name: CreateLoyaltyCampaign :one
INSERT INTO loyalty_campaigns (
    organization_id, name, description, service_ids, category_ids, stamps_required,
    reward_type, reward_service_id, reward_value, valid_from, valid_until, is_active,
    per_customer_limit, created_by
) VALUES (
    sqlc.arg(organization_id), sqlc.arg(name), sqlc.arg(description), sqlc.arg(service_ids)::bigint[],
    sqlc.arg(category_ids)::bigint[], sqlc.arg(stamps_required), sqlc.arg(reward_type),
    sqlc.narg(reward_service_id), sqlc.arg(reward_value), sqlc.narg(valid_from), sqlc.narg(valid_until),
    sqlc.arg(is_active), sqlc.narg(per_customer_limit), sqlc.narg(created_by)
)
RETURNING *;

-- name: UpdateLoyaltyCampaign :one
UPDATE loyalty_campaigns
SET name = sqlc.arg(name),
    description = sqlc.arg(description),
    service_ids = sqlc.arg(service_ids)::bigint[],
    category_ids = sqlc.arg(category_ids)::bigint[],
    stamps_required = sqlc.arg(stamps_required),
    reward_type = sqlc.arg(reward_type),
    reward_service_id = sqlc.narg(reward_service_id),
    reward_value = sqlc.arg(reward_value),
    valid_from = sqlc.narg(valid_from),
    valid_until = sqlc.narg(valid_until),
    is_active = sqlc.arg(is_active),
    per_customer_limit = sqlc.narg(per_customer_limit)
WHERE uuid = sqlc.arg(uuid) AND organization_id = sqlc.arg(organization_id) AND deleted_at IS NULL
RETURNING *;

-- name: SoftDeleteLoyaltyCampaign :one
UPDATE loyalty_campaigns
SET deleted_at = NOW(), is_active = false
WHERE uuid = sqlc.arg(uuid) AND organization_id = sqlc.arg(organization_id) AND deleted_at IS NULL
RETURNING *;

-- name: GetLoyaltyCampaign :one
SELECT * FROM loyalty_campaigns
WHERE uuid = sqlc.arg(uuid) AND organization_id = sqlc.arg(organization_id) AND deleted_at IS NULL;

-- name: GetLoyaltyCampaignByID :one
SELECT * FROM loyalty_campaigns
WHERE id = sqlc.arg(id) AND organization_id = sqlc.arg(organization_id);

-- name: ListLoyaltyCampaigns :many
SELECT * FROM loyalty_campaigns
WHERE organization_id = sqlc.arg(organization_id) AND deleted_at IS NULL
  AND (sqlc.narg(is_active)::boolean IS NULL OR is_active = sqlc.narg(is_active))
  AND (sqlc.narg(q)::text IS NULL OR name ILIKE '%' || sqlc.narg(q) || '%')
ORDER BY is_active DESC, created_at DESC
LIMIT sqlc.arg(limit_count) OFFSET sqlc.arg(offset_count);

-- name: CountLoyaltyCampaigns :one
SELECT COUNT(*)::bigint FROM loyalty_campaigns
WHERE organization_id = sqlc.arg(organization_id) AND deleted_at IS NULL
  AND (sqlc.narg(is_active)::boolean IS NULL OR is_active = sqlc.narg(is_active))
  AND (sqlc.narg(q)::text IS NULL OR name ILIKE '%' || sqlc.narg(q) || '%');

-- name: ListActiveLoyaltyCampaigns :many
-- Campaigns that can earn / redeem on a day (active, inside the window).
SELECT * FROM loyalty_campaigns
WHERE organization_id = sqlc.arg(organization_id) AND deleted_at IS NULL AND is_active
  AND (valid_from IS NULL OR valid_from <= sqlc.arg(on_day)::date)
  AND (valid_until IS NULL OR valid_until >= sqlc.arg(on_day)::date)
ORDER BY id;

-- ------------------------------------------------------------ stamps

-- name: InsertLoyaltyStampEvent :one
-- Earn / reverse_earn are once per (campaign, job): a repeat returns no row.
INSERT INTO loyalty_stamp_events (organization_id, campaign_id, customer_id, job_id, kind, stamps, created_by)
VALUES (sqlc.arg(organization_id), sqlc.arg(campaign_id), sqlc.arg(customer_id), sqlc.narg(job_id),
        sqlc.arg(kind), sqlc.arg(stamps), sqlc.narg(created_by))
ON CONFLICT DO NOTHING
RETURNING *;

-- name: ListLoyaltyStampEventsByJob :many
SELECT * FROM loyalty_stamp_events
WHERE organization_id = sqlc.arg(organization_id) AND job_id = sqlc.arg(job_id)
ORDER BY id;

-- name: LoyaltyStampBalances :many
-- Per campaign: stamp balance and the number of rewards redeemed (net of
-- reverted redemptions) of one customer.
SELECT e.campaign_id,
       COALESCE(SUM(e.stamps), 0)::bigint AS balance,
       (COUNT(*) FILTER (WHERE e.kind = 'redeem') - COUNT(*) FILTER (WHERE e.kind = 'unredeem'))::bigint AS redeemed,
       COUNT(*) FILTER (WHERE e.kind = 'earn')::bigint AS earned
FROM loyalty_stamp_events e
WHERE e.organization_id = sqlc.arg(organization_id) AND e.customer_id = sqlc.arg(customer_id)
GROUP BY e.campaign_id;

-- name: LoyaltyLockCustomer :exec
-- Serializes stamp / credit changes of one customer inside a transaction.
SELECT pg_advisory_xact_lock(hashtextextended('loyalty:' || sqlc.arg(organization_id)::bigint::text || ':' || sqlc.arg(customer_id)::bigint::text, 0));

-- ------------------------------------------------------------ packages

-- name: CreateLoyaltyPackage :one
INSERT INTO loyalty_packages (organization_id, name, description, price, currency, validity_days, is_active, created_by)
VALUES (sqlc.arg(organization_id), sqlc.arg(name), sqlc.arg(description), sqlc.arg(price), sqlc.arg(currency),
        sqlc.narg(validity_days), sqlc.arg(is_active), sqlc.narg(created_by))
RETURNING *;

-- name: UpdateLoyaltyPackage :one
UPDATE loyalty_packages
SET name = sqlc.arg(name), description = sqlc.arg(description), price = sqlc.arg(price),
    currency = sqlc.arg(currency), validity_days = sqlc.narg(validity_days), is_active = sqlc.arg(is_active)
WHERE uuid = sqlc.arg(uuid) AND organization_id = sqlc.arg(organization_id) AND deleted_at IS NULL
RETURNING *;

-- name: SoftDeleteLoyaltyPackage :one
UPDATE loyalty_packages
SET deleted_at = NOW(), is_active = false
WHERE uuid = sqlc.arg(uuid) AND organization_id = sqlc.arg(organization_id) AND deleted_at IS NULL
RETURNING *;

-- name: GetLoyaltyPackage :one
SELECT * FROM loyalty_packages
WHERE uuid = sqlc.arg(uuid) AND organization_id = sqlc.arg(organization_id) AND deleted_at IS NULL;

-- name: ListLoyaltyPackages :many
SELECT p.*,
       (SELECT COUNT(*) FROM loyalty_customer_packages cp
        WHERE cp.package_id = p.id AND cp.organization_id = p.organization_id)::bigint AS sold_count
FROM loyalty_packages p
WHERE p.organization_id = sqlc.arg(organization_id) AND p.deleted_at IS NULL
  AND (sqlc.narg(is_active)::boolean IS NULL OR p.is_active = sqlc.narg(is_active))
  AND (sqlc.narg(q)::text IS NULL OR p.name ILIKE '%' || sqlc.narg(q) || '%')
ORDER BY p.is_active DESC, p.created_at DESC
LIMIT sqlc.arg(limit_count) OFFSET sqlc.arg(offset_count);

-- name: CountLoyaltyPackages :one
SELECT COUNT(*)::bigint FROM loyalty_packages
WHERE organization_id = sqlc.arg(organization_id) AND deleted_at IS NULL
  AND (sqlc.narg(is_active)::boolean IS NULL OR is_active = sqlc.narg(is_active))
  AND (sqlc.narg(q)::text IS NULL OR name ILIKE '%' || sqlc.narg(q) || '%');

-- name: DeleteLoyaltyPackageItems :exec
DELETE FROM loyalty_package_items
WHERE package_id = sqlc.arg(package_id) AND organization_id = sqlc.arg(organization_id);

-- name: CreateLoyaltyPackageItem :exec
INSERT INTO loyalty_package_items (organization_id, package_id, service_id, quantity, sort_order)
VALUES (sqlc.arg(organization_id), sqlc.arg(package_id), sqlc.arg(service_id), sqlc.arg(quantity), sqlc.arg(sort_order));

-- name: ListLoyaltyPackageItems :many
SELECT i.package_id, i.service_id, i.quantity, s.uuid AS service_uuid, s.name AS service_name, s.price AS service_price
FROM loyalty_package_items i
JOIN services s ON s.id = i.service_id
WHERE i.organization_id = sqlc.arg(organization_id)
  AND i.package_id = ANY (sqlc.arg(package_ids)::bigint[])
ORDER BY i.package_id, i.sort_order, i.id;

-- ------------------------------------------------------------ customer packages

-- name: CreateLoyaltyCustomerPackage :one
INSERT INTO loyalty_customer_packages (
    organization_id, package_id, customer_id, name, price, currency, purchased_at, expires_at,
    payment_method, finance_account_id, notes, created_by
) VALUES (
    sqlc.arg(organization_id), sqlc.narg(package_id), sqlc.arg(customer_id), sqlc.arg(name), sqlc.arg(price),
    sqlc.arg(currency), sqlc.arg(purchased_at), sqlc.narg(expires_at), sqlc.arg(payment_method),
    sqlc.narg(finance_account_id), sqlc.arg(notes), sqlc.narg(created_by)
)
RETURNING *;

-- name: LinkLoyaltyCustomerPackagePayment :exec
UPDATE loyalty_customer_packages
SET finance_transaction_id = sqlc.narg(finance_transaction_id), cari_entry_id = sqlc.narg(cari_entry_id)
WHERE id = sqlc.arg(id) AND organization_id = sqlc.arg(organization_id);

-- name: CreateLoyaltyCustomerPackageCredit :exec
INSERT INTO loyalty_customer_package_credits (organization_id, customer_package_id, service_id, service_name, total)
VALUES (sqlc.arg(organization_id), sqlc.arg(customer_package_id), sqlc.arg(service_id), sqlc.arg(service_name), sqlc.arg(total));

-- name: CancelLoyaltyCustomerPackage :one
UPDATE loyalty_customer_packages
SET status = 'cancelled', cancelled_at = NOW()
WHERE uuid = sqlc.arg(uuid) AND organization_id = sqlc.arg(organization_id) AND status = 'active'
RETURNING *;

-- name: GetLoyaltyCustomerPackage :one
SELECT cp.*, c.uuid AS customer_uuid, c.name AS customer_name, p.uuid AS package_uuid
FROM loyalty_customer_packages cp
JOIN customers c ON c.id = cp.customer_id
LEFT JOIN loyalty_packages p ON p.id = cp.package_id
WHERE cp.uuid = sqlc.arg(uuid) AND cp.organization_id = sqlc.arg(organization_id);

-- name: ListLoyaltyCustomerPackages :many
-- state: active (usable) | expired | used_up | cancelled; NULL = all.
SELECT cp.*, c.uuid AS customer_uuid, c.name AS customer_name, p.uuid AS package_uuid,
       COALESCE((SELECT SUM(cr.total) FROM loyalty_customer_package_credits cr WHERE cr.customer_package_id = cp.id), 0)::bigint AS credits_total,
       COALESCE((SELECT SUM(cr.used) FROM loyalty_customer_package_credits cr WHERE cr.customer_package_id = cp.id), 0)::bigint AS credits_used
FROM loyalty_customer_packages cp
JOIN customers c ON c.id = cp.customer_id
LEFT JOIN loyalty_packages p ON p.id = cp.package_id
WHERE cp.organization_id = sqlc.arg(organization_id)
  AND (sqlc.narg(customer_id)::bigint IS NULL OR cp.customer_id = sqlc.narg(customer_id))
  AND (sqlc.narg(q)::text IS NULL OR cp.name ILIKE '%' || sqlc.narg(q) || '%' OR c.name ILIKE '%' || sqlc.narg(q) || '%')
  AND (
    sqlc.narg(state)::text IS NULL
    OR (sqlc.narg(state) = 'cancelled' AND cp.status = 'cancelled')
    OR (sqlc.narg(state) = 'expired' AND cp.status = 'active' AND cp.expires_at IS NOT NULL AND cp.expires_at <= NOW())
    OR (sqlc.narg(state) = 'used_up' AND cp.status = 'active' AND (cp.expires_at IS NULL OR cp.expires_at > NOW())
        AND NOT EXISTS (SELECT 1 FROM loyalty_customer_package_credits cr WHERE cr.customer_package_id = cp.id AND cr.used < cr.total))
    OR (sqlc.narg(state) = 'active' AND cp.status = 'active' AND (cp.expires_at IS NULL OR cp.expires_at > NOW())
        AND EXISTS (SELECT 1 FROM loyalty_customer_package_credits cr WHERE cr.customer_package_id = cp.id AND cr.used < cr.total))
  )
ORDER BY cp.purchased_at DESC, cp.id DESC
LIMIT sqlc.arg(limit_count) OFFSET sqlc.arg(offset_count);

-- name: CountLoyaltyCustomerPackages :one
SELECT COUNT(*)::bigint
FROM loyalty_customer_packages cp
JOIN customers c ON c.id = cp.customer_id
WHERE cp.organization_id = sqlc.arg(organization_id)
  AND (sqlc.narg(customer_id)::bigint IS NULL OR cp.customer_id = sqlc.narg(customer_id))
  AND (sqlc.narg(q)::text IS NULL OR cp.name ILIKE '%' || sqlc.narg(q) || '%' OR c.name ILIKE '%' || sqlc.narg(q) || '%')
  AND (
    sqlc.narg(state)::text IS NULL
    OR (sqlc.narg(state) = 'cancelled' AND cp.status = 'cancelled')
    OR (sqlc.narg(state) = 'expired' AND cp.status = 'active' AND cp.expires_at IS NOT NULL AND cp.expires_at <= NOW())
    OR (sqlc.narg(state) = 'used_up' AND cp.status = 'active' AND (cp.expires_at IS NULL OR cp.expires_at > NOW())
        AND NOT EXISTS (SELECT 1 FROM loyalty_customer_package_credits cr WHERE cr.customer_package_id = cp.id AND cr.used < cr.total))
    OR (sqlc.narg(state) = 'active' AND cp.status = 'active' AND (cp.expires_at IS NULL OR cp.expires_at > NOW())
        AND EXISTS (SELECT 1 FROM loyalty_customer_package_credits cr WHERE cr.customer_package_id = cp.id AND cr.used < cr.total))
  );

-- name: ListLoyaltyPackageCredits :many
SELECT cr.*, s.uuid AS service_uuid
FROM loyalty_customer_package_credits cr
JOIN services s ON s.id = cr.service_id
WHERE cr.organization_id = sqlc.arg(organization_id)
  AND cr.customer_package_id = ANY (sqlc.arg(customer_package_ids)::bigint[])
ORDER BY cr.customer_package_id, cr.id;

-- name: ListUsableLoyaltyCredits :many
-- Credits a customer can use now (active, not expired, remaining > 0),
-- oldest expiry first.
SELECT cr.id AS credit_id, cr.service_id, cr.service_name, cr.total, cr.used,
       cp.id AS customer_package_id, cp.uuid AS customer_package_uuid, cp.name AS package_name, cp.expires_at
FROM loyalty_customer_package_credits cr
JOIN loyalty_customer_packages cp ON cp.id = cr.customer_package_id
WHERE cp.organization_id = sqlc.arg(organization_id)
  AND cp.customer_id = sqlc.arg(customer_id)
  AND cp.status = 'active'
  AND (cp.expires_at IS NULL OR cp.expires_at > NOW())
  AND cr.used < cr.total
ORDER BY cp.expires_at ASC NULLS LAST, cp.purchased_at ASC, cr.id ASC;

-- name: UseLoyaltyCredit :one
UPDATE loyalty_customer_package_credits
SET used = used + sqlc.arg(units)::int
WHERE id = sqlc.arg(id) AND organization_id = sqlc.arg(organization_id) AND used + sqlc.arg(units)::int <= total
RETURNING *;

-- name: ReturnLoyaltyCredit :exec
UPDATE loyalty_customer_package_credits
SET used = GREATEST(used - sqlc.arg(units)::int, 0)
WHERE id = sqlc.arg(id) AND organization_id = sqlc.arg(organization_id);

-- name: CountLoyaltyCustomerPackageUses :one
SELECT COUNT(*)::bigint FROM loyalty_applications
WHERE organization_id = sqlc.arg(organization_id) AND customer_package_id = sqlc.arg(customer_package_id)
  AND status = 'applied';

-- ------------------------------------------------------------ subscription plans

-- name: CreateLoyaltySubscriptionPlan :one
INSERT INTO loyalty_subscription_plans (
    organization_id, name, description, price, currency, period_months, uses_per_period,
    service_ids, category_ids, is_active, created_by
) VALUES (
    sqlc.arg(organization_id), sqlc.arg(name), sqlc.arg(description), sqlc.arg(price), sqlc.arg(currency),
    sqlc.arg(period_months), sqlc.narg(uses_per_period), sqlc.arg(service_ids)::bigint[],
    sqlc.arg(category_ids)::bigint[], sqlc.arg(is_active), sqlc.narg(created_by)
)
RETURNING *;

-- name: UpdateLoyaltySubscriptionPlan :one
UPDATE loyalty_subscription_plans
SET name = sqlc.arg(name), description = sqlc.arg(description), price = sqlc.arg(price),
    currency = sqlc.arg(currency), period_months = sqlc.arg(period_months),
    uses_per_period = sqlc.narg(uses_per_period), service_ids = sqlc.arg(service_ids)::bigint[],
    category_ids = sqlc.arg(category_ids)::bigint[], is_active = sqlc.arg(is_active)
WHERE uuid = sqlc.arg(uuid) AND organization_id = sqlc.arg(organization_id) AND deleted_at IS NULL
RETURNING *;

-- name: SoftDeleteLoyaltySubscriptionPlan :one
UPDATE loyalty_subscription_plans
SET deleted_at = NOW(), is_active = false
WHERE uuid = sqlc.arg(uuid) AND organization_id = sqlc.arg(organization_id) AND deleted_at IS NULL
RETURNING *;

-- name: GetLoyaltySubscriptionPlan :one
SELECT * FROM loyalty_subscription_plans
WHERE uuid = sqlc.arg(uuid) AND organization_id = sqlc.arg(organization_id) AND deleted_at IS NULL;

-- name: GetLoyaltySubscriptionPlanByID :one
SELECT * FROM loyalty_subscription_plans
WHERE id = sqlc.arg(id) AND organization_id = sqlc.arg(organization_id);

-- name: ListLoyaltySubscriptionPlans :many
SELECT p.*,
       (SELECT COUNT(*) FROM loyalty_subscriptions s
        WHERE s.plan_id = p.id AND s.organization_id = p.organization_id AND s.status = 'active')::bigint AS active_count
FROM loyalty_subscription_plans p
WHERE p.organization_id = sqlc.arg(organization_id) AND p.deleted_at IS NULL
  AND (sqlc.narg(is_active)::boolean IS NULL OR p.is_active = sqlc.narg(is_active))
  AND (sqlc.narg(q)::text IS NULL OR p.name ILIKE '%' || sqlc.narg(q) || '%')
ORDER BY p.is_active DESC, p.created_at DESC
LIMIT sqlc.arg(limit_count) OFFSET sqlc.arg(offset_count);

-- name: CountLoyaltySubscriptionPlans :one
SELECT COUNT(*)::bigint FROM loyalty_subscription_plans
WHERE organization_id = sqlc.arg(organization_id) AND deleted_at IS NULL
  AND (sqlc.narg(is_active)::boolean IS NULL OR is_active = sqlc.narg(is_active))
  AND (sqlc.narg(q)::text IS NULL OR name ILIKE '%' || sqlc.narg(q) || '%');

-- ------------------------------------------------------------ subscriptions

-- name: CreateLoyaltySubscription :one
INSERT INTO loyalty_subscriptions (
    organization_id, plan_id, customer_id, vehicle_id, name, price, currency, period_months,
    uses_per_period, start_date, paid_through, notes, created_by
) VALUES (
    sqlc.arg(organization_id), sqlc.narg(plan_id), sqlc.arg(customer_id), sqlc.narg(vehicle_id), sqlc.arg(name),
    sqlc.arg(price), sqlc.arg(currency), sqlc.arg(period_months), sqlc.narg(uses_per_period),
    sqlc.arg(start_date), sqlc.arg(start_date), sqlc.arg(notes), sqlc.narg(created_by)
)
RETURNING *;

-- name: AdvanceLoyaltySubscription :one
-- Moves paid_through forward after a period payment (only from the
-- expected value, so concurrent payments cannot pay the same period).
UPDATE loyalty_subscriptions
SET paid_through = sqlc.arg(new_paid_through)
WHERE id = sqlc.arg(id) AND organization_id = sqlc.arg(organization_id)
  AND status = 'active' AND paid_through = sqlc.arg(expected_paid_through)
RETURNING *;

-- name: CancelLoyaltySubscription :one
UPDATE loyalty_subscriptions
SET status = 'cancelled', cancelled_at = NOW()
WHERE uuid = sqlc.arg(uuid) AND organization_id = sqlc.arg(organization_id) AND status = 'active'
RETURNING *;

-- name: GetLoyaltySubscription :one
SELECT s.*, c.uuid AS customer_uuid, c.name AS customer_name, c.phone AS customer_phone,
       p.uuid AS plan_uuid, v.uuid AS vehicle_uuid, v.plate AS vehicle_plate
FROM loyalty_subscriptions s
JOIN customers c ON c.id = s.customer_id
LEFT JOIN loyalty_subscription_plans p ON p.id = s.plan_id
LEFT JOIN customer_vehicles v ON v.id = s.vehicle_id
WHERE s.uuid = sqlc.arg(uuid) AND s.organization_id = sqlc.arg(organization_id);

-- name: GetLoyaltySubscriptionByID :one
SELECT * FROM loyalty_subscriptions
WHERE id = sqlc.arg(id) AND organization_id = sqlc.arg(organization_id);

-- name: ListLoyaltySubscriptions :many
-- state: active | past_due | cancelled; due_before: active subscriptions whose
-- renewal (paid_through) is before that day (renewals list).
SELECT s.*, c.uuid AS customer_uuid, c.name AS customer_name, c.phone AS customer_phone,
       p.uuid AS plan_uuid, v.uuid AS vehicle_uuid, v.plate AS vehicle_plate
FROM loyalty_subscriptions s
JOIN customers c ON c.id = s.customer_id
LEFT JOIN loyalty_subscription_plans p ON p.id = s.plan_id
LEFT JOIN customer_vehicles v ON v.id = s.vehicle_id
WHERE s.organization_id = sqlc.arg(organization_id)
  AND (sqlc.narg(customer_id)::bigint IS NULL OR s.customer_id = sqlc.narg(customer_id))
  AND (sqlc.narg(q)::text IS NULL OR s.name ILIKE '%' || sqlc.narg(q) || '%' OR c.name ILIKE '%' || sqlc.narg(q) || '%'
       OR v.plate ILIKE '%' || sqlc.narg(q) || '%')
  AND (
    sqlc.narg(state)::text IS NULL
    OR (sqlc.narg(state) = 'cancelled' AND s.status = 'cancelled')
    OR (sqlc.narg(state) = 'past_due' AND s.status = 'active' AND s.paid_through <= sqlc.arg(today)::date)
    OR (sqlc.narg(state) = 'active' AND s.status = 'active' AND s.paid_through > sqlc.arg(today)::date)
  )
  AND (sqlc.narg(due_before)::date IS NULL OR (s.status = 'active' AND s.paid_through < sqlc.narg(due_before)))
ORDER BY
    CASE WHEN sqlc.narg(due_before)::date IS NOT NULL THEN s.paid_through END ASC,
    s.created_at DESC, s.id DESC
LIMIT sqlc.arg(limit_count) OFFSET sqlc.arg(offset_count);

-- name: CountLoyaltySubscriptions :one
SELECT COUNT(*)::bigint
FROM loyalty_subscriptions s
JOIN customers c ON c.id = s.customer_id
LEFT JOIN customer_vehicles v ON v.id = s.vehicle_id
WHERE s.organization_id = sqlc.arg(organization_id)
  AND (sqlc.narg(customer_id)::bigint IS NULL OR s.customer_id = sqlc.narg(customer_id))
  AND (sqlc.narg(q)::text IS NULL OR s.name ILIKE '%' || sqlc.narg(q) || '%' OR c.name ILIKE '%' || sqlc.narg(q) || '%'
       OR v.plate ILIKE '%' || sqlc.narg(q) || '%')
  AND (
    sqlc.narg(state)::text IS NULL
    OR (sqlc.narg(state) = 'cancelled' AND s.status = 'cancelled')
    OR (sqlc.narg(state) = 'past_due' AND s.status = 'active' AND s.paid_through <= sqlc.arg(today)::date)
    OR (sqlc.narg(state) = 'active' AND s.status = 'active' AND s.paid_through > sqlc.arg(today)::date)
  )
  AND (sqlc.narg(due_before)::date IS NULL OR (s.status = 'active' AND s.paid_through < sqlc.narg(due_before)));

-- name: ListUsableLoyaltySubscriptions :many
-- Active, paid subscriptions of a customer (the current day is covered).
SELECT * FROM loyalty_subscriptions
WHERE organization_id = sqlc.arg(organization_id) AND customer_id = sqlc.arg(customer_id)
  AND status = 'active' AND start_date <= sqlc.arg(today)::date AND paid_through > sqlc.arg(today)::date
ORDER BY id;

-- name: CreateLoyaltySubscriptionPayment :one
INSERT INTO loyalty_subscription_payments (
    organization_id, subscription_id, period_start, period_end, amount, currency, method,
    finance_account_id, created_by
) VALUES (
    sqlc.arg(organization_id), sqlc.arg(subscription_id), sqlc.arg(period_start), sqlc.arg(period_end),
    sqlc.arg(amount), sqlc.arg(currency), sqlc.arg(method), sqlc.narg(finance_account_id), sqlc.narg(created_by)
)
RETURNING *;

-- name: LinkLoyaltySubscriptionPayment :exec
UPDATE loyalty_subscription_payments
SET finance_transaction_id = sqlc.narg(finance_transaction_id), cari_entry_id = sqlc.narg(cari_entry_id)
WHERE id = sqlc.arg(id) AND organization_id = sqlc.arg(organization_id);

-- name: ListLoyaltySubscriptionPayments :many
SELECT pay.*, fa.uuid AS finance_account_uuid, fa.name AS finance_account_name
FROM loyalty_subscription_payments pay
LEFT JOIN finance_accounts fa ON fa.id = pay.finance_account_id
WHERE pay.organization_id = sqlc.arg(organization_id) AND pay.subscription_id = sqlc.arg(subscription_id)
ORDER BY pay.period_start DESC;

-- name: CountLoyaltySubscriptionUses :one
SELECT COALESCE(SUM(units), 0)::bigint FROM loyalty_applications
WHERE organization_id = sqlc.arg(organization_id) AND subscription_id = sqlc.arg(subscription_id)
  AND period_start = sqlc.arg(period_start) AND status = 'applied';

-- name: LoyaltyRenewalCounts :one
SELECT
    COUNT(*) FILTER (WHERE status = 'active')::bigint AS active_count,
    COUNT(*) FILTER (WHERE status = 'active' AND paid_through <= sqlc.arg(today)::date)::bigint AS past_due_count,
    COUNT(*) FILTER (WHERE status = 'active' AND paid_through > sqlc.arg(today)::date
                     AND paid_through <= sqlc.arg(horizon)::date)::bigint AS upcoming_count
FROM loyalty_subscriptions
WHERE organization_id = sqlc.arg(organization_id);

-- ------------------------------------------------------------ job applications

-- name: LoyaltyGetJob :one
SELECT j.id, j.uuid, j.customer_id, j.vehicle_id, j.status, j.payment_status, j.currency,
       j.delivered_at, j.paid_at, j.started_at, j.plate, j.customer_name, c.uuid AS customer_uuid
FROM service_jobs j
JOIN customers c ON c.id = j.customer_id
WHERE j.uuid = sqlc.arg(uuid) AND j.organization_id = sqlc.arg(organization_id);

-- name: LoyaltyGetJobByID :one
SELECT j.id, j.uuid, j.customer_id, j.vehicle_id, j.status, j.payment_status, j.currency,
       j.delivered_at, j.paid_at, j.started_at, j.plate, j.customer_name, c.uuid AS customer_uuid
FROM service_jobs j
JOIN customers c ON c.id = j.customer_id
WHERE j.id = sqlc.arg(id) AND j.organization_id = sqlc.arg(organization_id);

-- name: LoyaltyJobLines :many
SELECT l.id, l.uuid, l.line_type, l.service_id, l.name, l.unit_price, l.qty, l.line_total,
       l.discount_amount, l.discount_source, l.currency, s.uuid AS service_uuid, s.category_id
FROM service_job_lines l
LEFT JOIN services s ON s.id = l.service_id
WHERE l.organization_id = sqlc.arg(organization_id) AND l.job_id = sqlc.arg(job_id)
ORDER BY l.sort_order, l.id;

-- name: LoyaltySetLineDiscount :exec
-- Sets what loyalty covers on a line; line_total = unit_price * qty - discount.
UPDATE service_job_lines
SET discount_amount = sqlc.arg(discount_amount),
    discount_source = sqlc.narg(discount_source),
    line_total = GREATEST(round(unit_price * qty, 2) - sqlc.arg(discount_amount), 0)
WHERE id = sqlc.arg(id) AND organization_id = sqlc.arg(organization_id);

-- name: LoyaltyRecalcJobTotal :one
UPDATE service_jobs j
SET total_amount = COALESCE((
    SELECT SUM(l.line_total) FROM service_job_lines l
    WHERE l.job_id = j.id AND l.organization_id = j.organization_id
), 0)
WHERE j.id = sqlc.arg(id) AND j.organization_id = sqlc.arg(organization_id)
RETURNING j.total_amount;

-- name: CreateLoyaltyApplication :one
INSERT INTO loyalty_applications (
    organization_id, job_id, job_line_id, customer_id, kind, campaign_id, customer_package_id, credit_id,
    subscription_id, period_start, source_name, units, discount_amount, created_by
) VALUES (
    sqlc.arg(organization_id), sqlc.arg(job_id), sqlc.arg(job_line_id), sqlc.arg(customer_id), sqlc.arg(kind),
    sqlc.narg(campaign_id), sqlc.narg(customer_package_id), sqlc.narg(credit_id), sqlc.narg(subscription_id),
    sqlc.narg(period_start), sqlc.arg(source_name), sqlc.arg(units), sqlc.arg(discount_amount), sqlc.narg(created_by)
)
RETURNING *;

-- name: RevertLoyaltyApplication :one
UPDATE loyalty_applications
SET status = 'reverted', reverted_at = NOW(), reverted_by = sqlc.narg(reverted_by)
WHERE id = sqlc.arg(id) AND organization_id = sqlc.arg(organization_id) AND status = 'applied'
RETURNING *;

-- name: ListLoyaltyApplicationsByJob :many
SELECT a.*, l.uuid AS line_uuid, l.name AS line_name,
       lc.uuid AS campaign_uuid, cp.uuid AS customer_package_uuid, ls.uuid AS subscription_uuid
FROM loyalty_applications a
JOIN service_job_lines l ON l.id = a.job_line_id
LEFT JOIN loyalty_campaigns lc ON lc.id = a.campaign_id
LEFT JOIN loyalty_customer_packages cp ON cp.id = a.customer_package_id
LEFT JOIN loyalty_subscriptions ls ON ls.id = a.subscription_id
WHERE a.organization_id = sqlc.arg(organization_id) AND a.job_id = sqlc.arg(job_id)
ORDER BY a.created_at, a.id;

-- name: GetLoyaltyApplication :one
SELECT * FROM loyalty_applications
WHERE uuid = sqlc.arg(uuid) AND organization_id = sqlc.arg(organization_id);

-- name: ListLoyaltyApplicationsBySource :many
-- Usage history of a customer package or subscription.
SELECT a.uuid, a.kind, a.units, a.discount_amount, a.status, a.created_at, a.period_start, a.source_name,
       j.uuid AS job_uuid, j.plate, l.name AS line_name
FROM loyalty_applications a
JOIN service_jobs j ON j.id = a.job_id
JOIN service_job_lines l ON l.id = a.job_line_id
WHERE a.organization_id = sqlc.arg(organization_id)
  AND (sqlc.narg(customer_package_id)::bigint IS NULL OR a.customer_package_id = sqlc.narg(customer_package_id))
  AND (sqlc.narg(subscription_id)::bigint IS NULL OR a.subscription_id = sqlc.narg(subscription_id))
ORDER BY a.created_at DESC
LIMIT 100;

-- name: LoyaltyGetVehicleByID :one
SELECT v.id, v.uuid, v.plate, v.customer_id
FROM customer_vehicles v
WHERE v.organization_id = sqlc.arg(organization_id) AND v.id = sqlc.arg(id);
