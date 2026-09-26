package usecase

import (
	"fmt"
	"math"
	"strconv"
	"strings"
)

// Alert events (settings.events values).
const (
	EventCreated   = "created"
	EventReady     = "ready"
	EventDelivered = "delivered"
	EventCancelled = "cancelled"
)

// AllEvents in display order.
var AllEvents = []string{EventCreated, EventReady, EventDelivered, EventCancelled}

// DefaultEvents agreed with the business: arrival, delivery, cancellation.
var DefaultEvents = []string{EventCreated, EventDelivered, EventCancelled}

var eventMeta = map[string]struct{ icon, label string }{
	EventCreated:   {"🚗", "Araç kabul edildi"},
	EventReady:     {"🔔", "Teslime hazır"},
	EventDelivered: {"✅", "Teslim edildi"},
	EventCancelled: {"❌", "İptal edildi"},
}

// JobInfo is the vehicle/job snapshot an alert is rendered from.
type JobInfo struct {
	Plate         string
	CustomerName  string
	Services      []string
	PaymentStatus string
	Amount        float64
}

// AlertText renders the title (plate + event) and detail line shared by the
// in-app notification and the WhatsApp line. Amount is not included: it is
// appended only for owners (staff get vehicle info, not money).
func AlertText(event string, j JobInfo) (title, detail string) {
	meta := eventMeta[event]
	title = fmt.Sprintf("%s — %s", strings.TrimSpace(j.Plate), meta.label)
	parts := []string{}
	if c := strings.TrimSpace(j.CustomerName); c != "" {
		parts = append(parts, c)
	}
	if len(j.Services) > 0 {
		parts = append(parts, strings.Join(uniq(j.Services), ", "))
	}
	if event == EventDelivered {
		if j.PaymentStatus == "paid" {
			parts = append(parts, "ödendi")
		} else {
			parts = append(parts, "ödeme bekliyor")
		}
	}
	return title, strings.Join(parts, " · ")
}

// WhatsAppLine is one bullet line: "🚗 *34 ABC 123* — Araç kabul edildi · …".
func WhatsAppLine(event string, j JobInfo) string {
	meta := eventMeta[event]
	_, detail := AlertText(event, j)
	line := fmt.Sprintf("%s *%s* — %s", meta.icon, strings.TrimSpace(j.Plate), meta.label)
	if detail != "" {
		line += " · " + detail
	}
	return line
}

// PendingLine is a queued WhatsApp line plus its amount (owners only).
type PendingLine struct {
	Line   string
	Amount float64
	Event  string
}

// Message renders the WhatsApp text for one recipient: a single alert or a
// digest when several lines were batched.
func Message(orgName string, lines []PendingLine, withAmounts bool) string {
	name := strings.TrimSpace(orgName)
	if name == "" {
		name = "İşletme"
	}
	render := func(l PendingLine) string {
		if withAmounts && l.Amount > 0 && l.Event != EventCancelled {
			return l.Line + " · " + formatTRY(l.Amount)
		}
		return l.Line
	}
	if len(lines) == 1 {
		return fmt.Sprintf("*%s* · Araç bildirimi\n%s", name, render(lines[0]))
	}
	var b strings.Builder
	fmt.Fprintf(&b, "*%s* · Araç hareketleri (%d)\n", name, len(lines))
	for _, l := range lines {
		b.WriteString(render(l))
		b.WriteString("\n")
	}
	return strings.TrimRight(b.String(), "\n")
}

func uniq(in []string) []string {
	seen := map[string]bool{}
	out := make([]string, 0, len(in))
	for _, s := range in {
		s = strings.TrimSpace(s)
		if s == "" || seen[s] {
			continue
		}
		seen[s] = true
		out = append(out, s)
	}
	return out
}

func formatTRY(v float64) string {
	neg := v < 0
	if neg {
		v = -v
	}
	whole := int64(v)
	cents := int64(math.Round((v - float64(whole)) * 100))
	if cents == 100 {
		whole++
		cents = 0
	}
	digits := strconv.FormatInt(whole, 10)
	var b strings.Builder
	for i, r := range digits {
		if i > 0 && (len(digits)-i)%3 == 0 {
			b.WriteByte('.')
		}
		b.WriteRune(r)
	}
	out := fmt.Sprintf("₺%s,%02d", b.String(), cents)
	if neg {
		out = "-" + out
	}
	return out
}
