// Package usecase keeps job Live Activities (iOS), Live Updates (Android)
// and the Home / Lock Screen widgets fresh while the app is not running.
//
//   - Job activities: on every change of a tracked job the current state is
//     pushed to the devices tracking it — ActivityKit pushes over APNs
//     (iOS, real time) and data-only Expo messages (Android; the app's
//     background task re-posts the Live Update notification).
//   - Widgets: a debounced, throttled background push carries the
//     organization's "today" snapshot; the app's background task turns it
//     into widget props (best effort: iOS budgets background pushes).
//
// Everything is fail-soft: without APNs credentials iOS activities fall back
// to the in-app sync, and push failures never touch the job request.
package usecase

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database/db"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/apns"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/bizclock"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/orgctx"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/resourceevents"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/queue"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

// Errors returned to handlers.
var (
	ErrNotFound       = errors.New("livepush: not found")
	ErrInvalidRequest = errors.New("livepush: invalid request")
)

const (
	// ActivityLifetime bounds a token row: ActivityKit ends an activity
	// after 8 hours and keeps it on the Lock Screen for up to 4 more.
	ActivityLifetime = 12 * time.Hour
	// FinishedVisibleFor keeps a delivered / cancelled job on screen
	// (matches the Android Live Update timeout).
	FinishedVisibleFor = 15 * time.Minute
	// WidgetMinInterval is the per-organization widget push throttle.
	WidgetMinInterval = time.Minute
	// widgetQueueMax caps the queue items carried by a widget push (the
	// widget shows at most 12; the payload must stay under 4 KB).
	widgetQueueMax = 12
	// maxJobsPerEvent caps the job tasks one bulk event schedules.
	maxJobsPerEvent = 50
)

var (
	expoTokenRE  = regexp.MustCompile(`^(ExponentPushToken|ExpoPushToken)\[[^\]\s]{1,200}\]$`)
	apnsTokenRE  = regexp.MustCompile(`^[0-9a-fA-F]{16,400}$`)
	activityIDRE = regexp.MustCompile(`^[A-Za-z0-9._:\-]{1,128}$`)
)

// Store is the persistence the service needs (*db.Queries satisfies it).
type Store interface {
	UpsertLiveActivityToken(ctx context.Context, arg db.UpsertLiveActivityTokenParams) (db.LiveActivityToken, error)
	DeleteLiveActivityTokensForUser(ctx context.Context, arg db.DeleteLiveActivityTokensForUserParams) (int64, error)
	ListLiveActivityTargetsForJob(ctx context.Context, arg db.ListLiveActivityTargetsForJobParams) ([]db.ListLiveActivityTargetsForJobRow, error)
	MarkLiveActivityTokenSent(ctx context.Context, arg db.MarkLiveActivityTokenSentParams) error
	DeleteLiveActivityToken(ctx context.Context, arg db.DeleteLiveActivityTokenParams) error
	DeleteExpiredLiveActivityTokens(ctx context.Context) (int64, error)
	GetActivePushDeviceForUser(ctx context.Context, arg db.GetActivePushDeviceForUserParams) (db.PushDevice, error)
	UpsertLiveActivityDevice(ctx context.Context, arg db.UpsertLiveActivityDeviceParams) (db.LiveActivityDevice, error)
	DeleteLiveActivityDeviceForUser(ctx context.Context, arg db.DeleteLiveActivityDeviceForUserParams) (int64, error)
	ListWidgetRefreshTargets(ctx context.Context, organizationID int64) ([]db.ListWidgetRefreshTargetsRow, error)
	LastWidgetPushAt(ctx context.Context, organizationID int64) (pgtype.Timestamptz, error)
	MarkWidgetPushSent(ctx context.Context, organizationID int64) error
	DisablePushDevice(ctx context.Context, arg db.DisablePushDeviceParams) error
	GetOrganizationByID(ctx context.Context, id int64) (db.Organization, error)
	GetServiceJobByUUID(ctx context.Context, arg db.GetServiceJobByUUIDParams) (db.GetServiceJobByUUIDRow, error)
	ListServiceJobServiceTags(ctx context.Context, arg db.ListServiceJobServiceTagsParams) ([]db.ListServiceJobServiceTagsRow, error)
	ListServiceJobs(ctx context.Context, arg db.ListServiceJobsParams) ([]db.ListServiceJobsRow, error)
	SumServiceJobsDaily(ctx context.Context, arg db.SumServiceJobsDailyParams) (db.SumServiceJobsDailyRow, error)
}

