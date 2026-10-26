package loyalty

import (
	"testing"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/msgtemplate"
	"github.com/jackc/pgx/v5/pgtype"
)

func TestTrMoney(t *testing.T) {
	for in, want := range map[string]string{"1250": "1.250,00", "999.5": "999,50", "1234567.89": "1.234.567,89", "0": "0,00"} {
		var n pgtype.Numeric
		_ = n.Scan(in)
		if got := trMoney(n); got != want {
			t.Errorf("trMoney(%s) = %s, want %s", in, got, want)
		}
	}
}

func TestReminderTemplatesRegistered(t *testing.T) {
	c, ok := msgtemplate.Lookup(KindRenewalReminder)
	if !ok || c.Audience != msgtemplate.AudienceCustomer || !c.HasChannel(msgtemplate.ChannelSMS) {
		t.Fatalf("customer reminder = %+v", c)
	}
	s, ok := msgtemplate.Lookup(KindTeamRenewalDue)
	if !ok || !s.UserPreference || !s.HasChannel(msgtemplate.ChannelInapp) {
		t.Fatalf("team reminder = %+v", s)
	}
}
