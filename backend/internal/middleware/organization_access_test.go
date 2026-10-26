package middleware

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database/db"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

func TestOrganizationAccess(t *testing.T) {
	t.Parallel()
	org := uuid.New()
	past := pgtype.Timestamptz{Time: time.Now().Add(-time.Hour), Valid: true}
	cases := []struct {
		name    string
		res     fakeOrgResolver
		want    bool
		wantErr bool
	}{
		{"active member", fakeOrgResolver{row: db.GetOrganizationMemberByUserAndOrgUUIDRow{OrganizationStatus: "active"}}, true, false},
		{"read-only subscription can still read", fakeOrgResolver{row: db.GetOrganizationMemberByUserAndOrgUUIDRow{OrganizationStatus: "active", SubscriptionStatus: "read_only"}}, true, false},
		{"not a member", fakeOrgResolver{err: pgx.ErrNoRows}, false, false},
		{"suspended", fakeOrgResolver{row: db.GetOrganizationMemberByUserAndOrgUUIDRow{OrganizationStatus: "suspended"}}, false, false},
		{"access ended", fakeOrgResolver{row: db.GetOrganizationMemberByUserAndOrgUUIDRow{OrganizationStatus: "active", AccessEndsAt: past}}, false, false},
		{"db error", fakeOrgResolver{err: errors.New("boom")}, false, true},
	}
	for _, tc := range cases {
		got, err := OrganizationAccess(tc.res)(context.Background(), 7, org)
		if got != tc.want || (err != nil) != tc.wantErr {
			t.Errorf("%s: got %v err %v", tc.name, got, err)
		}
	}
	if ok, _ := OrganizationAccess(fakeOrgResolver{})(context.Background(), 0, org); ok {
		t.Error("missing user must be denied")
	}
	if ok, _ := OrganizationAccess(nil)(context.Background(), 7, org); ok {
		t.Error("nil resolver must deny")
	}
}
