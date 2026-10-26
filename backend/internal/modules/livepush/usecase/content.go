package usecase

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"strings"
	"time"

	"github.com/google/uuid"
)

// ActivityName is the name the mobile app passes to expo-widgets'
// createLiveActivity; ActivityKit content-state carries it next to the props.
const ActivityName = "JobActivity"

// ActivityAttributesType is expo-widgets' ActivityAttributes struct (only
// needed for push-to-start payloads).
const ActivityAttributesType = "LiveActivityAttributes"

// JobActivityProps mirrors JobActivityProps in the mobile app
// (src/widgets/types.ts). Everything is display-ready because the widget
// extension has no i18n: labels are translated here, timestamps are epoch ms.
type JobActivityProps struct {
	V          int            `json:"v"`
	JobID      string         `json:"jobId"`
	Plate      string         `json:"plate"`
	Customer   string         `json:"customer"`
	Vehicle    string         `json:"vehicle"`
	Services   string         `json:"services"`
	Status     string         `json:"status"`
	StartedAt  int64          `json:"startedAt"`
	FinishedAt int64          `json:"finishedAt"`
	Org        string         `json:"org"`
	Labels     ActivityLabels `json:"labels"`
}

// ActivityLabels are the translated strings of a job activity.
type ActivityLabels struct {
	Status  string `json:"status"`
	Elapsed string `json:"elapsed"`
	Hint    string `json:"hint"`
	Channel string `json:"channel"`
}

// ContentState is expo-widgets' LiveActivityAttributes.ContentState: the
// layout name and the props as a JSON string.
type ContentState struct {
	Name  string `json:"name"`
	Props string `json:"props"`
}

// JobState is the part of a service job an activity shows.
type JobState struct {
	UUID        uuid.UUID
	Plate       string
	Customer    string
	Vehicle     string
	Services    []string
	Status      string
	StartedAt   time.Time
	CompletedAt time.Time
	DeliveredAt time.Time
	UpdatedAt   time.Time
}

// Outcome is what a job state means for a running activity.
type Outcome int

const (
	// OutcomeUpdate keeps the activity running with new content.
	OutcomeUpdate Outcome = iota
	// OutcomeEnd ends it and leaves the final state on screen for a while.
	OutcomeEnd
	// OutcomeDismiss ends it and removes it right away (voided job).
	OutcomeDismiss
)

// activityStatus maps a job status to the activity status and outcome.
func activityStatus(status string) (string, Outcome) {
	switch status {
	case "in_progress", "ready":
		return status, OutcomeUpdate
	case "delivered", "cancelled":
		return status, OutcomeEnd
	default: // voided or unknown: nothing left to show
		return "cancelled", OutcomeDismiss
	}
}

type labelSet struct {
	elapsed, channel string
	status, hint     map[string]string
}

// Strings copied from the mobile catalogs (jobs.status.*, mobile.live.*).
var labels = map[string]labelSet{
	"tr": {
		elapsed: "Geçen süre",
		channel: "Canlı iş takibi",
		status: map[string]string{
			"in_progress": "Devam ediyor", "ready": "Teslime hazır",
			"delivered": "Teslim edildi", "cancelled": "İptal",
		},
		hint: map[string]string{
			"in_progress": "İşlem devam ediyor", "ready": "Araç teslime hazır",
			"delivered": "Araç teslim edildi", "cancelled": "İş iptal edildi",
		},
	},
	"en": {
		elapsed: "Elapsed",
		channel: "Live job tracking",
		status: map[string]string{
			"in_progress": "In progress", "ready": "Ready for delivery",
			"delivered": "Delivered", "cancelled": "Cancelled",
		},
		hint: map[string]string{
			"in_progress": "Work in progress", "ready": "Car is ready for pickup",
			"delivered": "Car delivered", "cancelled": "Job cancelled",
		},
	},
}

// NormalizeLocale maps "tr-TR" / "en_US" to tr|en; anything else → "".
func NormalizeLocale(v string) string {
	v = strings.ToLower(strings.TrimSpace(v))
	if len(v) > 2 {
		v = v[:2]
	}
	if _, ok := labels[v]; ok {
		return v
	}
	return ""
}

// pickLocale prefers the user's language, then the device's, then Turkish.
func pickLocale(values ...string) string {
	for _, v := range values {
		if l := NormalizeLocale(v); l != "" {
			return l
		}
	}
	return "tr"
}

func epochMs(t time.Time) int64 {
	if t.IsZero() {
		return 0
	}
	return t.UnixMilli()
}

// BuildJobProps renders the activity props for one recipient language. Same
// rules as buildJobActivityProps in the app, so a push and an in-app update
// show the same thing.
func BuildJobProps(job JobState, org, locale string, now time.Time) (JobActivityProps, Outcome) {
	status, outcome := activityStatus(job.Status)
	l := labels[pickLocale(locale)]
	started := epochMs(job.StartedAt)
	if started == 0 {
		started = now.UnixMilli()
	}
	var finished int64
	if status != "in_progress" {
		for _, t := range []time.Time{job.CompletedAt, job.DeliveredAt, job.UpdatedAt, now} {
			if ms := epochMs(t); ms > 0 {
				finished = ms
				break
			}
		}
	}
	return JobActivityProps{
		V:          1,
		JobID:      job.UUID.String(),
		Plate:      job.Plate,
		Customer:   job.Customer,
		Vehicle:    job.Vehicle,
		Services:   strings.Join(job.Services, ", "),
		Status:     status,
		StartedAt:  started,
		FinishedAt: finished,
		Org:        org,
		Labels: ActivityLabels{
			Status:  l.status[status],
			Elapsed: l.elapsed,
			Hint:    l.hint[status],
			Channel: l.channel,
		},
	}, outcome
}

// propsHash identifies what a recipient last saw, so a refetch that changes
// nothing visible does not spend the APNs budget again.
func propsHash(props JobActivityProps, outcome Outcome) string {
	raw, _ := json.Marshal(struct {
		P JobActivityProps `json:"p"`
		O Outcome          `json:"o"`
	}{props, outcome})
	sum := sha256.Sum256(raw)
	return hex.EncodeToString(sum[:])
}

// alertText is the banner shown when a tracked car becomes ready.
func alertText(props JobActivityProps, locale string) (title, body string) {
	l := labels[pickLocale(locale)]
	title = props.Plate
	if props.Customer != "" {
		title += " · " + props.Customer
	}
	return title, l.hint[props.Status]
}
