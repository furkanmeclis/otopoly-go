package usecase

import (
	"context"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/orgctx"
	"github.com/google/uuid"
)

const (
	searchSpecFinanceAccounts     = "tenant_finance_accounts"
	searchSpecFinanceCategories   = "tenant_finance_categories"
	searchSpecFinanceTransactions = "tenant_finance_transactions"
)

// SearchIndexer schedules command-palette search index updates (optional).
type SearchIndexer interface {
	EnqueueUpsert(ctx context.Context, spec, id string)
	EnqueueDelete(ctx context.Context, spec, id string)
}

func (s *Service) SetSearchIndexer(indexer SearchIndexer) {
	if s == nil {
		return
	}
	s.searchIndexer = indexer
}

func tenantSearchDocID(orgUUID, entityUUID uuid.UUID) string {
	return orgUUID.String() + "_" + entityUUID.String()
}

func (s *Service) indexAccount(ctx context.Context, accountUUID uuid.UUID) {
	if s == nil || s.searchIndexer == nil {
		return
	}
	scope := orgctx.MustScope(ctx)
	s.searchIndexer.EnqueueUpsert(ctx, searchSpecFinanceAccounts, tenantSearchDocID(scope.UUID, accountUUID))
}

func (s *Service) deleteAccountIndex(ctx context.Context, accountUUID uuid.UUID) {
	if s == nil || s.searchIndexer == nil {
		return
	}
	scope := orgctx.MustScope(ctx)
	s.searchIndexer.EnqueueDelete(ctx, searchSpecFinanceAccounts, tenantSearchDocID(scope.UUID, accountUUID))
}

func (s *Service) indexCategory(ctx context.Context, categoryUUID uuid.UUID) {
	if s == nil || s.searchIndexer == nil {
		return
	}
	scope := orgctx.MustScope(ctx)
	s.searchIndexer.EnqueueUpsert(ctx, searchSpecFinanceCategories, tenantSearchDocID(scope.UUID, categoryUUID))
}

func (s *Service) deleteCategoryIndex(ctx context.Context, categoryUUID uuid.UUID) {
	if s == nil || s.searchIndexer == nil {
		return
	}
	scope := orgctx.MustScope(ctx)
	s.searchIndexer.EnqueueDelete(ctx, searchSpecFinanceCategories, tenantSearchDocID(scope.UUID, categoryUUID))
}

func (s *Service) indexTransaction(ctx context.Context, transactionUUID uuid.UUID) {
	if s == nil || s.searchIndexer == nil {
		return
	}
	scope := orgctx.MustScope(ctx)
	s.searchIndexer.EnqueueUpsert(ctx, searchSpecFinanceTransactions, tenantSearchDocID(scope.UUID, transactionUUID))
}

func (s *Service) indexAccounts(ctx context.Context, accountUUIDs ...uuid.UUID) {
	for _, id := range accountUUIDs {
		if id != uuid.Nil {
			s.indexAccount(ctx, id)
		}
	}
}
