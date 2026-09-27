-- Billing settings, discounts, orders and admin subscription queries.

-- name: GetBillingSettings :one
SELECT * FROM billing_settings WHERE id = 1;

-- name: UpdatePaymentSettings :one
UPDATE billing_settings
SET bank_name = sqlc.arg(bank_name),
    account_holder = sqlc.arg(account_holder),
    iban = sqlc.arg(iban),
    payment_instructions = sqlc.arg(payment_instructions),
    order_ttl_days = sqlc.arg(order_ttl_days),
    grace_days = sqlc.arg(grace_days),
    vat_rate = sqlc.arg(vat_rate)
WHERE id = 1
RETURNING *;

-- name: ListDiscountCodes :many
SELECT d.*,
    (SELECT COUNT(*)::bigint FROM billing_discount_uses u WHERE u.discount_code_id = d.id) AS used_count
FROM billing_discount_codes d
WHERE sqlc.arg(q)::text = ''
    OR d.code ILIKE '%' || sqlc.arg(q)::text || '%'
    OR d.note ILIKE '%' || sqlc.arg(q)::text || '%'
ORDER BY d.created_at DESC, d.id DESC
LIMIT sqlc.arg(limit_) OFFSET sqlc.arg(offset_);

-- name: CountDiscountCodes :one
SELECT COUNT(*)::bigint
FROM billing_discount_codes d
WHERE sqlc.arg(q)::text = ''
    OR d.code ILIKE '%' || sqlc.arg(q)::text || '%'
    OR d.note ILIKE '%' || sqlc.arg(q)::text || '%';

-- name: GetDiscountCodeByUUID :one
SELECT * FROM billing_discount_codes WHERE uuid = $1;

-- name: GetDiscountCodeByCode :one
SELECT * FROM billing_discount_codes WHERE code = $1;

-- name: CreateDiscountCode :one
INSERT INTO billing_discount_codes (
    code, kind, value, applies_to_plans, applies_to_periods, starts_at, ends_at,
    max_uses, max_uses_per_org, first_purchase_only, is_active, note, created_by
) VALUES (
    sqlc.arg(code), sqlc.arg(kind), sqlc.arg(value), sqlc.arg(applies_to_plans), sqlc.arg(applies_to_periods),
    sqlc.narg(starts_at), sqlc.narg(ends_at), sqlc.narg(max_uses), sqlc.narg(max_uses_per_org),
    sqlc.arg(first_purchase_only), sqlc.arg(is_active), sqlc.arg(note), sqlc.narg(created_by)
)
RETURNING *;

-- name: UpdateDiscountCode :one
UPDATE billing_discount_codes
SET code = sqlc.arg(code),
    kind = sqlc.arg(kind),
    value = sqlc.arg(value),
    applies_to_plans = sqlc.arg(applies_to_plans),
    applies_to_periods = sqlc.arg(applies_to_periods),
    starts_at = sqlc.narg(starts_at),
    ends_at = sqlc.narg(ends_at),
    max_uses = sqlc.narg(max_uses),
    max_uses_per_org = sqlc.narg(max_uses_per_org),
    first_purchase_only = sqlc.arg(first_purchase_only),
    is_active = sqlc.arg(is_active),
    note = sqlc.arg(note)
WHERE uuid = sqlc.arg(uuid)
RETURNING *;

-- name: DeactivateDiscountCode :exec
UPDATE billing_discount_codes SET is_active = FALSE WHERE uuid = $1;

-- name: DeleteUnusedDiscountCode :execrows
DELETE FROM billing_discount_codes d
WHERE d.uuid = $1
    AND NOT EXISTS (SELECT 1 FROM billing_discount_uses u WHERE u.discount_code_id = d.id);

-- name: CountDiscountUses :one
SELECT COUNT(*)::bigint FROM billing_discount_uses WHERE discount_code_id = $1;

-- name: CountDiscountUsesByOrg :one
SELECT COUNT(*)::bigint FROM billing_discount_uses WHERE discount_code_id = $1 AND organization_id = $2;

