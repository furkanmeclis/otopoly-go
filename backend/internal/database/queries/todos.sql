-- name: CreateTodo :one
INSERT INTO todos (
    organization_id, title, notes, due_date, due_time, assignee_user_id,
    customer_id, service_job_id, created_by, via_ai
) VALUES (
    sqlc.arg(organization_id), sqlc.arg(title), sqlc.arg(notes), sqlc.narg(due_date), sqlc.narg(due_time),
    sqlc.narg(assignee_user_id), sqlc.narg(customer_id), sqlc.narg(service_job_id), sqlc.narg(created_by),
    sqlc.arg(via_ai)
)
RETURNING *;

-- name: GetTodoByUUID :one
SELECT t.*,
       au.uuid AS assignee_uuid,
       COALESCE(btrim(au.name || ' ' || au.surname), '')::text AS assignee_name,
       c.uuid AS customer_uuid,
       COALESCE(c.name, '')::text AS customer_name,
       j.uuid AS job_uuid,
       COALESCE(j.plate, '')::text AS job_plate,
       COALESCE(btrim(cu.name || ' ' || cu.surname), '')::text AS created_by_name
FROM todos t
LEFT JOIN users au ON au.id = t.assignee_user_id
LEFT JOIN customers c ON c.id = t.customer_id
LEFT JOIN service_jobs j ON j.id = t.service_job_id
LEFT JOIN users cu ON cu.id = t.created_by
WHERE t.uuid = sqlc.arg(uuid) AND t.organization_id = sqlc.arg(organization_id);

-- name: ListTodos :many
-- scope: overdue | today | upcoming | no_date | open_due (overdue + today); today is the local date.
SELECT t.*,
       au.uuid AS assignee_uuid,
       COALESCE(btrim(au.name || ' ' || au.surname), '')::text AS assignee_name,
       c.uuid AS customer_uuid,
       COALESCE(c.name, '')::text AS customer_name,
       j.uuid AS job_uuid,
       COALESCE(j.plate, '')::text AS job_plate,
       COALESCE(btrim(cu.name || ' ' || cu.surname), '')::text AS created_by_name
FROM todos t
LEFT JOIN users au ON au.id = t.assignee_user_id
LEFT JOIN customers c ON c.id = t.customer_id
LEFT JOIN service_jobs j ON j.id = t.service_job_id
LEFT JOIN users cu ON cu.id = t.created_by
WHERE t.organization_id = sqlc.arg(organization_id)
  AND (sqlc.narg(status)::text IS NULL OR t.status = sqlc.narg(status))
  AND (sqlc.narg(assignee_user_id)::bigint IS NULL OR t.assignee_user_id = sqlc.narg(assignee_user_id))
  AND (sqlc.narg(q)::text IS NULL OR t.title ILIKE '%' || sqlc.narg(q) || '%' OR t.notes ILIKE '%' || sqlc.narg(q) || '%')
  AND (
    sqlc.narg(scope)::text IS NULL
    OR (sqlc.narg(scope) = 'overdue' AND t.due_date < sqlc.arg(today)::date)
    OR (sqlc.narg(scope) = 'today' AND t.due_date = sqlc.arg(today)::date)
    OR (sqlc.narg(scope) = 'open_due' AND t.due_date <= sqlc.arg(today)::date)
    OR (sqlc.narg(scope) = 'upcoming' AND t.due_date > sqlc.arg(today)::date)
    OR (sqlc.narg(scope) = 'no_date' AND t.due_date IS NULL)
  )
ORDER BY (t.status = 'done') ASC,
         CASE WHEN t.status = 'done' THEN t.completed_at END DESC NULLS LAST,
         t.due_date ASC NULLS LAST, t.due_time ASC NULLS LAST, t.id DESC
LIMIT sqlc.arg(limit_count) OFFSET sqlc.arg(offset_count);

