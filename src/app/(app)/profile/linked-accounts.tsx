/**
 * Profile → Bağlı hesaplar. Web `OAuthIdentityManager` (account profile page): list the linked
 * Apple / Google sign-ins, link one with the native sheet, unlink. `OAUTH_ACCOUNT_NOT_LINKED` on the
 * sign-in screen sends the user here after they sign in the usual way.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams } from 'expo-router';
import { Info, Link2, Unlink } from 'lucide-react-native';
import { useState } from 'react';
import { View } from 'react-native';

import { isApiError } from '@/api/errors';
import { demoIdToken, type DemoIdentity } from '@/api/mock/demo-auth';
import { useToast } from '@/components/feedback/toast';
import { Badge, Button, Card, ErrorState, Header, ListSkeleton, Row, Screen, Txt, useConfirm } from '@/components/ui';
import { isMock } from '@/config/env';
import { identityErrorKey, LINKABLE_PROVIDERS, unlinkBlock } from '@/features/account/lib/identities';
import { accountKeys } from '@/features/account/queries';
import { identitiesService, type LinkedIdentity } from '@/features/account/services/identities.service';
import { DemoIdentitySheet } from '@/features/auth/components/oauth-sheets';
import { AppleLogo, GoogleLogo, useSocialProviders } from '@/features/auth/components/social-buttons';
import { PROVIDER_NAME } from '@/features/auth/lib/auth-errors';
import { signInWithAppleNative, signInWithGoogleNative } from '@/features/auth/native/social';
import type { NativeOAuthInput, OAuthProvider } from '@/features/auth/services/passwordless.service';
import { useLocale } from '@/lib/i18n/provider';
import { createLogger } from '@/lib/logger';
import { useTheme } from '@/theme/provider';

const log = createLogger('screen.profile.linked');

export default function LinkedAccountsScreen() {
  const t = useTheme();
  const { t: tr } = useLocale();
  const { provider: hinted } = useLocalSearchParams<{ provider?: string }>();
  const query = useQuery({ queryKey: accountKeys.identities, queryFn: identitiesService.list });
  const available = useSocialProviders();
  const [busy, setBusy] = useState<OAuthProvider | null>(null);
  const [demoProvider, setDemoProvider] = useState<OAuthProvider | null>(null);
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const hint = hinted === 'apple' || hinted === 'google' ? hinted : null;

  const fail = (error: unknown, fallback: string) => {
    const code = isApiError(error) ? error.code : undefined;
    const key = identityErrorKey(code);
    toast.error(fallback, key === 'common.error_generic' ? undefined : tr(key));
  };

  const finishLink = async (provider: OAuthProvider, input: NativeOAuthInput) => {
    setBusy(provider);
    try {
      await identitiesService.linkNative(provider, input);
      log.info('Identity linked', { provider });
      toast.success(tr('mobile.account.linked.link_success', { provider: PROVIDER_NAME[provider] }));
      await qc.invalidateQueries({ queryKey: accountKeys.identities });
    } catch (error) {
      log.warn('Link failed', { provider, code: isApiError(error) ? error.code : String(error) });
      fail(error, tr('auth.oauth.connect_error'));
    } finally {
      setBusy(null);
    }
  };

  const link = async (provider: OAuthProvider) => {
    if (isMock) {
      setDemoProvider(provider);
      return;
    }
    setBusy(provider);
    try {
      const input = provider === 'apple' ? await signInWithAppleNative() : await signInWithGoogleNative();
      if (!input) return; // cancelled in the native sheet
      await finishLink(provider, input);
    } catch (error) {
      log.warn('Native credential failed', { provider, error: String((error as Error)?.message ?? error) });
      toast.error(tr('auth.oauth.connect_error'));
    } finally {
      setBusy(null);
    }
  };

  const linkDemo = (identity: DemoIdentity) => {
    setDemoProvider(null);
    const nonce = Math.random().toString(36).slice(2);
    void finishLink(identity.provider, { id_token: demoIdToken(identity, nonce), nonce });
  };

  const unlink = async (provider: OAuthProvider) => {
    const ok = await confirm({
      title: tr('mobile.account.linked.unlink_title', { provider: PROVIDER_NAME[provider] }),
      message: tr('mobile.account.linked.unlink_body', { provider: PROVIDER_NAME[provider] }),
      destructive: true,
      confirmLabel: tr('auth.oauth.unlink'),
      cancelLabel: tr('common.cancel'),
    });
    if (!ok) return;
    setBusy(provider);
    try {
      await identitiesService.unlink(provider);
      log.info('Identity unlinked', { provider });
      toast.success(tr('auth.oauth.unlink_success'));
      await qc.invalidateQueries({ queryKey: accountKeys.identities });
    } catch (error) {
      log.warn('Unlink failed', { provider, code: isApiError(error) ? error.code : String(error) });
      fail(error, tr('auth.oauth.unlink_error'));
    } finally {
      setBusy(null);
    }
  };

  const items = query.data?.items ?? [];
  const offered = (p: OAuthProvider) => (p === 'apple' ? available.apple : available.google);

  return (
    <Screen header={<Header title={tr('auth.oauth.title')} subtitle={tr('auth.oauth.profile_hint')} />} refreshing={query.isRefetching} onRefresh={() => void query.refetch()}>
      {hint && !items.some((i) => i.provider === hint) ? (
        <Card style={{ flexDirection: 'row', gap: t.spacing.md, borderColor: t.colors.info }}>
          <Info size={18} color={t.colors.info} />
          <Txt variant="caption" tone="secondary" style={{ flex: 1 }} accessibilityLiveRegion="polite">
            {tr('mobile.account.linked.hint', { provider: PROVIDER_NAME[hint] })}
          </Txt>
        </Card>
      ) : null}
      {query.isLoading ? (
        <ListSkeleton rows={2} height={92} />
      ) : query.isError ? (
        <ErrorState onRetry={() => void query.refetch()} />
      ) : (
        <View style={{ gap: t.spacing.md }}>
          {LINKABLE_PROVIDERS.map((provider) => (
            <ProviderCard
              key={provider}
              provider={provider}
              identity={items.find((i) => i.provider === provider) ?? null}
              offered={offered(provider)}
              busy={busy}
              block={unlinkBlock(query.data, provider)}
              onLink={() => void link(provider)}
              onUnlink={() => void unlink(provider)}
            />
          ))}
          <Txt variant="caption" tone="muted">
            {tr('mobile.account.linked.footer')}
          </Txt>
        </View>
      )}
      <DemoIdentitySheet provider={demoProvider} onClose={() => setDemoProvider(null)} onPick={linkDemo} />
    </Screen>
  );
}

function ProviderCard({
  provider,
  identity,
  offered,
  busy,
  block,
  onLink,
  onUnlink,
}: {
  provider: OAuthProvider;
  identity: LinkedIdentity | null;
  offered: boolean;
  busy: OAuthProvider | null;
  block: ReturnType<typeof unlinkBlock>;
  onLink: () => void;
  onUnlink: () => void;
}) {
  const t = useTheme();
  const { t: tr, fmt } = useLocale();
  const name = tr(provider === 'apple' ? 'auth.apple.provider' : 'auth.google.provider');
  const pending = busy === provider;
  return (
    <Card style={{ gap: t.spacing.md }}>
      <Row gap={t.spacing.md} style={{ alignItems: 'center' }}>
        <View style={{ width: 36, height: 36, borderRadius: 18, borderWidth: 1, borderColor: t.colors.border, alignItems: 'center', justifyContent: 'center', backgroundColor: t.colors.surface }}>
          {provider === 'apple' ? <AppleLogo color={t.colors.text} /> : <GoogleLogo />}
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Row gap={t.spacing.sm}>
            <Txt variant="bodyStrong">{name}</Txt>
            {identity ? <Badge size="sm" tone="success" label={tr('auth.oauth.connected')} /> : null}
          </Row>
          <Txt variant="caption" tone="secondary">
            {identity ? tr('auth.oauth.linked_at', { date: fmt.dateTime(identity.linked_at) }) : offered ? tr('mobile.account.linked.not_linked') : tr('mobile.account.linked.unavailable')}
          </Txt>
        </View>
      </Row>
      {identity ? (
        <>
          {block ? (
            <Txt variant="caption" tone="muted">
              {tr('mobile.account.linked.last_method')}
            </Txt>
          ) : null}
          <Button
            label={pending ? tr('auth.oauth.unlinking') : tr('auth.oauth.unlink')}
            variant="outline"
            size="sm"
            icon={<Unlink size={16} color={t.colors.text} />}
            loading={pending}
            disabled={Boolean(block) || (busy !== null && !pending)}
            onPress={onUnlink}
          />
        </>
      ) : offered ? (
        <Button
          label={pending ? tr('auth.oauth.connecting') : tr(provider === 'apple' ? 'auth.apple.connect' : 'auth.google.connect')}
          variant="secondary"
          size="sm"
          icon={<Link2 size={16} color={t.colors.primary} />}
          loading={pending}
          disabled={busy !== null && !pending}
          onPress={onLink}
        />
      ) : null}
    </Card>
  );
}