-- name: InsertDiscountUse :exec
INSERT INTO billing_discount_uses (discount_code_id, organization_id, order_id, amount)
VALUES (sqlc.arg(discount_code_id), sqlc.arg(organization_id), sqlc.arg(order_id), sqlc.arg(amount));

-- name: CreateOrder :one
INSERT INTO billing_orders (
    organization_id, plan_id, period, kind, status, channel, reference_code, list_price,
    proration_credit, discount_code_id, discount_code, discount_amount, credit_applied,
    credit_surplus, total, vat_rate, vat_amount, lines, starts_at, ends_at,
    custom_features, expires_at, created_by
) VALUES (
    sqlc.arg(organization_id), sqlc.arg(plan_id), sqlc.arg(period), sqlc.arg(kind), sqlc.arg(status),
    sqlc.arg(channel), sqlc.arg(reference_code), sqlc.arg(list_price), sqlc.arg(proration_credit),
    sqlc.narg(discount_code_id), sqlc.arg(discount_code), sqlc.arg(discount_amount),
    sqlc.arg(credit_applied), sqlc.arg(credit_surplus), sqlc.arg(total), sqlc.arg(vat_rate),
    sqlc.arg(vat_amount), sqlc.arg(lines), sqlc.arg(starts_at), sqlc.arg(ends_at),
    sqlc.arg(custom_features), sqlc.arg(expires_at), sqlc.narg(created_by)
)
RETURNING *;

-- name: GetOrderByUUIDForOrg :one
SELECT o.*, p.code AS plan_code, p.name AS plan_name, p.uuid AS plan_uuid
FROM billing_orders o
JOIN billing_plans p ON p.id = o.plan_id
WHERE o.uuid = sqlc.arg(uuid) AND o.organization_id = sqlc.arg(organization_id);

-- name: GetOrderByUUID :one
SELECT o.*, p.code AS plan_code, p.name AS plan_name, p.uuid AS plan_uuid,
    org.uuid AS organization_uuid, org.slug AS organization_slug, org.name AS organization_name
FROM billing_orders o
JOIN billing_plans p ON p.id = o.plan_id
JOIN organizations org ON org.id = o.organization_id
WHERE o.uuid = $1;

-- name: GetOrderForUpdate :one
SELECT * FROM billing_orders WHERE uuid = $1 FOR UPDATE;

-- name: GetOpenOrderForOrg :one
SELECT * FROM billing_orders
WHERE organization_id = $1 AND status IN ('pending_payment', 'payment_reported')
ORDER BY created_at DESC
LIMIT 1;

-- name: ListOrdersForOrg :many
SELECT o.*, p.code AS plan_code, p.name AS plan_name, p.uuid AS plan_uuid
FROM billing_orders o
JOIN billing_plans p ON p.id = o.plan_id
WHERE o.organization_id = sqlc.arg(organization_id)
    AND (
        sqlc.arg(status)::text = ''
        OR (sqlc.arg(status)::text = 'open' AND o.status IN ('pending_payment', 'payment_reported'))
        OR o.status = sqlc.arg(status)::text
    )
ORDER BY o.created_at DESC, o.id DESC
LIMIT sqlc.arg(limit_) OFFSET sqlc.arg(offset_);

-- name: CountOrdersForOrg :one
SELECT COUNT(*)::bigint
FROM billing_orders o
WHERE o.organization_id = sqlc.arg(organization_id)
    AND (
        sqlc.arg(status)::text = ''
        OR (sqlc.arg(status)::text = 'open' AND o.status IN ('pending_payment', 'payment_reported'))
        OR o.status = sqlc.arg(status)::text
    );

-- name: ListOrders :many
SELECT o.*, p.code AS plan_code, p.name AS plan_name, p.uuid AS plan_uuid,
    org.uuid AS organization_uuid, org.slug AS organization_slug, org.name AS organization_name