// APNs sends ActivityKit pushes (*apns.Resolver satisfies it: credentials
// are resolved at send time, DB first, env fallback).
type APNs interface {
	Configured(ctx context.Context) bool
	SendLiveActivity(ctx context.Context, p apns.LiveActivity) (apns.Result, error)
}

// Service is the livepush use case.
type Service struct {
	q     Store
	apns  APNs
	expo  ExpoSender
	queue queue.LiveEnqueuer
	log   *slog.Logger
	now   func() time.Time
	loc   *time.Location

	inline sync.WaitGroup
}

// New builds the service. apnsClient may be nil or unconfigured (iOS Live
// Activity pushes off); enq may be nil (work runs inline, no debounce).
func New(q Store, apnsClient APNs, expo ExpoSender, enq queue.LiveEnqueuer, log *slog.Logger) *Service {
	if log == nil {
		log = slog.Default()
	}
	return &Service{q: q, apns: apnsClient, expo: expo, queue: enq, log: log, now: time.Now, loc: bizclock.Location()}
}

// SetClock overrides time (tests).
func (s *Service) SetClock(now func() time.Time) { s.now = now }

// SetLocation sets the business time zone used for "today" (tests).
func (s *Service) SetLocation(loc *time.Location) { s.loc = loc }

// Wait blocks until inline (queue-less) work finishes (tests).
func (s *Service) Wait() { s.inline.Wait() }

// APNsConfigured reports whether iOS Live Activities get remote updates.
func (s *Service) APNsConfigured(ctx context.Context) bool {
	return s.apns != nil && s.apns.Configured(ctx)
}

func (s *Service) scope(ctx context.Context) (int64, error) {
	sc, ok := orgctx.ScopeFrom(ctx)
	if !ok || sc.InternalID <= 0 {
		return 0, fmt.Errorf("%w: organization required", ErrInvalidRequest)
	}
	return sc.InternalID, nil
}

// ─── Registration ──────────────────────────────────────────────────────────

// ActivityInput registers one running activity of the caller.
type ActivityInput struct {
	Platform    string `json:"platform"`
	ActivityID  string `json:"activity_id"`
	PushToken   string `json:"push_token"`
	DeviceToken string `json:"device_token"`
	Locale      string `json:"locale"`
}

// ValidateActivity returns field errors (field → code).
func ValidateActivity(in ActivityInput) map[string]string {
	errs := map[string]string{}
	if !activityIDRE.MatchString(strings.TrimSpace(in.ActivityID)) {
		errs["activity_id"] = "invalid"
	}
	dev := strings.TrimSpace(in.DeviceToken)
	if dev != "" && !expoTokenRE.MatchString(dev) {
		errs["device_token"] = "invalid"
	}
	switch strings.ToLower(strings.TrimSpace(in.Platform)) {
	case "ios":
		if !apnsTokenRE.MatchString(strings.TrimSpace(in.PushToken)) {
			errs["push_token"] = "invalid"
		}
	case "android":
		if dev == "" {
			errs["device_token"] = "required"
		}
	default:
		errs["platform"] = "invalid"
	}
	return errs
}

// Activity is the API view of a registered activity.
type Activity struct {
	UUID       uuid.UUID `json:"uuid"`
	JobUUID    uuid.UUID `json:"job_uuid"`
	Platform   string    `json:"platform"`
	ActivityID string    `json:"activity_id"`
	ExpiresAt  time.Time `json:"expires_at"`
	// RemoteUpdates is false when the server cannot reach this activity
	// (iOS without APNs credentials): the app keeps updating it itself.
	RemoteUpdates bool `json:"remote_updates"`
}

