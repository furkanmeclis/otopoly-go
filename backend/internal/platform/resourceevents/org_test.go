package resourceevents_test

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/config"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/authctx"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/orgctx"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/resourceevents"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/realtime"
	"github.com/google/uuid"
)

func tenantRegistry() *resourceevents.Registry {
	reg := resourceevents.NewRegistry()
	reg.Register("tenant.jobs", "tenant.jobs.read")
	reg.Register("tenant.customers", "tenant.customers.read")
	return reg
}

func orgPrincipalCtx(userID uuid.UUID, org *uuid.UUID, perms ...string) context.Context {
	return authctx.WithPrincipal(context.Background(), authctx.Principal{
		UserID: userID, UserInternal: 7, Permissions: perms, OrganizationUUID: org,
	})
}

// members returns a membership check that admits exactly the listed orgs.
func members(orgs ...uuid.UUID) resourceevents.MembershipCheck {
	return func(_ context.Context, userInternal int64, orgUUID uuid.UUID) (bool, error) {
		if userInternal != 7 {
			return false, nil
		}
		for _, o := range orgs {
			if o == orgUUID {
				return true, nil
			}
		}
		return false, nil
	}
}

func TestOrgChannelRoundTrip(t *testing.T) {
	t.Parallel()
	org := uuid.New()
	ch := resourceevents.OrgChannel(org, "tenant.jobs")
	if ch != "org:"+org.String()+":resource:tenant.jobs" {
		t.Fatalf("channel = %q", ch)
	}
	gotOrg, gotRes, ok := resourceevents.ParseOrgChannel(ch)
	if !ok || gotOrg != org || gotRes != "tenant.jobs" {
		t.Fatalf("parse = %v %q %v", gotOrg, gotRes, ok)
	}
	for _, bad := range []string{
		"resource:tenant.jobs",
		"org:" + org.String(),
		"org:not-a-uuid:resource:tenant.jobs",
		"org:" + uuid.Nil.String() + ":resource:tenant.jobs",
		"org:" + org.String() + ":resource:Tenant Jobs",
		"user:" + org.String(),
	} {
		if _, _, ok := resourceevents.ParseOrgChannel(bad); ok {
			t.Errorf("ParseOrgChannel(%q) accepted", bad)
		}
	}
}

func TestOrgChannelResolver(t *testing.T) {
	t.Parallel()
	orgA := uuid.New()
	lookedUp := uuid.New()
	resolve := resourceevents.OrgChannelResolver(func(_ context.Context, id int64) (uuid.UUID, error) {
		if id == 42 {
			return lookedUp, nil
		}
		return uuid.Nil, errors.New("not found")
	})

	withUUID := orgctx.WithScope(context.Background(), orgctx.Scope{InternalID: 1, UUID: orgA})
	ch, handled, err := resolve(withUUID, "tenant.jobs")
	if err != nil || !handled || ch != resourceevents.OrgChannel(orgA, "tenant.jobs") {
		t.Fatalf("scoped: %q %v %v", ch, handled, err)
	}

	idOnly := orgctx.WithScope(context.Background(), orgctx.Scope{InternalID: 42})
	ch, handled, err = resolve(idOnly, "tenant.jobs")
	if err != nil || !handled || ch != resourceevents.OrgChannel(lookedUp, "tenant.jobs") {
		t.Fatalf("lookup: %q %v %v", ch, handled, err)
	}

	unknown := orgctx.WithScope(context.Background(), orgctx.Scope{InternalID: 9})
	if _, handled, err = resolve(unknown, "tenant.jobs"); err == nil || !handled {
		t.Fatalf("lookup failure must be handled with an error, got %v %v", handled, err)
	}

	// Tenant resource without an organization: dropped (never a shared channel).
	ch, handled, err = resolve(context.Background(), "tenant.jobs")
	if err != nil || !handled || ch != "" {
		t.Fatalf("no scope: %q %v %v", ch, handled, err)
	}

	// Platform resources fall through to the next resolver.
	if _, handled, _ = resolve(withUUID, "platform.users"); handled {
		t.Fatal("platform resource must not be handled")
	}
}