FROM billing_orders o
JOIN billing_plans p ON p.id = o.plan_id
JOIN organizations org ON org.id = o.organization_id
WHERE (sqlc.arg(status)::text = '' OR o.status = sqlc.arg(status)::text)
    AND (
        sqlc.arg(q)::text = ''
        OR org.name ILIKE '%' || sqlc.arg(q)::text || '%'
        OR org.slug ILIKE '%' || sqlc.arg(q)::text || '%'
        OR o.reference_code ILIKE '%' || sqlc.arg(q)::text || '%'
    )
ORDER BY o.created_at DESC, o.id DESC
LIMIT sqlc.arg(limit_) OFFSET sqlc.arg(offset_);

-- name: CountOrders :one
SELECT COUNT(*)::bigint
FROM billing_orders o
JOIN organizations org ON org.id = o.organization_id
WHERE (sqlc.arg(status)::text = '' OR o.status = sqlc.arg(status)::text)
    AND (
        sqlc.arg(q)::text = ''
        OR org.name ILIKE '%' || sqlc.arg(q)::text || '%'
        OR org.slug ILIKE '%' || sqlc.arg(q)::text || '%'
        OR o.reference_code ILIKE '%' || sqlc.arg(q)::text || '%'
    );

-- name: OrderStatusSummary :one
SELECT
    COUNT(*) FILTER (WHERE status = 'pending_payment')::bigint AS pending_payment,
    COUNT(*) FILTER (WHERE status = 'payment_reported')::bigint AS payment_reported
FROM billing_orders;

-- name: ReportOrder :one
UPDATE billing_orders
SET status = 'payment_reported',
    receipt_object_key = sqlc.arg(receipt_object_key),
    receipt_content_type = sqlc.arg(receipt_content_type),
    report_note = sqlc.arg(report_note),
    reported_at = NOW()
WHERE uuid = sqlc.arg(uuid)
RETURNING *;

-- name: SetOrderStatus :one
UPDATE billing_orders
SET status = sqlc.arg(status),
    reviewed_by = sqlc.narg(reviewed_by),
    reviewed_at = sqlc.narg(reviewed_at),
    review_note = sqlc.arg(review_note),
    reject_reason = sqlc.arg(reject_reason),
    subscription_id = sqlc.narg(subscription_id)
WHERE uuid = sqlc.arg(uuid)
RETURNING *;

-- name: ExpireDueOrders :many
UPDATE billing_orders
SET status = 'expired'
WHERE status = 'pending_payment' AND expires_at < NOW()
RETURNING id, organization_id;

-- name: ReferenceCodeExists :one
SELECT EXISTS(SELECT 1 FROM billing_orders WHERE reference_code = $1)::boolean;

-- name: CountApprovedOrdersForOrg :one
SELECT COUNT(*)::bigint FROM billing_orders WHERE organization_id = $1 AND status = 'approved';

-- name: ListBillingPlanUUIDsByIDs :many
SELECT id, uuid FROM billing_plans WHERE id = ANY(sqlc.arg(ids)::bigint[]);

-- name: ListSubscriptionsAdmin :many
SELECT latest.*, p.code AS plan_code, p.name AS plan_name, p.uuid AS plan_uuid,
    org.uuid AS organization_uuid, org.slug AS organization_slug, org.name AS organization_name
FROM (
    SELECT DISTINCT ON (organization_id) *
    FROM billing_subscriptions
    ORDER BY organization_id, created_at DESC
) latest
JOIN billing_plans p ON p.id = latest.plan_id
JOIN organizations org ON org.id = latest.organization_id
WHERE (sqlc.arg(status)::text = '' OR latest.status = sqlc.arg(status)::text)
    AND (sqlc.narg(plan_uuid)::uuid IS NULL OR p.uuid = sqlc.narg(plan_uuid)::uuid)
    AND (
        sqlc.narg(expiring_until)::timestamptz IS NULL
        OR (
            latest.status IN ('trial', 'active')
            AND latest.ends_at > NOW()
            AND latest.ends_at <= sqlc.narg(expiring_until)::timestamptz
        )
    )
    AND (
        sqlc.arg(q)::text = ''
        OR org.name ILIKE '%' || sqlc.arg(q)::text || '%'
        OR org.slug ILIKE '%' || sqlc.arg(q)::text || '%'
    )
