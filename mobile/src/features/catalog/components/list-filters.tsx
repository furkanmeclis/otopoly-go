import { SlidersHorizontal } from 'lucide-react-native';
import type { ReactNode } from 'react';

import { Button, IconButton, Sheet } from '@/components/ui';
import { useLocale } from '@/lib/i18n/provider';
import { useTheme } from '@/theme/provider';

/** Header button that opens the secondary-filter sheet; shows how many filters are active. */
export function FilterButton({ active, onPress }: { active: number; onPress: () => void }) {
  const t = useTheme();
  const { t: tr } = useLocale();
  return <IconButton label={tr('mobile.catalog.filters')} badge={active || undefined} icon={<SlidersHorizontal size={18} color={t.colors.text} />} onPress={onPress} />;
}

export function FilterSheet({ visible, onClose, onReset, children }: { visible: boolean; onClose: () => void; onReset: () => void; children: ReactNode }) {
  const { t: tr } = useLocale();
  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title={tr('mobile.catalog.filters')}
      footer={
        <>
          <Button size="lg" label={tr('mobile.common.done')} onPress={onClose} />
          <Button variant="ghost" label={tr('mobile.catalog.reset_filters')} onPress={onReset} />
        </>
      }
    >
      {children}
    </Sheet>
  );
}
