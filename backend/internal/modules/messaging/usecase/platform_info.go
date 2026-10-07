package usecase

import (
	"context"
	"net/url"
	"strings"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database/db"
)

// Catalog variables carrying the platform's own identity in platform-number
// messages (e.g. the contract OTP KVKK notice).
const (
	VarPlatformName = "platform_name"
	VarPlatformURL  = "platform_url"
)

// PlatformInfo is the platform brand shown in platform-number messages.
type PlatformInfo struct {
	Name string
	URL  string
}

// PlatformInfoFunc resolves the platform brand at send time.
type PlatformInfoFunc func(ctx context.Context) PlatformInfo

// SetPlatformInfo installs the platform brand source (nil: no brand vars).
func (s *Service) SetPlatformInfo(fn PlatformInfoFunc) *Service {
	s.platformInfo = fn
	return s
}

// withPlatformInfo returns a copy of vars with platform_name / platform_url
// filled (caller-supplied values win).
func (s *Service) withPlatformInfo(ctx context.Context, vars map[string]string) map[string]string {
	out := make(map[string]string, len(vars)+2)
	for k, v := range vars {
		out[k] = v
	}
	if s.platformInfo == nil {
		return out
	}
	info := s.platformInfo(ctx)
	if strings.TrimSpace(out[VarPlatformName]) == "" {
		out[VarPlatformName] = info.Name
	}
	if strings.TrimSpace(out[VarPlatformURL]) == "" {
		out[VarPlatformURL] = info.URL
	}
	return out
}

// AppSettingsReader reads the platform letterhead (app_settings).
type AppSettingsReader interface {
	GetAppSettings(ctx context.Context) (db.AppSetting, error)
}

// AppSettingsPlatformInfo uses the platform letterhead company name (platform
// settings) and PUBLIC_FRONTEND_URL; the letterhead website and the URL host
// are fallbacks.
func AppSettingsPlatformInfo(q AppSettingsReader, publicFrontendURL string) PlatformInfoFunc {
	base := strings.TrimRight(strings.TrimSpace(publicFrontendURL), "/")
	return func(ctx context.Context) PlatformInfo {
		info := PlatformInfo{URL: base}
		if row, err := q.GetAppSettings(ctx); err == nil {
			info.Name = strings.TrimSpace(row.CompanyName)
			if info.URL == "" {
				info.URL = strings.TrimRight(strings.TrimSpace(row.Website), "/")
			}
		}
		if info.Name == "" {
			if u, err := url.Parse(info.URL); err == nil {
				info.Name = u.Hostname()
			}
		}
		return info
	}
}