// RegisterActivity stores (or refreshes) the caller's activity for a job of
// the current organization. Another organization's job answers ErrNotFound;
// an Android device token must be the caller's active push device.
func (s *Service) RegisterActivity(ctx context.Context, userID int64, jobUUID uuid.UUID, in ActivityInput) (Activity, error) {
	orgID, err := s.scope(ctx)
	if err != nil {
		return Activity{}, err
	}
	if len(ValidateActivity(in)) > 0 {
		return Activity{}, fmt.Errorf("%w: invalid activity", ErrInvalidRequest)
	}
	job, err := s.q.GetServiceJobByUUID(ctx, db.GetServiceJobByUUIDParams{Uuid: jobUUID, OrganizationID: orgID})
	if errors.Is(err, pgx.ErrNoRows) {
		return Activity{}, ErrNotFound
	}
	if err != nil {
		return Activity{}, err
	}
	platform := strings.ToLower(strings.TrimSpace(in.Platform))
	device := strings.TrimSpace(in.DeviceToken)
	if platform == "android" {
		if _, err := s.q.GetActivePushDeviceForUser(ctx, db.GetActivePushDeviceForUserParams{UserID: userID, Token: device}); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return Activity{}, ErrNotFound
			}
			return Activity{}, err
		}
	}
	pushToken := ""
	if platform == "ios" {
		pushToken = strings.ToLower(strings.TrimSpace(in.PushToken))
	}
	row, err := s.q.UpsertLiveActivityToken(ctx, db.UpsertLiveActivityTokenParams{
		OrganizationID: orgID,
		UserID:         userID,
		JobID:          job.ID,
		Platform:       platform,
		ActivityID:     strings.TrimSpace(in.ActivityID),
		PushToken:      pushToken,
		DeviceToken:    device,
		Locale:         NormalizeLocale(in.Locale),
		ExpiresAt:      pgtype.Timestamptz{Time: s.now().Add(ActivityLifetime), Valid: true},
	})
	if errors.Is(err, pgx.ErrNoRows) {
		// The activity id is registered in another organization.
		return Activity{}, ErrNotFound
	}
	if err != nil {
		return Activity{}, err
	}
	if row.LastStatus == "" {
		// Remember what the device shows now, so the next push knows
		// whether the status changed (alert + high priority).
		_ = s.q.MarkLiveActivityTokenSent(ctx, db.MarkLiveActivityTokenSentParams{
			ID: row.ID, OrganizationID: orgID, LastStatus: job.Status, LastHash: "",
		})
	}
	return Activity{
		UUID: row.Uuid, JobUUID: job.Uuid, Platform: row.Platform, ActivityID: row.ActivityID,
		ExpiresAt:     row.ExpiresAt.Time,
		RemoteUpdates: platform == "android" || s.APNsConfigured(ctx),
	}, nil
}

// UnregisterActivity removes the caller's activity rows for a job
// (idempotent). activityID / deviceToken narrow it when set.
func (s *Service) UnregisterActivity(ctx context.Context, userID int64, jobUUID uuid.UUID, activityID, deviceToken string) error {
	orgID, err := s.scope(ctx)
	if err != nil {
		return err
	}
	job, err := s.q.GetServiceJobByUUID(ctx, db.GetServiceJobByUUIDParams{Uuid: jobUUID, OrganizationID: orgID})
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrNotFound
	}
	if err != nil {
		return err
	}
	arg := db.DeleteLiveActivityTokensForUserParams{OrganizationID: orgID, UserID: userID, JobID: job.ID}
	if v := strings.TrimSpace(activityID); v != "" {
		arg.ActivityID = pgtype.Text{String: v, Valid: true}
	}
	if v := strings.TrimSpace(deviceToken); v != "" {
		arg.DeviceToken = pgtype.Text{String: v, Valid: true}
	}
	_, err = s.q.DeleteLiveActivityTokensForUser(ctx, arg)
	return err
}

// DeviceInput links a push device to the current organization.
type DeviceInput struct {
	DeviceToken      string `json:"device_token"`
	PushToStartToken string `json:"push_to_start_token"`
	Widgets          *bool  `json:"widgets"`
}

// Device is the API view of a linked device.
type Device struct {
	WidgetsEnabled bool `json:"widgets_enabled"`
	PushToStart    bool `json:"push_to_start"`
	// LiveActivityPush reports whether iOS Live Activities get server
	// updates (APNs configured).
	LiveActivityPush bool `json:"live_activity_push"`
}

// ValidateDevice returns field errors (field → code).
func ValidateDevice(in DeviceInput) map[string]string {
	errs := map[string]string{}
	if !expoTokenRE.MatchString(strings.TrimSpace(in.DeviceToken)) {
		errs["device_token"] = "invalid"
	}
	if v := strings.TrimSpace(in.PushToStartToken); v != "" && !apnsTokenRE.MatchString(v) {
		errs["push_to_start_token"] = "invalid"
	}
	return errs
}

