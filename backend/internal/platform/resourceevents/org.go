package resourceevents

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database/db"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/authctx"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/orgctx"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/realtime"
	"github.com/google/uuid"
)

// Live lists of organization-owned resources use one channel per
// organization and resource: org:{org_uuid}:resource:{name} (Centrifugo
// namespace "org"). Same scheme as the sibling Rentopya product.
const (
	// TenantResourcePrefix marks organization-owned resources ("tenant.jobs").
	TenantResourcePrefix = "tenant."
	orgChannelPrefix     = "org:"
	orgResourceMarker    = ":resource:"
)

// IsTenantResource reports whether resource is organization-owned.
func IsTenantResource(resource string) bool {
	return strings.HasPrefix(resource, TenantResourcePrefix)
}

// OrgChannel returns the live list channel of a tenant resource.
func OrgChannel(orgUUID uuid.UUID, resource string) string {
	return orgChannelPrefix + orgUUID.String() + orgResourceMarker + resource
}

// ParseOrgChannel splits org:{uuid}:resource:{name}.
func ParseOrgChannel(channel string) (uuid.UUID, string, bool) {
	rest, ok := strings.CutPrefix(channel, orgChannelPrefix)
	if !ok {
		return uuid.Nil, "", false
	}
	rawID, resource, ok := strings.Cut(rest, orgResourceMarker)
	if !ok || !ValidResourceName(resource) {
		return uuid.Nil, "", false
	}
	id, err := uuid.Parse(rawID)
	if err != nil || id == uuid.Nil {
		return uuid.Nil, "", false
	}
	return id, resource, true
}

// OrganizationUUIDLookup maps an organization id to its uuid. Background
// code often only carries the internal id (orgctx.Scope{InternalID: …}).
type OrganizationUUIDLookup func(ctx context.Context, organizationID int64) (uuid.UUID, error)

// QueriesLookup reads organization uuids from the database.
func QueriesLookup(q *db.Queries) OrganizationUUIDLookup {
	return func(ctx context.Context, organizationID int64) (uuid.UUID, error) {
		org, err := q.GetOrganizationByID(ctx, organizationID)
		if err != nil {
			return uuid.Nil, err
		}
		return org.Uuid, nil
	}
}

// OrgChannelResolver scopes tenant.* resource events to the organization on
// the context. A tenant resource published without an organization is
// dropped rather than leaked on a shared channel.
func OrgChannelResolver(lookup OrganizationUUIDLookup) ChannelResolver {
	return func(ctx context.Context, resource string) (string, bool, error) {
		if !IsTenantResource(resource) {
			return "", false, nil
		}
		scope, ok := orgctx.ScopeFrom(ctx)
		if !ok || (scope.InternalID <= 0 && scope.UUID == uuid.Nil) {
			return "", true, nil
		}
		orgUUID := scope.UUID
		if orgUUID == uuid.Nil {
			if lookup == nil {
				return "", true, errors.New("resourceevents: organization uuid lookup missing")
			}
			id, err := lookup(ctx, scope.InternalID)
			if err != nil {
				return "", true, fmt.Errorf("resourceevents: organization uuid: %w", err)
			}
			orgUUID = id
		}
		if orgUUID == uuid.Nil {
			return "", true, nil
		}
		return OrgChannel(orgUUID, resource), true, nil
	}
}

// MembershipCheck reports whether the user (internal id) may currently act
// inside the organization: an active member of an organization that is not
// suspended and inside its access window (same rules as RequireOrganization).
type MembershipCheck func(ctx context.Context, userInternal int64, orgUUID uuid.UUID) (bool, error)

// OrgChannelRule authorizes org:{uuid}:resource:{name} subscriptions with the
// same checks a GET on the resource's list route makes:
//   - the resource is registered in reg (unknown resources are denied);
//   - the caller's access token is scoped to that organization (JWT `oid`),
//     because tenant permissions in the token belong to that organization;
//   - the caller is still an active member with access (membership);
//   - the caller holds the registered read permission.
//
// A nil membership check denies every organization channel.
func OrgChannelRule(reg *Registry, membership MembershipCheck) realtime.ChannelRule {
	return func(ctx context.Context, userUUID uuid.UUID, _ bool, channel string) (bool, bool, error) {
		orgUUID, resource, ok := ParseOrgChannel(channel)
		if !ok {
			return false, false, nil
		}
		perm, registered := reg.Permission(resource)
		if !registered || membership == nil {
			return true, false, nil
		}
		p, ok := authctx.PrincipalFrom(ctx)
		if !ok || p.UserID != userUUID || p.UserInternal <= 0 {
			return true, false, nil
		}
		if p.OrganizationUUID == nil || *p.OrganizationUUID != orgUUID {
			return true, false, nil
		}
		member, err := membership(ctx, p.UserInternal, orgUUID)
		if err != nil {
			return true, false, err
		}
		if !member {
			return true, false, nil
		}
		return true, p.HasPermission(perm), nil
	}
}
