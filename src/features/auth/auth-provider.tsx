import { useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { setAuthFailureHandler } from '@/api/client';
import { isApiError } from '@/api/errors';
import { session } from '@/api/session';
import { isMock } from '@/config/env';
import { authService, type Me, type OrganizationMembership } from '@/features/account/services/auth.service';
import { useLocale } from '@/lib/i18n/provider';
import { isSupportedLocale } from '@/lib/i18n/translate';
import { createLogger } from '@/lib/logger';

import type { Gate, Permission } from './permissions';

const log = createLogger('auth');

export type AuthStatus = 'booting' | 'signedOut' | 'selectOrg' | 'ready';

/** Why the active organization can't be used (mirrors web TenantRouteGuard states). */
export type OrgBlock = 'expired' | 'suspended' | null;

type AuthContextValue = {
  status: AuthStatus;
  me: Me | null;
  organization: OrganizationMembership | null;
  isOwner: boolean;
  permissions: ReadonlySet<string>;
  can: (gate: Permission | Gate | undefined) => boolean;
  login: (email: string, password: string, totpCode?: string) => Promise<void>;
  selectOrganization: (slug: string) => Promise<void>;
  switchOrganization: () => void;
  logout: () => Promise<void>;
  refreshMe: () => Promise<void>;
  orgBlock: (org: OrganizationMembership) => OrgBlock;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function orgBlock(org: OrganizationMembership): OrgBlock {
  if (org.status === 'suspended') return 'suspended';
  if (org.status === 'expired') return 'expired';
  if (org.access_ends_at && new Date(org.access_ends_at).getTime() <= Date.now()) return 'expired';
  return null;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const { locale, setLocale } = useLocale();
  const [status, setStatus] = useState<AuthStatus>('booting');
  const [me, setMe] = useState<Me | null>(null);
  const [orgSlug, setOrgSlug] = useState<string | null>(null);
  const booted = useRef(false);

  const reset = useCallback(
    async (reason: string) => {
      await session.clear(reason);
      queryClient.clear();
      setMe(null);
      setOrgSlug(null);
      setStatus('signedOut');
    },
    [queryClient],
  );

  /** Adopt the user's saved locale from the backend profile (web behaviour). */
  const syncLocale = useCallback(
    (profile: Me) => {
      const userLocale = profile.user.locale;
      if (isSupportedLocale(userLocale) && userLocale !== locale) setLocale(userLocale);
    },
    [locale, setLocale],
  );

  const enterOrganization = useCallback(
    async (profile: Me, slug: string) => {
      const membership = profile.organizations?.find((o) => o.slug === slug);
      if (!membership) throw new Error('NO_TENANT_MEMBERSHIP');
      const tokens = await authService.switchOrganizationContext(slug);
      await session.setTokens(tokens, slug);
      const scoped = await authService.getMe();
      setMe(scoped);
      setOrgSlug(slug);
      setStatus('ready');
      log.info('Organization entered', { slug, role: membership.role });
    },
    [],
  );

  /** After a fresh profile load decide: straight into the org, or ask the user to pick. */
  const route = useCallback(
    async (profile: Me, preferredSlug: string | null) => {
      const orgs = profile.organizations ?? [];
      const usable = orgs.filter((o) => !orgBlock(o));
      const preferred = preferredSlug ? usable.find((o) => o.slug === preferredSlug) : null;
      const target = preferred ?? (orgs.length === 1 && usable.length === 1 ? usable[0] : null);
      if (target) {
        await enterOrganization(profile, target.slug);
      } else {
        setMe(profile);
        setOrgSlug(null);
        setStatus('selectOrg');
      }
    },
    [enterOrganization],
  );

  useEffect(() => {
    if (booted.current) return;
    booted.current = true;
    (async () => {
      try {
        if (isMock) {
          const { installMockTransport } = await import('@/api/mock');
          await installMockTransport();
        }
        const stored = await session.load();
        if (!stored) {
          setStatus('signedOut');
          return;
        }
        const profile = await authService.getMe();
        syncLocale(profile);
        await route(profile, stored.organizationSlug);
      } catch (error) {
        log.warn('Session restore failed', error);
        await reset('restore_failed');
      }
    })();
  }, [reset, route, syncLocale]);

  useEffect(() => {
    setAuthFailureHandler(() => {
      log.warn('Auth failure — signing out');
      queryClient.clear();
      setMe(null);
      setOrgSlug(null);
      setStatus('signedOut');
    });
    return () => setAuthFailureHandler(null);
  }, [queryClient]);

  const login = useCallback(
    async (email: string, password: string, totpCode?: string) => {
      log.info('Login attempt', { email });
      const tokens = await authService.login({ email: email.trim(), password, ...(totpCode ? { totp_code: totpCode } : {}) });
      await session.setTokens(tokens, null);
      try {
        const profile = await authService.getMe();
        syncLocale(profile);
        await route(profile, null);
        log.info('Login succeeded', { organizations: profile.organizations?.length ?? 0 });
      } catch (error) {
        await reset('post_login_failed');
        throw error;
      }
    },
    [reset, route, syncLocale],
  );

  const selectOrganization = useCallback(
    async (slug: string) => {
      if (!me) return;
      await enterOrganization(me, slug);
      queryClient.clear();
    },
    [enterOrganization, me, queryClient],
  );

  const switchOrganization = useCallback(() => {
    log.info('Switch organization requested');
    queryClient.clear();
    setOrgSlug(null);
    setStatus('selectOrg');
  }, [queryClient]);

  const logout = useCallback(async () => {
    const s = session.get();
    if (s?.refreshToken) {
      try {
        await authService.logout(s.refreshToken);
      } catch (error) {
        // Local sign-out must always succeed even if the server call fails.
        log.warn('Server logout failed', isApiError(error) ? error.code : error);
      }
    }
    await reset('logout');
    log.info('Logged out');
  }, [reset]);

  const refreshMe = useCallback(async () => {
    const profile = await authService.getMe();
    setMe(profile);
  }, []);

  const value = useMemo<AuthContextValue>(() => {
    const permissions = new Set(me?.permissions ?? []);
    const organization = me?.organizations?.find((o) => o.slug === orgSlug) ?? null;
    const isOwner = organization?.role === 'owner';
    const can = (gate: Permission | Gate | undefined) => {
      if (!gate) return true;
      const g: Gate = typeof gate === 'string' ? { perm: gate } : gate;
      if (g.perm && !permissions.has(g.perm)) return false;
      if (g.owner && !isOwner) return false;
      return true;
    };
    return {
      status,
      me,
      organization,
      isOwner,
      permissions,
      can,
      login,
      selectOrganization,
      switchOrganization,
      logout,
      refreshMe,
      orgBlock,
    };
  }, [status, me, orgSlug, login, selectOrganization, switchOrganization, logout, refreshMe]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}

export function useCan(gate: Permission | Gate | undefined) {
  return useAuth().can(gate);
}