ORDER BY latest.created_at DESC, latest.id DESC
LIMIT sqlc.arg(limit_) OFFSET sqlc.arg(offset_);

-- name: CountSubscriptionsAdmin :one
SELECT COUNT(*)::bigint
FROM (
    SELECT DISTINCT ON (organization_id) *
    FROM billing_subscriptions
    ORDER BY organization_id, created_at DESC
) latest
JOIN billing_plans p ON p.id = latest.plan_id
JOIN organizations org ON org.id = latest.organization_id
WHERE (sqlc.arg(status)::text = '' OR latest.status = sqlc.arg(status)::text)
    AND (sqlc.narg(plan_uuid)::uuid IS NULL OR p.uuid = sqlc.narg(plan_uuid)::uuid)
    AND (
        sqlc.narg(expiring_until)::timestamptz IS NULL
        OR (
            latest.status IN ('trial', 'active')
            AND latest.ends_at > NOW()
            AND latest.ends_at <= sqlc.narg(expiring_until)::timestamptz
        )
    )
    AND (
        sqlc.arg(q)::text = ''
        OR org.name ILIKE '%' || sqlc.arg(q)::text || '%'
        OR org.slug ILIKE '%' || sqlc.arg(q)::text || '%'
    );

-- name: GetSubscriptionByUUID :one
SELECT s.*, p.code AS plan_code, p.name AS plan_name, p.uuid AS plan_uuid,
    org.uuid AS organization_uuid, org.slug AS organization_slug, org.name AS organization_name
FROM billing_subscriptions s
JOIN billing_plans p ON p.id = s.plan_id
JOIN organizations org ON org.id = s.organization_id
WHERE s.uuid = $1;

-- name: GetLiveSubscriptionForUpdate :one
SELECT * FROM billing_subscriptions
WHERE organization_id = $1 AND status IN ('trial', 'active', 'grace', 'read_only')
FOR UPDATE;

-- name: CloseSubscription :exec
UPDATE billing_subscriptions
SET status = 'cancelled',
    note = CASE WHEN note = '' THEN sqlc.arg(note)::text ELSE note || E'\n' || sqlc.arg(note)::text END
WHERE id = sqlc.arg(id);

-- name: UpdateSubscriptionAdmin :one
UPDATE billing_subscriptions
SET ends_at = COALESCE(sqlc.narg(ends_at), ends_at),
    plan_id = COALESCE(sqlc.narg(plan_id), plan_id),
    status = COALESCE(sqlc.narg(status), status),
    grace_ends_at = CASE WHEN sqlc.narg(clear_grace)::boolean THEN NULL ELSE grace_ends_at END,
    note = CASE
        WHEN sqlc.arg(note)::text = '' THEN note
        WHEN note = '' THEN sqlc.arg(note)::text
        ELSE note || E'\n' || sqlc.arg(note)::text
    END
WHERE uuid = sqlc.arg(uuid)
RETURNING *;

-- name: SetSubscriptionCredit :exec
UPDATE billing_subscriptions SET credit_balance = sqlc.arg(credit_balance) WHERE id = sqlc.arg(id);

-- name: CreateSubscriptionWithCredit :one
INSERT INTO billing_subscriptions (
    organization_id, plan_id, period, status, starts_at, ends_at, price_paid,
    credit_balance, source, note, created_by
) VALUES (
    sqlc.arg(organization_id), sqlc.arg(plan_id), sqlc.arg(period), sqlc.arg(status),
    sqlc.arg(starts_at), sqlc.arg(ends_at), sqlc.arg(price_paid), sqlc.arg(credit_balance),
    sqlc.arg(source), sqlc.arg(note), sqlc.narg(created_by)
)
RETURNING *;