func TestBroadcasterScopesTenantEventsToOrganization(t *testing.T) {
	t.Parallel()
	fake := &fakePublisher{}
	b := resourceevents.New(fake, quietLog())
	b.AddResolver(resourceevents.OrgChannelResolver(nil))
	orgA, orgB := uuid.New(), uuid.New()

	b.Publish(orgctx.WithScope(context.Background(), orgctx.Scope{InternalID: 1, UUID: orgA}),
		"tenant.jobs", resourceevents.ActionCreated, "j-1")
	b.Publish(orgctx.WithScope(context.Background(), orgctx.Scope{InternalID: 2, UUID: orgB}),
		"tenant.jobs", resourceevents.ActionDeleted, "j-2")
	// No organization on the context, no lookup: dropped.
	b.Publish(context.Background(), "tenant.jobs", resourceevents.ActionUpdated, "j-3")
	b.Publish(orgctx.WithScope(context.Background(), orgctx.Scope{InternalID: 3}),
		"tenant.jobs", resourceevents.ActionUpdated, "j-4")
	b.Wait()

	got := map[string]string{}
	for _, c := range fake.snapshot() {
		got[c.channel] = c.event.UUIDs[0]
	}
	if len(got) != 2 {
		t.Fatalf("published %v, want exactly the two scoped events", got)
	}
	if got[resourceevents.OrgChannel(orgA, "tenant.jobs")] != "j-1" ||
		got[resourceevents.OrgChannel(orgB, "tenant.jobs")] != "j-2" {
		t.Fatalf("channels = %v", got)
	}
}

func TestOrgChannelRule(t *testing.T) {
	t.Parallel()
	orgA, orgB := uuid.New(), uuid.New()
	user := uuid.New()
	rule := resourceevents.OrgChannelRule(tenantRegistry(), members(orgA))
	jobsA := resourceevents.OrgChannel(orgA, "tenant.jobs")
	jobsB := resourceevents.OrgChannel(orgB, "tenant.jobs")

	tests := []struct {
		name        string
		ctx         context.Context
		user        uuid.UUID
		channel     string
		wantHandled bool
		wantAllowed bool
	}{
		{"other family", orgPrincipalCtx(user, &orgA, "tenant.jobs.read"), user, "user:" + user.String(), false, false},
		{"member with read", orgPrincipalCtx(user, &orgA, "tenant.jobs.read"), user, jobsA, true, true},
		{"missing read permission", orgPrincipalCtx(user, &orgA, "tenant.customers.read"), user, jobsA, true, false},
		{"unregistered resource", orgPrincipalCtx(user, &orgA, "tenant.jobs.read"), user, resourceevents.OrgChannel(orgA, "tenant.secrets"), true, false},
		{"token scoped to another org", orgPrincipalCtx(user, &orgB, "tenant.jobs.read"), user, jobsA, true, false},
		{"token without org", orgPrincipalCtx(user, nil, "tenant.jobs.read"), user, jobsA, true, false},
		{"not a member", orgPrincipalCtx(user, &orgB, "tenant.jobs.read"), user, jobsB, true, false},
		{"no principal", context.Background(), user, jobsA, true, false},
		{"principal mismatch", orgPrincipalCtx(uuid.New(), &orgA, "tenant.jobs.read"), user, jobsA, true, false},
	}
	for _, tc := range tests {
		handled, allowed, err := rule(tc.ctx, tc.user, false, tc.channel)
		if err != nil {
			t.Fatalf("%s: err %v", tc.name, err)
		}
		if handled != tc.wantHandled || allowed != tc.wantAllowed {
			t.Errorf("%s: handled=%v allowed=%v, want %v/%v", tc.name, handled, allowed, tc.wantHandled, tc.wantAllowed)
		}
	}

	// Super admins still need membership and an org-scoped token.
	super := authctx.WithPrincipal(context.Background(), authctx.Principal{
		UserID: user, UserInternal: 7, IsSuperAdmin: true, OrganizationUUID: &orgB,
	})
	if _, allowed, _ := rule(super, user, true, jobsB); allowed {
		t.Fatal("super admin outside the organization must be denied")
	}

	failing := resourceevents.OrgChannelRule(tenantRegistry(), func(context.Context, int64, uuid.UUID) (bool, error) {
		return false, errors.New("db down")
	})
	if handled, allowed, err := failing(orgPrincipalCtx(user, &orgA, "tenant.jobs.read"), user, false, jobsA); !handled || allowed || err == nil {
		t.Fatalf("membership error: %v %v %v", handled, allowed, err)
	}

	noMembership := resourceevents.OrgChannelRule(tenantRegistry(), nil)
	if _, allowed, _ := noMembership(orgPrincipalCtx(user, &orgA, "tenant.jobs.read"), user, false, jobsA); allowed {
		t.Fatal("nil membership check must deny")
	}
}

