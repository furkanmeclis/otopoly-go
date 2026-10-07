package usecase

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"errors"
	"fmt"
	"math/big"
	"strings"
	"time"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database/db"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/i18n"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

const (
	otpChannelWhatsApp = "whatsapp"
	otpCodeLength      = 6
	otpTTL             = 5 * time.Minute
	otpResendCooldown  = 60 * time.Second
	otpMaxAttempts     = 5
	otpMaxSendsPerHour = 5
	// otpVerificationTTL bounds how long a verified OTP authorizes the signature.
	otpVerificationTTL = 30 * time.Minute
)

var (
	// ErrOTPRequired is returned when a signer must verify an OTP before signing.
	ErrOTPRequired = errors.New("otp verification required")
	// ErrOTPInvalid is returned for a wrong, expired, or exhausted code.
	ErrOTPInvalid = errors.New("otp code is invalid")
	// ErrOTPRateLimited is returned when codes are requested too often.
	ErrOTPRateLimited = errors.New("otp requested too often")
	// ErrOTPChannelUnavailable is returned when the org channel cannot deliver.
	ErrOTPChannelUnavailable = errors.New("otp channel unavailable")
)

// OTPMessage is a rendered contract OTP message for the organization's channel.
type OTPMessage struct {
	OrgID        int64
	Channel      string
	Phone        string
	Body         string
	InstanceUUID uuid.UUID
	// Code, BusinessName and Minutes feed the platform template when the
	// platform number sends instead of the organization's own line.
	Code         string
	BusinessName string
	Minutes      int
}

// OTPSender delivers contract OTP messages over the organization's own channel
// (WhatsApp session). Implemented by the messaging module.
type OTPSender interface {
	SendContractOTP(ctx context.Context, msg OTPMessage) (providerRef string, err error)
}

// SetOTPSender attaches the transactional sender used for signer OTPs.
func (s *Service) SetOTPSender(sender OTPSender) {
	s.otp = sender
}

// SendOTPInput requests a new OTP for a signer.
type SendOTPInput struct {
	Phone     string `json:"phone"`
	IPAddress string `json:"-"`
	UserAgent string `json:"-"`
}

// VerifyOTPInput verifies a signer OTP.
type VerifyOTPInput struct {
	Code string `json:"code"`
}

// OTPChallenge describes a sent OTP (never includes the code).
type OTPChallenge struct {
	Channel     string    `json:"channel"`
	PhoneMasked string    `json:"phone_masked"`
	ExpiresAt   time.Time `json:"expires_at"`
	ResendAt    time.Time `json:"resend_at"`
}

func signerRequiresOTP(inst db.ContractInstance, signer db.ContractSigner) bool {
	return inst.OtpRequired && signer.Role == "customer"
}

func signerOTPFresh(signer db.ContractSigner, now time.Time) bool {
	return signer.OtpVerifiedAt.Valid && now.Sub(signer.OtpVerifiedAt.Time) <= otpVerificationTTL
}

