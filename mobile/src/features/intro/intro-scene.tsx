import { Check, CheckCheck, FileSignature, MessageCircle, Sparkles } from 'lucide-react-native';
import { memo, type ReactNode } from 'react';
import { StyleSheet, View, type ViewStyle } from 'react-native';
import Animated, {
  Extrapolation,
  interpolate,
  type SharedValue,
  useAnimatedStyle,
} from 'react-native-reanimated';
import Svg, { Circle } from 'react-native-svg';

import { BrandMark } from '@/components/brand';
import { Txt } from '@/components/ui';
import { useTheme } from '@/theme/provider';
import type { Theme } from '@/theme/tokens';

type IntroSceneProps = {
  progress: SharedValue<number>;
  width: number;
  height?: number;
  reduceMotion?: boolean;
  mode?: 'launch' | 'carousel';
};

const AnimatedView = Animated.View;

export const IntroScene = memo(function IntroScene({
  progress,
  width,
  height = 360,
  reduceMotion = false,
  mode = 'carousel',
}: IntroSceneProps) {
  const t = useTheme();
  const compact = width < 360;
  const sceneWidth = Math.min(width, 420);
  const sceneHeight = Math.max(300, height);
  const styles = makeSceneStyles(t, sceneWidth, sceneHeight, compact, mode);
  const brandStyle = usePopStyle(progress, reduceMotion, -0.05, 0.7, 0, 0.98);
  const boardStyle = useBoardStyle(progress, reduceMotion);
  const messageStyle = useFloatStyle(progress, reduceMotion, 0.72, 1.65, -34, 16, -8);
  const contractStyle = useFloatStyle(progress, reduceMotion, 1.28, 2.15, 28, -18, 7);
  const sparkStyle = useSparkStyle(progress, reduceMotion);

  return (
    <View style={[styles.stage, { width: sceneWidth, height: sceneHeight }]} accessible={false} importantForAccessibility="no-hide-descendants">
      <GlowLayer progress={progress} reduceMotion={reduceMotion} style={styles.glowA} from={0} to={2} scale={1.08} />
      <GlowLayer progress={progress} reduceMotion={reduceMotion} style={styles.glowB} from={1} to={2} scale={0.92} />

      <AnimatedView style={[styles.brandHalo, brandStyle]}>
        <BrandMark height={compact ? 34 : 40} />
      </AnimatedView>

      <AnimatedView style={[styles.board, boardStyle]}>
        <View style={styles.boardTop}>
          <View style={styles.windowDots}>
            <View style={styles.dot} />
            <View style={styles.dot} />
            <View style={styles.dot} />
          </View>
          <Txt variant="caption" tone="muted" numberOfLines={1}>
            Otopoly
          </Txt>
          <View style={styles.livePill}>
            <View style={styles.liveDot} />
            <Txt variant="caption" style={styles.liveText}>
              live
            </Txt>
          </View>
        </View>

        <View style={styles.columns}>
          <MiniColumn label="In" color={t.colors.warning} muted />
          <MiniColumn label="Ready" color={t.colors.success}>
            <MovingJobCard progress={progress} reduceMotion={reduceMotion} />
          </MiniColumn>
          <MiniColumn label="Done" color={t.colors.info} muted />
        </View>
      </AnimatedView>

      <AnimatedView style={[styles.messageCard, messageStyle]}>
        <View style={styles.messageIcon}>
          <MessageCircle size={18} color={t.colors.success} />
        </View>
        <View style={{ flex: 1, gap: 3 }}>
          <Txt variant="caption" tone="secondary" numberOfLines={1}>
            WhatsApp
          </Txt>
          <Txt variant="bodyStrong" numberOfLines={1} style={styles.smallLine}>
            34 TKO 34 ready
          </Txt>
        </View>
        <CheckCheck size={18} color={t.colors.success} />
      </AnimatedView>

      <AnimatedView style={[styles.contractCard, contractStyle]}>
        <View style={styles.contractIcon}>
          <FileSignature size={20} color={t.colors.primary} />
        </View>
        <View style={{ flex: 1, gap: 5 }}>
          <View style={styles.contractLineWide} />
          <View style={styles.contractLine} />
          <View style={styles.signatureLine} />
        </View>
        <View style={styles.okBadge}>
          <Check size={14} color={t.colors.onPrimary} />
        </View>
      </AnimatedView>

      <AnimatedView style={[styles.spark, sparkStyle]}>
        <Sparkles size={22} color={t.colors.primary} />
      </AnimatedView>
    </View>
  );
});

