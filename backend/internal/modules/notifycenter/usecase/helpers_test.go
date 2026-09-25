package usecase_test

import (
	"context"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/authctx"
)

func withUser(ctx context.Context, id int64) context.Context {
	return authctx.WithPrincipal(ctx, authctx.Principal{UserInternal: id})
}
