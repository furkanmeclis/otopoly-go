import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import * as Haptics from 'expo-haptics';
import { Calendar, Check, ChevronDown, Search, X } from 'lucide-react-native';
import { forwardRef, useMemo, useState, type ReactNode } from 'react';
import {
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Switch,
  TextInput,
  View,
  type TextInputInstance,
  type TextInputProps,
} from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useLocale } from '@/lib/i18n/provider';
import { useTheme } from '@/theme/provider';

import { EmptyState } from './layout';
import { Button, IconButton, Txt } from './primitives';

// ─── Field wrapper ─────────────────────────────────────────────────────────

export function Field({ label, error, hint, required, children }: { label?: string; error?: string | null; hint?: string; required?: boolean; children: ReactNode }) {
  return (
    <View style={{ gap: 6 }}>
      {label ? (
        <Txt variant="caption" tone="secondary" style={{ fontWeight: '600' }}>
          {label}
          {required ? <Txt tone="danger"> *</Txt> : null}
        </Txt>
      ) : null}
      {children}
      {error ? (
        <Txt variant="caption" tone="danger" accessibilityLiveRegion="polite">
          {error}
        </Txt>
      ) : hint ? (
        <Txt variant="caption" tone="muted">
          {hint}
        </Txt>
      ) : null}
    </View>
  );
}

// ─── TextField ─────────────────────────────────────────────────────────────

export type TextFieldProps = TextInputProps & {
  label?: string;
  error?: string | null;
  hint?: string;
  required?: boolean;
  left?: ReactNode;
  right?: ReactNode;
};

export const TextField = forwardRef<TextInputInstance, TextFieldProps>(function TextField(
  { label, error, hint, required, left, right, style, multiline, editable = true, ...rest },
  ref,
) {
  const t = useTheme();
  const [focused, setFocused] = useState(false);
  return (
    <Field label={label} error={error} hint={hint} required={required}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: multiline ? 'flex-start' : 'center',
          gap: t.spacing.sm,
          minHeight: multiline ? 96 : 48,
          paddingHorizontal: t.spacing.md,
          borderRadius: t.radius.md,
          borderWidth: 1.5,
          borderColor: error ? t.colors.danger : focused ? t.colors.primary : t.colors.border,
          backgroundColor: editable ? t.colors.surface : t.colors.surfaceAlt,
        }}
      >
        {left}
        <TextInput
          ref={ref}
          placeholderTextColor={t.colors.textMuted}
          selectionColor={t.colors.primary}
          editable={editable}
          multiline={multiline}
          accessibilityLabel={label}
          onFocus={(e) => {
            setFocused(true);
            rest.onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            rest.onBlur?.(e);
          }}
          style={[
            {
              flex: 1,
              color: t.colors.text,
              fontSize: t.fontSize.md,
              paddingVertical: multiline ? t.spacing.md : 0,
              minHeight: multiline ? 96 : 44,
              textAlignVertical: multiline ? 'top' : 'center',
            },
            style,
          ]}
          {...rest}
        />
        {right}
      </View>
    </Field>
  );
});

/** Decimal input that keeps the API's "1234.50" string format (accepts "," too). */
export function MoneyField({
  value,
  onChangeText,
  currency = '₺',
  ...rest
}: Omit<TextFieldProps, 'onChangeText' | 'value'> & { value: string; onChangeText: (v: string) => void; currency?: string }) {
  const t = useTheme();
  return (
    <TextField
      {...rest}
      value={value}
      keyboardType="decimal-pad"
      inputMode="decimal"
      onChangeText={(raw) => {
        const cleaned = raw.replace(',', '.').replace(/[^0-9.]/g, '');
        const [int, ...dec] = cleaned.split('.');
        onChangeText(dec.length ? `${int}.${dec.join('').slice(0, 2)}` : int);
      }}
      right={<Txt tone="muted" style={{ fontWeight: '700', color: t.colors.textMuted }}>{currency}</Txt>}
    />
  );
}

// ─── SearchBar ─────────────────────────────────────────────────────────────

export function SearchBar({ value, onChangeText, placeholder }: { value: string; onChangeText: (v: string) => void; placeholder?: string }) {
  const t = useTheme();
  const { t: tr } = useLocale();
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: t.spacing.sm,
        height: 44,
        paddingHorizontal: t.spacing.md,
        borderRadius: t.radius.md,
        backgroundColor: t.colors.surface,
        borderWidth: 1,
        borderColor: t.colors.border,
      }}
    >
      <Search size={18} color={t.colors.textMuted} />
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder ?? tr('common.search')}
        placeholderTextColor={t.colors.textMuted}
        selectionColor={t.colors.primary}
        returnKeyType="search"
        autoCorrect={false}
        autoCapitalize="none"
        accessibilityRole="search"
        style={{ flex: 1, color: t.colors.text, fontSize: t.fontSize.md, height: 44 }}
      />
      {value ? (
        <Pressable onPress={() => onChangeText('')} hitSlop={10} accessibilityLabel={tr('common.clear')} accessibilityRole="button">
          <X size={16} color={t.colors.textMuted} />
        </Pressable>
      ) : null}
    </View>
  );
}

