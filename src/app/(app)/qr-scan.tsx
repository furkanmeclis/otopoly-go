import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import * as Haptics from 'expo-haptics';
import { router, useFocusEffect } from 'expo-router';
import { Camera, QrCode } from 'lucide-react-native';
import { useCallback, useRef, useState } from 'react';
import { Linking, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useToast } from '@/components/feedback/toast';
import { Button, EmptyState, Header, Screen, Txt } from '@/components/ui';
import { env, isMock } from '@/config/env';
import { parseQRLoginCode } from '@/features/qr-login/lib';
import { qrLoginService } from '@/features/qr-login/qr-login.service';
import { useLocale } from '@/lib/i18n/provider';
import { createLogger } from '@/lib/logger';
import { useTheme } from '@/theme/provider';

const log = createLogger('screen.qr-scan');

/**
 * "QR ile giriş onayla": scans the QR on the web login page with the in-app camera and opens the
 * approval screen. Only Otopoly sign-in links are accepted; other codes are ignored with a hint.
 */
export default function QRScanScreen() {
  const t = useTheme();
  const { t: tr } = useLocale();
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const [permission, requestPermission] = useCameraPermissions();
  const [active, setActive] = useState(true);
  const handled = useRef(false);
  const lastRejected = useRef<string | null>(null);

  // Only one camera preview may run at a time: stop it while another screen is on top.
  useFocusEffect(
    useCallback(() => {
      handled.current = false;
      setActive(true);
      return () => setActive(false);
    }, []),
  );

  const open = (sessionId: string) => {
    handled.current = true;
    setActive(false);
    router.push(`/login/qr/${sessionId}`);
  };

  const onScanned = ({ data }: BarcodeScanningResult) => {
    if (handled.current) return;
    const sessionId = parseQRLoginCode(data, env.webHost ? [env.webHost] : []);
    if (sessionId) {
      log.info('QR sign-in code scanned');
      Haptics.selectionAsync().catch(() => {});
      open(sessionId);
      return;
    }
    if (lastRejected.current === data) return;
    lastRejected.current = data;
    toast.error(tr('mobile.qr.not_otopoly_code'));
  };

  const demo = async () => {
    try {
      const created = await qrLoginService.createDemo();
      open(created.session_id);
    } catch (error) {
      log.warn('Demo QR session failed', error);
    }
  };

  const header = <Header title={tr('mobile.qr.scan_title')} subtitle={tr('mobile.qr.scan_subtitle')} />;
  const demoButton = isMock ? <Button variant="ghost" label={tr('mobile.qr.demo_session')} onPress={demo} /> : null;

  if (!permission) {
    return (
      <Screen header={header}>
        <EmptyState icon={<Camera size={28} color={t.colors.textMuted} />} title={tr('common.loading')} description={tr('mobile.qr.camera_body')} />
      </Screen>
    );
  }

  if (!permission.granted) {
    const blocked = !permission.canAskAgain;
    return (
      <Screen header={header}>
        <EmptyState
          icon={<Camera size={28} color={t.colors.textMuted} />}
          title={tr('mobile.qr.camera_title')}
          description={blocked ? tr('mobile.qr.camera_blocked') : tr('mobile.qr.camera_body')}
          action={
            <View style={{ gap: t.spacing.sm, alignSelf: 'stretch' }}>
              <Button
                label={blocked ? tr('mobile.qr.open_settings') : tr('mobile.qr.allow_camera')}
                onPress={() => (blocked ? Linking.openSettings() : requestPermission())}
              />
              {demoButton}
            </View>
          }
        />
      </Screen>
    );
  }

  return (
    <Screen header={header} scroll={false}>
      <View style={styles.cameraWrap}>
        {active ? (
          <CameraView
            style={StyleSheet.absoluteFill}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
            onBarcodeScanned={onScanned}
          />
        ) : null}
        <View pointerEvents="none" style={styles.overlay}>
          <View style={[styles.frame, { borderColor: t.colors.onPrimary }]} />
        </View>
      </View>
      <View style={{ padding: t.spacing.lg, paddingBottom: insets.bottom + t.spacing.lg, gap: t.spacing.sm, alignItems: 'center' }}>
        <QrCode size={22} color={t.colors.textSecondary} />
        <Txt tone="secondary" style={{ textAlign: 'center' }}>
          {tr('mobile.qr.scan_hint')}
        </Txt>
        {demoButton}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  cameraWrap: { flex: 1, marginHorizontal: 16, borderRadius: 20, overflow: 'hidden', backgroundColor: '#000' },
  overlay: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' },
  frame: { width: 240, height: 240, borderWidth: 3, borderRadius: 24 },
});
