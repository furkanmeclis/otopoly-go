import * as Haptics from 'expo-haptics';
import { AlertCircle, CheckCircle2, Info, XCircle } from 'lucide-react-native';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';
import Animated, { FadeInUp, FadeOutUp } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { ApiError } from '@/api/errors';
import { subscribeApiEvents } from '@/api/events';
import { useLocale } from '@/lib/i18n/provider';
import { makeStyles, useTheme } from '@/theme/provider';

export type ToastKind = 'success' | 'error' | 'info' | 'warning';
type ToastItem = { id: number; kind: ToastKind; title: string; message?: string };

type ToastApi = {
  show: (kind: ToastKind, title: string, message?: string) => void;
  success: (title: string, message?: string) => void;
  error: (title: string, message?: string) => void;
  info: (title: string, message?: string) => void;
};

const ToastContext = createContext<ToastApi | null>(null);

let seq = 0;

/** Maps an API error to a user-facing sentence using the shared web `errors.*` catalog. */
export function useApiErrorMessage() {
  const { t } = useLocale();
  return useCallback(
    (error: unknown) => {
      const e = error as ApiError;
      if (!e || typeof e !== 'object') return t('common.error_generic');
      if (e.code === 'NETWORK_ERROR' || e.code === 'TIMEOUT') return t('mobile.error.network');
      const key = `errors.codes.${String(e.code ?? '')}`;
      const translated = t(key);
      if (translated !== key) return translated;
      return e.message || t('common.error_generic');
    },
    [t],
  );
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());
  const { t } = useLocale();
  const toMessage = useApiErrorMessage();

  const dismiss = useCallback((id: number) => {
    setItems((prev) => prev.filter((x) => x.id !== id));
    const timer = timers.current.get(id);
    if (timer) clearTimeout(timer);
    timers.current.delete(id);
  }, []);

  const show = useCallback(
    (kind: ToastKind, title: string, message?: string) => {
      const id = ++seq;
      setItems((prev) => [...prev.slice(-2), { id, kind, title, message }]);
      timers.current.set(
        id,
        setTimeout(() => dismiss(id), kind === 'error' ? 5000 : 3000),
      );
      if (kind === 'success') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      if (kind === 'error') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
    },
    [dismiss],
  );

  // Global API errors: only the ones screens don't handle inline (network, server, rate limit).
  useEffect(
    () =>
      subscribeApiEvents((error) => {
        if (error.isNetwork || error.status >= 500 || error.code === 'RATE_LIMITED') {
          show('error', t('common.error_generic'), toMessage(error));
        }
      }),
    [show, t, toMessage],
  );

  const api = useMemo<ToastApi>(
    () => ({
      show,
      success: (title, message) => show('success', title, message),
      error: (title, message) => show('error', title, message),
      info: (title, message) => show('info', title, message),
    }),
    [show],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <ToastViewport items={items} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}

function ToastViewport({ items, onDismiss }: { items: ToastItem[]; onDismiss: (id: number) => void }) {
  const insets = useSafeAreaInsets();
  const styles = useStyles();
  const theme = useTheme();
  const icon = (kind: ToastKind) => {
    const c = theme.colors;
    switch (kind) {
      case 'success':
        return <CheckCircle2 size={20} color={c.success} />;
      case 'error':
        return <XCircle size={20} color={c.danger} />;
      case 'warning':
        return <AlertCircle size={20} color={c.warning} />;
      default:
        return <Info size={20} color={c.info} />;
    }
  };
  return (
    <View pointerEvents="box-none" style={[styles.viewport, { top: insets.top + 8 }]}>
      {items.map((item) => (
        <Animated.View key={item.id} entering={FadeInUp.springify().damping(18)} exiting={FadeOutUp.duration(160)}>
          <Pressable
            onPress={() => onDismiss(item.id)}
            style={styles.toast}
            accessibilityRole="alert"
            accessibilityLabel={`${item.title}${item.message ? `. ${item.message}` : ''}`}
          >
            {icon(item.kind)}
            <View style={styles.body}>
              <Text style={styles.title} numberOfLines={2}>
                {item.title}
              </Text>
              {item.message ? (
                <Text style={styles.message} numberOfLines={3}>
                  {item.message}
                </Text>
              ) : null}
            </View>
          </Pressable>
        </Animated.View>
      ))}
    </View>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside ToastProvider');
  return ctx;
}

const useStyles = makeStyles((t) => ({
  viewport: { position: 'absolute', left: t.spacing.lg, right: t.spacing.lg, gap: t.spacing.sm, zIndex: 1000 },
  toast: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: t.spacing.md,
    backgroundColor: t.colors.surface,
    borderRadius: t.radius.lg,
    borderWidth: 1,
    borderColor: t.colors.border,
    paddingHorizontal: t.spacing.lg,
    paddingVertical: t.spacing.md,
    ...t.shadow.md,
  },
  body: { flex: 1, gap: 2 },
  title: { color: t.colors.text, fontSize: t.fontSize.md, fontWeight: t.fontWeight.semibold },
  message: { color: t.colors.textSecondary, fontSize: t.fontSize.sm },
}));
