package usecase

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/auth/model"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/auth/repository"
	"github.com/google/uuid"
	pqtotp "github.com/pquerna/otp/totp"
)

func TestPublicAccountDeletionNoEnumeration(t *testing.T) {
	e := newFlowEnv(t)
	ctx := context.Background()
	if err := e.uc.RequestPublicAccountDeletion(ctx, "nobody@example.com"); err != nil {
		t.Fatalf("unknown email must be accepted: %v", err)
	}
	if len(e.notif.sent) != 0 || len(e.repo.otps) != 0 {
		t.Fatal("no code may be issued for an unknown email")
	}
	if _, err := e.uc.ConfirmPublicAccountDeletion(ctx, "nobody@example.com", "123456", ""); !errors.Is(err, ErrInvalidEmailCode) {
		t.Fatalf("unknown email confirm: %v", err)
	}
	if err := e.uc.RequestPublicAccountDeletion(ctx, "not-an-email"); !errors.Is(err, ErrInvalidRequest) {
		t.Fatalf("invalid email: %v", err)
	}
	// Recovery for an account without a pending deletion sends nothing.
	e.user(t, "ada@example.com")
	if err := e.uc.RequestAccountRecoveryCode(ctx, "ada@example.com"); err != nil {
		t.Fatal(err)
	}
	if e.notif.count("auth.account_recovery_code") != 0 {
		t.Fatal("recovery code sent for an active account")
	}
}

func TestPublicAccountDeletionAndRecovery(t *testing.T) {
	e := newFlowEnv(t)
	e.uc.SetAppURL("https://otopoly.app/")
	fixed := time.Date(2026, 11, 9, 22, 30, 0, 0, time.UTC) // 01:30 on 10 Nov in Istanbul
	e.uc.now = func() time.Time { return fixed }
	u := e.user(t, "ada@example.com")
	ctx := context.Background()

	if err := e.uc.RequestPublicAccountDeletion(ctx, " Ada@Example.com "); err != nil {
		t.Fatal(err)
	}
	code := e.notif.lastCode(t, "auth.account_deactivation_code")
	if _, err := e.uc.ConfirmPublicAccountDeletion(ctx, "ada@example.com", "000000", ""); !errors.Is(err, ErrInvalidEmailCode) {
		t.Fatalf("wrong code: %v", err)
	}
	res, err := e.uc.ConfirmPublicAccountDeletion(ctx, "ada@example.com", code, "")
	if err != nil {
		t.Fatalf("confirm: %v", err)
	}
	// Business day: 10 Nov (Istanbul) + 30 days.
	if res.ScheduledOn != "2026-12-10" {
		t.Fatalf("scheduled on %q", res.ScheduledOn)
	}
	if _, err := e.uc.ConfirmPublicAccountDeletion(ctx, "ada@example.com", code, ""); !errors.Is(err, ErrInvalidEmailCode) {
		t.Fatalf("code must be single use: %v", err)
	}
	got := e.repo.byUUID[u.UUID]
	if got.Status != "disabled" || got.DeactivatedAt == nil || !got.PendingDeletion() {
		t.Fatalf("not pending: %+v", got)
	}
	if e.repo.revokedAll[u.ID] != 1 {
		t.Fatal("sessions must be revoked")
	}
	var scheduledMail map[string]string
	for _, n := range e.notif.sent {
		if n.TemplateCode == "auth.account_deletion_scheduled" {
			scheduledMail = n.TemplateVars
		}
	}
	if scheduledMail == nil || scheduledMail["deletion_date"] != "10 December 2026" ||
		scheduledMail["recover_url"] != "https://otopoly.app/en/account/delete?mode=recover" {
		t.Fatalf("scheduled email vars: %v", scheduledMail)
	}

	// Sign-in is blocked with the deletion day.
	_, err = e.uc.Login(ctx, "ada@example.com", "Secret123!", "", "", model.SessionMeta{})
	var pending *PendingDeletionError
	if !errors.As(err, &pending) || pending.ScheduledOn != "2026-12-10" || !errors.Is(err, ErrAccountDeactivated) {
		t.Fatalf("login while pending: %v", err)
	}
	// No second deletion code while pending.
	before := e.notif.count("auth.account_deactivation_code")
	_ = e.uc.RequestPublicAccountDeletion(ctx, "ada@example.com")
	if e.notif.count("auth.account_deactivation_code") != before {
		t.Fatal("pending account got another deletion code")
	}

	// Recovery.
	if _, err := e.uc.RecoverAccount(ctx, "ada@example.com", "123456"); !errors.Is(err, ErrInvalidEmailCode) {
		t.Fatalf("recover without code: %v", err)
	}
	if err := e.uc.RequestAccountRecoveryCode(ctx, "ada@example.com"); err != nil {
		t.Fatal(err)
	}
	rcode := e.notif.lastCode(t, "auth.account_recovery_code")
	if _, err := e.uc.RecoverAccount(ctx, "ada@example.com", rcode); err != nil {
		t.Fatalf("recover: %v", err)
	}
	got = e.repo.byUUID[u.UUID]
	if got.Status != "active" || got.DeactivatedAt != nil || got.PendingDeletion() {
		t.Fatalf("not recovered: %+v", got)
	}
	if e.notif.count("auth.account_recovered") != 1 {
		t.Fatal("recovered email missing")
	}
	if _, err := e.uc.RecoverAccount(ctx, "ada@example.com", rcode); !errors.Is(err, ErrInvalidEmailCode) {
		t.Fatalf("recovery code must be single use: %v", err)
	}
	if _, err := e.uc.Login(ctx, "ada@example.com", "Secret123!", "", "", model.SessionMeta{}); err != nil {
		t.Fatalf("login after recovery: %v", err)
	}
}

