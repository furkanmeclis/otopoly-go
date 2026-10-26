package livepush

import (
	"log/slog"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/config"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database/db"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/livepush/usecase"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/apns"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/queue"
)

// NewService builds the livepush use case from config. A malformed APNs key
// is logged and turns iOS Live Activity pushes off instead of failing start-up.
// enq may be nil (work runs inline).
func NewService(cfg config.Config, q *db.Queries, enq queue.LiveEnqueuer, log *slog.Logger) *usecase.Service {
	if log == nil {
		log = slog.Default()
	}
	var push usecase.APNs
	client, err := apns.New(apns.Config{
		KeyID:       cfg.APNs.KeyID,
		TeamID:      cfg.APNs.TeamID,
		PrivateKey:  cfg.APNs.PrivateKey,
		BundleID:    cfg.APNs.BundleID,
		Environment: cfg.APNs.Environment,
	})
	switch {
	case err != nil:
		log.Error("livepush_apns_key_invalid", "error", err)
	case client.Configured():
		push = client
	default:
		log.Info("livepush_apns_disabled", "hint", "APNS_KEY_ID / APNS_TEAM_ID / APNS_PRIVATE_KEY not set; iOS Live Activities update only while the app runs")
	}
	return usecase.New(q, push, usecase.NewExpoHTTP(cfg.Expo.AccessToken), enq, log)
}
