import { HStack, Image, RoundedRectangle, Spacer, Text, VStack } from '@expo/ui/swift-ui';
import { containerBackground, font, foregroundStyle, frame, lineLimit, minimumScaleFactor, monospacedDigit, widgetURL } from '@expo/ui/swift-ui/modifiers';
import { createWidget, type WidgetEnvironment } from 'expo-widgets';

import type { TodayWidgetProps } from './types';

/**
 * "Otopoly · Haftalık ciro" (small / medium): the day's collections for the last 7 business days as
 * a bar chart (today highlighted), with the 7-day total. Finance readers only; locked otherwise.
 *
 * Widget runtime: everything inside the function, only @expo/ui/swift-ui components, un-aliased imports.
 */
const OtopolyWeek = (props: TodayWidgetProps, environment: WidgetEnvironment) => {
  'widget';
  const dark = environment.colorScheme === 'dark';
  const c = dark
    ? { bg: '#1C1714', text: '#F7F1ED', sub: '#C4B3AA', muted: '#8E7C73', brand: '#F07D55', bar: '#4A3D37' }
    : { bg: '#FFFFFF', text: '#1A1412', sub: '#6B5E57', muted: '#9C8880', brand: '#EA6E43', bar: '#EADFD8' };
  const ok = Boolean(props && props.v === 2);
  const url = ok ? props.links.finance : 'otopoly://finance';
  const medium = environment.widgetFamily === 'systemMedium';

  const root = (content: any) => (
    <VStack alignment="leading" spacing={4} modifiers={[frame({ maxWidth: 1000, maxHeight: 1000, alignment: 'topLeading' }), containerBackground(c.bg, 'widget'), widgetURL(url)]}>
      {content}
    </VStack>
  );
  const title = (text: string) => (
    <HStack spacing={5}>
      <Image systemName="chart.bar.fill" size={12} color={c.brand} />
      <Text modifiers={[font({ size: 12, weight: 'semibold' }), foregroundStyle(c.sub), lineLimit(1)]}>{text}</Text>
      <Spacer />
    </HStack>
  );

  if (!ok || props.state !== 'ok' || props.money.state !== 'ok' || props.money.week.length === 0) {
    const message = !ok
      ? "Otopoly'yi açın · Open Otopoly"
      : props.state === 'noAccess'
        ? props.labels.noAccess
        : props.state === 'signedOut'
          ? props.labels.signedOut
          : props.money.state === 'locked'
            ? props.labels.moneyLocked
            : props.labels.loading;
    return root(
      <>
        {title(ok ? props.labels.week : 'Otopoly')}
        <Spacer />
        <Image systemName={ok && props.money.state === 'locked' ? 'lock.fill' : 'hourglass'} size={16} color={c.muted} />
        <Text modifiers={[font({ size: 12 }), foregroundStyle(c.sub), lineLimit(3)]}>{message}</Text>
      </>,
    );
  }

  const L = props.labels;
  const m = props.money;
  const height = medium ? 64 : 56;
  const width = medium ? 22 : 12;

  return root(
    <>
      {title(L.week)}
      <HStack alignment="firstTextBaseline" spacing={6}>
        <Text modifiers={[font({ size: medium ? 20 : 17, weight: 'bold', design: 'rounded' }), foregroundStyle(c.text), monospacedDigit(), lineLimit(1), minimumScaleFactor(0.5)]}>{m.weekTotal}</Text>
        {medium ? <Text modifiers={[font({ size: 11 }), foregroundStyle(c.muted), lineLimit(1)]}>{L.weekTotal}</Text> : null}
      </HStack>
      <Spacer />
      <HStack alignment="bottom" spacing={medium ? 10 : 5}>
        {m.week.map((d, i) => (
          <VStack key={`${i}-${d.label}`} spacing={2}>
            {medium && d.today ? <Text modifiers={[font({ size: 9, weight: 'semibold' }), foregroundStyle(c.brand), lineLimit(1), minimumScaleFactor(0.5)]}>{d.value}</Text> : null}
            <RoundedRectangle cornerRadius={3} modifiers={[frame({ width, height: Math.max(3, Math.round(d.ratio * height)) }), foregroundStyle(d.today ? c.brand : c.bar)]} />
            <Text modifiers={[font({ size: 9, weight: d.today ? 'bold' : 'regular' }), foregroundStyle(d.today ? c.text : c.muted), lineLimit(1)]}>{d.label}</Text>
          </VStack>
        ))}
      </HStack>
      <Text modifiers={[font({ size: 9 }), foregroundStyle(c.muted), lineLimit(1)]}>{props.asOf}</Text>
    </>,
  );
};

export default createWidget<TodayWidgetProps>('OtopolyWeek', OtopolyWeek);