func TestRecoveryRestoresAdminDisabledStatus(t *testing.T) {
	e := newFlowEnv(t)
	u := e.user(t, "ada@example.com")
	u.Status = "disabled"
	e.repo.put(u)
	ctx := context.Background()
	_ = e.uc.RequestPublicAccountDeletion(ctx, "ada@example.com")
	if _, err := e.uc.ConfirmPublicAccountDeletion(ctx, "ada@example.com", e.notif.lastCode(t, "auth.account_deactivation_code"), ""); err != nil {
		t.Fatal(err)
	}
	_ = e.uc.RequestAccountRecoveryCode(ctx, "ada@example.com")
	if _, err := e.uc.RecoverAccount(ctx, "ada@example.com", e.notif.lastCode(t, "auth.account_recovery_code")); err != nil {
		t.Fatal(err)
	}
	if got := e.repo.byUUID[u.UUID]; got.Status != "disabled" {
		t.Fatalf("recovery must not lift an admin disable: %+v", got)
	}
}

func TestPublicAccountDeletionRequiresTOTP(t *testing.T) {
	e := newFlowEnv(t)
	u := e.user(t, "ada@example.com")
	secret := e.enableTOTP(t, u.ID)
	ctx := context.Background()
	_ = e.uc.RequestPublicAccountDeletion(ctx, "ada@example.com")
	code := e.notif.lastCode(t, "auth.account_deactivation_code")
	if _, err := e.uc.ConfirmPublicAccountDeletion(ctx, "ada@example.com", code, ""); !errors.Is(err, ErrMFARequired) {
		t.Fatalf("expected MFA required, got %v", err)
	}
	totp, _ := pqtotp.GenerateCode(secret, time.Now())
	if _, err := e.uc.ConfirmPublicAccountDeletion(ctx, "ada@example.com", code, totp); err != nil {
		t.Fatalf("confirm with totp (same email code): %v", err)
	}
}

func TestAccountDeletionReportsOwnedOrganizations(t *testing.T) {
	e := newFlowEnv(t)
	u := e.user(t, "ada@example.com")
	org := model.OwnedOrganization{ID: 9, UUID: uuid.New(), Slug: "garage", Name: "Garage", OtherMembers: 2}
	e.repo.owned = map[int64][]model.OwnedOrganization{u.ID: {org}}
	res, err := e.uc.DeactivateAccount(context.Background(), u.UUID, "", true)
	if err != nil {
		t.Fatal(err)
	}
	if len(res.OwnedOrganizations) != 1 || res.OwnedOrganizations[0].Slug != "garage" {
		t.Fatalf("owned orgs: %+v", res.OwnedOrganizations)
	}
}

// ---- anonymization job --------------------------------------------------------

type anonRepo struct {
	due      []int64
	today    string
	users    map[int64]model.User
	scrubbed map[int64]model.AnonymizedIdentity
	fail     map[int64]error
	owned    map[int64][]model.OwnedOrganization
}

func (r *anonRepo) ListUsersDueForAnonymization(_ context.Context, today string, _ int32) ([]int64, error) {
	r.today = today
	var out []int64
	for _, id := range r.due {
		if _, done := r.scrubbed[id]; !done {
			out = append(out, id)
		}
	}
	return out, nil
}

