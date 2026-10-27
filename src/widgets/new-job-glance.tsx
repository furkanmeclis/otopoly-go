import { AccessoryWidgetBackground, HStack, Image, Text, VStack, ZStack } from '@expo/ui/swift-ui';
import { containerBackground, font, lineLimit, widgetURL } from '@expo/ui/swift-ui/modifiers';
import { createWidget, type WidgetEnvironment } from 'expo-widgets';

import type { TodayWidgetProps } from './types';

/**
 * "Otopoly · Yeni iş" Lock Screen shortcut (circular / rectangular): one tap opens the new job form
 * (`otopoly://jobs/new`). It shows no business data, so it looks the same signed in or out.
 */
const OtopolyNewJob = (props: TodayWidgetProps, environment: WidgetEnvironment) => {
  'widget';
  const v2 = Boolean(props && props.v === 2);
  const url = v2 ? props.links.newJob : 'otopoly://jobs/new';
  const label = v2 ? props.labels.newJob : 'Yeni iş';

  if (environment.widgetFamily === 'accessoryRectangular') {
    return (
      <HStack spacing={6} modifiers={[containerBackground('clear', 'widget'), widgetURL(url)]}>
        <Image systemName="plus.circle.fill" size={22} />
        <VStack alignment="leading" spacing={0}>
          <Text modifiers={[font({ size: 15, weight: 'bold' }), lineLimit(1)]}>{label}</Text>
          <Text modifiers={[font({ size: 12 }), lineLimit(1)]}>Otopoly</Text>
        </VStack>
      </HStack>
    );
  }

  return (
    <ZStack modifiers={[containerBackground('clear', 'widget'), widgetURL(url)]}>
      <AccessoryWidgetBackground />
      <VStack spacing={1}>
        <Image systemName="plus" size={18} />
        <Text modifiers={[font({ size: 9, weight: 'semibold' }), lineLimit(1)]}>{label}</Text>
      </VStack>
    </ZStack>
  );
};

export default createWidget<TodayWidgetProps>('OtopolyNewJob', OtopolyNewJob);
