-- Review collection (internal/modules/reviews).

-- name: GetReviewSettings :one
SELECT * FROM review_settings WHERE organization_id = sqlc.arg(organization_id);

-- name: UpsertReviewSettings :one
INSERT INTO review_settings (
    organization_id, enabled, channel, delay_minutes, quiet_hours_enabled, quiet_start_hour, quiet_end_hour,
    google_review_url, high_score_threshold, min_days_between, consent_text, default_locale, excluded_customer_ids
) VALUES (
    sqlc.arg(organization_id), sqlc.arg(enabled), sqlc.arg(channel), sqlc.arg(delay_minutes),
    sqlc.arg(quiet_hours_enabled), sqlc.arg(quiet_start_hour), sqlc.arg(quiet_end_hour),
    sqlc.arg(google_review_url), sqlc.arg(high_score_threshold), sqlc.arg(min_days_between),
    sqlc.arg(consent_text), sqlc.arg(default_locale), sqlc.arg(excluded_customer_ids)::bigint[]
)
ON CONFLICT (organization_id) DO UPDATE SET
    enabled = EXCLUDED.enabled,
    channel = EXCLUDED.channel,
    delay_minutes = EXCLUDED.delay_minutes,
    quiet_hours_enabled = EXCLUDED.quiet_hours_enabled,
    quiet_start_hour = EXCLUDED.quiet_start_hour,
    quiet_end_hour = EXCLUDED.quiet_end_hour,
    google_review_url = EXCLUDED.google_review_url,
    high_score_threshold = EXCLUDED.high_score_threshold,
    min_days_between = EXCLUDED.min_days_between,
    consent_text = EXCLUDED.consent_text,
    default_locale = EXCLUDED.default_locale,
    excluded_customer_ids = EXCLUDED.excluded_customer_ids
RETURNING *;

-- name: GetReviewJob :one
-- The delivered job behind a review request (the job event carries its uuid).
SELECT j.id, j.uuid, j.organization_id, j.status, j.plate, j.delivered_at,
       j.customer_id,
       COALESCE(NULLIF(c.name, ''), j.customer_name)::text AS customer_name,
       COALESCE(NULLIF(c.phone, ''), j.customer_phone)::text AS customer_phone
FROM service_jobs j
LEFT JOIN customers c ON c.id = j.customer_id AND c.organization_id = j.organization_id
WHERE j.uuid = sqlc.arg(uuid);

-- name: GetReviewJobStatus :one
SELECT status FROM service_jobs WHERE id = sqlc.arg(id) AND organization_id = sqlc.arg(organization_id);

-- name: CreateReviewRequest :one
-- Idempotent per job: a second delivery event of the same job inserts nothing
-- (no row → pgx.ErrNoRows).
INSERT INTO review_requests (
    organization_id, kind, job_id, customer_id, customer_name, recipient_phone, plate,
    token, status, channel, locale, send_at, deferred, created_by
) VALUES (
    sqlc.arg(organization_id), sqlc.arg(kind), sqlc.narg(job_id), sqlc.narg(customer_id), sqlc.arg(customer_name),
    sqlc.arg(recipient_phone), sqlc.arg(plate), sqlc.arg(token), sqlc.arg(status), sqlc.arg(channel),
    sqlc.arg(locale), sqlc.arg(send_at), sqlc.arg(deferred), sqlc.narg(created_by)
)
ON CONFLICT (organization_id, job_id) WHERE kind = 'job' AND job_id IS NOT NULL DO NOTHING
RETURNING *;

-- name: CancelScheduledReviewRequestsForJob :many
UPDATE review_requests
SET status = 'cancelled', cancelled_at = NOW(), skip_reason = sqlc.arg(reason)
WHERE organization_id = sqlc.arg(organization_id) AND job_id = sqlc.arg(job_id)
  AND status IN ('scheduled', 'sending')
RETURNING uuid;

-- name: ClaimDueReviewRequests :many
-- Moves due scheduled requests to "sending" so concurrent sweeps (API and
-- worker) never send one twice.
UPDATE review_requests r
SET status = 'sending'
WHERE r.id IN (
    SELECT d.id FROM review_requests d
    WHERE d.status = 'scheduled' AND d.send_at <= sqlc.arg(now)::timestamptz
    ORDER BY d.send_at
    LIMIT sqlc.arg(limit_count)
    FOR UPDATE SKIP LOCKED
)
RETURNING r.*;

-- name: RescheduleReviewRequest :exec
UPDATE review_requests
SET status = 'scheduled', send_at = sqlc.arg(send_at), deferred = sqlc.arg(deferred)
WHERE id = sqlc.arg(id) AND organization_id = sqlc.arg(organization_id);

