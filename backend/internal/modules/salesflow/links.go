package salesflow

import (
	"context"
	"errors"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database/db"
	todosusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/todos/usecase"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/authctx"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/rbac"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// Links is the todos LinkResolver for leads and quotes. Every lookup is
// scoped by organization; soft-deleted leads are treated as missing. A
// signed-in caller without leads/quotes read permission can neither link nor
// see the linked record's label.
type Links struct {
	store Store
}

// NewLinks builds the resolver.
func NewLinks(store Store) *Links { return &Links{store: store} }

var _ todosusecase.LinkResolver = (*Links)(nil)

func isNoRows(err error) bool { return errors.Is(err, pgx.ErrNoRows) }

// allowed: background callers (no principal) are trusted; users need the
// read permission of the linked resource.
func allowed(ctx context.Context, perm string) bool {
	p, ok := authctx.PrincipalFrom(ctx)
	if !ok {
		return true
	}
	return p.HasPermission(perm)
}

// ResolveLead implements todosusecase.LinkResolver.
func (l *Links) ResolveLead(ctx context.Context, orgID int64, id uuid.UUID) (int64, error) {
	if orgID <= 0 || !allowed(ctx, rbac.PermTenantLeadsRead) {
		return 0, todosusecase.ErrLinkNotFound
	}
	v, err := l.store.ResolveTodoLeadLink(ctx, db.ResolveTodoLeadLinkParams{OrganizationID: orgID, Uuid: id})
	if isNoRows(err) {
		return 0, todosusecase.ErrLinkNotFound
	}
	return v, err
}

// ResolveQuote implements todosusecase.LinkResolver.
func (l *Links) ResolveQuote(ctx context.Context, orgID int64, id uuid.UUID) (int64, error) {
	if orgID <= 0 || !allowed(ctx, rbac.PermTenantQuotesRead) {
		return 0, todosusecase.ErrLinkNotFound
	}
	v, err := l.store.ResolveTodoQuoteLink(ctx, db.ResolveTodoQuoteLinkParams{OrganizationID: orgID, Uuid: id})
	if isNoRows(err) {
		return 0, todosusecase.ErrLinkNotFound
	}
	return v, err
}

// DescribeLeads implements todosusecase.LinkResolver (one query per page).
func (l *Links) DescribeLeads(ctx context.Context, orgID int64, ids []int64) (map[int64]todosusecase.Ref, error) {
	out := map[int64]todosusecase.Ref{}
	if len(ids) == 0 || orgID <= 0 || !allowed(ctx, rbac.PermTenantLeadsRead) {
		return out, nil
	}
	rows, err := l.store.DescribeTodoLeadLinks(ctx, db.DescribeTodoLeadLinksParams{OrganizationID: orgID, Ids: ids})
	if err != nil {
		return out, err
	}
	for _, r := range rows {
		out[r.ID] = todosusecase.Ref{UUID: r.Uuid, Label: r.Label}
	}
	return out, nil
}

// DescribeQuotes implements todosusecase.LinkResolver (one query per page).
func (l *Links) DescribeQuotes(ctx context.Context, orgID int64, ids []int64) (map[int64]todosusecase.Ref, error) {
	out := map[int64]todosusecase.Ref{}
	if len(ids) == 0 || orgID <= 0 || !allowed(ctx, rbac.PermTenantQuotesRead) {
		return out, nil
	}
	rows, err := l.store.DescribeTodoQuoteLinks(ctx, db.DescribeTodoQuoteLinksParams{OrganizationID: orgID, Ids: ids})
	if err != nil {
		return out, err
	}
	for _, r := range rows {
		out[r.ID] = todosusecase.Ref{UUID: r.Uuid, Label: r.Label}
	}
	return out, nil
}
