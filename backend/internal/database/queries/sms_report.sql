-- Platform SMS report (cross-organization, platform.messaging.sms.read).

-- name: SMSReportByProvider :many
SELECT COALESCE(sender_kind, '')::text AS sender_kind,
       COUNT(*) FILTER (WHERE status = 'sent')::bigint   AS sent,
       COUNT(*) FILTER (WHERE status = 'failed')::bigint AS failed,
       COALESCE(SUM(segments) FILTER (WHERE status = 'sent'), 0)::bigint AS segments
FROM outbound_messages
WHERE channel = 'sms'
  AND created_at >= sqlc.arg(date_from)
  AND created_at < sqlc.arg(date_to)
GROUP BY 1
ORDER BY 1;

-- name: SMSReportDaily :many
SELECT (created_at AT TIME ZONE 'Europe/Istanbul')::date AS day,
       COUNT(*) FILTER (WHERE status = 'sent')::bigint   AS sent,
       COUNT(*) FILTER (WHERE status = 'failed')::bigint AS failed,
       COALESCE(SUM(segments) FILTER (WHERE status = 'sent'), 0)::bigint AS segments
FROM outbound_messages
WHERE channel = 'sms'
  AND created_at >= sqlc.arg(date_from)
  AND created_at < sqlc.arg(date_to)
GROUP BY 1
ORDER BY 1;

-- name: SMSReportOrganizations :many
-- Organizations with an SMS provider account or SMS traffic in the period.
WITH stats AS (
    SELECT m.organization_id,
           COUNT(*) FILTER (WHERE m.status = 'sent')::bigint   AS sent,
           COUNT(*) FILTER (WHERE m.status = 'failed')::bigint AS failed,
           COALESCE(SUM(m.segments) FILTER (WHERE m.status = 'sent'), 0)::bigint AS segments
    FROM outbound_messages m
    WHERE m.channel = 'sms'
      AND m.created_at >= sqlc.arg(date_from)
      AND m.created_at < sqlc.arg(date_to)
    GROUP BY m.organization_id
)
SELECT o.id AS organization_id,
       o.uuid AS organization_uuid,
       o.name AS organization_name,
       o.slug AS organization_slug,
       COALESCE(a.provider, '')::text AS provider,
       COALESCE(a.is_active, FALSE)::boolean AS is_active,
       COALESCE(a.status, '')::text AS account_status,
       COALESCE(s.sent, 0)::bigint AS sent,
       COALESCE(s.failed, 0)::bigint AS failed,
       COALESCE(s.segments, 0)::bigint AS segments,
       ls.last_sent_at::timestamptz AS last_sent_at
FROM organizations o
LEFT JOIN LATERAL (
    SELECT spa.provider, spa.is_active, spa.status
    FROM sms_provider_accounts spa
    WHERE spa.organization_id = o.id
    ORDER BY spa.is_active DESC, spa.updated_at DESC
    LIMIT 1
) a ON TRUE
LEFT JOIN stats s ON s.organization_id = o.id
LEFT JOIN LATERAL (
    SELECT MAX(om.sent_at) AS last_sent_at
    FROM outbound_messages om
    WHERE om.organization_id = o.id AND om.channel = 'sms' AND om.status = 'sent'
) ls ON TRUE
WHERE o.deleted_at IS NULL
  AND (a.provider IS NOT NULL OR s.organization_id IS NOT NULL)
ORDER BY COALESCE(s.segments, 0) DESC, o.name
LIMIT 1000;

-- name: SMSReportOrgMessages :many
SELECT uuid, event_type, recipient_phone, status, sender_kind, provider_reference,
       delivery_status, error_code, segments, sent_at, created_at
FROM outbound_messages
WHERE organization_id = sqlc.arg(organization_id) AND channel = 'sms'
ORDER BY created_at DESC, id DESC
LIMIT sqlc.arg(row_limit) OFFSET sqlc.arg(row_offset);

-- name: CountSMSReportOrgMessages :one
SELECT COUNT(*)::bigint FROM outbound_messages
WHERE organization_id = $1 AND channel = 'sms';
