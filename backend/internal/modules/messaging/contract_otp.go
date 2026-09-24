package messaging

import (
	"context"

	contractsusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/contracts/usecase"
	messagingmodel "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/messaging/model"
	messagingusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/messaging/usecase"
)

// ContractOTPSender delivers contract signing OTPs over the organization's own
// WhatsApp session. It satisfies contractsusecase.OTPSender.
type ContractOTPSender struct {
	svc *messagingusecase.Service
}

// NewContractOTPSender wraps the messaging service for the contracts module.
func NewContractOTPSender(svc *messagingusecase.Service) *ContractOTPSender {
	return &ContractOTPSender{svc: svc}
}

func (s *ContractOTPSender) SendContractOTP(ctx context.Context, msg contractsusecase.OTPMessage) (string, error) {
	instanceUUID := msg.InstanceUUID
	return s.svc.SendDirect(ctx, messagingusecase.SendDirectInput{
		OrgID:          msg.OrgID,
		EventType:      messagingmodel.EventContractOTP,
		Channel:        msg.Channel,
		RecipientPhone: msg.Phone,
		Body:           msg.Body,
		SubjectType:    "contract_instance",
		SubjectUUID:    &instanceUUID,
	})
}
