import { HStack, Image, Link, Spacer, Text, VStack } from '@expo/ui/swift-ui';
import { background, clipShape, containerBackground, font, foregroundStyle, frame, lineLimit, monospacedDigit, padding, widgetURL } from '@expo/ui/swift-ui/modifiers';
import { createWidget, type WidgetEnvironment } from 'expo-widgets';

import type { TodayWidgetProps } from './types';

/**
 * "Otopoly · Uyarılar" (small / medium): what needs attention — unpaid deliveries of the day, products
 * at or below their minimum stock, subscription renewals due within 7 days, reviews waiting for a
 * follow-up. Each source only appears for members who may read it; on medium every row opens its list.
 *
 * Widget runtime: everything inside the function, only @expo/ui/swift-ui components, un-aliased imports.
 */
const OtopolyAlerts = (props: TodayWidgetProps, environment: WidgetEnvironment) => {
  'widget';
  const dark = environment.colorScheme === 'dark';
  const c = dark
    ? { bg: '#1C1714', card: '#2A221E', text: '#F7F1ED', sub: '#C4B3AA', muted: '#8E7C73', brand: '#F07D55', warn: '#FBBF24', ok: '#4ADE80' }
    : { bg: '#FFFFFF', card: '#F6EFEA', text: '#1A1412', sub: '#6B5E57', muted: '#9C8880', brand: '#EA6E43', warn: '#B45309', ok: '#15803D' };
  const ok = Boolean(props && props.v === 2);
  const medium = environment.widgetFamily === 'systemMedium';
  const first = ok && props.state === 'ok' ? props.alerts.items[0] : undefined;
  // Small widgets have a single tap target: the most urgent alert's list.
  const url = !ok ? 'otopoly://operations' : medium || !first ? props.links.home : first.url;

  const root = (content: any) => (
    <VStack alignment="leading" spacing={6} modifiers={[frame({ maxWidth: 1000, maxHeight: 1000, alignment: 'topLeading' }), containerBackground(c.bg, 'widget'), widgetURL(url)]}>
      {content}
    </VStack>
  );
  const title = (text: string, count: number) => (
    <HStack spacing={5}>
      <Image systemName="exclamationmark.triangle.fill" size={12} color={count > 0 ? c.warn : c.muted} />
      <Text modifiers={[font({ size: 12, weight: 'semibold' }), foregroundStyle(c.sub), lineLimit(1)]}>{text}</Text>
      <Spacer />
      {count > 0 ? <Text modifiers={[font({ size: 12, weight: 'bold' }), foregroundStyle(c.warn), monospacedDigit()]}>{String(count)}</Text> : null}
    </HStack>
  );

  if (!ok || props.state !== 'ok' || props.alerts.state !== 'ok') {
    const message = !ok
      ? "Otopoly'yi açın · Open Otopoly"
      : props.state === 'noAccess'
        ? props.labels.noAccess
        : props.state === 'signedOut'
          ? props.labels.signedOut
          : props.labels.loading;
    return root(
      <>
        {title(ok ? props.labels.alerts : 'Otopoly', 0)}
        <Spacer />
        <Image systemName={ok && props.state === 'ok' ? 'hourglass' : 'lock.fill'} size={16} color={c.muted} />
        <Text modifiers={[font({ size: 12 }), foregroundStyle(c.sub), lineLimit(3)]}>{message}</Text>
      </>,
    );
  }

  const L = props.labels;
  const items = props.alerts.items;

  if (items.length === 0) {
    return root(
      <>
        {title(L.alerts, 0)}
        <Spacer />
        <Image systemName="checkmark.seal.fill" size={22} color={c.ok} />
        <Text modifiers={[font({ size: 13, weight: 'semibold' }), foregroundStyle(c.text), lineLimit(1)]}>{L.alertsEmpty}</Text>
        <Text modifiers={[font({ size: 9 }), foregroundStyle(c.muted), lineLimit(1)]}>{props.asOf}</Text>
      </>,
    );
  }

  const row = (it: (typeof items)[number]) => (
    <HStack spacing={7}>
      <Image systemName={it.symbol as any} size={11} color={c.brand} modifiers={[frame({ width: 22, height: 22 }), background(c.card), clipShape('roundedRectangle', 6)]} />
      <Text modifiers={[font({ size: 12 }), foregroundStyle(c.text), lineLimit(1)]}>{it.label}</Text>
      <Spacer />
      <Text modifiers={[font({ size: 13, weight: 'bold', design: 'rounded' }), foregroundStyle(c.warn), monospacedDigit(), padding({ horizontal: 2 })]}>{String(it.count)}</Text>
    </HStack>
  );

  return root(
    <>
      {title(L.alerts, props.alerts.total)}
      <VStack alignment="leading" spacing={medium ? 5 : 4}>
        {items.slice(0, medium ? 4 : 3).map((it) =>
          medium ? (
            <Link key={it.key} destination={it.url}>
              {row(it)}
            </Link>
          ) : (
            <HStack key={it.key} spacing={4}>
              <Text modifiers={[font({ size: 11 }), foregroundStyle(c.sub), lineLimit(1)]}>{it.label}</Text>
              <Spacer />
              <Text modifiers={[font({ size: 12, weight: 'bold' }), foregroundStyle(c.warn), monospacedDigit()]}>{String(it.count)}</Text>
            </HStack>
          ),
        )}
      </VStack>
      <Spacer />
      <Text modifiers={[font({ size: 9 }), foregroundStyle(c.muted), lineLimit(1)]}>{props.asOf}</Text>
    </>,
  );
};

export default createWidget<TodayWidgetProps>('OtopolyAlerts', OtopolyAlerts);
