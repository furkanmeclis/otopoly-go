package httpserver

import (
	"context"
	"time"

	aiusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/ai/usecase"
	authusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/auth/usecase"
	"github.com/google/uuid"
)

// aiQuotaAdapter exposes AI organization quotas to the platform user detail.
type aiQuotaAdapter struct {
	svc *aiusecase.Service
}

func (a aiQuotaAdapter) CurrentPeriod() (time.Time, time.Time) {
	return a.svc.CurrentPeriod()
}

func (a aiQuotaAdapter) OrganizationQuota(ctx context.Context, orgUUID uuid.UUID) (authusecase.OrganizationAIQuota, error) {
	st, err := a.svc.OrgSettings(ctx, orgUUID)
	if err != nil {
		return authusecase.OrganizationAIQuota{}, err
	}
	return authusecase.OrganizationAIQuota{
		Enabled: st.Enabled, Limit: st.Quota.Limit, Used: st.Quota.Used, Unlimited: st.Quota.Unlimited,
	}, nil
}