// RegisterDevice makes the caller's push device show the current
// organization's widgets (and stores the iOS push-to-start token).
func (s *Service) RegisterDevice(ctx context.Context, userID int64, in DeviceInput) (Device, error) {
	orgID, err := s.scope(ctx)
	if err != nil {
		return Device{}, err
	}
	if len(ValidateDevice(in)) > 0 {
		return Device{}, fmt.Errorf("%w: invalid device", ErrInvalidRequest)
	}
	dev, err := s.q.GetActivePushDeviceForUser(ctx, db.GetActivePushDeviceForUserParams{UserID: userID, Token: strings.TrimSpace(in.DeviceToken)})
	if errors.Is(err, pgx.ErrNoRows) {
		return Device{}, ErrNotFound
	}
	if err != nil {
		return Device{}, err
	}
	widgets := in.Widgets == nil || *in.Widgets
	row, err := s.q.UpsertLiveActivityDevice(ctx, db.UpsertLiveActivityDeviceParams{
		OrganizationID:   orgID,
		UserID:           userID,
		PushDeviceID:     dev.ID,
		PushToStartToken: strings.ToLower(strings.TrimSpace(in.PushToStartToken)),
		WidgetsEnabled:   widgets,
	})
	if err != nil {
		return Device{}, err
	}
	return Device{WidgetsEnabled: row.WidgetsEnabled, PushToStart: row.PushToStartToken != "", LiveActivityPush: s.APNsConfigured(ctx)}, nil
}

// UnregisterDevice stops widget pushes of the current organization to the
// caller's device (idempotent).
func (s *Service) UnregisterDevice(ctx context.Context, userID int64, deviceToken string) error {
	orgID, err := s.scope(ctx)
	if err != nil {
		return err
	}
	dev, err := s.q.GetActivePushDeviceForUser(ctx, db.GetActivePushDeviceForUserParams{UserID: userID, Token: strings.TrimSpace(deviceToken)})
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	_, err = s.q.DeleteLiveActivityDeviceForUser(ctx, db.DeleteLiveActivityDeviceForUserParams{
		OrganizationID: orgID, UserID: userID, PushDeviceID: dev.ID,
	})
	return err
}

// PurgeExpired deletes token rows past their lifetime.
func (s *Service) PurgeExpired(ctx context.Context) (int64, error) {
	return s.q.DeleteExpiredLiveActivityTokens(ctx)
}

// ─── Scheduling (hooked into the jobs live-list events) ────────────────────

// JobsChanged schedules pushes after a jobs mutation in the organization on
// ctx. It never blocks on push delivery and never fails the caller.
func (s *Service) JobsChanged(ctx context.Context, uuids []string) {
	sc, ok := orgctx.ScopeFrom(ctx)
	if !ok || sc.InternalID <= 0 {
		return
	}
	orgID := sc.InternalID
	if len(uuids) > maxJobsPerEvent {
		uuids = uuids[:maxJobsPerEvent]
	}
	if s.queue == nil {
		bg := context.WithoutCancel(ctx)
		s.inline.Add(1)
		go func() {
			defer s.inline.Done()
			for _, id := range uuids {
				if err := s.ProcessJob(bg, queue.LiveJobPayload{OrganizationID: orgID, JobUUID: id}); err != nil {
					s.log.Warn("livepush_job_failed", "error", err)
				}
			}
			if err := s.ProcessWidgets(bg, queue.LiveWidgetsPayload{OrganizationID: orgID}); err != nil {
				s.log.Warn("livepush_widgets_failed", "error", err)
			}
		}()
		return
	}
	now := s.now()
	for _, id := range uuids {
		if _, err := uuid.Parse(id); err != nil {
			continue
		}
		if err := queue.EnqueueLiveJob(s.queue, orgID, id, now); err != nil && !errors.Is(err, queue.ErrDuplicate) {
			s.log.Warn("livepush_enqueue_job_failed", "error", err)
		}
	}
	if err := queue.EnqueueLiveWidgets(s.queue, orgID, queue.LiveWidgetsDebounce, ""); err != nil && !errors.Is(err, queue.ErrDuplicate) {
		s.log.Warn("livepush_enqueue_widgets_failed", "error", err)
	}
}

// Publisher wraps the live-list publisher of the jobs module: every
// tenant.jobs event also schedules Live Activity and widget pushes.
type Publisher struct {
	Next resourceevents.Publisher
	Svc  *Service
}

// Publish implements resourceevents.Publisher.
func (p Publisher) Publish(ctx context.Context, resource, action string, uuids ...string) {
	if p.Next != nil {
		p.Next.Publish(ctx, resource, action, uuids...)
	}
	if p.Svc != nil && resource == resourceevents.TenantJobs {
		p.Svc.JobsChanged(ctx, uuids)
	}
}

var _ resourceevents.Publisher = Publisher{}
