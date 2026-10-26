// Package usecase manages the platform APNs key (Platform → Entegrasyonlar →
// Apple → Apple Push) used for iOS Live Activity pushes (modules/livepush).
//
// The .p8 is sealed with the integration SecretBox and never returned or
// logged; the API exposes ids, a public-key fingerprint and the source in
// use (database first, APNS_* env fallback).
package usecase

import (
	"context"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"time"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database/db"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/apns"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/appleauth"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/crypto"
	"github.com/jackc/pgx/v5/pgtype"
)

// ErrInvalidRequest wraps validation failures (see FieldError).
var ErrInvalidRequest = errors.New("invalid request")

// FieldError is a validation failure of one input field.
type FieldError struct {
	Field   string
	Code    string
	Message string
}

func (e *FieldError) Error() string { return e.Field + ": " + e.Message }

// Unwrap makes errors.Is(err, ErrInvalidRequest) true.
func (e *FieldError) Unwrap() error { return ErrInvalidRequest }

func fieldErr(field, code, msg string) error {
	return &FieldError{Field: field, Code: code, Message: msg}
}

// Team id sources reported in Status.TeamIDSource.
const (
	TeamFromDatabase = "database"
	TeamFromApple    = "apple_integration"
	TeamFromEnv      = "env"
	TeamNone         = "none"
)

const maxKeyBytes = 16 << 10

