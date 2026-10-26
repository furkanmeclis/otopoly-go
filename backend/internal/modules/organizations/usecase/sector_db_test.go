package usecase_test

import (
	"context"
	"errors"
	"testing"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database/db"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database/dbtest"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/organizations/usecase"
)

func strp(s string) *string { return &s }

// The sector is set at self-serve creation, returned on the organization,
// the memberships (/auth/me) and tenant settings, and patched or cleared
// through tenant settings.
func TestOrganizationSectorDB(t *testing.T) {
	fx := dbtest.NewFixtures(t)
	ctx := context.Background()
	svc := usecase.New(fx.Pool, db.New(fx.Pool))
	owner := fx.User()

	if _, err := svc.CreateOwnedOrganization(ctx, usecase.RegisterInput{OrganizationName: "Köpük", Sector: "space"}, owner.ID); !errors.Is(err, usecase.ErrInvalidRequest) {
		t.Fatalf("invalid sector: %v", err)
	}
	res, err := svc.CreateOwnedOrganization(ctx, usecase.RegisterInput{OrganizationName: "Köpük Oto", Sector: "car_wash"}, owner.ID)
	if err != nil {
		t.Fatal(err)
	}
	if res.Organization.Sector == nil || *res.Organization.Sector != "car_wash" {
		t.Fatalf("created sector = %v", res.Organization.Sector)
	}
	orgRow, err := db.New(fx.Pool).GetOrganizationByUUID(ctx, res.Organization.UUID)
	if err != nil {
		t.Fatal(err)
	}
	members, err := svc.ListMembershipsForUser(ctx, owner.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(members) != 1 || members[0].Sector == nil || *members[0].Sector != "car_wash" {
		t.Fatalf("memberships: %+v", members)
	}

	settings, err := svc.PatchTenantSettings(ctx, orgRow.ID, usecase.LetterheadPatch{Sector: strp("ppf_tint")})
	if err != nil {
		t.Fatal(err)
	}
	if settings.Sector == nil || *settings.Sector != "ppf_tint" {
		t.Fatalf("patched sector = %v", settings.Sector)
	}
	// Absent keeps it; other fields still update.
	settings, err = svc.PatchTenantSettings(ctx, orgRow.ID, usecase.LetterheadPatch{Tagline: strp("Parlak")})
	if err != nil || settings.Sector == nil || *settings.Sector != "ppf_tint" || settings.Tagline != "Parlak" {
		t.Fatalf("patch without sector: %+v %v", settings, err)
	}
	if _, err := svc.PatchTenantSettings(ctx, orgRow.ID, usecase.LetterheadPatch{Sector: strp("bakery")}); !errors.Is(err, usecase.ErrInvalidRequest) {
		t.Fatalf("invalid patch: %v", err)
	}
	// "" clears it.
	settings, err = svc.PatchTenantSettings(ctx, orgRow.ID, usecase.LetterheadPatch{Sector: strp("")})
	if err != nil || settings.Sector != nil {
		t.Fatalf("cleared sector = %v %v", settings.Sector, err)
	}
	got, err := svc.GetTenantSettings(ctx, orgRow.ID)
	if err != nil || got.Sector != nil {
		t.Fatalf("get after clear: %v %v", got.Sector, err)
	}
}
