package usecase

import (
	"bytes"
	"context"
	"errors"
	"io"
	"os"
	"regexp"
	"strings"
	"testing"
	"time"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database/db"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/authctx"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/i18n"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/orgctx"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/storage"
	"github.com/google/uuid"
	"github.com/hibiken/asynq"
	"github.com/jackc/pgx/v5/pgxpool"
)

func TestMaskPhone(t *testing.T) {
	cases := map[string]string{
		"0532 123 45 67":  "*******4567",
		"+90 532 1234567": "********4567",
		"123":             "123",
	}
	for in, want := range cases {
		if got := maskPhone(in); got != want {
			t.Errorf("maskPhone(%q)=%q want %q", in, got, want)
		}
	}
}

func TestGenerateOTPCode(t *testing.T) {
	re := regexp.MustCompile(`^\d{6}$`)
	for range 50 {
		code, err := generateOTPCode()
		if err != nil {
			t.Fatal(err)
		}
		if !re.MatchString(code) {
			t.Fatalf("bad code %q", code)
		}
	}
}

func TestHashOTPCodeBindsSigner(t *testing.T) {
	a, b := uuid.New(), uuid.New()
	if hashOTPCode(a, "123456") == hashOTPCode(b, "123456") {
		t.Fatal("hash must differ per signer")
	}
	if hashOTPCode(a, " 123456 ") != hashOTPCode(a, "123456") {
		t.Fatal("hash must ignore surrounding whitespace")
	}
}

func TestBuildOTPMessageIncludesContractAndKVKK(t *testing.T) {
	body := buildOTPMessage(i18n.LocaleTR, otpMessageVars{
		CustomerName:  "Ahmet Yılmaz",
		BusinessName:  "Tech Oto",
		ContractTitle: "Seramik Kaplama Sözleşmesi",
		ContractNo:    "SZL-000012",
		Plate:         "34 ABC 123",
		Code:          "482913",
		Minutes:       5,
	})
	for _, want := range []string{"Ahmet Yılmaz", "Tech Oto", "Seramik Kaplama Sözleşmesi", "SZL-000012", "34 ABC 123", "482913", "KVKK", "6698"} {
		if !strings.Contains(body, want) {
			t.Errorf("message missing %q:\n%s", want, body)
		}
	}
	en := buildOTPMessage(i18n.LocaleEN, otpMessageVars{BusinessName: "Tech Oto", Code: "000001", Minutes: 5})
	if !strings.Contains(en, "Verification code: *000001*") || strings.Contains(en, "Dear") {
		t.Errorf("unexpected EN message:\n%s", en)
	}
}

func TestSuggestSigner(t *testing.T) {
	job := db.GetServiceJobByUUIDRow{CustomerName: " Ayşe Kaya ", CustomerPhone: "05321234567"}
	if n, p := suggestSigner("customer", job, "Owner"); n != "Ayşe Kaya" || p != "05321234567" {
		t.Fatalf("customer: %q %q", n, p)
	}
	if n, _ := suggestSigner("staff", job, "Mehmet Usta"); n != "Mehmet Usta" {
		t.Fatalf("staff fallback to actor: %q", n)
	}
	job.AssigneeName = "Ali Demir"
	if n, p := suggestSigner("staff", job, "Mehmet Usta"); n != "Ali Demir" || p != "" {
		t.Fatalf("staff assignee: %q %q", n, p)
	}
	if n, _ := suggestSigner("witness", job, "x"); n != "" {
		t.Fatalf("unknown role should be empty: %q", n)
	}
}

// --- DB-backed flow (skipped without DATABASE_URL) ---

type fakeOTPSender struct {
	messages []OTPMessage
	err      error
}

func (f *fakeOTPSender) SendContractOTP(_ context.Context, msg OTPMessage) (string, error) {
	if f.err != nil {
		return "", f.err
	}
	f.messages = append(f.messages, msg)
	return "wa-ref", nil
}

var codeInBody = regexp.MustCompile(`\*(\d{6})\*`)

func (f *fakeOTPSender) lastCode(t *testing.T) string {
	t.Helper()
	if len(f.messages) == 0 {
		t.Fatal("no OTP message sent")
	}
	m := codeInBody.FindStringSubmatch(f.messages[len(f.messages)-1].Body)
	if m == nil {
		t.Fatal("no code in body")
	}
	return m[1]
}

type memStorage struct {
	storage.Driver
	objects map[string][]byte
}

func (m *memStorage) Upload(_ context.Context, f storage.File, path string) error {
	data, err := io.ReadAll(f.Body)
	m.objects[path] = data
	return err
}