// ─── Chips / Segmented ─────────────────────────────────────────────────────

export type ChipOption<T extends string> = { value: T; label: string; count?: number };

export function FilterChips<T extends string>({ options, value, onChange }: { options: ChipOption<T>[]; value: T; onChange: (v: T) => void }) {
  const t = useTheme();
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: t.spacing.sm, paddingRight: t.spacing.lg }}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <Pressable
            key={o.value}
            onPress={() => {
              Haptics.selectionAsync().catch(() => {});
              onChange(o.value);
            }}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 6,
              height: 34,
              paddingHorizontal: t.spacing.md,
              borderRadius: t.radius.full,
              borderWidth: 1,
              borderColor: active ? t.colors.primary : t.colors.border,
              backgroundColor: active ? t.colors.primary : t.colors.surface,
            }}
          >
            <Txt variant="caption" style={{ fontWeight: '700', color: active ? t.colors.onPrimary : t.colors.textSecondary }}>
              {o.label}
            </Txt>
            {o.count != null ? (
              <View
                style={{
                  minWidth: 20,
                  paddingHorizontal: 5,
                  height: 18,
                  borderRadius: 9,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: active ? 'rgba(255,255,255,0.25)' : t.colors.surfaceAlt,
                }}
              >
                <Txt style={{ fontSize: 11, fontWeight: '800', color: active ? t.colors.onPrimary : t.colors.textSecondary }}>{o.count}</Txt>
              </View>
            ) : null}
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

export function Segmented<T extends string>({ options, value, onChange }: { options: ChipOption<T>[]; value: T; onChange: (v: T) => void }) {
  const t = useTheme();
  return (
    <View
      accessibilityRole="tablist"
      style={{ flexDirection: 'row', backgroundColor: t.colors.surfaceSunken, borderRadius: t.radius.md, padding: 3, gap: 3 }}
    >
      {options.map((o) => {
        const active = o.value === value;
        return (
          <Pressable
            key={o.value}
            onPress={() => {
              Haptics.selectionAsync().catch(() => {});
              onChange(o.value);
            }}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            style={{
              flex: 1,
              height: 36,
              borderRadius: t.radius.sm,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: active ? t.colors.surface : 'transparent',
              ...(active ? t.shadow.sm : {}),
            }}
          >
            <Txt variant="caption" numberOfLines={1} style={{ fontWeight: '700', color: active ? t.colors.text : t.colors.textSecondary }}>
              {o.label}
            </Txt>
          </Pressable>
        );
      })}
    </View>
  );
}

export function SwitchRow({ label, description, value, onValueChange, disabled }: { label: string; description?: string; value: boolean; onValueChange: (v: boolean) => void; disabled?: boolean }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.md, minHeight: 48 }}>
      <View style={{ flex: 1 }}>
        <Txt variant="bodyStrong">{label}</Txt>
        {description ? (
          <Txt variant="caption" tone="secondary">
            {description}
          </Txt>
        ) : null}
      </View>
      <Switch
        value={value}
        onValueChange={onValueChange}
        disabled={disabled}
        accessibilityLabel={label}
        trackColor={{ true: t.colors.primary, false: t.colors.borderStrong }}
        thumbColor={Platform.OS === 'android' ? t.colors.surface : undefined}
      />
    </View>
  );
}

// ─── Sheet ─────────────────────────────────────────────────────────────────