var (
	appleIDPattern = regexp.MustCompile(`^[A-Z0-9]{10}$`)
	bundlePattern  = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9\-]*(\.[A-Za-z0-9][A-Za-z0-9\-]*)+$`)
)

// Store is the persistence the service needs (*db.Queries satisfies it).
type Store interface {
	GetPlatformAPNsSettings(ctx context.Context) (db.PlatformApnsSetting, error)
	SavePlatformAPNsSettings(ctx context.Context, arg db.SavePlatformAPNsSettingsParams) (db.PlatformApnsSetting, error)
	ClearPlatformAPNsSettings(ctx context.Context, updatedBy pgtype.Int8) (db.PlatformApnsSetting, error)
	RecordPlatformAPNsTest(ctx context.Context, arg db.RecordPlatformAPNsTestParams) (db.PlatformApnsSetting, error)
	GetOAuthProviderSettings(ctx context.Context, provider string) (db.OauthProviderSetting, error)
}

// Keys is the runtime resolver (*apns.Resolver).
type Keys interface {
	Active(ctx context.Context) apns.Info
	EnvInfo() apns.Info
	Probe(ctx context.Context) (apns.Info, apns.ProbeResult)
	Invalidate()
}

// Service manages the platform_apns_settings singleton.
type Service struct {
	q    Store
	box  *crypto.SecretBox
	keys Keys
}

// New builds the service.
func New(q Store, box *crypto.SecretBox) *Service { return &Service{q: q, box: box} }

// SetKeys attaches the runtime resolver (status, test, cache invalidation).
func (s *Service) SetKeys(k Keys) { s.keys = k }

// ActiveKey describes the credentials pushes use right now.
type ActiveKey struct {
	KeyID          string `json:"key_id"`
	TeamID         string `json:"team_id"`
	BundleID       string `json:"bundle_id"`
	Environment    string `json:"environment"`
	Host           string `json:"host"`
	KeyFingerprint string `json:"key_fingerprint"`
}

// TestResult is the outcome of a connection test.
type TestResult struct {
	OK          bool      `json:"ok"`
	Verdict     string    `json:"verdict"`
	Status      *int      `json:"status,omitempty"`
	Reason      string    `json:"reason"`
	Source      string    `json:"source"`
	Environment string    `json:"environment"`
	Host        string    `json:"host,omitempty"`
	Error       string    `json:"error,omitempty"`
	TestedAt    time.Time `json:"tested_at"`
}

// Status is the admin payload (never the key).
type Status struct {
	// Source is what pushes use: database, env or none.
	Source string `json:"source"`
	// Stored reports a key uploaded from the panel.
	Stored         bool       `json:"stored"`
	KeyID          string     `json:"key_id"`
	TeamID         string     `json:"team_id"`
	TeamIDSource   string     `json:"team_id_source"`
	EffectiveTeam  string     `json:"effective_team_id"`
	BundleID       string     `json:"bundle_id"`
	Environment    string     `json:"environment"`
	KeyFingerprint string     `json:"key_fingerprint"`
	UploadedAt     *time.Time `json:"uploaded_at"`
	UpdatedAt      *time.Time `json:"updated_at"`
	EnvConfigured  bool       `json:"env_configured"`
	// Active is nil when no key is configured anywhere.
	Active   *ActiveKey  `json:"active"`
	LastTest *TestResult `json:"last_test"`
}

// SaveInput uploads or edits the key. PrivateKey may be empty when a key is
// already stored (only the other fields change).
type SaveInput struct {
	KeyID       string `json:"key_id"`
	TeamID      string `json:"team_id"`
	BundleID    string `json:"bundle_id"`
	Environment string `json:"environment"`
	PrivateKey  string `json:"private_key"`
}

func hasKey(row db.PlatformApnsSetting) bool {
	return row.PrivateKeyEnc.Valid && row.PrivateKeyEnc.String != ""
}

func tsPtr(t pgtype.Timestamptz) *time.Time {
	if !t.Valid {
		return nil
	}
	v := t.Time
	return &v
}

// appleTeamID is the Sign in with Apple integration team id ("" if unset).
func (s *Service) appleTeamID(ctx context.Context) string {
	row, err := s.q.GetOAuthProviderSettings(ctx, "apple")
	if err != nil {
		return ""
	}
	return strings.ToUpper(strings.TrimSpace(row.AppleTeamID))
}

// effectiveTeam resolves the team id: stored, Apple integration, env.
func (s *Service) effectiveTeam(ctx context.Context, row db.PlatformApnsSetting) (string, string) {
	if t := strings.TrimSpace(row.TeamID); t != "" {
		return t, TeamFromDatabase
	}
	if t := s.appleTeamID(ctx); t != "" {
		return t, TeamFromApple
	}
	if s.keys != nil {
		if t := s.keys.EnvInfo().TeamID; t != "" {
			return t, TeamFromEnv
		}
	}
	return "", TeamNone
}

// APNsKey returns the stored key (implements apns.KeySource). The team id
// falls back to the Apple integration's; an empty one means env.
func (s *Service) APNsKey(ctx context.Context) (apns.Config, bool, error) {
	row, err := s.q.GetPlatformAPNsSettings(ctx)
	if err != nil {
		return apns.Config{}, false, err
	}
	if !hasKey(row) {
		return apns.Config{}, false, nil
	}
	if s.box == nil {
		return apns.Config{}, false, errors.New("apns key: encryption unavailable")
	}
	pemText, err := s.box.Decrypt(row.PrivateKeyEnc.String)
	if err != nil {
		return apns.Config{}, false, fmt.Errorf("decrypt apns key: %w", err)
	}
	team := strings.TrimSpace(row.TeamID)
	if team == "" {
		team = s.appleTeamID(ctx)
	}
	return apns.Config{
		KeyID: row.KeyID, TeamID: team, PrivateKey: pemText,
		BundleID: row.BundleID, Environment: row.Environment,
	}, true, nil
}

// Get returns the masked status.
func (s *Service) Get(ctx context.Context) (Status, error) {
	row, err := s.q.GetPlatformAPNsSettings(ctx)
	if err != nil {
		return Status{}, err
	}
	return s.status(ctx, row), nil
}

func (s *Service) status(ctx context.Context, row db.PlatformApnsSetting) Status {
	team, teamSrc := s.effectiveTeam(ctx, row)
	out := Status{
		Source:        apns.SourceNone,
		Stored:        hasKey(row),
		KeyID:         row.KeyID,
		TeamID:        row.TeamID,
		TeamIDSource:  teamSrc,
		EffectiveTeam: team,
		BundleID:      row.BundleID,
		Environment:   apns.NormalizeEnvironment(row.Environment),
		UploadedAt:    tsPtr(row.UploadedAt),
		UpdatedAt:     tsPtr(row.UpdatedAt),
	}
	if out.Stored && s.box != nil {
		if pemText, err := s.box.Decrypt(row.PrivateKeyEnc.String); err == nil {
			out.KeyFingerprint = apns.KeyFingerprint(pemText)
		}
	}
	if s.keys != nil {
		out.EnvConfigured = s.keys.EnvInfo().Source == apns.SourceEnv
		if info := s.keys.Active(ctx); info.Source != apns.SourceNone {
			out.Source = info.Source
			out.Active = &ActiveKey{
				KeyID: info.KeyID, TeamID: info.TeamID, BundleID: info.BundleID,
				Environment: info.Environment, Host: info.Host, KeyFingerprint: info.Fingerprint,
			}
		}
	}
	if row.LastTestAt.Valid {
		lt := &TestResult{
			OK:          row.LastTestOk.Valid && row.LastTestOk.Bool,
			Verdict:     row.LastTestVerdict,
			Reason:      row.LastTestReason,
			Source:      row.LastTestSource,
			Environment: row.LastTestEnvironment,
			TestedAt:    row.LastTestAt.Time,
		}
		if row.LastTestStatus.Valid {
			st := int(row.LastTestStatus.Int32)
			lt.Status = &st
		}
		out.LastTest = lt
	}
	return out
}

func actor(id *int64) pgtype.Int8 {
	if id == nil {
		return pgtype.Int8{}
	}
	return pgtype.Int8{Int64: *id, Valid: true}
}

// Validate normalizes the input; a non-nil error is a *FieldError.
func Validate(in SaveInput, keyStored bool) (SaveInput, error) {
	out := SaveInput{
		KeyID:       strings.ToUpper(strings.TrimSpace(in.KeyID)),
		TeamID:      strings.ToUpper(strings.TrimSpace(in.TeamID)),
		BundleID:    strings.TrimSpace(in.BundleID),
		Environment: strings.ToLower(strings.TrimSpace(in.Environment)),
		PrivateKey:  strings.TrimSpace(in.PrivateKey),
	}
	if out.BundleID == "" {
		out.BundleID = apns.DefaultBundleID
	}
	if out.Environment == "" {
		out.Environment = "production"
	}
	switch {
	case !appleIDPattern.MatchString(out.KeyID):
		return out, fieldErr("key_id", "invalid", "key_id must be 10 letters or digits")
	case out.TeamID != "" && !appleIDPattern.MatchString(out.TeamID):
		return out, fieldErr("team_id", "invalid", "team_id must be 10 letters or digits")
	case len(out.BundleID) > 155 || !bundlePattern.MatchString(out.BundleID):
		return out, fieldErr("bundle_id", "invalid", "bundle_id must be a reverse-DNS bundle identifier")
	case out.Environment != "production" && out.Environment != "sandbox":
		return out, fieldErr("environment", "invalid", "environment must be production or sandbox")
	case out.PrivateKey == "" && !keyStored:
		return out, fieldErr("private_key", "required", "private_key (.p8) is required")
	case len(out.PrivateKey) > maxKeyBytes:
		return out, fieldErr("private_key", "invalid", "private_key is too large")
	}
	if out.PrivateKey != "" {
		if _, err := appleauth.ParsePrivateKey(out.PrivateKey); err != nil {
			return out, fieldErr("private_key", "invalid", "private_key must be an Apple .p8 key (PEM, PKCS#8, EC P-256 / ES256)")
		}
	}
	return out, nil
}

// SaveResult is the saved status plus what changed (activity log).
type SaveResult struct {
	Status      Status
	KeyUploaded bool
}

// Save stores the key / fields and drops the runtime cache.
func (s *Service) Save(ctx context.Context, actorID *int64, in SaveInput) (SaveResult, error) {
	row, err := s.q.GetPlatformAPNsSettings(ctx)
	if err != nil {
		return SaveResult{}, err
	}
	in, err = Validate(in, hasKey(row))
	if err != nil {
		return SaveResult{}, err
	}
	params := db.SavePlatformAPNsSettingsParams{
		KeyID: in.KeyID, TeamID: in.TeamID, BundleID: in.BundleID, Environment: in.Environment,
		UpdatedBy: actor(actorID),
	}
	if in.PrivateKey != "" {
		if s.box == nil {
			return SaveResult{}, errors.New("apns key: encryption unavailable")
		}
		enc, err := s.box.Encrypt(in.PrivateKey)
		if err != nil {
			return SaveResult{}, err
		}
		params.PrivateKeyEnc = pgtype.Text{String: enc, Valid: true}
	}
	row, err = s.q.SavePlatformAPNsSettings(ctx, params)
	if err != nil {
		return SaveResult{}, err
	}
	if s.keys != nil {
		s.keys.Invalidate()
	}
	return SaveResult{Status: s.status(ctx, row), KeyUploaded: in.PrivateKey != ""}, nil
}

// Delete removes the stored key (env, if set, takes over).
func (s *Service) Delete(ctx context.Context, actorID *int64) (Status, error) {
	row, err := s.q.ClearPlatformAPNsSettings(ctx, actor(actorID))
	if err != nil {
		return Status{}, err
	}
	if s.keys != nil {
		s.keys.Invalidate()
	}
	return s.status(ctx, row), nil
}

// Test signs a provider token and sends one push to an impossible device
// token with the active credentials, then records the outcome.
func (s *Service) Test(ctx context.Context) (TestResult, error) {
	now := time.Now().UTC()
	if s.keys == nil {
		return TestResult{Verdict: apns.VerdictNotConfigured, Source: apns.SourceNone, TestedAt: now}, nil
	}
	s.keys.Invalidate()
	info, probe := s.keys.Probe(ctx)
	out := TestResult{
		OK: probe.OK, Verdict: probe.Verdict, Reason: probe.Reason, Source: info.Source,
		Environment: info.Environment, Host: info.Host, Error: probe.Error, TestedAt: now,
	}
	if probe.Status != 0 {
		st := probe.Status
		out.Status = &st
	}
	if probe.Verdict == apns.VerdictNotConfigured {
		return out, nil
	}
	params := db.RecordPlatformAPNsTestParams{
		LastTestOk: pgtype.Bool{Bool: probe.OK, Valid: true}, LastTestReason: probe.Reason,
		LastTestVerdict: probe.Verdict, LastTestSource: info.Source, LastTestEnvironment: info.Environment,
	}
	if probe.Status != 0 {
		params.LastTestStatus = pgtype.Int4{Int32: int32(probe.Status), Valid: true}
	}
	if row, err := s.q.RecordPlatformAPNsTest(ctx, params); err == nil && row.LastTestAt.Valid {
		out.TestedAt = row.LastTestAt.Time
	}
	return out, nil
}