func TestSubscriptionTokenEndpointIsolatesOrganizations(t *testing.T) {
	t.Parallel()
	issuer, err := realtime.NewTokenIssuer(config.CentrifugoConfig{
		Enabled: true, TokenHMAC: "unit-test-hmac-secret", TokenTTL: time.Hour,
	})
	if err != nil {
		t.Fatal(err)
	}
	orgA, orgB := uuid.New(), uuid.New()
	h := realtime.NewHandler(issuer, rulesAuthorizer{rules: []realtime.ChannelRule{
		resourceevents.OrgChannelRule(tenantRegistry(), members(orgA)),
	}})
	user := uuid.New()

	call := func(channel string, org *uuid.UUID, perms ...string) int {
		body := strings.NewReader(`{"channel":"` + channel + `"}`)
		req := httptest.NewRequest(http.MethodPost, "/v1/realtime/subscription-token", body)
		req = req.WithContext(orgPrincipalCtx(user, org, perms...))
		rec := httptest.NewRecorder()
		h.SubscriptionToken(rec, req)
		return rec.Code
	}

	if code := call(resourceevents.OrgChannel(orgA, "tenant.customers"), &orgA, "tenant.customers.read"); code != http.StatusOK {
		t.Fatalf("own org with permission: %d, want 200", code)
	}
	if code := call(resourceevents.OrgChannel(orgA, "tenant.customers"), &orgA); code != http.StatusForbidden {
		t.Fatalf("own org without permission: %d, want 403", code)
	}
	if code := call(resourceevents.OrgChannel(orgB, "tenant.customers"), &orgA, "tenant.customers.read"); code != http.StatusForbidden {
		t.Fatalf("other org: %d, want 403", code)
	}
	if code := call(resourceevents.OrgChannel(orgB, "tenant.customers"), &orgB, "tenant.customers.read"); code != http.StatusForbidden {
		t.Fatalf("non-member with forged org token: %d, want 403", code)
	}
}

func TestTenantResourcesAreRegisteredWithReadPermissions(t *testing.T) {
	t.Parallel()
	reg := resourceevents.NewRegistry()
	resourceevents.RegisterTenantResources(reg)
	for resource, perm := range resourceevents.TenantResources {
		if !resourceevents.IsTenantResource(resource) || !resourceevents.ValidResourceName(resource) {
			t.Errorf("%q is not a valid tenant resource name", resource)
		}
		if !strings.HasPrefix(perm, "tenant.") || !strings.HasSuffix(perm, ".read") {
			t.Errorf("%q: permission %q is not a tenant read permission", resource, perm)
		}
		if got, ok := reg.Permission(resource); !ok || got != perm {
			t.Errorf("%q not registered", resource)
		}
	}
}
