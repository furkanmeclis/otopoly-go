package activity

import (
	"context"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/orgctx"
	"github.com/jackc/pgx/v5/pgtype"
)

type orgCtxKey struct{}

// WithOrganization attributes events recorded with ctx to an organization.
// Tenant requests are attributed automatically from their orgctx scope; use
// this for platform actions that target an organization.
func WithOrganization(ctx context.Context, orgID int64) context.Context {
	return context.WithValue(ctx, orgCtxKey{}, orgID)
}

// organizationOf resolves the organization an event belongs to: an explicit
// WithOrganization value wins over the tenant scope.
func organizationOf(ctx context.Context) pgtype.Int8 {
	if id, ok := ctx.Value(orgCtxKey{}).(int64); ok && id > 0 {
		return pgtype.Int8{Int64: id, Valid: true}
	}
	if scope, ok := orgctx.ScopeFrom(ctx); ok && scope.InternalID > 0 {
		return pgtype.Int8{Int64: scope.InternalID, Valid: true}
	}
	return pgtype.Int8{}
}