function MiniColumn({ label, color, muted, children }: { label: string; color: string; muted?: boolean; children?: ReactNode }) {
  const t = useTheme();
  return (
    <View style={[stylesBase.column, { backgroundColor: muted ? t.colors.surfaceSunken : t.colors.surfaceAlt, borderColor: t.colors.border }]}>
      <View style={stylesBase.columnHead}>
        <View style={[stylesBase.columnDot, { backgroundColor: color }]} />
        <Txt variant="caption" tone="secondary" numberOfLines={1}>
          {label}
        </Txt>
      </View>
      {children ?? (
        <View style={{ gap: 6 }}>
          <View style={[stylesBase.skeleton, { backgroundColor: t.colors.skeleton, width: '82%' }]} />
          <View style={[stylesBase.skeleton, { backgroundColor: t.colors.skeleton, width: '58%' }]} />
        </View>
      )}
    </View>
  );
}

function MovingJobCard({ progress, reduceMotion }: { progress: SharedValue<number>; reduceMotion: boolean }) {
  const t = useTheme();
  const cardStyle = useAnimatedStyle(() => {
    if (reduceMotion) return { opacity: 1, transform: [{ translateX: 0 }, { translateY: 0 }, { scale: 1 }] };
    const p = progress.value;
    return {
      opacity: interpolate(p, [0, 0.18, 1.95, 2.2], [0, 1, 1, 0.92], Extrapolation.CLAMP),
      transform: [
        { translateX: interpolate(p, [0, 0.9, 1.35, 2.15], [-70, -34, 0, 22], Extrapolation.CLAMP) },
        { translateY: interpolate(p, [0, 0.9, 1.35, 2.15], [38, 12, 0, -6], Extrapolation.CLAMP) },
        { scale: interpolate(p, [0, 0.28, 1.45, 2.15], [0.82, 1, 1.02, 0.98], Extrapolation.CLAMP) },
      ],
    };
  }, [reduceMotion]);
  const pillStyle = useAnimatedStyle(() => ({
    opacity: reduceMotion ? 1 : interpolate(progress.value, [0.65, 1.05], [0, 1], Extrapolation.CLAMP),
  }), [reduceMotion]);
  return (
    <AnimatedView style={[stylesBase.jobCard, { backgroundColor: t.colors.surface, borderColor: t.colors.border }, cardStyle]}>
      <View style={stylesBase.plate}>
        <Txt variant="mono" style={{ fontSize: 12, color: '#111827' }}>
          34 TKO 34
        </Txt>
      </View>
      <Txt variant="caption" tone="secondary" numberOfLines={1}>
        Ceramic coat
      </Txt>
      <AnimatedView style={[stylesBase.readyPill, { backgroundColor: t.colors.successBg }, pillStyle]}>
        <Txt variant="caption" style={{ color: t.colors.success, fontWeight: t.fontWeight.bold }}>
          ready
        </Txt>
      </AnimatedView>
    </AnimatedView>
  );
}

function GlowLayer({
  progress,
  reduceMotion,
  style,
  from,
  to,
  scale,
}: {
  progress: SharedValue<number>;
  reduceMotion: boolean;
  style: ViewStyle;
  from: number;
  to: number;
  scale: number;
}) {
  const animated = useAnimatedStyle(() => {
    if (reduceMotion) return { opacity: 0.45, transform: [{ scale }] };
    return {
      opacity: interpolate(progress.value, [from, (from + to) / 2, to], [0.16, 0.54, 0.28], Extrapolation.CLAMP),
      transform: [
        { scale: interpolate(progress.value, [from, to], [scale * 0.92, scale * 1.08], Extrapolation.CLAMP) },
        { rotate: `${interpolate(progress.value, [from, to], [-7, 8], Extrapolation.CLAMP)}deg` },
      ],
    };
  }, [from, reduceMotion, scale, to]);
  return (
    <AnimatedView style={[style, animated]}>
      <Svg width="100%" height="100%" viewBox="0 0 200 200">
        <Circle cx="100" cy="100" r="78" fill="rgba(234,110,67,0.20)" />
        <Circle cx="118" cy="84" r="58" fill="rgba(37,99,235,0.13)" />
        <Circle cx="74" cy="118" r="50" fill="rgba(21,128,61,0.13)" />
      </Svg>
    </AnimatedView>
  );
}

