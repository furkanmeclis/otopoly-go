import { useState } from 'react';
import { View } from 'react-native';

import { Button, Card, Row, Segmented, Sheet, TextField, Txt } from '@/components/ui';
import { catalogUnitLabel, normalizeDecimal } from '@/features/catalog/lib/units';
import { catalogService, type CatalogProduct } from '@/features/catalog/services/catalog.service';
import { qk } from '@/features/queries';
import { toNumber } from '@/lib/i18n/format';
import { useLocale } from '@/lib/i18n/provider';
import { createLogger } from '@/lib/logger';
import { fieldErrors, useApiMutation } from '@/lib/mutation';
import { useTheme } from '@/theme/provider';

const log = createLogger('screen.catalog.stock-adjust');

/**
 * Web `StockAdjustmentDialog`: signed delta + reason + note. On mobile the sign is a segmented
 * in/out switch because numeric keypads have no minus key.
 */
export function StockAdjustSheet({ product, visible, onClose }: { product: CatalogProduct; visible: boolean; onClose: () => void }) {
  return visible ? <StockAdjustForm key={product.uuid} product={product} onClose={onClose} /> : null;
}

function StockAdjustForm({ product, onClose }: { product: CatalogProduct; onClose: () => void }) {
  const t = useTheme();
  const { t: tr, fmt } = useLocale();
  const [direction, setDirection] = useState<'in' | 'out'>('in');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  const unit = catalogUnitLabel(tr, product.unit);
  const current = toNumber(product.stock_quantity);
  const delta = (direction === 'out' ? -1 : 1) * toNumber(amount);
  const next = current + delta;

  const adjust = useApiMutation({
    key: 'catalog.products.adjust_stock',
    fn: () => catalogService.adjustProductStock(product.uuid, { delta: String(delta), reason: reason.trim() || undefined, description: note.trim() || undefined }),
    invalidate: [qk.catalog],
    success: tr('catalog.products.stock_adjusted_success'),
    onSuccess: (p) => {
      log.info('Stock adjusted', { uuid: p.uuid, delta });
      onClose();
    },
  });
  const errs = fieldErrors(adjust.error);

  const submit = () => {
    if (!amount.trim()) return setError(tr('form.required'));
    if (!(toNumber(amount) > 0)) return setError(tr('mobile.catalog.delta_invalid'));
    setError(null);
    adjust.mutate(undefined);
  };

  return (
    <Sheet
      visible
      onClose={onClose}
      title={tr('catalog.adjust_dialog.title')}
      footer={<Button size="lg" label={adjust.isPending ? tr('common.saving') : tr('catalog.adjust_dialog.submit')} loading={adjust.isPending} onPress={submit} />}
    >
      <Txt tone="secondary">{`${product.name} (${fmt.number(current, 3)} ${unit})`}</Txt>
      <Txt variant="caption" tone="muted">
        {tr('catalog.adjust_dialog.description')}
      </Txt>
      <Card style={{ flexDirection: 'row', justifyContent: 'space-between', backgroundColor: t.colors.surfaceAlt }}>
        <Txt tone="secondary">{tr('catalog.adjust_dialog.current_stock')}</Txt>
        <Txt variant="bodyStrong">{`${fmt.number(current, 3)} ${unit}`}</Txt>
      </Card>
      <Segmented
        value={direction}
        onChange={setDirection}
        options={[
          { value: 'in', label: tr('mobile.catalog.adjust_in') },
          { value: 'out', label: tr('mobile.catalog.adjust_out') },
        ]}
      />
      <TextField
        label={tr('catalog.adjust_dialog.delta')}
        placeholder={tr('mobile.catalog.delta_placeholder')}
        value={amount}
        onChangeText={(v) => setAmount(normalizeDecimal(v))}
        keyboardType="decimal-pad"
        inputMode="decimal"
        error={error ?? errs.delta}
        required
        autoFocus
        right={<Txt tone="muted">{unit}</Txt>}
      />
      <View style={{ borderWidth: 1, borderStyle: 'dashed', borderColor: t.colors.borderStrong, borderRadius: t.radius.md, padding: t.spacing.md }}>
        <Row style={{ justifyContent: 'space-between' }}>
          <Txt tone="secondary">{tr('catalog.adjust_dialog.new_stock')}</Txt>
          <Txt variant="bodyStrong" tone={next < 0 ? 'danger' : 'success'}>{`${fmt.number(next, 3)} ${unit}`}</Txt>
        </Row>
      </View>
      <TextField label={tr('catalog.adjust_dialog.reason')} placeholder={tr('catalog.adjust_dialog.reason_placeholder')} value={reason} onChangeText={setReason} error={errs.reason} />
      <TextField label={tr('catalog.adjust_dialog.note')} value={note} onChangeText={setNote} multiline error={errs.description} />
    </Sheet>
  );
}
