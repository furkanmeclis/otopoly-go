import { Link2, UserPlus } from 'lucide-react-native';
import { useState } from 'react';
import { View } from 'react-native';

import { DEMO_IDENTITIES, type DemoIdentity } from '@/api/mock/demo-auth';
import { Button, Card, Group, ListRow, Sheet, Txt } from '@/components/ui';
import { PROVIDER_NAME, type LinkChoice } from '@/features/auth/lib/auth-errors';
import { passwordlessService, type OAuthProvider } from '@/features/auth/services/passwordless.service';
import type { SignInFlow } from '@/features/auth/use-sign-in-flow';
import { useLocale } from '@/lib/i18n/provider';
import { useTheme } from '@/theme/provider';

import { Notice } from './code-entry';
import { EmailCodeForm } from './email-code-form';

/**
 * `409 OAUTH_LINK_CHOICE_REQUIRED` (Apple private relay, no account): "Hesabım var mı?"
 *   Yes → account e-mail → code → `/oauth/link/verify` (links Apple to that account)
 *   No  → `/oauth/link/create` (hidden when `register_allowed` is "false")
 * MFA and success are handled by the shared sign-in flow, which closes this sheet — on success before
 * the app routes on, waiting for `onDismissed`, so the native modal never outlives the login screen.
 */
export function LinkAccountSheet({ choice, flow }: { choice: LinkChoice | null; flow: SignInFlow }) {
  return (
    <Sheet visible={Boolean(choice)} onClose={flow.closeLinkChoice} onDismissed={flow.sheetDismissed} title={useLocale().t('mobile.auth.link.title')}>
      {choice ? <LinkAccountBody key={choice.linkTicket} choice={choice} flow={flow} /> : null}
    </Sheet>
  );
}

function LinkAccountBody({ choice, flow }: { choice: LinkChoice; flow: SignInFlow }) {
  const t = useTheme();
  const { t: tr } = useLocale();
  const [step, setStep] = useState<'choice' | 'existing'>('choice');
  const [error, setError] = useState<string | null>(null);
  const { linkTicket, provider } = choice;
  const minutes = Math.max(1, Math.round(choice.expiresIn / 60));

  const create = async () => {
    setError(null);
    setError(await flow.run((totp) => passwordlessService.createFromLink(linkTicket, totp), provider));
  };

  if (step === 'existing') {
    return (
      <EmailCodeForm
        description={tr('mobile.auth.link.email_hint')}
        emailLabel={tr('mobile.auth.link.email_label')}
        submitLabel={tr('mobile.auth.link.verify')}
        provider={provider}
        busy={flow.busy}
        requestCode={(email) => passwordlessService.requestLinkCode(linkTicket, email)}
        verify={(email, code) => flow.run((totp) => passwordlessService.verifyLink(linkTicket, email, code, totp), provider)}
        footer={
          <Button label={tr('common.back')} variant="ghost" onPress={() => setStep('choice')} disabled={flow.busy} />
        }
      />
    );
  }

  return (
    <View style={{ gap: t.spacing.lg }}>
      <Txt tone="secondary">{tr('mobile.auth.link.body')}</Txt>
      <Txt variant="caption" tone="muted">
        {tr('mobile.auth.link.expires', { minutes })}
      </Txt>
      {error ? <Notice message={error} /> : null}
      <Button label={tr('mobile.auth.link.yes')} icon={<Link2 size={18} color={t.colors.onPrimary} />} size="lg" fullWidth onPress={() => setStep('existing')} disabled={flow.busy} />
      {choice.registerAllowed ? (
        <Button
          label={tr('mobile.auth.link.no')}
          variant="outline"
          icon={<UserPlus size={18} color={t.colors.text} />}
          size="lg"
          fullWidth
          loading={flow.busy}
          disabled={flow.busy}
          onPress={create}
        />
      ) : (
        <Txt variant="caption" tone="secondary">
          {tr('mobile.auth.link.no_register')}
        </Txt>
      )}
    </View>
  );
}

/** `409 OAUTH_ACCOUNT_NOT_LINKED`: sign in the usual way, then link from the profile. */
export function NotLinkedNotice({ provider, onUseCode, onDismiss }: { provider: OAuthProvider; onUseCode: () => void; onDismiss: () => void }) {
  const t = useTheme();
  const { t: tr } = useLocale();
  const name = PROVIDER_NAME[provider];
  return (
    <Card style={{ gap: t.spacing.md, borderColor: t.colors.warning }}>
      <Txt variant="bodyStrong" accessibilityRole="header">
        {tr('mobile.auth.not_linked.title', { provider: name })}
      </Txt>
      <Txt variant="caption" tone="secondary" accessibilityLiveRegion="polite">
        {tr('mobile.auth.not_linked.body', { provider: name })}
      </Txt>
      <Button label={tr('mobile.auth.not_linked.use_code')} variant="secondary" onPress={onUseCode} />
      <Button label={tr('common.close')} variant="ghost" size="sm" onPress={onDismiss} />
    </Card>
  );
}

/** Demo builds: pick a sample Apple / Google identity instead of the real native sheet. */
export function DemoIdentitySheet({
  provider,
  onClose,
  onPick,
  onDismissed,
}: {
  provider: OAuthProvider | null;
  onClose: () => void;
  onPick: (identity: DemoIdentity) => void;
  onDismissed?: () => void;
}) {
  const t = useTheme();
  const { t: tr } = useLocale();
  const items = DEMO_IDENTITIES.filter((i) => i.provider === provider);
  return (
    <Sheet visible={Boolean(provider)} onClose={onClose} onDismissed={onDismissed} title={tr('mobile.auth.demo.choose_title')}>
      <Txt variant="caption" tone="secondary">
        {tr('mobile.auth.demo.choose_hint', { provider: provider ? PROVIDER_NAME[provider] : '' })}
      </Txt>
      <Group>
        {items.map((identity, i) => (
          <ListRow
            key={identity.sub}
            title={tr(identity.labelKey)}
            subtitle={identity.email}
            onPress={() => onPick(identity)}
            last={i === items.length - 1}
          />
        ))}
      </Group>
      <View style={{ height: t.spacing.md }} />
    </Sheet>
  );
}