function usePopStyle(progress: SharedValue<number>, reduceMotion: boolean, from: number, to: number, y: number, maxScale: number) {
  return useAnimatedStyle(() => {
    if (reduceMotion) return { opacity: 1, transform: [{ translateY: 0 }, { scale: maxScale }] };
    return {
      opacity: interpolate(progress.value, [from, from + 0.15, to], [0, 1, 1], Extrapolation.CLAMP),
      transform: [
        { translateY: interpolate(progress.value, [from, to], [y + 16, y], Extrapolation.CLAMP) },
        { scale: interpolate(progress.value, [from, to], [0.8, maxScale], Extrapolation.CLAMP) },
      ],
    };
  }, [from, maxScale, reduceMotion, to, y]);
}

function useBoardStyle(progress: SharedValue<number>, reduceMotion: boolean) {
  return useAnimatedStyle(() => {
    if (reduceMotion) return { opacity: 1, transform: [{ translateY: 0 }, { scale: 1 }, { rotate: '-1deg' }] };
    return {
      opacity: interpolate(progress.value, [0.05, 0.38], [0, 1], Extrapolation.CLAMP),
      transform: [
        { translateY: interpolate(progress.value, [0.05, 0.7, 2.2], [34, 0, -8], Extrapolation.CLAMP) },
        { scale: interpolate(progress.value, [0.05, 0.72, 2.2], [0.9, 1, 0.98], Extrapolation.CLAMP) },
        { rotate: `${interpolate(progress.value, [0, 2.2], [-4, 2], Extrapolation.CLAMP)}deg` },
      ],
    };
  }, [reduceMotion]);
}

function useFloatStyle(progress: SharedValue<number>, reduceMotion: boolean, from: number, to: number, x: number, y: number, rotate: number) {
  return useAnimatedStyle(() => {
    if (reduceMotion) return { opacity: 1, transform: [{ translateX: x }, { translateY: y }, { rotate: `${rotate}deg` }, { scale: 1 }] };
    return {
      opacity: interpolate(progress.value, [from, from + 0.22, to], [0, 1, 1], Extrapolation.CLAMP),
      transform: [
        { translateX: interpolate(progress.value, [from, to], [x * 0.55, x], Extrapolation.CLAMP) },
        { translateY: interpolate(progress.value, [from, to], [y + 26, y], Extrapolation.CLAMP) },
        { rotate: `${interpolate(progress.value, [from, to], [rotate * 0.2, rotate], Extrapolation.CLAMP)}deg` },
        { scale: interpolate(progress.value, [from, from + 0.25, to], [0.88, 1, 1], Extrapolation.CLAMP) },
      ],
    };
  }, [from, reduceMotion, rotate, to, x, y]);
}

function useSparkStyle(progress: SharedValue<number>, reduceMotion: boolean) {
  return useAnimatedStyle(() => {
    if (reduceMotion) return { opacity: 0.8, transform: [{ scale: 1 }, { rotate: '0deg' }] };
    return {
      opacity: interpolate(progress.value, [1.55, 1.75, 2.2], [0, 1, 0.4], Extrapolation.CLAMP),
      transform: [
        { translateY: interpolate(progress.value, [1.55, 2.2], [12, -8], Extrapolation.CLAMP) },
        { scale: interpolate(progress.value, [1.55, 1.8, 2.2], [0.6, 1.2, 0.95], Extrapolation.CLAMP) },
        { rotate: `${interpolate(progress.value, [1.55, 2.2], [-20, 18], Extrapolation.CLAMP)}deg` },
      ],
    };
  }, [reduceMotion]);
}

