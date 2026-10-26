import { useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { setAuthFailureHandler } from '@/api/client';
import { isApiError } from '@/api/errors';
import { session, type Tokens } from '@/api/session';
import { isMock } from '@/config/env';
import { authService, type Me, type OrganizationMembership } from '@/features/account/services/auth.service';
import { useLocale } from '@/lib/i18n/provider';
import { isSupportedLocale } from '@/lib/i18n/translate';
import { createLogger } from '@/lib/logger';
import { setMonitoringUser } from '@/lib/monitoring';
import { clearWidgetsForSignOut } from '@/features/widgets/bridge';
import { registerPushDevice, unregisterPushDevice } from '@/features/notifications/push';
import { loadIntroSeen, markIntroSeen as persistIntroSeen, subscribeIntroReset } from '@/features/onboarding/state';

import { orgBlock as accessBlock } from './lib/access';
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
  /** Finishes any sign-in (password, e-mail code, Apple / Google, account linking) with its token pair. */
  completeSignIn: (tokens: Tokens, options?: SignInOptions) => Promise<void>;
  selectOrganization: (slug: string) => Promise<void>;
  /**
   * Enters an organization the user just got (created in the app): reloads `/v1/auth/me` first, since
   * the cached profile doesn't list it yet. `prepare` runs with the organization token before the app
   * opens (e.g. adding starter services while the progress screen is still up).
   */
  enterNewOrganization: (slug: string, prepare?: () => Promise<void>) => Promise<void>;
  /** The intro carousel was shown on this device (read during boot, so there is no flicker). */
  introSeen: boolean;
  markIntroSeen: () => void;
  switchOrganization: () => void;
  /** `serverRevoked`: the server already ended every session (account deletion), only clear locally. */
  logout: (options?: { serverRevoked?: boolean }) => Promise<void>;
  refreshMe: () => Promise<void>;
  orgBlock: (org: OrganizationMembership) => OrgBlock;
};

export type SignInOptions = {
  /**
   * Runs with the new session's tokens before the profile is loaded and the user is routed (e.g. the
   * sign-up screen saves the name a code sign-up could not send). Failures are logged, never block sign-in.
   */
  prepare?: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

/** Why the organization can't be used (mirrors web TenantRouteGuard states; see `lib/access.ts`). */
export function orgBlock(org: OrganizationMembership): OrgBlock {
  return accessBlock(org);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const { locale, setLocale } = useLocale();
  const [status, setStatus] = useState<AuthStatus>('booting');
  const [me, setMe] = useState<Me | null>(null);
  const [orgSlug, setOrgSlug] = useState<string | null>(null);
  const [introSeen, setIntroSeen] = useState(false);
  const booted = useRef(false);

  const reset = useCallback(
    async (reason: string) => {
      await session.clear(reason);
      queryClient.clear();
      // No business figures may stay on the Home / Lock Screen after sign-out.
      clearWidgetsForSignOut();
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
    async (profile: Me, slug: string, prepare?: () => Promise<void>) => {
      const membership = profile.organizations?.find((o) => o.slug === slug);
      if (!membership) throw new Error('NO_TENANT_MEMBERSHIP');
      const tokens = await authService.switchOrganizationContext(slug);
      await session.setTokens(tokens, slug);
      if (prepare) await prepare();
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
        // Read before leaving `booting`, so a signed-out launch opens on the right screen at once.
        setIntroSeen(await loadIntroSeen());
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

  useEffect(() => subscribeIntroReset(() => setIntroSeen(false)), []);

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

  const completeSignIn = useCallback(
    async (tokens: Tokens, options?: SignInOptions) => {
      await session.setTokens(tokens, null);
      if (options?.prepare) {
        try {
          await options.prepare();
        } catch (error) {
          log.warn('Sign-in preparation failed', isApiError(error) ? error.code : error);
        }
      }
      try {
        const profile = await authService.getMe();
        syncLocale(profile);
        await route(profile, null);
        // Signed in once (also via a deep link that skipped it): the intro never needs to show again.
        setIntroSeen(true);
        void persistIntroSeen();
        log.info('Login succeeded', { organizations: profile.organizations?.length ?? 0 });
        // Never prompts and never throws; the in-app explanation sheet handles first-time permission.
        void registerPushDevice({ force: true });
      } catch (error) {
        await reset('post_login_failed');
        throw error;
      }
    },
    [reset, route, syncLocale],
  );

  const login = useCallback(
    async (email: string, password: string, totpCode?: string) => {
      log.info('Login attempt', { email });
      const tokens = await authService.login({ email: email.trim(), password, ...(totpCode ? { totp_code: totpCode } : {}) });
      await completeSignIn(tokens);
    },
    [completeSignIn],
  );

  const selectOrganization = useCallback(
    async (slug: string) => {
      if (!me) return;
      await enterOrganization(me, slug);
      queryClient.clear();
    },
    [enterOrganization, me, queryClient],
  );

  const enterNewOrganization = useCallback(
    async (slug: string, prepare?: () => Promise<void>) => {
      const profile = await authService.getMe();
      setMe(profile);
      await enterOrganization(profile, slug, prepare);
      queryClient.clear();
    },
    [enterOrganization, queryClient],
  );

  const markIntroSeen = useCallback(() => {
    setIntroSeen(true);
    void persistIntroSeen();
  }, []);

  const switchOrganization = useCallback(() => {
    log.info('Switch organization requested');
    queryClient.clear();
    setOrgSlug(null);
    setStatus('selectOrg');
  }, [queryClient]);

  const logout = useCallback(async (options?: { serverRevoked?: boolean }) => {
    // Push device must go while the access token is still valid (never throws). When the server already
    // revoked every session (account deletion) the caller unregistered beforehand; only forget it locally.
    await unregisterPushDevice({ localOnly: options?.serverRevoked });
    const s = session.get();
    if (s?.refreshToken && !options?.serverRevoked) {
      try {
        await authService.logout(s.refreshToken);
        // An expired access token makes the client refresh before replaying logout with the OLD refresh
        // token, which would leave the rotated one alive server-side — revoke that one as well.
        const rotated = session.get()?.refreshToken;
        if (rotated && rotated !== s.refreshToken) await authService.logout(rotated);
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

  // Error reports carry the opaque user uuid only (no e-mail / name); cleared on sign-out.
  const userId = me?.user.uuid ?? null;
  useEffect(() => {
    setMonitoringUser(userId);
  }, [userId]);

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
      completeSignIn,
      selectOrganization,
      enterNewOrganization,
      introSeen,
      markIntroSeen,
      switchOrganization,
      logout,
      refreshMe,
      orgBlock,
    };
  }, [status, me, orgSlug, login, completeSignIn, selectOrganization, enterNewOrganization, introSeen, markIntroSeen, switchOrganization, logout, refreshMe]);

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
