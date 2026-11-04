import { AccessoryWidgetBackground, HStack, Image, Text, VStack, ZStack } from '@expo/ui/swift-ui';
import { containerBackground, font, lineLimit, minimumScaleFactor, monospacedDigit, widgetURL } from '@expo/ui/swift-ui/modifiers';
import { createWidget, type WidgetEnvironment } from 'expo-widgets';

import type { TodayWidgetProps } from './types';

/**
 * "Otopoly · Tahsilat" Lock Screen widget (circular / rectangular / inline): the day's collections
 * ("tahsilat": every posted income of the Istanbul day) for members with finance read; a lock for
 * everyone else. Vibrant rendering: hierarchy and SF Symbols only.
 */
const OtopolyCollectedGlance = (props: TodayWidgetProps, environment: WidgetEnvironment) => {
  'widget';
  const family = environment.widgetFamily;
  const v2 = Boolean(props && props.v === 2);
  const ok = v2 && props.state === 'ok' && props.showMoney;
  const url = v2 ? props.links.finance : 'otopoly://finance';
  const hint = !v2 ? 'Otopoly' : props.state !== 'ok' ? (props.state === 'noAccess' ? props.labels.noAccess : props.labels.signedOut) : props.money.state === 'loading' ? props.labels.loading : props.labels.moneyLocked;

  if (family === 'accessoryCircular') {
    return (
      <ZStack modifiers={[containerBackground('clear', 'widget'), widgetURL(url)]}>
        <AccessoryWidgetBackground />
        <VStack spacing={0}>
          <Image systemName={ok ? 'turkishlirasign' : 'lock.fill'} size={11} />
          <Text modifiers={[font({ size: 13, weight: 'bold', design: 'rounded' }), monospacedDigit(), lineLimit(1), minimumScaleFactor(0.4)]}>{ok ? props.stats.collectedCompact : '–'}</Text>
        </VStack>
      </ZStack>
    );
  }

  if (family === 'accessoryInline') {
    return <Text modifiers={[widgetURL(url)]}>{ok ? `${props.labels.collected} ${props.stats.collectedCompact}` : 'Otopoly'}</Text>;
  }

  return (
    <VStack alignment="leading" spacing={1} modifiers={[containerBackground('clear', 'widget'), widgetURL(url)]}>
      <HStack spacing={4}>
        <Image systemName="banknote.fill" size={11} />
        <Text modifiers={[font({ size: 12, weight: 'semibold' }), lineLimit(1)]}>{v2 ? props.labels.collected : 'Otopoly'}</Text>
      </HStack>
      {ok ? (
        <VStack alignment="leading" spacing={0}>
          <Text modifiers={[font({ size: 17, weight: 'bold', design: 'rounded' }), monospacedDigit(), lineLimit(1), minimumScaleFactor(0.6)]}>{props.stats.collected}</Text>
          <Text modifiers={[font({ size: 11 }), monospacedDigit(), lineLimit(1), minimumScaleFactor(0.7)]}>{`${props.labels.cash} ${props.money.cash} · ${props.labels.card} ${props.money.card}`}</Text>
        </VStack>
      ) : (
        <Text modifiers={[font({ size: 12 }), lineLimit(2)]}>{hint}</Text>
      )}
    </VStack>
  );
};

export default createWidget<TodayWidgetProps>('OtopolyCollectedGlance', OtopolyCollectedGlance);
