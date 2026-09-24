package tools

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"math/big"
	"strconv"
	"strings"
	"time"
)

// Preview is the confirmation card shown for a proposed write action.
// Field keys and value keys are i18n keys resolved by the UI
// (ai.confirm.fields.<key>, ai.confirm.values.<value_key>).
type Preview struct {
	Action string  `json:"action"`
	Title  string  `json:"title"`
	Amount string  `json:"amount,omitempty"`
	Fields []Field `json:"fields"`
	// Edit lists the fields the user may change on the card before confirming.
	Edit []EditField `json:"edit,omitempty"`
	// Warnings are i18n keys (ai.confirm.warnings.<key>).
	Warnings []string `json:"warnings,omitempty"`
}

// Field is one "label: value" row of a preview.
type Field struct {
	Key      string `json:"key"`
	Value    string `json:"value,omitempty"`
	ValueKey string `json:"value_key,omitempty"`
}

// EditField is an inline-editable input on the confirm card. Key is the tool
// input property the edited value is written to.
type EditField struct {
	Key      string   `json:"key"`
	Type     string   `json:"type"` // money | text | textarea | select | date | time
	Value    string   `json:"value"`
	Options  []Option `json:"options,omitempty"`
	Required bool     `json:"required,omitempty"`
}

// Option is a select option. LabelKey (i18n) wins over Label when set.
type Option struct {
	Value    string `json:"value"`
	Label    string `json:"label,omitempty"`
	LabelKey string `json:"label_key,omitempty"`
}

// Link points the UI at the record a confirmed action created or changed.
type Link struct {
	Kind string `json:"kind"` // customer | cari | job | sale | finance_account | todo
	UUID string `json:"uuid"`
}

// Proposal is a validated, reference-resolved write call.
type Proposal struct {
	// Input is the normalized input stored with the pending action and passed
	// to Run on confirm (same schema as the model input, uuids resolved).
	Input   json.RawMessage
	Preview Preview
}

// ActionTool is a write tool: Propose validates the input, resolves references
// and builds the confirm card without changing anything; Run executes the
// normalized input after the user confirms.
type ActionTool interface {
	Tool
	Propose(ctx context.Context, env Env, input json.RawMessage) (Proposal, error)
}

// InputError is a user-correctable problem with a tool input; its message is
// returned to the model (and to the UI when an edited confirm fails).
type InputError struct{ Msg string }

func (e *InputError) Error() string { return e.Msg }

func inputErr(format string, args ...any) error {
	return &InputError{Msg: fmt.Sprintf(format, args...)}
}

// AsInputError reports whether err is a user-correctable input problem.
func AsInputError(err error) (*InputError, bool) {
	var ie *InputError
	if errors.As(err, &ie) {
		return ie, true
	}
	return nil, false
}

// proposalError converts domain validation errors into InputErrors and lets
// other errors bubble up as internal failures.
func proposalError(err error) error {
	if err == nil {
		return nil
	}
	if _, ok := AsInputError(err); ok {
		return err
	}
	msg := strings.ToLower(err.Error())
	for _, marker := range []string{"not found", "invalid", "must", "cannot", "required", "conflict", "insufficient", "already", "mismatch"} {
		if strings.Contains(msg, marker) {
			return &InputError{Msg: err.Error()}
		}
	}
	return err
}

// execError turns a domain error during execution into a tool error result.
func execError(err error) (Result, error) {
	if pe := proposalError(err); pe != nil {
		if ie, ok := AsInputError(pe); ok {
			return ErrorResult("Not executed: " + ie.Msg), nil
		}
	}
	return Result{}, err
}

// Plan is a checklist the assistant shows (and updates in place) for
// multi-step requests.
type Plan struct {
	Title string     `json:"title,omitempty"`
	Items []PlanItem `json:"items"`
}

// PlanItem is one checklist row.
type PlanItem struct {
	Text   string `json:"text"`
	Status string `json:"status"` // pending | in_progress | done | skipped
}

// ---------------------------------------------------------------- helpers

// normalize decodes raw into a generic object after schema validation.
func decodeInput(schema map[string]any, raw json.RawMessage, dst any) error {
	if err := Decode(schema, raw, dst); err != nil {
		return &InputError{Msg: "Invalid input: " + err.Error()}
	}
	return nil
}

func mustJSON(v any) json.RawMessage {
	raw, err := json.Marshal(v)
	if err != nil {
		return json.RawMessage(`{}`)
	}
	return raw
}

// Amount is a positive money amount with at most 2 decimals.
type Amount struct {
	rat *big.Rat
}

