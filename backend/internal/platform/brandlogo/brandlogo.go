// Package brandlogo builds the API-owned public logo URL of a legacy vehicle
// brand (vehicle_brands). The stream follows the brand's catalog display
// brand (admin upload, else the synced badge / full / wordmark file), so the
// projected vehicle_brands.logo_object_key is enough to know a logo exists.
package brandlogo

import (
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
)

// URL is the public logo path of a vehicle brand, or nil when the brand has
// no logo (the UI then shows the brand initial). Clients add
// `?variant=badge` for the compact emblem.
func URL(brandUUID uuid.UUID, key pgtype.Text) *string {
	if brandUUID == uuid.Nil || !key.Valid || strings.TrimSpace(key.String) == "" {
		return nil
	}
	u := "/v1/public/vehicle-brands/logo/" + brandUUID.String()
	return &u
}

// NullableURL is URL for a brand reached through an optional join.
func NullableURL(brandUUID pgtype.UUID, key pgtype.Text) *string {
	if !brandUUID.Valid {
		return nil
	}
	return URL(uuid.UUID(brandUUID.Bytes), key)
}