function makeSceneStyles(t: Theme, width: number, height: number, compact: boolean, mode: 'launch' | 'carousel') {
  const boardW = Math.min(width - 30, compact ? 300 : 340);
  const boardH = compact ? 156 : 174;
  const centerTop = mode === 'launch' ? height * 0.35 : height * 0.28;
  return StyleSheet.create({
    stage: {
      alignItems: 'center',
      justifyContent: 'center',
    },
    glowA: {
      position: 'absolute',
      top: centerTop - 136,
      width: 270,
      height: 270,
    },
    glowB: {
      position: 'absolute',
      top: centerTop - 84,
      right: compact ? -26 : 4,
      width: 190,
      height: 190,
    },
    brandHalo: {
      position: 'absolute',
      top: Math.max(10, centerTop - 132),
      paddingHorizontal: t.spacing.lg,
      paddingVertical: t.spacing.md,
      borderRadius: t.radius.lg,
      backgroundColor: t.scheme === 'dark' ? 'rgba(28,23,20,0.82)' : 'rgba(255,255,255,0.78)',
      borderWidth: 1,
      borderColor: t.colors.border,
      ...t.shadow.sm,
    },
    board: {
      position: 'absolute',
      top: centerTop - 54,
      width: boardW,
      height: boardH,
      borderRadius: t.radius.lg,
      overflow: 'hidden',
      borderWidth: 1,
      borderColor: t.colors.border,
      backgroundColor: t.scheme === 'dark' ? 'rgba(28,23,20,0.94)' : 'rgba(255,255,255,0.95)',
      ...t.shadow.md,
    },
    boardTop: {
      height: 38,
      paddingHorizontal: t.spacing.md,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      borderBottomWidth: 1,
      borderBottomColor: t.colors.border,
    },
    windowDots: {
      flexDirection: 'row',
      gap: 5,
    },
    dot: {
      width: 7,
      height: 7,
      borderRadius: 4,
      backgroundColor: t.colors.borderStrong,
    },
    livePill: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
      borderRadius: t.radius.full,
      backgroundColor: t.colors.successBg,
      paddingHorizontal: 7,
      paddingVertical: 3,
    },
    liveDot: {
      width: 6,
      height: 6,
      borderRadius: 3,
      backgroundColor: t.colors.success,
    },
    liveText: {
      color: t.colors.success,
      fontSize: 10,
      fontWeight: t.fontWeight.bold,
    },
    columns: {
      flex: 1,
      flexDirection: 'row',
      gap: 8,
      padding: t.spacing.sm,
    },
    messageCard: {
      position: 'absolute',
      top: centerTop + boardH - 56,
      width: compact ? 250 : 282,
      minHeight: 66,
      borderRadius: t.radius.lg,
      backgroundColor: t.colors.surface,
      borderWidth: 1,
      borderColor: t.colors.border,
      padding: t.spacing.md,
      flexDirection: 'row',
      alignItems: 'center',
      gap: t.spacing.sm,
      ...t.shadow.md,
    },
    messageIcon: {
      width: 34,
      height: 34,
      borderRadius: 12,
      backgroundColor: t.colors.successBg,
      alignItems: 'center',
      justifyContent: 'center',
    },
    smallLine: {
      fontSize: 13,
    },
    contractCard: {
      position: 'absolute',
      top: centerTop + boardH - 8,
      width: compact ? 230 : 260,
      minHeight: 78,
      borderRadius: t.radius.lg,
      backgroundColor: t.colors.surface,
      borderWidth: 1,
      borderColor: t.colors.border,
      padding: t.spacing.md,
      flexDirection: 'row',
      alignItems: 'center',
      gap: t.spacing.sm,
      ...t.shadow.md,
    },
    contractIcon: {
      width: 38,
      height: 38,
      borderRadius: 13,
      backgroundColor: t.colors.primarySoft,
      alignItems: 'center',
      justifyContent: 'center',
    },
    contractLineWide: {
      width: '92%',
      height: 8,
      borderRadius: 4,
      backgroundColor: t.colors.skeleton,
    },
    contractLine: {
      width: '62%',
      height: 8,
      borderRadius: 4,
      backgroundColor: t.colors.skeleton,
    },
    signatureLine: {
      width: '72%',
      height: 2,
      borderRadius: 1,
      backgroundColor: t.colors.primary,
      marginTop: 4,
    },
    okBadge: {
      width: 24,
      height: 24,
      borderRadius: 12,
      backgroundColor: t.colors.primary,
      alignItems: 'center',
      justifyContent: 'center',
    },
    spark: {
      position: 'absolute',
      top: centerTop + 8,
      right: compact ? 18 : 34,
      width: 42,
      height: 42,
      borderRadius: 21,
      backgroundColor: t.colors.primarySoft,
      alignItems: 'center',
      justifyContent: 'center',
    },
  });
}

const stylesBase = StyleSheet.create({
  column: {
    flex: 1,
    borderRadius: 10,
    borderWidth: 1,
    padding: 7,
    gap: 8,
  },
  columnHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  columnDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  skeleton: {
    height: 9,
    borderRadius: 5,
  },
  jobCard: {
    borderRadius: 10,
    borderWidth: 1,
    padding: 8,
    gap: 6,
  },
  plate: {
    alignSelf: 'flex-start',
    borderRadius: 5,
    borderWidth: 1,
    borderColor: '#D1D5DB',
    backgroundColor: '#F9FAFB',
    paddingHorizontal: 6,
    paddingVertical: 3,
  },
  readyPill: {
    alignSelf: 'flex-start',
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
});
