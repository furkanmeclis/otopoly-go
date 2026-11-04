/** Profile / account hooks (sessions, 2FA status, notification preferences). */
import { useQuery } from '@tanstack/react-query';

import { authService } from '@/features/account/services/auth.service';
import { notificationPreferencesService } from '@/features/account/services/notification-preferences.service';
import { tenantNotificationPreferencesService } from '@/features/account/services/tenant-notification-preferences.service';
import { qk } from '@/features/queries';

export const accountKeys = {
  sessions: [...qk.account, 'sessions'] as const,
  totp: [...qk.account, 'totp'] as const,
  prefs: [...qk.account, 'notification-preferences'] as const,
  tenantPrefs: [...qk.account, 'tenant-notification-preferences'] as const,
  identities: [...qk.account, 'identities'] as const,
};

export const useSessions = () => useQuery({ queryKey: accountKeys.sessions, queryFn: async () => (await authService.listSessions()).items ?? [] });
export const useTotpStatus = () => useQuery({ queryKey: accountKeys.totp, queryFn: () => authService.getTOTPStatus(), retry: false });
export const useNotificationPreferences = () => useQuery({ queryKey: accountKeys.prefs, queryFn: () => notificationPreferencesService.get() });
export const useTenantNotificationPreferences = () => useQuery({ queryKey: accountKeys.tenantPrefs, queryFn: () => tenantNotificationPreferencesService.get() });
