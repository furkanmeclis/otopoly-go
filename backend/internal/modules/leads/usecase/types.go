package usecase

import (
	"time"

	"github.com/google/uuid"
)

// Sources, temperatures and statuses (kept in sync with migration 000054).
var (
	Sources      = []string{"incoming_call", "outgoing_call", "walk_in", "whatsapp", "social", "referral", "website", "other"}
	Temperatures = []string{"cold", "warm", "hot"}
	Statuses     = []string{"new", "contacted", "quoted", "won", "lost"}
)

// Ref is a related record.
type Ref struct {
	UUID  uuid.UUID `json:"uuid"`
	Label string    `json:"label"`
}

// Lead is the list shape.
type Lead struct {
	UUID           uuid.UUID  `json:"uuid"`
	CustomerUUID   uuid.UUID  `json:"customer_uuid"`
	CustomerName   string     `json:"customer_name"`
	CustomerPhone  string     `json:"customer_phone"`
	VehiclePlate   string     `json:"vehicle_plate"`
	VehicleText    string     `json:"vehicle_text"`
	Interest       string     `json:"interest"`
	Source         string     `json:"source"`
	Temperature    string     `json:"temperature"`
	Status         string     `json:"status"`
	LostReason     string     `json:"lost_reason"`
	FollowUpDate   *string    `json:"follow_up_date"`
	FollowUpState  string     `json:"follow_up_state"` // none | overdue | today | upcoming
	Assignee       *Ref       `json:"assignee"`
	QuoteCount     int64      `json:"quote_count"`
	LastActivityAt *time.Time `json:"last_activity_at"`
	CreatedAt      time.Time  `json:"created_at"`
	UpdatedAt      time.Time  `json:"updated_at"`
}

// Event is a timeline entry.
type Event struct {
	UUID      uuid.UUID  `json:"uuid"`
	Kind      string     `json:"kind"`
	FromValue string     `json:"from_value"`
	ToValue   string     `json:"to_value"`
	Body      string     `json:"body"`
	RefType   string     `json:"ref_type"`
	RefUUID   *uuid.UUID `json:"ref_uuid"`
	RefLabel  string     `json:"ref_label"`
	ActorName string     `json:"actor_name"`
	CreatedAt time.Time  `json:"created_at"`
}

// LeadQuote is a quote linked to the lead.
type LeadQuote struct {
	UUID       uuid.UUID `json:"uuid"`
	Number     string    `json:"number"`
	Status     string    `json:"status"`
	GrandTotal string    `json:"grand_total"`
	Currency   string    `json:"currency"`
	ValidUntil *string   `json:"valid_until"`
	CreatedAt  time.Time `json:"created_at"`
}

// Detail is the full lead.
type Detail struct {
	Lead
	VehicleUUID   *uuid.UUID  `json:"vehicle_uuid"`
	Notes         string      `json:"notes"`
	CreatedByName string      `json:"created_by_name"`
	ContactedAt   *time.Time  `json:"contacted_at"`
	ClosedAt      *time.Time  `json:"closed_at"`
	Quotes        []LeadQuote `json:"quotes"`
	Events        []Event     `json:"events"`
}

// Summary counts open leads for the dashboard and nav badge.
type Summary struct {
	Open     int64  `json:"open"`
	New      int64  `json:"new"`
	Hot      int64  `json:"hot"`
	Overdue  int64  `json:"overdue"`
	DueToday int64  `json:"due_today"`
	Mine     int64  `json:"mine"`
	Date     string `json:"date"`
}

// Assignee is an org member that can own leads.
type Assignee struct {
	UUID  uuid.UUID `json:"uuid"`
	Label string    `json:"label"`
	Role  string    `json:"role"`
}

// ListFilters narrows the list.
type ListFilters struct {
	Q            string
	Status       string // new|contacted|quoted|won|lost|open
	Temperature  string
	Source       string
	Assignee     string // "me" or user uuid
	FollowUp     string // overdue | today
	CustomerUUID *uuid.UUID
	Sort         string
}

// CreateInput creates a lead.
type CreateInput struct {
	CustomerUUID uuid.UUID  `json:"customer_uuid"`
	VehicleUUID  *uuid.UUID `json:"vehicle_uuid"`
	VehicleText  string     `json:"vehicle_text"`
	Interest     string     `json:"interest"`
	Source       string     `json:"source"`
	Temperature  string     `json:"temperature"`
	Notes        string     `json:"notes"`
	FollowUpDate *string    `json:"follow_up_date"`
	AssigneeUUID *uuid.UUID `json:"assignee_uuid"`
}

// PatchInput updates a lead. Missing fields are kept; for the optional
// references an empty string clears the value.
type PatchInput struct {
	CustomerUUID *uuid.UUID `json:"customer_uuid"`
	VehicleUUID  *string    `json:"vehicle_uuid"`
	VehicleText  *string    `json:"vehicle_text"`
	Interest     *string    `json:"interest"`
	Source       *string    `json:"source"`
	Temperature  *string    `json:"temperature"`
	Status       *string    `json:"status"`
	LostReason   *string    `json:"lost_reason"`
	Notes        *string    `json:"notes"`
	FollowUpDate *string    `json:"follow_up_date"`
	AssigneeUUID *string    `json:"assignee_uuid"`
}

// NoteInput adds a free note to the timeline.
type NoteInput struct {
	Body string `json:"body"`
}

// TodoInput creates a todo from a lead.
type TodoInput struct {
	Title        string     `json:"title"`
	Notes        string     `json:"notes"`
	DueDate      *string    `json:"due_date"`
	DueTime      *string    `json:"due_time"`
	AssigneeUUID *uuid.UUID `json:"assignee_uuid"`
}

// TodoResult reports the created todo.
type TodoResult struct {
	TodoUUID uuid.UUID `json:"todo_uuid"`
	Title    string    `json:"title"`
	Lead     Detail    `json:"lead"`
}
