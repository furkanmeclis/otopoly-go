/**
 * Intro carousel shown once per device before the first sign-in (`(auth)/_layout` guards it with
 * `introSeen`). Icon-based slides in brand colours; Skip / Sign in mark it seen and open the login.
 */
import { router } from 'expo-router';
import { CarFront, ClipboardList, FileSignature, FileText, MessageCircle, QrCode, Sparkles, Users, type LucideIcon } from 'lucide-react-native';
import { useRef, useState } from 'react';
import { Pressable, ScrollView, useWindowDimensions, View, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { BrandMark } from '@/components/brand';
import { Button, Txt } from '@/components/ui';
import { useAuth } from '@/features/auth/auth-provider';
import { useLocale } from '@/lib/i18n/provider';
import { useTheme } from '@/theme/provider';

type Slide = { key: string; icon: LucideIcon; satellites: [LucideIcon, LucideIcon]; title: string; body: string };

export default function WelcomeScreen() {
  const t = useTheme();
  const { t: tr } = useLocale();
  const { markIntroSeen } = useAuth();
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const scroller = useRef<ScrollView>(null);
  const [index, setIndex] = useState(0);

  const slides: Slide[] = [
    { key: 'jobs', icon: ClipboardList, satellites: [CarFront, Users], title: tr('mobile.onboarding.intro.jobs_title'), body: tr('mobile.onboarding.intro.jobs_body') },
    { key: 'docs', icon: FileSignature, satellites: [FileText, MessageCircle], title: tr('mobile.onboarding.intro.docs_title'), body: tr('mobile.onboarding.intro.docs_body') },
    { key: 'team', icon: Users, satellites: [QrCode, Sparkles], title: tr('mobile.onboarding.intro.team_title'), body: tr('mobile.onboarding.intro.team_body') },
  ];
  const last = index === slides.length - 1;

  const finish = () => {
    markIntroSeen();
    // The guard also drops this screen; replacing makes the hand-off explicit.
    router.replace('/login');
  };

  const goTo = (i: number) => {
    scroller.current?.scrollTo({ x: i * width, animated: true });
    setIndex(i);
  };

  const onScrollEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const i = Math.round(e.nativeEvent.contentOffset.x / Math.max(1, width));
    if (i !== index) setIndex(Math.min(Math.max(i, 0), slides.length - 1));
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.colors.background }} edges={['top']}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: t.spacing.lg, paddingTop: t.spacing.sm }}>
        <BrandMark height={28} />
        {!last ? (
          <Pressable onPress={finish} accessibilityRole="button" accessibilityLabel={tr('mobile.onboarding.intro.skip')} hitSlop={8} style={{ padding: t.spacing.sm, minHeight: 44, justifyContent: 'center' }}>
            <Txt variant="bodyStrong" tone="secondary">
              {tr('mobile.onboarding.intro.skip')}
            </Txt>
          </Pressable>
        ) : (
          <View style={{ height: 44 }} />
        )}
      </View>

      <ScrollView
        ref={scroller}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={onScrollEnd}
        style={{ flex: 1 }}
>
        {slides.map((slide, i) => (
          <View key={slide.key} style={{ width, paddingHorizontal: t.spacing.xl, alignItems: 'center', justifyContent: 'center', gap: t.spacing.xl }} importantForAccessibility={i === index ? 'auto' : 'no-hide-descendants'}>
            <Illustration slide={slide} />
            <View style={{ gap: t.spacing.sm, maxWidth: 420 }}>
              <Txt variant="display" accessibilityRole="header" style={{ textAlign: 'center' }}>
                {slide.title}
              </Txt>
              <Txt tone="secondary" style={{ textAlign: 'center', lineHeight: 22 }}>
                {slide.body}
              </Txt>
            </View>
          </View>
        ))}
      </ScrollView>

      <View style={{ paddingHorizontal: t.spacing.lg, paddingTop: t.spacing.md, paddingBottom: Math.max(insets.bottom, t.spacing.lg), gap: t.spacing.lg }}>
        <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 8 }} accessible={false} importantForAccessibility="no-hide-descendants">
          {slides.map((slide, i) => (
            <View key={slide.key} style={{ width: i === index ? 22 : 8, height: 8, borderRadius: 4, backgroundColor: i === index ? t.colors.primary : t.colors.borderStrong }} />
          ))}
        </View>
        {last ? (
          <Button label={tr('mobile.onboarding.intro.sign_in')} size="lg" onPress={finish} />
        ) : (
          <Button
            label={tr('mobile.onboarding.intro.next')}
            accessibilityHint={tr('mobile.onboarding.intro.page', { current: index + 1, total: slides.length })}
            size="lg"
            onPress={() => goTo(index + 1)}
          />
        )}
      </View>
    </SafeAreaView>
  );
}

function Illustration({ slide }: { slide: Slide }) {
  const t = useTheme();
  const Main = slide.icon;
  const [A, B] = slide.satellites;
  const chip = (Icon: LucideIcon, position: { top?: number; bottom?: number; left?: number; right?: number }) => (
    <View
      style={{
        position: 'absolute',
        ...position,
        width: 56,
        height: 56,
        borderRadius: 18,
        backgroundColor: t.colors.surface,
        borderWidth: 1,
        borderColor: t.colors.border,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Icon size={26} color={t.colors.primary} />
    </View>
  );
  return (
    <View style={{ width: 220, height: 220, alignItems: 'center', justifyContent: 'center' }} accessible={false} importantForAccessibility="no-hide-descendants">
      <View style={{ width: 200, height: 200, borderRadius: 100, backgroundColor: t.colors.primarySoft, alignItems: 'center', justifyContent: 'center' }}>
        <View style={{ width: 108, height: 108, borderRadius: 32, backgroundColor: t.colors.primary, alignItems: 'center', justifyContent: 'center' }}>
          <Main size={52} color={t.colors.onPrimary} />
        </View>
      </View>
      {chip(A, { top: 6, right: 0 })}
      {chip(B, { bottom: 10, left: 0 })}
    </View>
  );
}
