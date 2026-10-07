import { useCallback, useEffect, useRef } from 'react';
import { Pressable, StyleSheet, useWindowDimensions } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  Extrapolation,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Txt } from '@/components/ui';
import { useLocale } from '@/lib/i18n/provider';
import { useTheme } from '@/theme/provider';

import { IntroScene } from './intro-scene';

type LaunchIntroProps = {
  compact?: boolean;
  onDone: () => void;
};

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export function LaunchIntro({ compact = false, onDone }: LaunchIntroProps) {
  const t = useTheme();
  const { t: tr } = useLocale();
  const reduceMotion = useReducedMotion();
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const progress = useSharedValue(reduceMotion ? 2.2 : 0);
  const exit = useSharedValue(0);
  const compactRef = useRef(compact);
  const reduceMotionRef = useRef(reduceMotion);
  const onDoneRef = useRef(onDone);
  const exitStartedRef = useRef(false);
  const doneRef = useRef(false);
  const compactUpdateSeenRef = useRef(false);

  useEffect(() => {
    onDoneRef.current = onDone;
  }, [onDone]);

  useEffect(() => {
    reduceMotionRef.current = reduceMotion;
  }, [reduceMotion]);

  const finishOnce = useCallback(() => {
    if (doneRef.current) return;
    doneRef.current = true;
    onDoneRef.current();
  }, []);

  const startExit = useCallback(() => {
    if (exitStartedRef.current) return;
    exitStartedRef.current = true;
    cancelAnimation(progress);
    cancelAnimation(exit);
    exit.set(withTiming(1, { duration: reduceMotionRef.current ? 140 : 280, easing: Easing.out(Easing.cubic) }, (done) => {
      if (done) {
        runOnJS(finishOnce)();
      }
    }));
  }, [exit, finishOnce, progress]);

  useEffect(() => {
    compactRef.current = compact;
    if (!compactUpdateSeenRef.current) {
      compactUpdateSeenRef.current = true;
      return;
    }
    if (compact) startExit();
  }, [compact, startExit]);

  useEffect(() => {
    const isCompact = compactRef.current;
    if (reduceMotionRef.current) {
      const timer = setTimeout(startExit, isCompact ? 260 : 520);
      return () => clearTimeout(timer);
    }
    progress.set(withTiming(2.2, { duration: isCompact ? 850 : 2100, easing: Easing.bezier(0.22, 1, 0.36, 1) }, (done) => {
      if (done) {
        runOnJS(startExit)();
      }
    }));
    return () => {
      cancelAnimation(progress);
      cancelAnimation(exit);
    };
  }, [exit, progress, startExit]);

  const overlayStyle = useAnimatedStyle(() => ({
    opacity: 1 - exit.value,
    transform: [
      { scale: interpolate(exit.value, [0, 1], [1, 1.045], Extrapolation.CLAMP) },
      { translateY: interpolate(exit.value, [0, 1], [0, -10], Extrapolation.CLAMP) },
    ],
  }));
  const copyStyle = useAnimatedStyle(() => ({
    opacity: reduceMotion ? 1 - exit.value : interpolate(progress.value, [0.24, 0.55, 1.8, 2.2], [0, 1, 1, 0], Extrapolation.CLAMP),
    transform: [{ translateY: reduceMotion ? 0 : interpolate(progress.value, [0.24, 0.7, 2.2], [14, 0, -8], Extrapolation.CLAMP) }],
  }), [reduceMotion]);

  return (
    <AnimatedPressable
      accessibilityRole="button"
      accessibilityLabel={tr('mobile.onboarding.launch.skip')}
      onPress={startExit}
      style={[StyleSheet.absoluteFill, styles.root, { backgroundColor: t.colors.background, paddingTop: insets.top, paddingBottom: insets.bottom }, overlayStyle]}
    >
      <IntroScene progress={progress} width={Math.min(width - 24, 430)} height={Math.min(430, height * 0.56)} reduceMotion={reduceMotion} mode="launch" />
      <Animated.View style={[styles.copy, { paddingHorizontal: t.spacing.xl }, copyStyle]}>
        <Txt variant="title" style={{ textAlign: 'center' }}>
          {tr('mobile.onboarding.launch.title')}
        </Txt>
        <Txt tone="secondary" style={{ textAlign: 'center', lineHeight: 21 }}>
          {tr('mobile.onboarding.launch.body')}
        </Txt>
      </Animated.View>
    </AnimatedPressable>
  );
}

const styles = StyleSheet.create({
  root: {
    zIndex: 1000,
    alignItems: 'center',
    justifyContent: 'center',
  },
  copy: {
    position: 'absolute',
    bottom: '12%',
    gap: 8,
    maxWidth: 390,
  },
});
