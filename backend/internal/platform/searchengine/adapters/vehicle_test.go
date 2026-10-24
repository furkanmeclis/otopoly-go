package adapters

import (
	"regexp"
	"testing"

	"github.com/google/uuid"
)

// Meilisearch primary keys: integers or strings of [a-zA-Z0-9_-] only.
var meiliDocID = regexp.MustCompile(`^[A-Za-z0-9_-]+$`)

func TestModelYearDocIDRoundTrip(t *testing.T) {
	id := uuid.MustParse("df875cf3-ed0d-4a3b-9f9f-bc1f2c99b0e4")
	doc := ModelYearDocID(id, 2020)
	if !meiliDocID.MatchString(doc) {
		t.Fatalf("doc id %q is not a valid Meilisearch primary key", doc)
	}
	gotID, gotYear, err := ParseModelYearDocID(doc)
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	if gotID != id || gotYear != 2020 {
		t.Fatalf("round trip = (%s, %d), want (%s, 2020)", gotID, gotYear, id)
	}
}

func TestParseModelYearDocIDRejectsGarbage(t *testing.T) {
	for _, in := range []string{"", "2020", "df875cf3-ed0d-4a3b-9f9f-bc1f2c99b0e4", "df875cf3-ed0d-4a3b-9f9f-bc1f2c99b0e4-", "not-a-uuid-2020", "df875cf3-ed0d-4a3b-9f9f-bc1f2c99b0e4:2020"} {
		if _, _, err := ParseModelYearDocID(in); err == nil {
			t.Errorf("ParseModelYearDocID(%q) = nil error, want failure", in)
		}
	}
}
