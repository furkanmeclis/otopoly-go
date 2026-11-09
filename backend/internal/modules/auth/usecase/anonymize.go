package usecase

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"time"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/auth/model"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/auth/repository"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/activity"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/bizclock"
	searchadapters "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/searchengine/adapters"
	"github.com/google/uuid"
)

const (
	// AnonymizedName / AnonymizedSurname replace the user's name on the
	// scrubbed row, so business records show a neutral author.
	AnonymizedName    = "Silinmiş"
	AnonymizedSurname = "Kullanıcı"
	// anonymizedEmailDomain is a reserved, undeliverable domain (RFC 2606).
	anonymizedEmailDomain = "anonymized.invalid"
	// anonymizedPasswordHash is not a valid hash: password checks always fail.
	anonymizedPasswordHash = "!anonymized"
	anonymizeBatchSize     = 100
	anonymizeMaxBatches    = 20
)

// AnonymizationRepo is the persistence port of the anonymization job.
type AnonymizationRepo interface {
	ListUsersDueForAnonymization(ctx context.Context, today string, limit int32) ([]int64, error)
	AnonymizeUser(ctx context.Context, userID int64, id model.AnonymizedIdentity) (before, after model.User, err error)
	ListOwnedOrganizations(ctx context.Context, userID int64) ([]model.OwnedOrganization, error)
}

// ActivityRecorder writes audit events (implemented by activity.Recorder).
type ActivityRecorder interface {
	Record(ctx context.Context, actorID *int64, action, resource string, resourceUUID *uuid.UUID, payload map[string]any, r *http.Request)
}

// AccountAnonymizer scrubs accounts whose deletion grace period ended. It
// runs in the queue worker (task app:account:anonymize).
type AccountAnonymizer struct {
	repo     AnonymizationRepo
	activity ActivityRecorder
	search   SearchIndexer
	log      *slog.Logger
	now      func() time.Time
}

// NewAccountAnonymizer creates the anonymization job service.
func NewAccountAnonymizer(repo AnonymizationRepo, rec ActivityRecorder, log *slog.Logger) *AccountAnonymizer {
	if log == nil {
		log = slog.Default()
	}
	return &AccountAnonymizer{repo: repo, activity: rec, log: log, now: time.Now}
}

// SetSearchIndexer removes anonymized users from the search index.
func (a *AccountAnonymizer) SetSearchIndexer(idx SearchIndexer) { a.search = idx }

// SetClock overrides the clock (tests).
func (a *AccountAnonymizer) SetClock(now func() time.Time) { a.now = now }

// AnonymizeDue scrubs every pending deletion whose day (Europe/Istanbul) has
// come and returns how many accounts were anonymized. One failing account is
// logged and skipped; the next run retries it.
func (a *AccountAnonymizer) AnonymizeDue(ctx context.Context) (int, error) {
	today := bizclock.FormatDay(a.now())
	done := 0
	var firstErr error
	failed := map[int64]bool{}
	for batch := 0; batch < anonymizeMaxBatches; batch++ {
		ids, err := a.repo.ListUsersDueForAnonymization(ctx, today, anonymizeBatchSize)
		if err != nil {
			return done, err
		}
		progressed := false
		for _, id := range ids {
			if failed[id] {
				continue
			}
			if err := a.anonymizeOne(ctx, id); err != nil {
				failed[id] = true
				if !errors.Is(err, repository.ErrNotFound) {
					a.log.Error("account_anonymize_failed", "user_id", id, "error", err)
					if firstErr == nil {
						firstErr = err
					}
				}
				continue
			}
			done++
			progressed = true
		}
		if len(ids) < anonymizeBatchSize || !progressed {
			break
		}
	}
	return done, firstErr
}

func (a *AccountAnonymizer) anonymizeOne(ctx context.Context, userID int64) error {
	owned, err := a.repo.ListOwnedOrganizations(ctx, userID)
	if err != nil {
		return err
	}
	identity := model.AnonymizedIdentity{
		Email:        "deleted-" + uuid.NewString() + "@" + anonymizedEmailDomain,
		PasswordHash: anonymizedPasswordHash,
		Name:         AnonymizedName,
		Surname:      AnonymizedSurname,
	}
	before, after, err := a.repo.AnonymizeUser(ctx, userID, identity)
	if err != nil {
		return err
	}
	if a.search != nil {
		a.search.EnqueueDelete(ctx, searchadapters.SpecUsers, after.UUID.String())
	}
	if a.activity != nil {
		uid := after.UUID
		// System action: no actor, the user's own (now scrubbed) id is the resource.
		a.activity.Record(ctx, nil, "auth.account_anonymized", "auth.account", &uid, map[string]any{
			"deletion_scheduled_on": before.DeletionScheduledOn,
			"owned_organizations":   len(owned),
		}, nil)
		for _, org := range owned {
			orgUUID := org.UUID
			octx := activity.WithOrganization(ctx, org.ID)
			a.activity.Record(octx, nil, "organizations.owner_anonymized", "organizations", &orgUUID, map[string]any{
				"user_uuid":     uid.String(),
				"other_members": org.OtherMembers,
				"other_owners":  org.OtherOwners,
				"sole_owner":    org.OtherOwners == 0,
			}, nil)
		}
	}
	a.log.Info("account_anonymized", "user_id", userID, "owned_organizations", len(owned))
	return nil
}
