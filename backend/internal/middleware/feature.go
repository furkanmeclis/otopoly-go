package middleware

import (
	"net/http"
	"strconv"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/entitlements"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/orgctx"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/pkg/response"
)

// RequireFeature blocks a module the organization's plan turns off.
// It runs after RequireOrganization. A nil service allows everything.
func RequireFeature(ent *entitlements.Service, key string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			scope, ok := orgctx.ScopeFrom(r.Context())
			if ok && ent != nil {
				on, err := ent.Enabled(r.Context(), scope.InternalID, key)
				if err != nil {
					response.InternalErr(w, r, err, "feature check failed")
					return
				}
				if !on {
					response.Error(w, r, http.StatusForbidden, response.CodeFeatureDisabled, "This feature is not included in your plan")
					return
				}
			}
			next.ServeHTTP(w, r)
		})
	}
}

// WriteLimitReached renders a hard plan limit as 409 with numbers the UI shows.
func WriteLimitReached(w http.ResponseWriter, r *http.Request, d entitlements.Decision) {
	response.ErrorWithDetails(w, r, http.StatusConflict, response.CodeLimitReached, "Plan limit reached", []response.Detail{
		{Field: "feature", Message: d.Key},
		{Field: "limit", Message: itoa(d.Limit)},
		{Field: "used", Message: itoa(d.Used)},
		{Field: "tolerance", Message: itoa(d.Tolerance)},
	})
}

func itoa(n int64) string { return strconv.FormatInt(n, 10) }
