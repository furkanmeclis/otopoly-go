package usecase

import (
	"reflect"
	"strconv"
	"testing"
	"time"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/notifycenter/model"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/msgtemplate"
)

func TestDefaultPrefs(t *testing.T) {
	if p := DefaultPrefs(""); !p.Inapp || p.Email || p.WhatsApp || p.SMS {
		t.Fatalf("no phone defaults = %+v", p)
	}
	if p := DefaultPrefs("0532 000 00 00"); !p.Inapp || !p.WhatsApp || p.SMS {
		t.Fatalf("phone defaults = %+v", p)
	}
}

func TestFilterChannels(t *testing.T) {
	todo, _ := msgtemplate.Lookup("todo.reminder")
	quote, _ := msgtemplate.Lookup("quote.sent")
	all := model.AllChannels
	cases := []struct {
		name   string
		spec   msgtemplate.TypeSpec
		isUser bool
		phone  string
		email  string
		want   []string
	}{
		{"member without contact", todo, true, "", "", []string{"inapp"}},
		{"member with everything", todo, true, "05320000000", "a@b.c", []string{"inapp", "email", "whatsapp", "sms"}},
		{"customer never gets inapp", quote, false, "05320000000", "", []string{"whatsapp", "sms"}},
		{"customer email only", quote, false, "", "c@d.e", []string{"email"}},
	}
	for _, c := range cases {
		got := FilterChannels(all, c.spec, c.isUser, c.phone, c.email)
		if !reflect.DeepEqual(got, c.want) {
			t.Errorf("%s: got %v want %v", c.name, got, c.want)
		}
	}
	job, _ := msgtemplate.Lookup("job.created")
	if got := FilterChannels([]string{"email", "whatsapp", "whatsapp"}, job, false, "1234567890", "x@y.z"); !reflect.DeepEqual(got, []string{"whatsapp"}) {
		t.Errorf("unsupported/duplicate channels not dropped: %v", got)
	}
}

func TestHumanizeAndFormat(t *testing.T) {
	cases := []struct {
		d      time.Duration
		tr, en string
	}{
		{0, "şimdi", "now"},
		{15 * time.Minute, "15 dakika sonra", "in 15 minutes"},
		{time.Minute, "1 dakika sonra", "in 1 minute"},
		{time.Hour, "1 saat sonra", "in 1 hour"},
		{24 * time.Hour, "1 gün sonra", "in 1 day"},
		{3 * 24 * time.Hour, "3 gün sonra", "in 3 days"},
	}
	for _, c := range cases {
		if got := HumanizeUntil(c.d, "tr"); got != c.tr {
			t.Errorf("tr %v = %q", c.d, got)
		}
		if got := HumanizeUntil(c.d, "en"); got != c.en {
			t.Errorf("en %v = %q", c.d, got)
		}
	}
	ts := time.Date(2026, 9, 25, 14, 30, 0, 0, time.UTC)
	if got := FormatDateTime(ts, "tr"); got != "25.09.2026 14:30" {
		t.Errorf("tr format %q", got)
	}
	if got := FormatDateTime(ts, "en"); got != "Sep 25, 2026 14:30" {
		t.Errorf("en format %q", got)
	}
}

func TestBackoffAndDedupeKey(t *testing.T) {
	if BackoffFor(0) != time.Minute || BackoffFor(1) != time.Minute || BackoffFor(2) != 5*time.Minute || BackoffFor(99) != 3*time.Hour {
		t.Fatal("unexpected backoff schedule")
	}
	at := time.Date(2026, 9, 25, 14, 30, 42, 0, time.UTC)
	n := model.Notification{Kind: "todo.reminder", SubjectType: "todo", SubjectID: 7, Recipient: model.Recipient{UserID: 3}}
	k1 := DedupeKey(n, at)
	if k1 != DedupeKey(n, at.Add(10*time.Second)) {
		t.Fatal("same minute must give the same key")
	}
	if k1 == DedupeKey(n, at.Add(time.Minute)) {
		t.Fatal("different slot must differ")
	}
	n.Recipient = model.Recipient{Phone: "+90 532 000 00 00"}
	if got := DedupeKey(n, at); got != "todo.reminder:todo:7:p905320000000:"+strconv.FormatInt(at.Unix()/60, 10) {
		t.Fatalf("phone key %q", got)
	}
}