// SendSignerOTP sends a WhatsApp OTP with the contract summary + KVKK notice to the signer.
func (s *Service) SendSignerOTP(ctx context.Context, instanceUUID, signerUUID uuid.UUID, in SendOTPInput) (OTPChallenge, error) {
	scope, err := s.requireOrgScope(ctx)
	if err != nil {
		return OTPChallenge{}, err
	}
	actor, err := s.actorID(ctx)
	if err != nil {
		return OTPChallenge{}, err
	}
	if s.otp == nil {
		return OTPChallenge{}, fmt.Errorf("%w: sender not configured", ErrOTPChannelUnavailable)
	}
	inst, signer, err := s.loadOpenSigner(ctx, scope.InternalID, instanceUUID, signerUUID)
	if err != nil {
		return OTPChallenge{}, err
	}

	phone := strings.TrimSpace(in.Phone)
	if phone == "" {
		phone = signer.Phone
	}
	if !validPhone(phone) {
		return OTPChallenge{}, fmt.Errorf("%w: a valid phone number is required", ErrInvalidRequest)
	}

	now := time.Now()
	if latest, lerr := s.q.GetLatestContractSignerOTP(ctx, signer.ID); lerr == nil {
		if resendAt := latest.CreatedAt.Time.Add(otpResendCooldown); now.Before(resendAt) {
			return OTPChallenge{}, fmt.Errorf("%w: wait %d seconds before resending",
				ErrOTPRateLimited, int(resendAt.Sub(now).Seconds())+1)
		}
	} else if !errors.Is(lerr, pgx.ErrNoRows) {
		return OTPChallenge{}, lerr
	}
	sent, err := s.q.CountContractSignerOTPsSince(ctx, db.CountContractSignerOTPsSinceParams{
		SignerID:  signer.ID,
		CreatedAt: pgtype.Timestamptz{Time: now.Add(-time.Hour), Valid: true},
	})
	if err != nil {
		return OTPChallenge{}, err
	}
	if sent >= otpMaxSendsPerHour {
		return OTPChallenge{}, fmt.Errorf("%w: hourly limit reached", ErrOTPRateLimited)
	}

	org, err := s.q.GetOrganizationByID(ctx, scope.InternalID)
	if err != nil {
		return OTPChallenge{}, err
	}
	code, err := generateOTPCode()
	if err != nil {
		return OTPChallenge{}, err
	}
	expiresAt := now.Add(otpTTL)
	body := buildOTPMessage(i18n.Normalize(inst.Locale), otpMessageVars{
		CustomerName:  signer.SuggestedName,
		BusinessName:  org.Name,
		ContractTitle: inst.Title,
		ContractNo:    formatContractNumber(inst.Number),
		Plate:         mustUnmarshalStringMap(inst.VariablesResolved)["plate"],
		Code:          code,
		Minutes:       int(otpTTL.Minutes()),
	})

	ref, err := s.otp.SendContractOTP(ctx, OTPMessage{
		OrgID:        scope.InternalID,
		Channel:      otpChannelWhatsApp,
		Phone:        phone,
		Body:         body,
		InstanceUUID: inst.Uuid,
		Code:         code,
		BusinessName: org.Name,
		Minutes:      int(otpTTL.Minutes()),
	})
	if err != nil {
		return OTPChallenge{}, fmt.Errorf("%w: %v", ErrOTPChannelUnavailable, err)
	}

	msgSum := sha256.Sum256([]byte(body))
	if _, err := s.q.CreateContractSignerOTP(ctx, db.CreateContractSignerOTPParams{
		OrganizationID:    scope.InternalID,
		InstanceID:        inst.ID,
		SignerID:          signer.ID,
		Channel:           otpChannelWhatsApp,
		Phone:             phone,
		CodeHash:          hashOTPCode(signer.Uuid, code),
		MessageSha256:     hex.EncodeToString(msgSum[:]),
		ProviderReference: ref,
		MaxAttempts:       otpMaxAttempts,
		ExpiresAt:         pgtype.Timestamptz{Time: expiresAt, Valid: true},
		SentByUserID:      actor,
		IpAddress:         strings.TrimSpace(in.IPAddress),
		UserAgent:         strings.TrimSpace(in.UserAgent),
	}); err != nil {
		return OTPChallenge{}, err
	}
	if phone != signer.Phone {
		if err := s.q.UpdateContractSignerPhone(ctx, db.UpdateContractSignerPhoneParams{
			ID: signer.ID, Phone: phone,
		}); err != nil {
			return OTPChallenge{}, err
		}
	}

	s.recordActivity(ctx, "tenant.contract_instance.otp_send", "contract_instance", &inst.Uuid, map[string]any{
		"signer_uuid": signer.Uuid.String(), "channel": otpChannelWhatsApp, "phone": maskPhone(phone),
	})
	return OTPChallenge{
		Channel:     otpChannelWhatsApp,
		PhoneMasked: maskPhone(phone),
		ExpiresAt:   expiresAt,
		ResendAt:    now.Add(otpResendCooldown),
	}, nil
}

