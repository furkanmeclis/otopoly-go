package loyalty_test

import (
	"net/http"
	"testing"

	customersmodule "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/customers"
	jobsmodule "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/jobs"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/loyalty"
)

// The job and customer loyalty routes live under paths the jobs and
// customers modules own; registering all three on one mux must not panic.
func TestRoutesDoNotConflict(t *testing.T) {
	mux := http.NewServeMux()
	jobsmodule.RegisterRoutes(mux, nil, nil, nil, nil)
	customersmodule.RegisterRoutes(mux, nil, nil, nil, nil)
	loyalty.RegisterRoutes(mux, nil, nil, nil, nil, nil)
}