func (r *anonRepo) AnonymizeUser(_ context.Context, id int64, ident model.AnonymizedIdentity) (model.User, model.User, error) {
	if err := r.fail[id]; err != nil {
		return model.User{}, model.User{}, err
	}
	before := r.users[id]
	after := before
	after.Email, after.Name, after.Surname = ident.Email, ident.Name, ident.Surname
	now := time.Now()
	after.AnonymizedAt = &now
	r.scrubbed[id] = ident
	return before, after, nil
}

func (r *anonRepo) ListOwnedOrganizations(_ context.Context, id int64) ([]model.OwnedOrganization, error) {
	return r.owned[id], nil
}

type recordedEvent struct {
	action string
	actor  *int64
}

type fakeActivity struct{ events []recordedEvent }

func (f *fakeActivity) Record(_ context.Context, actor *int64, action, _ string, _ *uuid.UUID, _ map[string]any, _ *http.Request) {
	f.events = append(f.events, recordedEvent{action: action, actor: actor})
}

type fakeSearch struct{ deleted []string }

func (f *fakeSearch) EnqueueUpsert(context.Context, string, string) {}
func (f *fakeSearch) EnqueueDelete(_ context.Context, _ string, id string) {
	f.deleted = append(f.deleted, id)
}

func TestAnonymizeDue(t *testing.T) {
	repo := &anonRepo{
		due: []int64{1, 2, 3},
		users: map[int64]model.User{
			1: {ID: 1, UUID: uuid.New(), Email: "a@example.com", Name: "A", DeletionScheduledOn: "2026-12-10"},
			2: {ID: 2, UUID: uuid.New(), Email: "b@example.com", Name: "B", DeletionScheduledOn: "2026-12-09"},
			3: {ID: 3, UUID: uuid.New(), Email: "c@example.com", Name: "C", DeletionScheduledOn: "2026-12-09"},
		},
		scrubbed: map[int64]model.AnonymizedIdentity{},
		fail:     map[int64]error{3: repository.ErrNotFound}, // recovered meanwhile
		owned:    map[int64][]model.OwnedOrganization{1: {{ID: 5, UUID: uuid.New(), Slug: "g", OtherOwners: 0}}},
	}
	act := &fakeActivity{}
	search := &fakeSearch{}
	a := NewAccountAnonymizer(repo, act, nil)
	a.SetSearchIndexer(search)
	// 21:30 UTC on 9 Dec is already 10 Dec in Istanbul.
	a.SetClock(func() time.Time { return time.Date(2026, 12, 9, 21, 30, 0, 0, time.UTC) })

	n, err := a.AnonymizeDue(context.Background())
	if err != nil || n != 2 {
		t.Fatalf("anonymized %d, err %v", n, err)
	}
	if repo.today != "2026-12-10" {
		t.Fatalf("today must be the Istanbul day, got %s", repo.today)
	}
	for _, id := range []int64{1, 2} {
		ident := repo.scrubbed[id]
		if !strings.HasSuffix(ident.Email, "@anonymized.invalid") || ident.Name != AnonymizedName || ident.PasswordHash == "" {
			t.Fatalf("user %d identity: %+v", id, ident)
		}
	}
	if repo.scrubbed[1].Email == repo.scrubbed[2].Email {
		t.Fatal("anonymized emails must be unique")
	}
	if len(search.deleted) != 2 {
		t.Fatalf("search deletes: %v", search.deleted)
	}
	actions := map[string]int{}
	for _, ev := range act.events {
		actions[ev.action]++
		if ev.actor != nil {
			t.Fatal("anonymization is a system action")
		}
	}
	if actions["auth.account_anonymized"] != 2 || actions["organizations.owner_anonymized"] != 1 {
		t.Fatalf("activity: %v", actions)
	}
	if n, err := a.AnonymizeDue(context.Background()); err != nil || n != 0 {
		t.Fatalf("second run: %d %v", n, err)
	}
}

func TestAnonymizeDueSkipsFailures(t *testing.T) {
	boom := errors.New("db down")
	repo := &anonRepo{
		due:      []int64{1, 2},
		users:    map[int64]model.User{1: {ID: 1, UUID: uuid.New()}, 2: {ID: 2, UUID: uuid.New()}},
		scrubbed: map[int64]model.AnonymizedIdentity{},
		fail:     map[int64]error{1: boom},
	}
	a := NewAccountAnonymizer(repo, nil, nil)
	n, err := a.AnonymizeDue(context.Background())
	if n != 1 || !errors.Is(err, boom) {
		t.Fatalf("got %d %v", n, err)
	}
}