/** Bottom sheet built on the native Modal (pageSheet on iOS, slide-up on Android). */
export function Sheet({
  visible,
  onClose,
  title,
  children,
  footer,
  scroll = true,
}: {
  visible: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  scroll?: boolean;
}) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { t: tr } = useLocale();
  return (
    <Modal visible={visible} onRequestClose={onClose} animationType="slide" presentationStyle={Platform.OS === 'ios' ? 'pageSheet' : 'fullScreen'}>
      {/* A Modal is a separate native root: gestures inside it (signature pad, chart scrub) need their own root view. */}
      <GestureHandlerRootView style={{ flex: 1 }}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, backgroundColor: t.colors.background }}>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: t.spacing.md,
            paddingHorizontal: t.spacing.lg,
            paddingTop: Platform.OS === 'ios' ? t.spacing.lg : insets.top + t.spacing.md,
            paddingBottom: t.spacing.md,
            borderBottomWidth: 1,
            borderBottomColor: t.colors.border,
          }}
        >
          <Txt variant="heading" style={{ flex: 1 }} numberOfLines={1} accessibilityRole="header">
            {title}
          </Txt>
          <IconButton label={tr('common.close')} icon={<X size={20} color={t.colors.text} />} onPress={onClose} />
        </View>
        {scroll ? (
          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={{ padding: t.spacing.lg, gap: t.spacing.lg, paddingBottom: t.spacing.xxxl }}
            keyboardShouldPersistTaps="handled"
          >
            {children}
          </ScrollView>
        ) : (
          <View style={{ flex: 1 }}>{children}</View>
        )}
        {footer ? (
          <View
            style={{
              padding: t.spacing.lg,
              paddingBottom: Math.max(insets.bottom, t.spacing.lg),
              borderTopWidth: 1,
              borderTopColor: t.colors.border,
              backgroundColor: t.colors.surface,
              gap: t.spacing.sm,
            }}
          >
            {footer}
          </View>
        ) : null}
      </KeyboardAvoidingView>
      </GestureHandlerRootView>
    </Modal>
  );
}

// ─── Select ────────────────────────────────────────────────────────────────

export type SelectOption = { value: string; label: string; description?: string; left?: ReactNode };

/** Tappable field opening a searchable option sheet. */
export function SelectField({
  label,
  value,
  options,
  onChange,
  placeholder,
  error,
  required,
  searchable,
  onSearch,
  loading,
  allowClear,
  disabled,
  footer,
}: {
  label?: string;
  value: string | null | undefined;
  options: SelectOption[];
  onChange: (value: string | null, option?: SelectOption) => void;
  placeholder?: string;
  error?: string | null;
  required?: boolean;
  searchable?: boolean;
  /** Remote search; when provided, local filtering is skipped. */
  onSearch?: (q: string) => void;
  loading?: boolean;
  allowClear?: boolean;
  disabled?: boolean;
  /** Extra content at the bottom of the sheet (e.g. "create new"). */
  footer?: (close: () => void) => ReactNode;
}) {
  const t = useTheme();
  const { t: tr } = useLocale();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const selected = options.find((o) => o.value === value);
  const filtered = useMemo(() => {
    if (onSearch || !q.trim()) return options;
    const needle = q.toLocaleLowerCase('tr-TR');
    return options.filter((o) => `${o.label} ${o.description ?? ''}`.toLocaleLowerCase('tr-TR').includes(needle));
  }, [options, q, onSearch]);
  const close = () => {
    setOpen(false);
    setQ('');
    onSearch?.('');
  };

  return (
    <Field label={label} error={error} required={required}>
      <Pressable
        disabled={disabled}
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={`${label ?? ''} ${selected?.label ?? placeholder ?? ''}`}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: t.spacing.sm,
          minHeight: 48,
          paddingHorizontal: t.spacing.md,
          borderRadius: t.radius.md,
          borderWidth: 1.5,
          borderColor: error ? t.colors.danger : t.colors.border,
          backgroundColor: disabled ? t.colors.surfaceAlt : t.colors.surface,
        }}
      >
        {selected?.left}
        <View style={{ flex: 1, paddingVertical: 8 }}>
          <Txt numberOfLines={1} tone={selected ? 'default' : 'muted'}>
            {selected?.label ?? placeholder ?? tr('mobile.common.select')}
          </Txt>
          {selected?.description ? (
            <Txt variant="caption" tone="secondary" numberOfLines={1}>
              {selected.description}
            </Txt>
          ) : null}
        </View>
        {allowClear && selected ? (
          <Pressable onPress={() => onChange(null)} hitSlop={10} accessibilityLabel={tr('common.clear')}>
            <X size={16} color={t.colors.textMuted} />
          </Pressable>
        ) : (
          <ChevronDown size={18} color={t.colors.textMuted} />
        )}
      </Pressable>

      <Sheet visible={open} onClose={close} title={label ?? tr('mobile.common.select')} scroll={false} footer={footer?.(close)}>
        {searchable || onSearch ? (
          <View style={{ padding: t.spacing.lg, paddingBottom: t.spacing.sm }}>
            <SearchBar
              value={q}
              onChangeText={(v) => {
                setQ(v);
                onSearch?.(v);
              }}
            />
          </View>
        ) : null}
        <FlatList
          data={filtered}
          keyExtractor={(o) => o.value}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingHorizontal: t.spacing.lg, paddingBottom: t.spacing.xxxl }}
          ListEmptyComponent={loading ? undefined : <EmptyState />}
          renderItem={({ item }) => {
            const active = item.value === value;
            return (
              <Pressable
                onPress={() => {
                  Haptics.selectionAsync().catch(() => {});
                  onChange(item.value, item);
                  close();
                }}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                style={({ pressed }) => ({
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: t.spacing.md,
                  paddingVertical: t.spacing.md,
                  paddingHorizontal: t.spacing.sm,
                  borderRadius: t.radius.md,
                  backgroundColor: active ? t.colors.primarySoft : pressed ? t.colors.surfaceAlt : 'transparent',
                })}
              >
                {item.left}
                <View style={{ flex: 1 }}>
                  <Txt variant="bodyStrong">{item.label}</Txt>
                  {item.description ? (
                    <Txt variant="caption" tone="secondary">
                      {item.description}
                    </Txt>
                  ) : null}
                </View>
                {active ? <Check size={18} color={t.colors.primary} /> : null}
              </Pressable>
            );
          }}
        />
      </Sheet>
    </Field>
  );
}