-- name: CountTodos :one
SELECT COUNT(*)::bigint
FROM todos t
WHERE t.organization_id = sqlc.arg(organization_id)
  AND (sqlc.narg(status)::text IS NULL OR t.status = sqlc.narg(status))
  AND (sqlc.narg(assignee_user_id)::bigint IS NULL OR t.assignee_user_id = sqlc.narg(assignee_user_id))
  AND (sqlc.narg(q)::text IS NULL OR t.title ILIKE '%' || sqlc.narg(q) || '%' OR t.notes ILIKE '%' || sqlc.narg(q) || '%')
  AND (
    sqlc.narg(scope)::text IS NULL
    OR (sqlc.narg(scope) = 'overdue' AND t.due_date < sqlc.arg(today)::date)
    OR (sqlc.narg(scope) = 'today' AND t.due_date = sqlc.arg(today)::date)
    OR (sqlc.narg(scope) = 'open_due' AND t.due_date <= sqlc.arg(today)::date)
    OR (sqlc.narg(scope) = 'upcoming' AND t.due_date > sqlc.arg(today)::date)
    OR (sqlc.narg(scope) = 'no_date' AND t.due_date IS NULL)
  );

-- name: TodoSummary :one
SELECT
    COUNT(*) FILTER (WHERE status = 'open')::bigint AS open_count,
    COUNT(*) FILTER (WHERE status = 'open' AND due_date < sqlc.arg(today)::date)::bigint AS overdue_count,
    COUNT(*) FILTER (WHERE status = 'open' AND due_date = sqlc.arg(today)::date)::bigint AS today_count,
    COUNT(*) FILTER (WHERE status = 'open' AND assignee_user_id = sqlc.narg(user_id)::bigint)::bigint AS mine_count
FROM todos
WHERE organization_id = sqlc.arg(organization_id);

-- name: UpdateTodo :one
UPDATE todos
SET title = COALESCE(sqlc.narg(title), title),
    notes = COALESCE(sqlc.narg(notes), notes),
    due_date = CASE WHEN sqlc.arg(clear_due)::boolean THEN NULL ELSE COALESCE(sqlc.narg(due_date), due_date) END,
    due_time = CASE WHEN sqlc.arg(clear_due)::boolean OR sqlc.arg(clear_due_time)::boolean THEN NULL
                    ELSE COALESCE(sqlc.narg(due_time), due_time) END,
    assignee_user_id = CASE WHEN sqlc.arg(clear_assignee)::boolean THEN NULL
                            ELSE COALESCE(sqlc.narg(assignee_user_id), assignee_user_id) END,
    customer_id = CASE WHEN sqlc.arg(clear_customer)::boolean THEN NULL
                       ELSE COALESCE(sqlc.narg(customer_id), customer_id) END,
    service_job_id = CASE WHEN sqlc.arg(clear_job)::boolean THEN NULL
                          ELSE COALESCE(sqlc.narg(service_job_id), service_job_id) END
WHERE id = sqlc.arg(id) AND organization_id = sqlc.arg(organization_id)
RETURNING *;

-- name: SetTodoStatus :one
UPDATE todos
SET status = sqlc.arg(status)::text,
    completed_at = CASE WHEN sqlc.arg(status)::text = 'done' THEN now() ELSE NULL END,
    completed_by = CASE WHEN sqlc.arg(status)::text = 'done' THEN sqlc.narg(completed_by)::bigint ELSE NULL END
WHERE id = sqlc.arg(id) AND organization_id = sqlc.arg(organization_id)
RETURNING *;

-- name: DeleteTodo :exec
DELETE FROM todos WHERE id = sqlc.arg(id) AND organization_id = sqlc.arg(organization_id);

-- name: GetTodoAssigneeByUUID :one
SELECT u.id, u.uuid, u.name, u.surname
FROM organization_members om
JOIN users u ON u.id = om.user_id AND u.deleted_at IS NULL
WHERE om.organization_id = sqlc.arg(organization_id) AND u.uuid = sqlc.arg(uuid);

-- name: ListTodoAssignees :many
SELECT u.id, u.uuid, u.name, u.surname, om.role
FROM organization_members om
JOIN users u ON u.id = om.user_id AND u.deleted_at IS NULL
WHERE om.organization_id = sqlc.arg(organization_id) AND u.status = 'active'
ORDER BY u.name ASC, u.surname ASC;

-- name: GetTodoCustomerRef :one
SELECT id, uuid, name FROM customers
WHERE organization_id = sqlc.arg(organization_id) AND uuid = sqlc.arg(uuid) AND deleted_at IS NULL;

-- name: GetTodoJobRef :one
SELECT id, uuid, plate FROM service_jobs
WHERE organization_id = sqlc.arg(organization_id) AND uuid = sqlc.arg(uuid);
