package usecase

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database/db"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/apns"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/queue"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

// Data-message kinds understood by the app's background notification task.
const (
	KindLiveJob        = "live.job"
	KindWidgetsRefresh = "widgets.refresh"
)

var errRetry = errors.New("livepush: some pushes failed")

// ─── Job activities ────────────────────────────────────────────────────────

// ProcessJob pushes the current state of one job to every activity tracking
// it. Recipients who already saw this exact state are skipped, so retries
// and coalesced duplicates cost nothing.
func (s *Service) ProcessJob(ctx context.Context, p queue.LiveJobPayload) error {
	jobUUID, err := uuid.Parse(p.JobUUID)
	if err != nil || p.OrganizationID <= 0 {
		return nil
	}
	job, err := s.q.GetServiceJobByUUID(ctx, db.GetServiceJobByUUIDParams{Uuid: jobUUID, OrganizationID: p.OrganizationID})
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	targets, err := s.q.ListLiveActivityTargetsForJob(ctx, db.ListLiveActivityTargetsForJobParams{OrganizationID: p.OrganizationID, JobID: job.ID})
	if err != nil || len(targets) == 0 {
		return err
	}
	org, err := s.q.GetOrganizationByID(ctx, p.OrganizationID)
	if err != nil {
		return err
	}
	state, err := s.jobState(ctx, job)
	if err != nil {
		return err
	}
	now := s.now()
	failed := false
	var android []androidSend
	for _, t := range targets {
		locale := pickLocale(t.UserLocale, t.Locale)
		props, outcome := BuildJobProps(state, org.Name, locale, now)
		hash := propsHash(props, outcome)
		if hash == t.LastHash {
			continue
		}
		switch t.Platform {
		case "ios":
			if !s.sendIOS(ctx, t, props, outcome, locale, hash, now) {
				failed = true
			}
		case "android":
			if t.DeviceID == 0 {
				// The push device was removed or disabled: nobody to reach.
				_ = s.q.DeleteLiveActivityToken(ctx, db.DeleteLiveActivityTokenParams{ID: t.ID, OrganizationID: t.OrganizationID})
				continue
			}
			android = append(android, androidSend{target: t, props: props, outcome: outcome, hash: hash, orgUUID: org.Uuid})
		}
	}
	if len(android) > 0 && !s.sendAndroid(ctx, android) {
		failed = true
	}
	if failed {
		return errRetry
	}
	return nil
}

func (s *Service) jobState(ctx context.Context, job db.GetServiceJobByUUIDRow) (JobState, error) {
	tags, err := s.q.ListServiceJobServiceTags(ctx, db.ListServiceJobServiceTagsParams{OrganizationID: job.OrganizationID, JobIds: []int64{job.ID}})
	if err != nil {
		return JobState{}, err
	}
	services := make([]string, 0, len(tags))
	for _, t := range tags {
		if t.JobID == job.ID && t.Name != "" {
			services = append(services, t.Name)
		}
	}
	return JobState{
		UUID: job.Uuid, Plate: job.Plate, Customer: job.CustomerName, Vehicle: job.VehicleLabel,
		Services: services, Status: job.Status,
		StartedAt: ts(job.StartedAt), CompletedAt: ts(job.CompletedAt),
		DeliveredAt: ts(job.DeliveredAt), UpdatedAt: ts(job.UpdatedAt),
	}, nil
}

func ts(t pgtype.Timestamptz) time.Time {
	if !t.Valid {
		return time.Time{}
	}
	return t.Time
}

