/**
 * Signing flow for one signer slot (web `SignDialog` + `SignerSignForm`). Customer signers on
 * OTP-required contracts first verify a WhatsApp code; then the name (pre-filled from the job) and a
 * finger signature are submitted as `signature_png_base64`.
 */
import { MessageCircle, ShieldCheck } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { ScrollView, View } from 'react-native';

import { isApiError } from '@/api/errors';
import { Button, Card, Row, Sheet, TextField, Txt } from '@/components/ui';
import { useLocale } from '@/lib/i18n/provider';
import { createLogger } from '@/lib/logger';
import { useApiMutation } from '@/lib/mutation';
import { useTheme } from '@/theme/provider';

import { contractKeys } from '../queries';
import { contractsService, type ContractInstance, type ContractOtpChallenge, type ContractSigner } from '../services/contracts.service';
import { SignaturePad } from './signature-pad';

const log = createLogger('screen.contracts.sign');

function useSecondsUntil(iso: string | null) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!iso) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [iso]);
  if (!iso) return 0;
  return Math.max(0, Math.ceil((new Date(iso).getTime() - now) / 1000));
}

export function SignSheet({ instance, signerUuid, onClose }: { instance: ContractInstance; signerUuid: string | null; onClose: () => void }) {
  const { t: tr } = useLocale();
  // Resolve from the live instance so OTP verification state stays current.
  const signer = instance.signers?.find((s) => s.uuid === signerUuid) ?? null;
  return (
    <Sheet visible={Boolean(signerUuid)} onClose={onClose} title={tr('contracts.instances.sign_title')} scroll={false}>
      {signer ? <SignerForm key={signer.uuid} instance={instance} signer={signer} onDone={onClose} /> : null}
    </Sheet>
  );
}

/**
 * One signer's OTP + signature form. `onSigned` receives the updated contract (job flow moves on to
 * the next signer); without it, `onDone` closes the form after signing. `cancelLabel` defaults to "Cancel".
 */
