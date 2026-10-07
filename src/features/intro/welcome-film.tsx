import { router } from 'expo-router';
import { useRef, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, useWindowDimensions, View, type NativeScrollEvent, type NativeSyntheticEvent, type ScrollViewInstance } from 'react-native';
import Animated, {
  Extrapolation,
  interpolate,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  type SharedValue,
} from 'react-native-reanimated';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { BrandMark } from '@/components/brand';
import { Button, Txt } from '@/components/ui';
import { useAuth } from '@/features/auth/auth-provider';
import { useLocale } from '@/lib/i18n/provider';
import { useMarkInteractive } from '@/lib/monitoring/observe';
import { useTheme } from '@/theme/provider';

import { IntroScene } from './intro-scene';

type Slide = {
  key: string;
  titleKey: string;
  bodyKey: string;
};

const SLIDES: Slide[] = [
  { key: 'jobs', titleKey: 'mobile.onboarding.intro.jobs_title', bodyKey: 'mobile.onboarding.intro.jobs_body' },
  { key: 'docs', titleKey: 'mobile.onboarding.intro.docs_title', bodyKey: 'mobile.onboarding.intro.docs_body' },
  { key: 'team', titleKey: 'mobile.onboarding.intro.team_title', bodyKey: 'mobile.onboarding.intro.team_body' },
];

export function WelcomeFilm() {
  useMarkInteractive();
  const t = useTheme();
  const { t: tr } = useLocale();
  const { markIntroSeen } = useAuth();
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const reduceMotion = useReducedMotion();
  const scrollRef = useRef<ScrollViewInstance>(null);
  const scrollX = useSharedValue(0);
  const progress = useSharedValue(0);
  const [index, setIndex] = useState(0);
  const last = index === SLIDES.length - 1;

  const finish = () => {
    markIntroSeen();
    router.replace('/login');
  };

  const goTo = (i: number) => {
    scrollRef.current?.scrollTo({ x: i * width, animated: true });
    setIndex(i);
  };

  const onScroll = useAnimatedScrollHandler({
    onScroll: (event) => {
      scrollX.value = event.contentOffset.x;
      progress.value = event.contentOffset.x / Math.max(1, event.layoutMeasurement.width);
    },
  });

  const onMomentumScrollEnd = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const next = Math.round(event.nativeEvent.contentOffset.x / Math.max(1, width));
    setIndex(Math.min(Math.max(next, 0), SLIDES.length - 1));
  };

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: t.colors.background }]} edges={['top']}>
      <View style={[styles.header, { paddingHorizontal: t.spacing.lg, paddingTop: t.spacing.sm }]}>
        <BrandMark height={28} />
        {!last ? (
          <Pressable
            onPress={finish}
            accessibilityRole="button"
            accessibilityLabel={tr('mobile.onboarding.intro.skip')}
            hitSlop={8}
            style={{ padding: t.spacing.sm, minHeight: 44, justifyContent: 'center' }}
          >
            <Txt variant="bodyStrong" tone="secondary">
              {tr('mobile.onboarding.intro.skip')}
            </Txt>
          </Pressable>
        ) : (
          <View style={{ height: 44 }} />
        )}
      </View>

      <View style={styles.film}>
        <IntroScene
          progress={progress}
          width={Math.min(width - t.spacing.xl * 2, 430)}
          height={Math.min(390, Math.max(320, height * 0.46))}
          reduceMotion={reduceMotion}
          mode="carousel"
        />
      </View>

      <Animated.ScrollView
        ref={scrollRef}
        horizontal
        pagingEnabled
        bounces={false}
        scrollEventThrottle={16}
        showsHorizontalScrollIndicator={false}
        onScroll={onScroll}
        onMomentumScrollEnd={onMomentumScrollEnd}
        style={styles.copyScroller}
      >
        {SLIDES.map((slide, i) => (
          <View key={slide.key} style={[styles.slideCopy, { width, paddingHorizontal: t.spacing.xl }]} importantForAccessibility={i === index ? 'auto' : 'no-hide-descendants'}>
            <AnimatedSlideCopy progress={progress} index={i} reduceMotion={reduceMotion}>
              <Txt variant="display" accessibilityRole="header" style={styles.title}>
                {tr(slide.titleKey)}
              </Txt>
              <Txt tone="secondary" style={styles.body}>
                {tr(slide.bodyKey)}
              </Txt>
            </AnimatedSlideCopy>
          </View>
        ))}
      </Animated.ScrollView>

      <View style={[styles.footer, { paddingHorizontal: t.spacing.lg, paddingTop: t.spacing.md, paddingBottom: Math.max(insets.bottom, t.spacing.lg) }]}>
        <View style={styles.dots} accessible={false} importantForAccessibility="no-hide-descendants">
          {SLIDES.map((slide, i) => (
            <PageDot key={slide.key} scrollX={scrollX} pageWidth={width} index={i} />
          ))}
        </View>
        <AnimatedButtonShell progress={progress} reduceMotion={reduceMotion}>
          <Button
            label={last ? tr('mobile.onboarding.intro.sign_in') : tr('mobile.onboarding.intro.next')}
            accessibilityHint={tr('mobile.onboarding.intro.page', { current: index + 1, total: SLIDES.length })}
            size="lg"
            onPress={last ? finish : () => goTo(index + 1)}
          />
        </AnimatedButtonShell>
      </View>
    </SafeAreaView>
  );
}