func (m *memStorage) Download(_ context.Context, path string) (io.ReadCloser, int64, error) {
	data, ok := m.objects[path]
	if !ok {
		return nil, 0, errors.New("missing")
	}
	return io.NopCloser(bytes.NewReader(data)), int64(len(data)), nil
}

type noopQueue struct{}

func (noopQueue) Enqueue(*asynq.Task, ...asynq.Option) (*asynq.TaskInfo, error) {
	return &asynq.TaskInfo{}, nil
}

// 1x1 transparent PNG.
const tinyPNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="

func TestContractOTPFlow_DB(t *testing.T) {
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		t.Skip("DATABASE_URL not set")
	}
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatalf("pool: %v", err)
	}
	t.Cleanup(pool.Close)
	q := db.New(pool)

	suffix := strings.ReplaceAll(uuid.NewString(), "-", "")[:12]
	var orgID, userID, assigneeID, customerID, vehicleID int64
	var orgUUID, jobUUID uuid.UUID
	mustScan := func(sql string, dest []any, args ...any) {
		t.Helper()
		if err := pool.QueryRow(ctx, sql, args...).Scan(dest...); err != nil {
			t.Fatalf("fixture %q: %v", sql, err)
		}
	}
	mustScan(`INSERT INTO organizations (slug, name) VALUES ($1, 'Tech Oto') RETURNING id, uuid`,
		[]any{&orgID, &orgUUID}, "otp-"+suffix)
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM organizations WHERE id = $1`, orgID)
	})
	mustScan(`INSERT INTO users (email, password_hash, name, surname) VALUES ($1, 'x', 'Kasa', 'Personeli') RETURNING id`,
		[]any{&userID}, "otp-"+suffix+"@example.test")
	mustScan(`INSERT INTO users (email, password_hash, name, surname) VALUES ($1, 'x', 'Ali', 'Usta') RETURNING id`,
		[]any{&assigneeID}, "otp-a-"+suffix+"@example.test")
	var brandID, modelID int64
	mustScan(`INSERT INTO vehicle_brands (name) VALUES ($1) RETURNING id`, []any{&brandID}, "B"+suffix)
	mustScan(`INSERT INTO vehicle_models (brand_id, name) VALUES ($1, 'M') RETURNING id`, []any{&modelID}, brandID)
	if _, err := pool.Exec(ctx, `INSERT INTO vehicle_model_years (model_id, year) VALUES ($1, 2020)`, modelID); err != nil {
		t.Fatal(err)
	}
	mustScan(`INSERT INTO customers (organization_id, name, phone) VALUES ($1, 'Ayşe Kaya', '0532 123 45 67') RETURNING id`,
		[]any{&customerID}, orgID)
	mustScan(`INSERT INTO customer_vehicles (organization_id, customer_id, plate, model_id, year) VALUES ($1, $2, '34ABC123', $3, 2020) RETURNING id`,
		[]any{&vehicleID}, orgID, customerID, modelID)
	mustScan(`INSERT INTO service_jobs (organization_id, customer_id, vehicle_id, customer_name, customer_phone, plate, created_by, assignee_user_id)
		VALUES ($1, $2, $3, 'Ayşe Kaya', '0532 123 45 67', '34ABC123', $4, $5) RETURNING uuid`,
		[]any{&jobUUID}, orgID, customerID, vehicleID, userID, assigneeID)

	sender := &fakeOTPSender{}
	store := &memStorage{objects: map[string][]byte{}}
	svc := New(pool, q, nil, store, nil, noopQueue{}, "")
	svc.SetOTPSender(sender)

	ctx = orgctx.WithScope(ctx, orgctx.Scope{InternalID: orgID, UUID: orgUUID})
	ctx = authctx.WithPrincipal(ctx, authctx.Principal{UserInternal: userID})

	tmpl, err := svc.CreateTemplate(ctx, CreateTemplateInput{
		Title:       "Seramik Kaplama",
		ContentHTML: "<p>{{customer_name}} / {{plate}}</p>",
		SignerSlots: []SignerSlot{
			{Role: "customer", Label: "Müşteri", Required: true},
			{Role: "staff", Label: "Yetkili", Required: true},
		},
	})
	if err != nil {
		t.Fatalf("create template: %v", err)
	}
	if !tmpl.OTPRequired {
		t.Fatal("new templates should require OTP by default")
	}
	inst, err := svc.CreateInstance(ctx, CreateInstanceInput{TemplateUUID: tmpl.UUID, SubjectUUID: jobUUID})
	if err != nil {
		t.Fatalf("create instance: %v", err)
	}
	if len(inst.Signers) != 2 {
		t.Fatalf("signers=%d", len(inst.Signers))
	}
	customer, staff := inst.Signers[0], inst.Signers[1]
	if customer.SuggestedName != "Ayşe Kaya" || customer.Phone != "0532 123 45 67" || !customer.OTPRequired {
		t.Fatalf("customer signer: %+v", customer)
	}
	if staff.SuggestedName != "Ali Usta" || staff.OTPRequired {
		t.Fatalf("staff signer: %+v", staff)
	}

	sign := func(s Signer) error {
		_, err := svc.Sign(ctx, inst.UUID, s.UUID, SignInput{DisplayName: s.SuggestedName, SignaturePNGBase64: tinyPNG})
		return err
	}
	if err := sign(customer); !errors.Is(err, ErrOTPRequired) {
		t.Fatalf("expected ErrOTPRequired, got %v", err)
	}
	if _, err := svc.SendSignerOTP(ctx, inst.UUID, staff.UUID, SendOTPInput{}); !errors.Is(err, ErrInvalidRequest) {
		t.Fatalf("staff OTP should be rejected, got %v", err)
	}

	challenge, err := svc.SendSignerOTP(ctx, inst.UUID, customer.UUID, SendOTPInput{})
	if err != nil {
		t.Fatalf("send otp: %v", err)
	}
	if challenge.PhoneMasked != "*******4567" || sender.messages[0].OrgID != orgID {
		t.Fatalf("challenge: %+v msg: %+v", challenge, sender.messages[0])
	}
	body := sender.messages[0].Body
	for _, want := range []string{"Seramik Kaplama", "34ABC123", "KVKK", "Tech Oto"} {
		if !strings.Contains(body, want) {
			t.Fatalf("body missing %q: %s", want, body)
		}
	}
	if _, err := svc.SendSignerOTP(ctx, inst.UUID, customer.UUID, SendOTPInput{}); !errors.Is(err, ErrOTPRateLimited) {
		t.Fatalf("expected cooldown, got %v", err)
	}

	code := sender.lastCode(t)
	wrong := "000000"
	if code == wrong {
		wrong = "111111"
	}
	if _, err := svc.VerifySignerOTP(ctx, inst.UUID, customer.UUID, VerifyOTPInput{Code: wrong}); !errors.Is(err, ErrOTPInvalid) {
		t.Fatalf("wrong code accepted: %v", err)
	}
	verified, err := svc.VerifySignerOTP(ctx, inst.UUID, customer.UUID, VerifyOTPInput{Code: code})
	if err != nil {
		t.Fatalf("verify: %v", err)
	}
	if !verified.Signers[0].OTPVerified || verified.Signers[0].OTPVerifiedAt == nil {
		t.Fatalf("customer not verified: %+v", verified.Signers[0])
	}
	if _, err := svc.VerifySignerOTP(ctx, inst.UUID, customer.UUID, VerifyOTPInput{Code: code}); !errors.Is(err, ErrOTPInvalid) {
		t.Fatalf("code reuse accepted: %v", err)
	}

	if err := sign(customer); err != nil {
		t.Fatalf("sign customer: %v", err)
	}
	if err := sign(staff); err != nil {
		t.Fatalf("sign staff: %v", err)
	}

	// Evidence reaches the PDF HTML.
	signers, _ := q.ListContractSignersByInstance(ctx, mustInstanceID(t, q, inst.UUID, orgID))
	if !signers[0].OtpVerifiedAt.Valid || signers[0].OtpChannel != "whatsapp" {
		t.Fatalf("evidence not stored: %+v", signers[0])
	}
	html := buildContractHTML(contractPDFOptions{
		Locale: i18n.LocaleTR,
		Signatures: []signatureEmbed{{
			Label: "Müşteri", DisplayName: "Ayşe Kaya", SignedAt: time.Now(),
			OTPChannel: "whatsapp", OTPPhoneMasked: "*******4567", OTPVerifiedAt: signers[0].OtpVerifiedAt.Time,
		}},
	})
	if !strings.Contains(html, "OTP ile doğrulandı (WhatsApp *******4567)") {
		t.Fatal("PDF html missing OTP evidence")
	}
}

func mustInstanceID(t *testing.T, q *db.Queries, id uuid.UUID, orgID int64) int64 {
	t.Helper()
	row, err := q.GetContractInstanceByUUID(context.Background(), db.GetContractInstanceByUUIDParams{Uuid: id, OrganizationID: orgID})
	if err != nil {
		t.Fatal(err)
	}
	return row.ID
}
