package handler

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	orgusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/organizations/usecase"
)

func TestWriteErrorMemberCodes(t *testing.T) {
	cases := []struct {
		err    error
		status int
		code   string
	}{
		{orgusecase.ErrLastOwner, http.StatusConflict, "LAST_ORGANIZATION_OWNER"},
		{orgusecase.ErrMemberNotFound, http.StatusNotFound, "NOT_FOUND"},
	}
	for _, tc := range cases {
		rec := httptest.NewRecorder()
		writeError(rec, httptest.NewRequest(http.MethodDelete, "/", nil), tc.err)
		var env createResp
		_ = json.Unmarshal(rec.Body.Bytes(), &env)
		if rec.Code != tc.status || env.Error.Code != tc.code {
			t.Fatalf("%v: status %d code %q", tc.err, rec.Code, env.Error.Code)
		}
	}
}

func TestMemberRoutesRejectInvalidUUIDs(t *testing.T) {
	h := New(nil, nil, nil)
	mux := http.NewServeMux()
	mux.HandleFunc("DELETE /x/{uuid}/members/{userUuid}", h.PlatformRemoveMember)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, httptest.NewRequest(http.MethodDelete, "/x/not-a-uuid/members/also-bad", nil))
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status %d", rec.Code)
	}
}