// sendIOS sends one ActivityKit push; false asks for a retry.
func (s *Service) sendIOS(ctx context.Context, t db.ListLiveActivityTargetsForJobRow, props JobActivityProps, outcome Outcome, locale, hash string, now time.Time) bool {
	if !s.APNsConfigured(ctx) {
		// The resolver logs livepush_apns_disabled once per process.
		return true
	}
	raw, err := json.Marshal(props)
	if err != nil {
		return true
	}
	changed := t.LastStatus != props.Status
	push := apns.LiveActivity{
		Token:        t.PushToken,
		Event:        apns.EventUpdate,
		ContentState: ContentState{Name: ActivityName, Props: string(raw)},
		Timestamp:    now,
		// Status changes are what people track the job for: deliver them
		// right away. Content-only edits (plate typo, services) ride the
		// low-priority lane that does not count against the budget.
		HighPriority: changed,
	}
	switch outcome {
	case OutcomeEnd:
		push.Event = apns.EventEnd
		push.DismissalDate = now.Add(FinishedVisibleFor)
	case OutcomeDismiss:
		push.Event = apns.EventEnd
		push.DismissalDate = now.Add(-time.Second)
	}
	if changed && (props.Status == "ready" || props.Status == "delivered") {
		title, body := alertText(props, locale)
		push.Alert = &apns.Alert{Title: title, Body: body}
	}
	res, err := s.apns.SendLiveActivity(ctx, push)
	if err != nil {
		s.log.Warn("livepush_apns_failed", "error", err)
		return false
	}
	switch {
	case res.OK():
		if outcome != OutcomeUpdate {
			// The activity has ended: its token is done.
			_ = s.q.DeleteLiveActivityToken(ctx, db.DeleteLiveActivityTokenParams{ID: t.ID, OrganizationID: t.OrganizationID})
			return true
		}
		_ = s.q.MarkLiveActivityTokenSent(ctx, db.MarkLiveActivityTokenSentParams{
			ID: t.ID, OrganizationID: t.OrganizationID, LastStatus: props.Status, LastHash: hash,
		})
		return true
	case res.TokenInvalid():
		_ = s.q.DeleteLiveActivityToken(ctx, db.DeleteLiveActivityTokenParams{ID: t.ID, OrganizationID: t.OrganizationID})
		return true
	case res.Status == 429 || res.Status >= 500:
		s.log.Warn("livepush_apns_retry", "status", res.Status, "reason", res.Reason)
		return false
	default:
		// 4xx we cannot fix by retrying (bad payload, wrong topic): log once
		// per push and move on.
		s.log.Warn("livepush_apns_rejected", "status", res.Status, "reason", res.Reason)
		return true
	}
}

type androidSend struct {
	target  db.ListLiveActivityTargetsForJobRow
	props   JobActivityProps
	outcome Outcome
	hash    string
	orgUUID uuid.UUID
}

// sendAndroid sends data-only messages; the app's background task re-posts
// the Live Update notification from the props. false asks for a retry.
func (s *Service) sendAndroid(ctx context.Context, items []androidSend) bool {
	if s.expo == nil {
		return true
	}
	msgs := make([]ExpoMessage, 0, len(items))
	for _, it := range items {
		dismissal := ""
		switch it.outcome {
		case OutcomeEnd:
			dismissal = "default"
		case OutcomeDismiss:
			dismissal = "immediate"
		}
		msgs = append(msgs, ExpoMessage{
			To: it.target.DeviceToken,
			Data: map[string]any{
				"kind":    KindLiveJob,
				"org":     it.orgUUID.String(),
				"job":     it.props.JobID,
				"end":     dismissal,
				"props":   it.props,
				"sent_at": s.now().UnixMilli(),
			},
			Priority: "high",
			TTL:      int(time.Hour / time.Second),
		})
	}
	tickets, err := s.expo.Send(ctx, msgs)
	if err != nil {
		s.log.Warn("livepush_expo_failed", "error", err)
		return false
	}
	for i, t := range tickets {
		if i >= len(items) {
			break
		}
		it := items[i]
		row := it.target
		switch {
		case t.Status == "ok":
			if it.outcome != OutcomeUpdate {
				_ = s.q.DeleteLiveActivityToken(ctx, db.DeleteLiveActivityTokenParams{ID: row.ID, OrganizationID: row.OrganizationID})
				continue
			}
			_ = s.q.MarkLiveActivityTokenSent(ctx, db.MarkLiveActivityTokenSentParams{
				ID: row.ID, OrganizationID: row.OrganizationID, LastStatus: it.props.Status, LastHash: it.hash,
			})
		case t.DeviceGone():
			_ = s.q.DisablePushDevice(ctx, db.DisablePushDeviceParams{ID: row.DeviceID, Reason: "DeviceNotRegistered"})
			_ = s.q.DeleteLiveActivityToken(ctx, db.DeleteLiveActivityTokenParams{ID: row.ID, OrganizationID: row.OrganizationID})
		default:
			s.log.Warn("livepush_expo_ticket_error", "error", t.Details.Error, "message", t.Message)
		}
	}
	return true
}

func numericString(n pgtype.Numeric) string {
	if !n.Valid {
		return "0"
	}
	v, err := n.Value()
	if err != nil || v == nil {
		return "0"
	}
	if str, ok := v.(string); ok {
		return str
	}
	return fmt.Sprint(v)
}

func clip(s string, n int) string {
	r := []rune(s)
	if len(r) <= n {
		return s
	}
	return string(r[:n])
}
