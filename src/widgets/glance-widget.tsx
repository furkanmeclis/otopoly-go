import { AccessoryWidgetBackground, HStack, Image, Text, VStack, ZStack } from '@expo/ui/swift-ui';
import { containerBackground, font, lineLimit, minimumScaleFactor, monospacedDigit, widgetURL } from '@expo/ui/swift-ui/modifiers';
import { createWidget, type WidgetEnvironment } from 'expo-widgets';

import type { TodayWidgetProps } from './types';

/**
 * Lock Screen widget. Lock Screen widgets render in `vibrant` mode (the system tints everything),
 * so this one relies on hierarchy and SF Symbols rather than brand colours.
 * Shares its props with the home-screen widget.
 */
const OtopolyGlance = (props: TodayWidgetProps, environment: WidgetEnvironment) => {
  'widget';
  const family = environment.widgetFamily;
  const ok = Boolean(props && props.v === 1 && props.state === 'ok');
  const url = 'otopoly://operations';
  const active = ok ? props.stats.inProgress : 0;
  const ready = ok ? props.stats.ready : 0;

  if (family === 'accessoryCircular') {
    return (
      <ZStack modifiers={[containerBackground('clear', 'widget'), widgetURL(url)]}>
        <AccessoryWidgetBackground />
        <VStack spacing={0}>
          <Image systemName={ok ? 'car.fill' : 'lock.fill'} size={12} />
          <Text modifiers={[font({ size: 20, weight: 'bold', design: 'rounded' }), monospacedDigit()]}>{ok ? String(active) : '–'}</Text>
        </VStack>
      </ZStack>
    );
  }

  if (family === 'accessoryInline') {
    return (
      <Text modifiers={[widgetURL(url)]}>
        {ok ? `${active} ${props.labels.inProgress} · ${ready} ${props.labels.ready}` : 'Otopoly'}
      </Text>
    );
  }

  // accessoryRectangular
  return (
    <VStack alignment="leading" spacing={1} modifiers={[containerBackground('clear', 'widget'), widgetURL(url)]}>
      <HStack spacing={4}>
        <Image systemName="car.fill" size={11} />
        <Text modifiers={[font({ size: 13, weight: 'bold' }), lineLimit(1)]}>{ok ? props.org : 'Otopoly'}</Text>
      </HStack>
      {ok ? (
        <VStack alignment="leading" spacing={1}>
          <Text modifiers={[font({ size: 13 }), monospacedDigit(), lineLimit(1)]}>{`${active} ${props.labels.inProgress} · ${ready} ${props.labels.ready}`}</Text>
          {props.showMoney ? (
            <Text modifiers={[font({ size: 13, weight: 'semibold' }), monospacedDigit(), lineLimit(1), minimumScaleFactor(0.7)]}>{props.stats.collected}</Text>
          ) : (
            <Text modifiers={[font({ size: 13 }), monospacedDigit(), lineLimit(1)]}>{`${props.stats.delivered} ${props.labels.delivered}`}</Text>
          )}
        </VStack>
      ) : (
        <Text modifiers={[font({ size: 12 }), lineLimit(2)]}>{props && props.v === 1 ? (props.state === 'noAccess' ? props.labels.noAccess : props.labels.signedOut) : "Otopoly'yi açın"}</Text>
      )}
    </VStack>
  );
};

export default createWidget<TodayWidgetProps>('OtopolyGlance', OtopolyGlance);
