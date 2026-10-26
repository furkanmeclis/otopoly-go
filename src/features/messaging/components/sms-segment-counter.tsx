/** Live "123 characters · 1 SMS" counter from the API estimate (debounced while typing). */
import { ActivityIndicator, View } from 'react-native';

import { Badge, Txt } from '@/components/ui';
import { useLocale } from '@/lib/i18n/provider';
import { useTheme } from '@/theme/provider';

import { useSmsEstimate } from '../queries';
import type { SmsProviderCode } from '../services/sms.service';

const ENCODING_KEYS = {
  gsm7: 'mobile.messaging.sms.segments.encoding.gsm7',
  turkish: 'mobile.messaging.sms.segments.encoding.turkish',
  ucs2: 'mobile.messaging.sms.segments.encoding.ucs2',
} as const;

export function SmsSegmentCounter({ body, provider }: { body: string; provider?: SmsProviderCode }) {
  const t = useTheme();
  const { t: tr } = useLocale();
  const { data, pending, isError } = useSmsEstimate(body, provider);
  const seg = data?.segments;
  if (isError && !seg) return null;
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: t.spacing.sm }} accessibilityLiveRegion="polite">
      {seg ? (
        <>
          <Txt variant="caption" tone="secondary" style={{ fontVariant: ['tabular-nums'] }}>
            {tr('mobile.messaging.sms.segments.summary', { characters: seg.characters, segments: seg.segments })}
          </Txt>
          <Txt variant="caption" tone="muted" style={{ fontVariant: ['tabular-nums'] }}>
            {tr('mobile.messaging.sms.segments.remaining', { remaining: seg.remaining })}
          </Txt>
          <Badge size="sm" tone={seg.encoding === 'ucs2' ? 'warning' : 'neutral'} label={tr(ENCODING_KEYS[seg.encoding])} />
        </>
      ) : (
        <Txt variant="caption" tone="muted">
          {tr('mobile.messaging.sms.segments.estimating')}
        </Txt>
      )}
      {pending ? <ActivityIndicator size="small" color={t.colors.textMuted} /> : null}
      {seg?.encoding === 'ucs2' ? (
        <Txt variant="caption" tone="warning" style={{ width: '100%' }}>
          {tr('mobile.messaging.sms.segments.ucs2_hint')}
        </Txt>
      ) : null}
    </View>
  );
}
