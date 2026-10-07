-- name: GetLegalPageBySlug :one
SELECT lp.*, u.uuid AS updated_by_uuid, u.name AS updated_by_name,
       u.surname AS updated_by_surname, u.email AS updated_by_email
FROM legal_pages lp
LEFT JOIN users u ON u.id = lp.updated_by
WHERE lp.slug = sqlc.arg(slug);

-- name: UpdateLegalPage :one
UPDATE legal_pages
SET title_tr = COALESCE(sqlc.narg(title_tr), title_tr),
    title_en = COALESCE(sqlc.narg(title_en), title_en),
    body_tr = COALESCE(sqlc.narg(body_tr), body_tr),
    body_en = COALESCE(sqlc.narg(body_en), body_en),
    updated_by = sqlc.narg(updated_by)
WHERE slug = sqlc.arg(slug)
RETURNING id;