// VerifySignerOTP checks the latest code for a signer and records the consent evidence.
func (s *Service) VerifySignerOTP(ctx context.Context, instanceUUID, signerUUID uuid.UUID, in VerifyOTPInput) (Instance, error) {
	scope, err := s.requireOrgScope(ctx)
	if err != nil {
		return Instance{}, err
	}
	code := strings.TrimSpace(in.Code)
	if code == "" {
		return Instance{}, fmt.Errorf("%w: code is required", ErrInvalidRequest)
	}
	inst, signer, err := s.loadOpenSigner(ctx, scope.InternalID, instanceUUID, signerUUID)
	if err != nil {
		return Instance{}, err
	}
	latest, err := s.q.GetLatestContractSignerOTP(ctx, signer.ID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Instance{}, fmt.Errorf("%w: no code was sent", ErrOTPInvalid)
		}
		return Instance{}, err
	}
	now := time.Now()
	if latest.VerifiedAt.Valid {
		return Instance{}, fmt.Errorf("%w: code already used", ErrOTPInvalid)
	}
	if now.After(latest.ExpiresAt.Time) {
		return Instance{}, fmt.Errorf("%w: code expired", ErrOTPInvalid)
	}
	if latest.Attempts >= latest.MaxAttempts {
		return Instance{}, fmt.Errorf("%w: too many attempts, request a new code", ErrOTPInvalid)
	}
	latest, err = s.q.IncrementContractSignerOTPAttempts(ctx, latest.ID)
	if err != nil {
		return Instance{}, err
	}
	expected := []byte(latest.CodeHash)
	got := []byte(hashOTPCode(signer.Uuid, code))
	if subtle.ConstantTimeCompare(expected, got) != 1 {
		return Instance{}, fmt.Errorf("%w: wrong code (%d attempts left)",
			ErrOTPInvalid, max(0, int(latest.MaxAttempts-latest.Attempts)))
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return Instance{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	qtx := s.q.WithTx(tx)
	verifiedAt := pgtype.Timestamptz{Time: now, Valid: true}
	if err := qtx.MarkContractSignerOTPVerifiedAt(ctx, db.MarkContractSignerOTPVerifiedAtParams{
		ID: latest.ID, VerifiedAt: verifiedAt,
	}); err != nil {
		return Instance{}, err
	}
	if _, err := qtx.MarkContractSignerOTPVerified(ctx, db.MarkContractSignerOTPVerifiedParams{
		ID:            signer.ID,
		OtpVerifiedAt: verifiedAt,
		OtpChannel:    latest.Channel,
		OtpPhone:      latest.Phone,
	}); err != nil {
		return Instance{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return Instance{}, err
	}

	s.recordActivity(ctx, "tenant.contract_instance.otp_verify", "contract_instance", &inst.Uuid, map[string]any{
		"signer_uuid": signer.Uuid.String(), "channel": latest.Channel, "phone": maskPhone(latest.Phone),
	})
	return s.GetInstance(ctx, instanceUUID)
}

func (s *Service) loadOpenSigner(ctx context.Context, orgID int64, instanceUUID, signerUUID uuid.UUID) (db.ContractInstance, db.ContractSigner, error) {
	inst, err := s.q.GetContractInstanceByUUID(ctx, db.GetContractInstanceByUUIDParams{
		Uuid: instanceUUID, OrganizationID: orgID,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return db.ContractInstance{}, db.ContractSigner{}, ErrNotFound
		}
		return db.ContractInstance{}, db.ContractSigner{}, err
	}
	if inst.Status != "pending" && inst.Status != "draft" {
		return db.ContractInstance{}, db.ContractSigner{}, fmt.Errorf("%w: contract is not open for signing", ErrConflict)
	}
	signer, err := s.q.GetContractSignerByUUID(ctx, db.GetContractSignerByUUIDParams{
		Uuid: signerUUID, OrganizationID: orgID, InstanceID: inst.ID,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return db.ContractInstance{}, db.ContractSigner{}, ErrNotFound
		}
		return db.ContractInstance{}, db.ContractSigner{}, err
	}
	if signer.Status == "signed" {
		return db.ContractInstance{}, db.ContractSigner{}, fmt.Errorf("%w: signer already signed", ErrConflict)
	}
	if !signerRequiresOTP(inst, signer) {
		return db.ContractInstance{}, db.ContractSigner{}, fmt.Errorf("%w: otp is not required for this signer", ErrInvalidRequest)
	}
	return inst, signer, nil
}

type otpMessageVars struct {
	CustomerName  string
	BusinessName  string
	ContractTitle string
	ContractNo    string
	Plate         string
	Code          string
	Minutes       int
}

// buildOTPMessage renders the consent message: contract heading, code, and KVKK notice.
func buildOTPMessage(locale i18n.Locale, v otpMessageVars) string {
	var b strings.Builder
	if locale == i18n.LocaleEN {
		if v.CustomerName != "" {
			fmt.Fprintf(&b, "Dear %s,\n\n", v.CustomerName)
		}
		fmt.Fprintf(&b, "*%s* has prepared a contract for your approval:\n", v.BusinessName)
		fmt.Fprintf(&b, "• Contract: %s\n• No: %s\n", v.ContractTitle, v.ContractNo)
		if v.Plate != "" {
			fmt.Fprintf(&b, "• Plate: %s\n", v.Plate)
		}
		fmt.Fprintf(&b, "\nVerification code: *%s*\n", v.Code)
		fmt.Fprintf(&b, "Valid for %d minutes. Share it with the business only if you have read and accept the contract.\n\n", v.Minutes)
		fmt.Fprintf(&b, "_Privacy notice (KVKK No. 6698): Your name, phone number, vehicle and signature data are processed by %s as data controller "+
			"for establishing and performing this contract and meeting legal obligations, and are retained for the statutory period. "+
			"You may exercise your rights under Article 11 by contacting the business._", v.BusinessName)
		return b.String()
	}
	if v.CustomerName != "" {
		fmt.Fprintf(&b, "Sayın %s,\n\n", v.CustomerName)
	}
	fmt.Fprintf(&b, "*%s* tarafından onayınıza sunulan sözleşme:\n", v.BusinessName)
	fmt.Fprintf(&b, "• Sözleşme: %s\n• No: %s\n", v.ContractTitle, v.ContractNo)
	if v.Plate != "" {
		fmt.Fprintf(&b, "• Plaka: %s\n", v.Plate)
	}
	fmt.Fprintf(&b, "\nOnay kodunuz: *%s*\n", v.Code)
	fmt.Fprintf(&b, "Kod %d dakika geçerlidir. Sözleşmeyi okuyup kabul ediyorsanız kodu işletme yetkilisiyle paylaşınız.\n\n", v.Minutes)
	fmt.Fprintf(&b, "_KVKK Aydınlatma: 6698 sayılı Kişisel Verilerin Korunması Kanunu uyarınca ad-soyad, telefon, araç ve imza bilgileriniz "+
		"veri sorumlusu %s tarafından sözleşmenin kurulması ve ifası ile hukuki yükümlülüklerin yerine getirilmesi amacıyla işlenir "+
		"ve yasal süre boyunca saklanır. KVKK m.11 kapsamındaki haklarınız için işletmeye başvurabilirsiniz._", v.BusinessName)
	return b.String()
}

func generateOTPCode() (string, error) {
	limit := big.NewInt(1)
	for range otpCodeLength {
		limit.Mul(limit, big.NewInt(10))
	}
	n, err := rand.Int(rand.Reader, limit)
	if err != nil {
		return "", err
	}
	return fmt.Sprintf("%0*d", otpCodeLength, n.Int64()), nil
}

func hashOTPCode(signerUUID uuid.UUID, code string) string {
	sum := sha256.Sum256([]byte(signerUUID.String() + ":" + strings.TrimSpace(code)))
	return hex.EncodeToString(sum[:])
}

func phoneDigits(phone string) string {
	return strings.Map(func(r rune) rune {
		if r >= '0' && r <= '9' {
			return r
		}
		return -1
	}, phone)
}

func validPhone(phone string) bool {
	return len(phoneDigits(phone)) >= 10
}

// maskPhone keeps the last four digits: 0532 *** ** 67 → "*******4567".
func maskPhone(phone string) string {
	d := phoneDigits(phone)
	if len(d) <= 4 {
		return d
	}
	return strings.Repeat("*", len(d)-4) + d[len(d)-4:]
}
