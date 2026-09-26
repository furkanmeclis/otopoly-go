-- name: GetVehicleAlertSettings :one
SELECT * FROM vehicle_alert_settings
WHERE organization_id = $1;

-- name: UpsertVehicleAlertSettings :one
INSERT INTO vehicle_alert_settings (organization_id, enabled, events, service_ids, recipient_user_ids, batch_minutes)
VALUES (
    sqlc.arg(organization_id), sqlc.arg(enabled), sqlc.arg(events)::text[],
    sqlc.arg(service_ids)::bigint[], sqlc.arg(recipient_user_ids)::bigint[], sqlc.arg(batch_minutes)
)
ON CONFLICT (organization_id) DO UPDATE
SET enabled = EXCLUDED.enabled,
    events = EXCLUDED.events,
    service_ids = EXCLUDED.service_ids,
    recipient_user_ids = EXCLUDED.recipient_user_ids,
    batch_minutes = EXCLUDED.batch_minutes
RETURNING *;

-- name: ListVehicleAlertMembers :many
-- Active members with notification phone and whether web push reaches them.
SELECT u.id AS user_id,
       u.uuid AS user_uuid,
       u.name,
       u.surname,
       u.email,
       om.role,
       COALESCE(ms.phone, '')::text AS phone,
       (
           COALESCE(np.push_enabled, FALSE)
           AND EXISTS (SELECT 1 FROM push_subscriptions ps WHERE ps.user_id = u.id)
       )::boolean AS has_push
FROM organization_members om
JOIN users u ON u.id = om.user_id
LEFT JOIN notification_member_settings ms
       ON ms.user_id = om.user_id AND ms.organization_id = om.organization_id
LEFT JOIN notification_preferences np ON np.user_id = u.id
WHERE om.organization_id = $1
  AND u.status = 'active'
ORDER BY (om.role = 'owner') DESC, u.name, u.surname;

-- name: ListVehicleAlertServices :many
SELECT id, uuid, name
FROM services
WHERE organization_id = $1
  AND deleted_at IS NULL
  AND is_active
ORDER BY name
LIMIT 200;

-- name: GetVehicleAlertJob :one
SELECT j.id,
       j.uuid,
       j.organization_id,
       j.plate,
       j.vehicle_label,
       j.customer_name,
       j.total_amount,
       j.payment_status,
       o.slug AS organization_slug,
       COALESCE(
           ARRAY_AGG(l.service_id ORDER BY l.sort_order) FILTER (WHERE l.service_id IS NOT NULL),
           '{}'
       )::bigint[] AS service_ids,
       COALESCE(
           ARRAY_AGG(l.name ORDER BY l.sort_order) FILTER (WHERE l.line_type = 'service'),
           '{}'
       )::text[] AS service_names
FROM service_jobs j
JOIN organizations o ON o.id = j.organization_id
LEFT JOIN service_job_lines l ON l.job_id = j.id
WHERE j.uuid = $1
GROUP BY j.id, o.slug;

-- name: InsertVehicleAlertEvent :exec
INSERT INTO vehicle_alert_events (organization_id, job_id, event, line, amount)
VALUES ($1, $2, $3, $4, $5);

-- name: ListOrgsWithPendingVehicleAlerts :many
SELECT s.*
FROM vehicle_alert_settings s
WHERE s.enabled
  AND EXISTS (
      SELECT 1 FROM vehicle_alert_events e
      WHERE e.organization_id = s.organization_id AND e.sent_at IS NULL
  );

-- name: ListPendingVehicleAlertEvents :many
SELECT * FROM vehicle_alert_events
WHERE organization_id = $1
  AND sent_at IS NULL
  AND created_at >= sqlc.arg(since)
ORDER BY created_at, id
LIMIT 100;

-- name: MarkVehicleAlertEventsSent :exec
UPDATE vehicle_alert_events
SET sent_at = NOW()
WHERE organization_id = sqlc.arg(organization_id)
  AND id = ANY (sqlc.arg(ids)::bigint[]);

-- name: DropStaleVehicleAlertEvents :exec
-- Lines older than the cutoff are not worth a late WhatsApp (line was down).
UPDATE vehicle_alert_events
SET sent_at = NOW()
WHERE organization_id = sqlc.arg(organization_id)
  AND sent_at IS NULL
  AND created_at < sqlc.arg(before);

-- name: ClaimVehicleAlertFlush :execrows
-- Serialises flushes per org and enforces the batch window.
UPDATE vehicle_alert_settings
SET last_flushed_at = NOW()
WHERE organization_id = sqlc.arg(organization_id)
  AND (
      batch_minutes = 0
      OR last_flushed_at IS NULL
      OR last_flushed_at <= NOW() - make_interval(mins => batch_minutes)
  )
  AND (last_flushed_at IS NULL OR last_flushed_at < NOW() - INTERVAL '30 seconds');