-- name: FinishReviewRequest :one
-- Ends a claimed request without sending: skipped | cancelled | failed.
UPDATE review_requests
SET status = sqlc.arg(status)::text, skip_reason = sqlc.arg(skip_reason), error = sqlc.arg(error),
    channel = sqlc.arg(channel),
    cancelled_at = CASE WHEN sqlc.arg(status)::text = 'cancelled' THEN NOW() ELSE cancelled_at END
WHERE id = sqlc.arg(id) AND organization_id = sqlc.arg(organization_id)
RETURNING *;

-- name: MarkReviewRequestSent :one
UPDATE review_requests
SET status = 'sent', sent_at = NOW(), channel = sqlc.arg(channel), expires_at = sqlc.arg(expires_at),
    outbound_message_uuid = sqlc.narg(outbound_message_uuid), error = '', skip_reason = ''
WHERE id = sqlc.arg(id) AND organization_id = sqlc.arg(organization_id)
RETURNING *;

-- name: FailReviewRequestByOutbound :one
-- The queued message failed for good after it was handed off.
UPDATE review_requests
SET status = 'failed', error = sqlc.arg(error)
WHERE organization_id = sqlc.arg(organization_id) AND uuid = sqlc.arg(uuid)
  AND status = 'sent' AND opened_at IS NULL
RETURNING *;

-- name: ExpireReviewRequests :many
UPDATE review_requests
SET status = 'expired'
WHERE status IN ('sent', 'opened') AND expires_at IS NOT NULL AND expires_at <= sqlc.arg(now)::timestamptz
RETURNING organization_id, uuid;

-- name: CountRecentReviewRequests :one
-- Frequency cap: requests already sent to the same customer (or phone) since.
SELECT COUNT(*)::bigint
FROM review_requests
WHERE organization_id = sqlc.arg(organization_id)
  AND kind = 'job'
  AND id <> sqlc.arg(exclude_id)
  AND status IN ('sent', 'opened', 'answered', 'expired')
  AND sent_at >= sqlc.arg(since)::timestamptz
  AND (
    (sqlc.narg(customer_id)::bigint IS NOT NULL AND customer_id = sqlc.narg(customer_id))
    OR (sqlc.arg(phone)::text <> '' AND recipient_phone = sqlc.arg(phone))
  );

-- name: GetReviewRequestByToken :one
SELECT * FROM review_requests WHERE token = sqlc.arg(token);

-- name: GetReviewRequestByTokenForUpdate :one
SELECT * FROM review_requests WHERE token = sqlc.arg(token) FOR UPDATE;

-- name: MarkReviewRequestViewed :one
UPDATE review_requests
SET view_count = view_count + 1,
    status = CASE WHEN status = 'sent' THEN 'opened' ELSE status END,
    opened_at = COALESCE(opened_at, NOW())
WHERE id = sqlc.arg(id)
RETURNING *;

-- name: AnswerReviewRequest :one
UPDATE review_requests
SET status = 'answered', answered_at = NOW(), opened_at = COALESCE(opened_at, NOW()),
    score = sqlc.arg(score), comment = sqlc.arg(comment), consent = sqlc.arg(consent),
    is_high = sqlc.arg(is_high), follow_up_status = sqlc.arg(follow_up_status),
    answer_ip = sqlc.arg(answer_ip), answer_user_agent = sqlc.arg(answer_user_agent)
WHERE id = sqlc.arg(id) AND status IN ('sent', 'opened')
RETURNING *;

-- name: RecordReviewGoogleRedirect :one
UPDATE review_requests
SET google_redirects = google_redirects + 1, google_redirected_at = NOW()
WHERE id = sqlc.arg(id) AND status = 'answered' AND is_high
RETURNING *;

-- name: ListReviewRequests :many
SELECT r.id, r.uuid, r.kind, r.status, r.skip_reason, r.error, r.channel, r.locale, r.customer_name,
       r.recipient_phone, r.plate, r.send_at, r.deferred, r.sent_at, r.opened_at, r.answered_at,
       r.expires_at, r.score, r.comment, r.is_high, r.google_redirects, r.follow_up_status,
       r.follow_up_note, r.followed_up_at, r.created_at, r.updated_at,
       j.uuid AS job_uuid,
       c.uuid AS customer_uuid,
       COALESCE(NULLIF(TRIM(u.name || ' ' || u.surname), ''), '')::text AS followed_up_by_name