export function SignerForm({
  instance,
  signer,
  onDone,
  onSigned,
  cancelLabel,
}: {
  instance: ContractInstance;
  signer: ContractSigner;
  onDone: () => void;
  onSigned?: (updated: ContractInstance) => void;
  cancelLabel?: string;
}) {
  const t = useTheme();
  const { t: tr, fmt } = useLocale();
  const [displayName, setDisplayName] = useState(signer.suggested_name ?? '');
  const [signature, setSignature] = useState<string | null>(null);
  const [phone, setPhone] = useState(signer.phone ?? '');
  const [challenge, setChallenge] = useState<ContractOtpChallenge | null>(null);
  const [code, setCode] = useState('');
  const [verified, setVerified] = useState(signer.otp_verified);
  const [drawing, setDrawing] = useState(false);
  const resendIn = useSecondsUntil(challenge?.resend_at ?? null);

  const needsOtp = signer.otp_required && !verified;
  const plate = instance.variables_resolved?.plate;

  const sendOtp = useApiMutation({
    key: 'contracts.otp.send',
    fn: () => contractsService.sendSignerOtp(instance.uuid, signer.uuid, { phone: phone.trim() || undefined }),
    success: (data) => tr('contracts.otp.toast.sent', { phone: data.phone_masked }),
    toastValidation: true,
    onSuccess: (data) => {
      setChallenge(data);
      setCode('');
    },
  });
  const verifyOtp = useApiMutation({
    key: 'contracts.otp.verify',
    fn: () => contractsService.verifySignerOtp(instance.uuid, signer.uuid, code),
    invalidate: [contractKeys.all],
    success: tr('contracts.otp.toast.verified'),
    toastValidation: true,
    onSuccess: () => setVerified(true),
  });
  const sign = useApiMutation({
    key: 'contracts.sign',
    fn: (png: string) => contractsService.sign(instance.uuid, signer.uuid, { display_name: displayName.trim(), signature_png_base64: png }),
    invalidate: [contractKeys.all],
    success: tr('contracts.instances.toast.signed'),
    toastValidation: true,
    onSuccess: (data) => {
      log.info('Signed', { instance: data.uuid, signer: signer.uuid, status: data.status });
      if (onSigned) onSigned(data);
      else onDone();
    },
  });

  const header = (
    <Txt variant="caption" tone="secondary">
      {`${signer.label} · ${tr('contracts.instances.sign_description')}`}
    </Txt>
  );

  if (needsOtp) {
    return (
      <ScrollView contentContainerStyle={{ padding: t.spacing.lg, gap: t.spacing.lg, paddingBottom: t.spacing.xxxl }} keyboardShouldPersistTaps="handled">
        {header}
        <Card style={{ gap: t.spacing.xs, backgroundColor: t.colors.surfaceAlt }}>
          <Row gap={t.spacing.sm}>
            <MessageCircle size={16} color={t.colors.success} />
            <Txt variant="bodyStrong" style={{ flex: 1 }}>
              {tr('contracts.otp.title')}
            </Txt>
          </Row>
          <Txt variant="caption" tone="secondary">
            {tr('contracts.otp.description')}
          </Txt>
          <Txt variant="caption" tone="secondary" style={{ marginTop: t.spacing.xs }}>
            {`${tr('contracts.otp.summary_contract')}: `}
            <Txt variant="caption">{`${instance.title} · ${instance.number_label}`}</Txt>
          </Txt>
          {plate ? (
            <Txt variant="caption" tone="secondary">
              {`${tr('contracts.otp.summary_plate')}: `}
              <Txt variant="caption">{plate}</Txt>
            </Txt>
          ) : null}
          <Txt variant="caption" tone="secondary">
            {tr('contracts.otp.summary_kvkk')}
          </Txt>
        </Card>

        <TextField
          label={tr('contracts.otp.phone')}
          value={phone}
          onChangeText={setPhone}
          keyboardType="phone-pad"
          textContentType="telephoneNumber"
          autoComplete="tel"
          placeholder="05XX XXX XX XX"
        />
        <Button
          variant={challenge ? 'outline' : 'primary'}
          loading={sendOtp.isPending}
          disabled={!phone.trim() || resendIn > 0}
          label={
            sendOtp.isPending
              ? tr('contracts.otp.sending')
              : challenge
                ? resendIn > 0
                  ? tr('contracts.otp.resend_in', { seconds: resendIn })
                  : tr('contracts.otp.resend')
                : tr('contracts.otp.send')
          }
          onPress={() => sendOtp.mutate(undefined)}
        />

        {challenge ? (
          <View style={{ gap: t.spacing.md }}>
            <TextField
              label={tr('contracts.otp.code')}
              hint={tr('contracts.otp.code_hint', { phone: challenge.phone_masked, time: fmt.time(challenge.expires_at) })}
              value={code}
              onChangeText={(v) => setCode(v.replace(/\D/g, '').slice(0, 6))}
              keyboardType="number-pad"
              textContentType="oneTimeCode"
              autoComplete="one-time-code"
              maxLength={6}
              placeholder="••••••"
              style={{ letterSpacing: 8, fontVariant: ['tabular-nums'] }}
            />
            <Button
              label={verifyOtp.isPending ? tr('common.saving') : tr('contracts.otp.verify')}
              loading={verifyOtp.isPending}
              disabled={code.length !== 6}
              onPress={() => verifyOtp.mutateAsync(undefined).catch(() => setCode(''))}
            />
          </View>
        ) : null}

        <Button variant="outline" label={cancelLabel ?? tr('common.cancel')} onPress={onDone} />
      </ScrollView>
    );
  }

  return (
    <ScrollView
      scrollEnabled={!drawing}
      contentContainerStyle={{ padding: t.spacing.lg, gap: t.spacing.lg, paddingBottom: t.spacing.xxxl }}
      keyboardShouldPersistTaps="handled"
    >
      {header}
      {signer.otp_required ? (
        <Row gap={t.spacing.sm} style={{ padding: t.spacing.md, borderRadius: t.radius.md, backgroundColor: t.colors.successBg }}>
          <ShieldCheck size={16} color={t.colors.success} />
          <Txt variant="caption" tone="success" style={{ flex: 1 }}>
            {tr('contracts.otp.verified')}
          </Txt>
        </Row>
      ) : null}
      <TextField label={tr('contracts.instances.sign_display_name')} value={displayName} onChangeText={setDisplayName} autoCapitalize="words" />
      <SignaturePad onChange={setSignature} onDrawingChange={setDrawing} />
      <Card style={{ gap: t.spacing.xs, backgroundColor: t.colors.surfaceAlt }}>
        <Txt variant="bodyStrong">{tr('contracts.instances.disclaimer')}</Txt>
        <Txt variant="caption" tone="secondary">
          {tr('contracts.instances.disclaimer_body')}
        </Txt>
      </Card>
      <Button
        label={sign.isPending ? tr('common.saving') : tr('contracts.instances.sign_submit')}
        loading={sign.isPending}
        disabled={!displayName.trim() || !signature}
        onPress={() => {
          if (!signature) return;
          sign.mutateAsync(signature).catch((err: unknown) => {
            // Verification window (30 min) elapsed: go back to the OTP step.
            if (isApiError(err) && err.code === 'OTP_REQUIRED') {
              setVerified(false);
              setChallenge(null);
            }
          });
        }}
      />
      <Button variant="outline" label={cancelLabel ?? tr('common.cancel')} onPress={onDone} />
    </ScrollView>
  );
}
