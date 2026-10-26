package usecase

import (
	"context"
	"errors"
	"testing"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database/db"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/messaging/model"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/messaging/providers"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/orgctx"
)

type smsQ struct {
	*fakeQ
	delivery []db.SetOutboundMessageDeliveryStatusParams
}

func (q *smsQ) SetOutboundMessageDeliveryStatus(_ context.Context, arg db.SetOutboundMessageDeliveryStatusParams) error {
	q.delivery = append(q.delivery, arg)
	return nil
}

type fakeSMS struct {
	active bool
	err    error
	calls  []string
	orgs   []int64
}

func (f *fakeSMS) Available(context.Context, int64) (bool, error) { return f.active, nil }

func (f *fakeSMS) Deliver(ctx context.Context, orgID int64, phone, body, class string) (model.SMSDelivery, error) {
	f.calls = append(f.calls, phone+"|"+body+"|"+class)
	f.orgs = append(f.orgs, scopeKey(ctx))
	if f.err != nil {
		return model.SMSDelivery{Provider: "netgsm"}, f.err
	}
	return model.SMSDelivery{Provider: "netgsm", MessageID: "NG-9", Status: "accepted", To: "+905321234567"}, nil
}

func newSMSRig() (*smsQ, *fakeSMS, *Service) {
	q := &smsQ{fakeQ: &fakeQ{queued: map[int64]db.OutboundMessage{}}}
	f := &fakeSMS{active: true}
	svc := New(q, providers.NewWhatsAppProvider(&fakeWA{}, nil), &providers.NoopSMSProvider{})
	svc.SetSMSChannel(f)
	return q, f, svc
}

func TestSendDirectSMSUsesOrgProvider(t *testing.T) {
	q, f, svc := newSMSRig()
	ref, err := svc.SendDirect(context.Background(), SendDirectInput{
		OrgID: testOrg, EventType: model.EventContractOTP, Channel: model.ChannelSMS,
		RecipientPhone: "05321234567", Body: "Kod 123456",
	})
	if err != nil || ref != "NG-9" {
		t.Fatalf("ref %q err %v", ref, err)
	}
	if len(f.calls) != 1 || f.calls[0] != "05321234567|Kod 123456|otp" || f.orgs[0] != testOrg {
		t.Fatalf("calls %v orgs %v", f.calls, f.orgs)
	}
	if len(q.senders) != 1 || q.senders[0].SenderKind.String != model.SenderSMSNetgsm {
		t.Fatalf("sender %+v", q.senders)
	}
	if len(q.statuses) != 1 || q.statuses[0].Status != model.OutboundStatusSent || q.statuses[0].ProviderReference != "NG-9" {
		t.Fatalf("status %+v", q.statuses)
	}
	if len(q.delivery) != 1 || q.delivery[0].DeliveryStatus.String != "accepted" || q.delivery[0].OrganizationID != testOrg {
		t.Fatalf("delivery %+v", q.delivery)
	}
}

func TestQueuedSMSFailureIsClassified(t *testing.T) {
	q, f, svc := newSMSRig()
	f.err = model.NewSendError(model.ErrCodeSMSNotConfigured, false, errors.New("no active sms provider"))
	q.queued[5] = db.OutboundMessage{ID: 5, OrganizationID: testOrg, Channel: model.ChannelSMS, RecipientPhone: "+905321234567", Body: "Hazır"}
	err := svc.ProcessOutbound(orgctx.WithScope(context.Background(), orgctx.Scope{InternalID: testOrg}), 5, false)
	if err == nil || model.ErrorCodeOf(err) != model.ErrCodeSMSNotConfigured {
		t.Fatalf("err %v", err)
	}
	if len(q.finished) != 1 || q.finished[0].Status != model.OutboundStatusFailed {
		t.Fatalf("non-retryable failure must fail the row at once: %+v", q.finished)
	}
	if len(q.senders) != 1 || q.senders[0].ErrorCode.String != model.ErrCodeSMSNotConfigured {
		t.Fatalf("sender %+v", q.senders)
	}
	if len(q.delivery) != 0 {
		t.Fatal("no delivery status on failure")
	}
}

func TestChannelAvailable(t *testing.T) {
	_, f, svc := newSMSRig()
	if ok, _ := svc.ChannelAvailable(context.Background(), testOrg, model.ChannelSMS); !ok {
		t.Fatal("sms should be available")
	}
	f.active = false
	if ok, _ := svc.ChannelAvailable(context.Background(), testOrg, model.ChannelSMS); ok {
		t.Fatal("sms should be unavailable")
	}
	if ok, _ := svc.ChannelAvailable(context.Background(), testOrg, "fax"); ok {
		t.Fatal("unknown channel")
	}
}