FROM review_requests r
LEFT JOIN service_jobs j ON j.id = r.job_id AND j.organization_id = r.organization_id
LEFT JOIN customers c ON c.id = r.customer_id AND c.organization_id = r.organization_id
LEFT JOIN users u ON u.id = r.followed_up_by
WHERE r.organization_id = sqlc.arg(organization_id)
  AND (sqlc.narg(status)::text IS NULL OR r.status = sqlc.narg(status)
       OR (sqlc.narg(status)::text = 'scheduled' AND r.status = 'sending'))
  AND (sqlc.narg(follow_up)::text IS NULL OR r.follow_up_status = sqlc.narg(follow_up))
  AND (sqlc.narg(rating)::text IS NULL
       OR (sqlc.narg(rating)::text = 'high' AND r.is_high IS TRUE)
       OR (sqlc.narg(rating)::text = 'low' AND r.is_high IS FALSE))
  AND (sqlc.narg(score)::smallint IS NULL OR r.score = sqlc.narg(score))
  AND (sqlc.narg(channel)::text IS NULL OR r.channel = sqlc.narg(channel))
  AND (sqlc.narg(customer_id)::bigint IS NULL OR r.customer_id = sqlc.narg(customer_id))
  AND (sqlc.narg(since)::timestamptz IS NULL OR r.created_at >= sqlc.narg(since))
  AND (sqlc.arg(include_tests)::boolean OR r.kind = 'job')
  AND (
    sqlc.narg(q)::text IS NULL
    OR r.customer_name ILIKE '%' || sqlc.narg(q) || '%'
    OR r.recipient_phone ILIKE '%' || sqlc.narg(q) || '%'
    OR r.plate ILIKE '%' || sqlc.narg(q) || '%'
    OR r.comment ILIKE '%' || sqlc.narg(q) || '%'
  )
ORDER BY
    CASE WHEN sqlc.arg(sort)::text = 'created_at' THEN r.created_at END ASC,
    CASE WHEN sqlc.arg(sort)::text = 'score' THEN r.score END ASC NULLS LAST,
    CASE WHEN sqlc.arg(sort)::text = '-score' THEN r.score END DESC NULLS LAST,
    CASE WHEN sqlc.arg(sort)::text = 'answered_at' THEN r.answered_at END ASC NULLS LAST,
    CASE WHEN sqlc.arg(sort)::text = '-answered_at' THEN r.answered_at END DESC NULLS LAST,
    r.created_at DESC, r.id DESC
LIMIT sqlc.arg(limit_count) OFFSET sqlc.arg(offset_count);

-- name: CountReviewRequests :one
SELECT COUNT(*)::bigint
FROM review_requests r
WHERE r.organization_id = sqlc.arg(organization_id)
  AND (sqlc.narg(status)::text IS NULL OR r.status = sqlc.narg(status)
       OR (sqlc.narg(status)::text = 'scheduled' AND r.status = 'sending'))
  AND (sqlc.narg(follow_up)::text IS NULL OR r.follow_up_status = sqlc.narg(follow_up))
  AND (sqlc.narg(rating)::text IS NULL
       OR (sqlc.narg(rating)::text = 'high' AND r.is_high IS TRUE)
       OR (sqlc.narg(rating)::text = 'low' AND r.is_high IS FALSE))
  AND (sqlc.narg(score)::smallint IS NULL OR r.score = sqlc.narg(score))
  AND (sqlc.narg(channel)::text IS NULL OR r.channel = sqlc.narg(channel))
  AND (sqlc.narg(customer_id)::bigint IS NULL OR r.customer_id = sqlc.narg(customer_id))
  AND (sqlc.narg(since)::timestamptz IS NULL OR r.created_at >= sqlc.narg(since))
  AND (sqlc.arg(include_tests)::boolean OR r.kind = 'job')
  AND (
    sqlc.narg(q)::text IS NULL
    OR r.customer_name ILIKE '%' || sqlc.narg(q) || '%'
    OR r.recipient_phone ILIKE '%' || sqlc.narg(q) || '%'
    OR r.plate ILIKE '%' || sqlc.narg(q) || '%'
    OR r.comment ILIKE '%' || sqlc.narg(q) || '%'
  );

-- name: GetReviewRequestByUUID :one
SELECT r.*,
       j.uuid AS job_uuid,
       c.uuid AS customer_uuid,
       COALESCE(NULLIF(TRIM(u.name || ' ' || u.surname), ''), '')::text AS followed_up_by_name
FROM review_requests r
LEFT JOIN service_jobs j ON j.id = r.job_id AND j.organization_id = r.organization_id
LEFT JOIN customers c ON c.id = r.customer_id AND c.organization_id = r.organization_id
LEFT JOIN users u ON u.id = r.followed_up_by
WHERE r.organization_id = sqlc.arg(organization_id) AND r.uuid = sqlc.arg(uuid);

