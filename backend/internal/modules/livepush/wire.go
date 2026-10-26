package livepush

import (
	"log/slog"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/config"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database/db"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/livepush/usecase"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/apns"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/queue"
)

// NewAPNs builds the runtime APNs credentials resolver: the key uploaded in
// the platform admin (src, the DB) first, the APNS_* env vars as fallback.
// Credentials are re-read at most every apns.DefaultResolverTTL, so the
// worker picks up a new key without a restart. src may be nil (env only).
// A malformed key is logged and leaves iOS Live Activity pushes off.
func NewAPNs(cfg config.Config, src apns.KeySource, log *slog.Logger) *apns.Resolver {
	return apns.NewResolver(src, apns.Config{
		KeyID:       cfg.APNs.KeyID,
		TeamID:      cfg.APNs.TeamID,
		PrivateKey:  cfg.APNs.PrivateKey,
		BundleID:    cfg.APNs.BundleID,
		Environment: cfg.APNs.Environment,
	}, nil, log)
}

// NewService builds the livepush use case. push may be nil (iOS Live
// Activity pushes off); enq may be nil (work runs inline).
func NewService(q *db.Queries, push usecase.APNs, enq queue.LiveEnqueuer, expoAccessToken string, log *slog.Logger) *usecase.Service {
	if log == nil {
		log = slog.Default()
	}
	return usecase.New(q, push, usecase.NewExpoHTTP(expoAccessToken), enq, log)
}
