package model_test

import (
	"testing"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/messaging/model"
)

func TestJobLifecycleEventsOrder(t *testing.T) {
	got := model.JobLifecycleEvents()
	want := []string{
		model.EventJobCreated,
		model.EventContractSigned,
		model.EventJobReady,
		model.EventJobDelivered,
		model.EventJobPaid,
	}
	if len(got) != len(want) {
		t.Fatalf("len=%d want %d", len(got), len(want))
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("idx %d: got %s want %s", i, got[i], want[i])
		}
	}
}

func TestDefaultTemplatesCoverLifecycle(t *testing.T) {
	for _, ev := range model.JobLifecycleEvents() {
		if _, _, ok := model.DefaultTemplate(ev, model.ChannelWhatsApp); !ok {
			t.Fatalf("missing default template for %s", ev)
		}
	}
}