// ─── Date ──────────────────────────────────────────────────────────────────

const pad = (n: number) => String(n).padStart(2, '0');
/** Local calendar day as yyyy-MM-dd (what the API expects for date fields). */
export const toDay = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const fromDay = (s: string) => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1, 12);
};

export function DateField({
  label,
  value,
  onChange,
  error,
  required,
  allowClear,
  mode = 'date',
  minimumDate,
  maximumDate,
}: {
  label?: string;
  /** yyyy-MM-dd for date mode, HH:mm for time mode. */
  value: string | null;
  onChange: (value: string | null) => void;
  error?: string | null;
  required?: boolean;
  allowClear?: boolean;
  mode?: 'date' | 'time';
  minimumDate?: Date;
  maximumDate?: Date;
}) {
  const t = useTheme();
  const { t: tr, fmt } = useLocale();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Date>(new Date());

  const current = (() => {
    if (!value) return new Date();
    if (mode === 'time') {
      const [h, m] = value.split(':').map(Number);
      const d = new Date();
      d.setHours(h || 0, m || 0, 0, 0);
      return d;
    }
    return fromDay(value);
  })();
  const display = !value ? null : mode === 'time' ? value : fmt.date(fromDay(value), 'medium');
  const commit = (d: Date) => onChange(mode === 'time' ? `${pad(d.getHours())}:${pad(d.getMinutes())}` : toDay(d));

  const onAndroidChange = (event: DateTimePickerEvent, d?: Date) => {
    setOpen(false);
    if (event.type === 'set' && d) commit(d);
  };

  return (
    <Field label={label} error={error} required={required}>
      <Pressable
        onPress={() => {
          setDraft(current);
          setOpen(true);
        }}
        accessibilityRole="button"
        accessibilityLabel={`${label ?? ''} ${display ?? ''}`}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: t.spacing.sm,
          height: 48,
          paddingHorizontal: t.spacing.md,
          borderRadius: t.radius.md,
          borderWidth: 1.5,
          borderColor: error ? t.colors.danger : t.colors.border,
          backgroundColor: t.colors.surface,
        }}
      >
        <Calendar size={18} color={t.colors.textMuted} />
        <Txt style={{ flex: 1 }} tone={display ? 'default' : 'muted'}>
          {display ?? tr('mobile.common.select')}
        </Txt>
        {allowClear && value ? (
          <Pressable onPress={() => onChange(null)} hitSlop={10} accessibilityLabel={tr('common.clear')}>
            <X size={16} color={t.colors.textMuted} />
          </Pressable>
        ) : null}
      </Pressable>
      {open && Platform.OS === 'android' ? (
        <DateTimePicker value={current} mode={mode} onChange={onAndroidChange} minimumDate={minimumDate} maximumDate={maximumDate} is24Hour />
      ) : null}
      {Platform.OS === 'ios' ? (
        <Sheet
          visible={open}
          onClose={() => setOpen(false)}
          title={label ?? ''}
          scroll={false}
          footer={
            <Button
              label={tr('mobile.common.done')}
              onPress={() => {
                commit(draft);
                setOpen(false);
              }}
            />
          }
        >
          <View style={{ alignItems: 'center', padding: t.spacing.lg }}>
            <DateTimePicker
              value={draft}
              mode={mode}
              display={mode === 'date' ? 'inline' : 'spinner'}
              onChange={(_, d) => d && setDraft(d)}
              minimumDate={minimumDate}
              maximumDate={maximumDate}
              themeVariant={t.scheme}
              accentColor={t.colors.primary}
              locale={fmt.locale}
            />
          </View>
        </Sheet>
      ) : null}
    </Field>
  );
}
