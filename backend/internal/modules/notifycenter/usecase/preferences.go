package usecase

import (
	"context"
	"errors"
	"fmt"
	"regexp"
	"strings"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database/db"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/notifycenter/model"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/authctx"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/msgtemplate"
	"github.com/jackc/pgx/v5"
)

var phoneRE = regexp.MustCompile(`^\+?[0-9 ()-]{7,20}$`)

// DefaultPrefs are the preferences without a stored row: in-app on, e-mail and
// SMS off, WhatsApp on only when the member saved a phone number.
func DefaultPrefs(phone string) model.ChannelPrefs {
	return model.ChannelPrefs{Inapp: true, WhatsApp: strings.TrimSpace(phone) != ""}
}

func (s *Service) userPrefs(ctx context.Context, userID, orgID int64, kind, phone string) (model.ChannelPrefs, error) {
	row, err := s.q.GetNotificationTypePreference(ctx, db.GetNotificationTypePreferenceParams{
		UserID: userID, OrganizationID: orgID, NotificationType: kind,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return DefaultPrefs(phone), nil
	}
	if err != nil {
		return model.ChannelPrefs{}, err
	}
	return model.ChannelPrefs{Inapp: row.InappEnabled, Email: row.EmailEnabled, WhatsApp: row.WhatsappEnabled, SMS: row.SmsEnabled}, nil
}

func (s *Service) actor(ctx context.Context) (int64, int64, error) {
	orgID, err := s.orgID(ctx, 0)
	if err != nil {
		return 0, 0, err
	}
	p, ok := authctx.PrincipalFrom(ctx)
	if !ok || p.UserInternal <= 0 {
		return 0, 0, fmt.Errorf("%w: authentication required", ErrInvalidRequest)
	}
	return orgID, p.UserInternal, nil
}

// GetPreferences returns the caller's per-type channel preferences in the org.
func (s *Service) GetPreferences(ctx context.Context) (model.Preferences, error) {
	orgID, userID, err := s.actor(ctx)
	if err != nil {
		return model.Preferences{}, err
	}
	return s.preferences(ctx, orgID, userID)
}

func (s *Service) preferences(ctx context.Context, orgID, userID int64) (model.Preferences, error) {
	out := model.Preferences{Types: []model.TypePreference{}}
	if ms, err := s.q.GetNotificationMemberSettings(ctx, db.GetNotificationMemberSettingsParams{UserID: userID, OrganizationID: orgID}); err == nil {
		out.Phone = ms.Phone
	} else if !errors.Is(err, pgx.ErrNoRows) {
		return out, err
	}
	rows, err := s.q.ListNotificationTypePreferences(ctx, db.ListNotificationTypePreferencesParams{UserID: userID, OrganizationID: orgID})
	if err != nil {
		return out, err
	}
	stored := make(map[string]db.NotificationTypePreference, len(rows))
	for _, r := range rows {
		stored[r.NotificationType] = r
	}
	for _, spec := range msgtemplate.UserPreferenceTypes() {
		tp := model.TypePreference{Type: spec.Type, Channels: spec.Channels, Prefs: DefaultPrefs(out.Phone)}
		if r, ok := stored[spec.Type]; ok {
			tp.Custom = true
			tp.Prefs = model.ChannelPrefs{Inapp: r.InappEnabled, Email: r.EmailEnabled, WhatsApp: r.WhatsappEnabled, SMS: r.SmsEnabled}
		}
		out.Types = append(out.Types, tp)
	}
	return out, nil
}

// UpdatePreferences saves the phone and per-type switches.
func (s *Service) UpdatePreferences(ctx context.Context, in model.PreferencesInput) (model.Preferences, error) {
	orgID, userID, err := s.actor(ctx)
	if err != nil {
		return model.Preferences{}, err
	}
	phone := ""
	if ms, err := s.q.GetNotificationMemberSettings(ctx, db.GetNotificationMemberSettingsParams{UserID: userID, OrganizationID: orgID}); err == nil {
		phone = ms.Phone
	}
	if in.Phone != nil {
		phone = strings.TrimSpace(*in.Phone)
		if phone != "" && !phoneRE.MatchString(phone) {
			return model.Preferences{}, invalid("phone is invalid")
		}
		if _, err := s.q.UpsertNotificationMemberSettings(ctx, db.UpsertNotificationMemberSettingsParams{
			UserID: userID, OrganizationID: orgID, Phone: phone,
		}); err != nil {
			return model.Preferences{}, err
		}
	}
	for _, t := range in.Types {
		spec, ok := msgtemplate.Lookup(t.Type)
		if !ok || !spec.UserPreference {
			return model.Preferences{}, invalid("unknown notification type %q", t.Type)
		}
		p := t.Prefs
		if (p.WhatsApp || p.SMS) && phone == "" {
			return model.Preferences{}, invalid("a phone number is required for WhatsApp/SMS")
		}
		if _, err := s.q.UpsertNotificationTypePreference(ctx, db.UpsertNotificationTypePreferenceParams{
			UserID: userID, OrganizationID: orgID, NotificationType: t.Type,
			InappEnabled:    p.Inapp && spec.HasChannel(model.ChannelInapp),
			EmailEnabled:    p.Email && spec.HasChannel(model.ChannelEmail),
			WhatsappEnabled: p.WhatsApp && spec.HasChannel(model.ChannelWhatsApp),
			SmsEnabled:      p.SMS && spec.HasChannel(model.ChannelSMS),
		}); err != nil {
			return model.Preferences{}, err
		}
	}
	return s.preferences(ctx, orgID, userID)
}
