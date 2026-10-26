package smschannel

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database/db"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/entitlements"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

type reportQ struct {
	from, to pgtype.Timestamptz
	org      db.Organization
}

func (q *reportQ) SMSReportByProvider(_ context.Context, arg db.SMSReportByProviderParams) ([]db.SMSReportByProviderRow, error) {
	q.from, q.to = arg.DateFrom, arg.DateTo
	return []db.SMSReportByProviderRow{
		{SenderKind: "sms_twilio", Sent: 2, Failed: 1, Segments: 4},
		{SenderKind: "sms_netgsm", Sent: 10, Failed: 0, Segments: 12},
		{SenderKind: "", Sent: 0, Failed: 3, Segments: 0},
	}, nil
}

func (q *reportQ) SMSReportDaily(context.Context, db.SMSReportDailyParams) ([]db.SMSReportDailyRow, error) {
	return []db.SMSReportDailyRow{{Day: pgtype.Date{Time: time.Date(2026, 10, 3, 0, 0, 0, 0, time.UTC), Valid: true}, Sent: 12, Failed: 4, Segments: 16}}, nil
}

func (q *reportQ) SMSReportOrganizations(context.Context, db.SMSReportOrganizationsParams) ([]db.SMSReportOrganizationsRow, error) {
	return []db.SMSReportOrganizationsRow{{OrganizationID: 7, OrganizationUuid: q.org.Uuid, OrganizationName: "Garage", Provider: "netgsm", IsActive: true, AccountStatus: "connected", Sent: 10, Segments: 12}}, nil
}

func (q *reportQ) SMSReportOrgMessages(_ context.Context, arg db.SMSReportOrgMessagesParams) ([]db.SMSReportOrgMessagesRow, error) {
	if arg.OrganizationID != q.org.ID {
		return nil, errors.New("wrong org")
	}
	return []db.SMSReportOrgMessagesRow{{Uuid: uuid.New(), RecipientPhone: "+905321234567", Status: "sent",
		SenderKind: pgtype.Text{String: "sms_netgsm", Valid: true}, Segments: pgtype.Int4{Int32: 2, Valid: true}}}, nil
}

func (q *reportQ) CountSMSReportOrgMessages(context.Context, int64) (int64, error) { return 1, nil }

func (q *reportQ) GetOrganizationByUUID(_ context.Context, id uuid.UUID) (db.Organization, error) {
	if id != q.org.Uuid {
		return db.Organization{}, pgx.ErrNoRows
	}
	return q.org, nil
}

type snapQuota struct{}

func (snapQuota) Snapshot(context.Context, int64) (entitlements.Snapshot, error) {
	return entitlements.Snapshot{Usage: []entitlements.Usage{{Key: FeatureSMSMonthly, Used: 12, Limit: 1000}}}, nil
}

func TestReportBuild(t *testing.T) {
	q := &reportQ{org: db.Organization{ID: 7, Uuid: uuid.New(), Name: "Garage"}}
	r := NewReport(q, snapQuota{})
	r.now = func() time.Time { return time.Date(2026, 10, 26, 12, 0, 0, 0, r.loc) }

	out, err := r.Build(context.Background(), "", "")
	if err != nil {
		t.Fatal(err)
	}
	if out.From != "2026-10-01" || out.To != "2026-10-26" {
		t.Fatalf("default range %s..%s", out.From, out.To)
	}
	if got := q.to.Time.In(r.loc); got.Day() != 27 || got.Hour() != 0 {
		t.Fatalf("exclusive end %v", got)
	}
	if out.Totals != (Counts{Sent: 12, Failed: 4, Segments: 16}) {
		t.Fatalf("totals %+v", out.Totals)
	}
	if len(out.ByProvider) != 3 || out.ByProvider[0].Provider != "netgsm" || out.ByProvider[2].Provider != "unknown" {
		t.Fatalf("providers %+v", out.ByProvider)
	}
	if len(out.Daily) != 1 || out.Daily[0].Date != "2026-10-03" {
		t.Fatalf("daily %+v", out.Daily)
	}
	if len(out.Organizations) != 1 || out.Organizations[0].QuotaUsed != 12 || out.Organizations[0].QuotaLimit != 1000 {
		t.Fatalf("orgs %+v", out.Organizations)
	}

	for _, bad := range [][2]string{{"2026-10-05", "2026-10-01"}, {"x", ""}, {"2024-01-01", "2026-01-01"}} {
		if _, err := r.Build(context.Background(), bad[0], bad[1]); !errors.Is(err, ErrInvalidRequest) {
			t.Fatalf("%v: %v", bad, err)
		}
	}
}

func TestReportMessagesMasksAndScopes(t *testing.T) {
	q := &reportQ{org: db.Organization{ID: 7, Uuid: uuid.New(), Name: "Garage"}}
	r := NewReport(q, nil)
	page, err := r.Messages(context.Background(), q.org.Uuid, 20, 0)
	if err != nil {
		t.Fatal(err)
	}
	if len(page.Items) != 1 || page.Items[0].Recipient != "+90532•••4567" || page.Items[0].Provider != "netgsm" || *page.Items[0].Segments != 2 {
		t.Fatalf("page %+v", page.Items)
	}
	if _, err := r.Messages(context.Background(), uuid.New(), 20, 0); !errors.Is(err, ErrNotFound) {
		t.Fatalf("unknown org: %v", err)
	}
}