-- name: MarkReviewFollowedUp :one
UPDATE review_requests
SET follow_up_status = 'done', follow_up_note = sqlc.arg(note), followed_up_at = NOW(),
    followed_up_by = sqlc.narg(user_id)
WHERE organization_id = sqlc.arg(organization_id) AND uuid = sqlc.arg(uuid)
  AND status = 'answered'
RETURNING id, uuid;

-- name: ReviewSummaryTotals :one
SELECT
    COUNT(*) FILTER (WHERE status IN ('sent', 'opened', 'answered', 'expired'))::bigint AS sent_count,
    COUNT(*) FILTER (WHERE status IN ('opened', 'answered') OR opened_at IS NOT NULL)::bigint AS opened_count,
    COUNT(*) FILTER (WHERE status = 'answered')::bigint AS answered_count,
    COUNT(*) FILTER (WHERE status IN ('scheduled', 'sending'))::bigint AS scheduled_count,
    COALESCE(AVG(score) FILTER (WHERE status = 'answered'), 0)::float8 AS average_score,
    COALESCE(SUM(google_redirects), 0)::bigint AS google_redirects,
    COUNT(*) FILTER (WHERE follow_up_status = 'required')::bigint AS follow_up_required
FROM review_requests
WHERE organization_id = sqlc.arg(organization_id) AND kind = 'job'
  AND created_at >= sqlc.arg(since)::timestamptz;

-- name: ReviewScoreDistribution :many
SELECT score::smallint AS score, COUNT(*)::bigint AS count
FROM review_requests
WHERE organization_id = sqlc.arg(organization_id) AND kind = 'job' AND status = 'answered'
  AND score IS NOT NULL AND created_at >= sqlc.arg(since)::timestamptz
GROUP BY score
ORDER BY score;

-- name: ReviewTrend :many
-- Weekly (or monthly) buckets in Europe/Istanbul.
SELECT date_trunc(sqlc.arg(bucket)::text, created_at AT TIME ZONE 'Europe/Istanbul')::date AS bucket_start,
       COUNT(*) FILTER (WHERE status IN ('sent', 'opened', 'answered', 'expired'))::bigint AS sent_count,
       COUNT(*) FILTER (WHERE status = 'answered')::bigint AS answered_count,
       COALESCE(AVG(score) FILTER (WHERE status = 'answered'), 0)::float8 AS average_score
FROM review_requests
WHERE organization_id = sqlc.arg(organization_id) AND kind = 'job'
  AND created_at >= sqlc.arg(since)::timestamptz
GROUP BY 1
ORDER BY 1;

-- name: ListReviewNotifyRecipients :many
-- Members of the organization whose roles grant tenant.reviews.read.
SELECT DISTINCT m.user_id
FROM organization_members m
JOIN users u ON u.id = m.user_id AND u.deleted_at IS NULL
WHERE m.organization_id = sqlc.arg(organization_id)
  AND EXISTS (
    SELECT 1 FROM user_roles ur
    JOIN role_permissions rp ON rp.role_id = ur.role_id
    JOIN permissions p ON p.id = rp.permission_id
    WHERE ur.user_id = m.user_id AND p.slug = 'tenant.reviews.read'
  )
ORDER BY m.user_id;

-- name: ListReviewCustomersByIDs :many
SELECT id, uuid, name, phone FROM customers
WHERE organization_id = sqlc.arg(organization_id) AND id = ANY(sqlc.arg(ids)::bigint[]) AND deleted_at IS NULL
ORDER BY name;

-- name: ListReviewCustomersByUUIDs :many
SELECT id, uuid, name, phone FROM customers
WHERE organization_id = sqlc.arg(organization_id) AND uuid = ANY(sqlc.arg(uuids)::uuid[]) AND deleted_at IS NULL;

-- name: GetReviewCustomerID :one
SELECT id FROM customers
WHERE organization_id = sqlc.arg(organization_id) AND uuid = sqlc.arg(uuid) AND deleted_at IS NULL;

-- name: GetReviewOrganization :one
SELECT id, uuid, slug, name, phone, logo_object_key, primary_color
FROM organizations WHERE id = sqlc.arg(id);

-- name: GetReviewMemberPhone :one
-- The member's notification phone in the organization (test sends).
SELECT COALESCE(ms.phone, '')::text AS phone
FROM organization_members om
LEFT JOIN notification_member_settings ms
       ON ms.user_id = om.user_id AND ms.organization_id = om.organization_id
WHERE om.organization_id = sqlc.arg(organization_id) AND om.user_id = sqlc.arg(user_id);