// ParseAmount accepts a JSON number or a string ("20000", "1.250,50", "1250.5").
func ParseAmount(v any) (Amount, error) {
	var s string
	switch x := v.(type) {
	case float64:
		s = strconv.FormatFloat(x, 'f', -1, 64)
	case json.Number:
		s = x.String()
	case string:
		s = normalizeAmountString(x)
	default:
		return Amount{}, inputErr("amount is required")
	}
	r, ok := new(big.Rat).SetString(s)
	if !ok {
		return Amount{}, inputErr("amount must be a number like 20000 or 1250.50")
	}
	if r.Sign() <= 0 {
		return Amount{}, inputErr("amount must be greater than zero")
	}
	if r.Cmp(big.NewRat(1_000_000_000, 1)) > 0 {
		return Amount{}, inputErr("amount is too large")
	}
	cents := new(big.Rat).Mul(r, big.NewRat(100, 1))
	if !cents.IsInt() {
		return Amount{}, inputErr("amount can have at most 2 decimals")
	}
	return Amount{rat: r}, nil
}

func normalizeAmountString(s string) string {
	s = strings.TrimSpace(strings.NewReplacer("₺", "", "TL", "", "tl", "", " ", "").Replace(s))
	if strings.Contains(s, ",") {
		// Turkish format: 1.250,50 → 1250.50
		s = strings.ReplaceAll(s, ".", "")
		s = strings.ReplaceAll(s, ",", ".")
	}
	return s
}

// String returns the decimal string ("20000.00").
func (a Amount) String() string {
	if a.rat == nil {
		return "0.00"
	}
	return a.rat.FloatString(2)
}

// Float returns the amount as a JSON number.
func (a Amount) Float() float64 {
	if a.rat == nil {
		return 0
	}
	f, _ := a.rat.Float64()
	return math.Round(f*100) / 100
}

// Rat returns the amount.
func (a Amount) Rat() *big.Rat {
	if a.rat == nil {
		return new(big.Rat)
	}
	return new(big.Rat).Set(a.rat)
}

func ratOf(decimal string) *big.Rat {
	r, ok := new(big.Rat).SetString(strings.TrimSpace(decimal))
	if !ok {
		return new(big.Rat)
	}
	return r
}

// dateOrToday validates an optional YYYY-MM-DD date (default today, max 1 year ahead/5 years back).
func dateOrToday(env Env, v string) (string, error) {
	v = strings.TrimSpace(v)
	if v == "" {
		return env.Today(), nil
	}
	t, err := time.Parse("2006-01-02", v)
	if err != nil {
		return "", inputErr("date must be YYYY-MM-DD")
	}
	today, _ := time.Parse("2006-01-02", env.Today())
	if t.After(today.AddDate(1, 0, 0)) || t.Before(today.AddDate(-5, 0, 0)) {
		return "", inputErr("date is out of range")
	}
	return v, nil
}

var paymentMethodValues = []string{"cash", "card", "transfer", "other"}

func methodOptions(values []string) []Option {
	out := make([]Option, 0, len(values))
	for _, v := range values {
		out = append(out, Option{Value: v, LabelKey: "ai.confirm.values." + v})
	}
	return out
}

func trimmed(s string, max int) string {
	s = strings.TrimSpace(s)
	if r := []rune(s); len(r) > max {
		return string(r[:max])
	}
	return s
}

// matchByName finds exactly one candidate whose folded name equals (or, if
// none does, contains) the folded query.
func matchByName[T any](query string, items []T, name func(T) string) (T, []T, bool) {
	var zero T
	q := FoldTR(query)
	if q == "" {
		return zero, nil, false
	}
	var exact, partial []T
	for _, it := range items {
		n := FoldTR(name(it))
		switch {
		case n == q:
			exact = append(exact, it)
		case strings.Contains(n, q) || strings.Contains(q, n):
			partial = append(partial, it)
		}
	}
	if len(exact) == 1 {
		return exact[0], nil, true
	}
	if len(exact) > 1 {
		return zero, exact, false
	}
	if len(partial) == 1 {
		return partial[0], nil, true
	}
	return zero, partial, false
}

func names[T any](items []T, name func(T) string, max int) string {
	out := make([]string, 0, len(items))
	for i, it := range items {
		if i >= max {
			out = append(out, "…")
			break
		}
		out = append(out, name(it))
	}
	return strings.Join(out, ", ")
}

// fmtQty renders a quantity without trailing zeros ("2", "1.5").
func fmtQty(r *big.Rat) string {
	if r.IsInt() {
		return r.Num().String()
	}
	return strings.TrimRight(strings.TrimRight(r.FloatString(2), "0"), ".")
}
