package brandlogo

import (
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
)

func TestURL(t *testing.T) {
	id := uuid.New()
	key := pgtype.Text{String: "brands/x.png", Valid: true}
	if u := URL(id, key); u == nil || *u != "/v1/public/vehicle-brands/logo/"+id.String() {
		t.Fatalf("URL = %v", u)
	}
	if URL(id, pgtype.Text{}) != nil || URL(id, pgtype.Text{String: "  ", Valid: true}) != nil {
		t.Fatal("no logo key must give nil")
	}
	if URL(uuid.Nil, key) != nil {
		t.Fatal("nil brand must give nil")
	}
	if NullableURL(pgtype.UUID{}, key) != nil {
		t.Fatal("missing join must give nil")
	}
	if u := NullableURL(pgtype.UUID{Bytes: id, Valid: true}, key); u == nil {
		t.Fatal("joined brand with key must give a URL")
	}
}