function AnimatedSlideCopy({
  progress,
  index,
  reduceMotion,
  children,
}: {
  progress: SharedValue<number>;
  index: number;
  reduceMotion: boolean;
  children: ReactNode;
}) {
  const animated = useAnimatedStyle(() => {
    if (reduceMotion) return { opacity: 1, transform: [{ translateY: 0 }] };
    const distance = Math.abs(progress.value - index);
    return {
      opacity: interpolate(distance, [0, 0.55, 1], [1, 0.58, 0.2], Extrapolation.CLAMP),
      transform: [{ translateY: interpolate(distance, [0, 1], [0, 16], Extrapolation.CLAMP) }],
    };
  }, [index, reduceMotion]);
  return <Animated.View style={[styles.copyBlock, animated]}>{children}</Animated.View>;
}

function PageDot({ scrollX, pageWidth, index }: { scrollX: SharedValue<number>; pageWidth: number; index: number }) {
  const t = useTheme();
  const animated = useAnimatedStyle(() => {
    const input = [(index - 1) * pageWidth, index * pageWidth, (index + 1) * pageWidth];
    return {
      width: interpolate(scrollX.value, input, [8, 26, 8], Extrapolation.CLAMP),
      opacity: interpolate(scrollX.value, input, [0.45, 1, 0.45], Extrapolation.CLAMP),
    };
  }, [index, pageWidth]);
  return <Animated.View style={[styles.dot, { backgroundColor: t.colors.primary }, animated]} />;
}

function AnimatedButtonShell({ progress, reduceMotion, children }: { progress: SharedValue<number>; reduceMotion: boolean; children: ReactNode }) {
  const animated = useAnimatedStyle(() => {
    if (reduceMotion) return { transform: [{ scale: 1 }] };
    return {
      transform: [{ scale: interpolate(progress.value % 1, [0, 0.5, 1], [1, 0.985, 1], Extrapolation.CLAMP) }],
    };
  }, [reduceMotion]);
  return <Animated.View style={animated}>{children}</Animated.View>;
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  film: {
    alignItems: 'center',
    justifyContent: 'center',
    flex: 1.04,
  },
  copyScroller: {
    flexGrow: 0,
    flexShrink: 0,
  },
  slideCopy: {
    justifyContent: 'center',
    minHeight: 168,
  },
  copyBlock: {
    alignSelf: 'center',
    maxWidth: 430,
    gap: 10,
  },
  title: {
    textAlign: 'center',
  },
  body: {
    textAlign: 'center',
    lineHeight: 22,
  },
  footer: {
    gap: 18,
  },
  dots: {
    height: 10,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
  },
  dot: {
    height: 8,
    borderRadius: 4,
  },
});
