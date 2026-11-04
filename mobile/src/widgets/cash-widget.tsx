import { Divider, HStack, Image, Link, Spacer, Text, VStack } from '@expo/ui/swift-ui';
import { containerBackground, font, foregroundStyle, frame, lineLimit, minimumScaleFactor, monospacedDigit, widgetURL } from '@expo/ui/swift-ui/modifiers';
import { createWidget, type WidgetEnvironment } from 'expo-widgets';

import type { TodayWidgetProps } from './types';

/**
 * "Otopoly · Kasa durumu" (small / medium), for owners and members with finance read: the day's
 * collections, money in / out and net, plus the cash and bank balances (medium). Everyone else sees a
 * locked card — the snapshot never carries money for them.
 *
 * Widget runtime: everything inside the function, only @expo/ui/swift-ui components, un-aliased imports.
 */
const OtopolyCash = (props: TodayWidgetProps, environment: WidgetEnvironment) => {
  'widget';
  const dark = environment.colorScheme === 'dark';
  const c = dark
    ? { bg: '#1C1714', text: '#F7F1ED', sub: '#C4B3AA', muted: '#8E7C73', brand: '#F07D55', ok: '#4ADE80', bad: '#F87171' }
    : { bg: '#FFFFFF', text: '#1A1412', sub: '#6B5E57', muted: '#9C8880', brand: '#EA6E43', ok: '#15803D', bad: '#B91C1C' };
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
      <Image systemName="banknote.fill" size={12} color={c.brand} />
      <Text modifiers={[font({ size: 12, weight: 'semibold' }), foregroundStyle(c.sub), lineLimit(1)]}>{text}</Text>
      <Spacer />
    </HStack>
  );

  if (!ok || props.state !== 'ok' || props.money.state !== 'ok') {
    const message = !ok
      ? "Otopoly'yi açın · Open Otopoly"
      : props.state === 'noAccess'
        ? props.labels.noAccess
        : props.state === 'signedOut'
          ? props.labels.signedOut
          : props.money.state === 'loading'
            ? props.labels.loading
            : props.labels.moneyLocked;
    return root(
      <>
        {title(ok ? props.labels.cashTitle : 'Otopoly')}
        <Spacer />
        <Image systemName={ok && props.money.state === 'loading' ? 'hourglass' : 'lock.fill'} size={16} color={c.muted} />
        <Text modifiers={[font({ size: 12 }), foregroundStyle(c.sub), lineLimit(3)]}>{message}</Text>
      </>,
    );
  }

  const L = props.labels;
  const m = props.money;
  const line = (label: string, value: string, color: string) => (
    <HStack spacing={4}>
      <Text modifiers={[font({ size: 11 }), foregroundStyle(c.sub), lineLimit(1)]}>{label}</Text>
      <Spacer />
      <Text modifiers={[font({ size: 12, weight: 'semibold', design: 'rounded' }), foregroundStyle(color), monospacedDigit(), lineLimit(1), minimumScaleFactor(0.6)]}>{value}</Text>
    </HStack>
  );
  const summary = (
    <VStack alignment="leading" spacing={3} modifiers={[frame({ maxWidth: 1000, maxHeight: 1000, alignment: 'topLeading' })]}>
      {title(L.cashTitle)}
      <Spacer />
      <Text modifiers={[font({ size: 10 }), foregroundStyle(c.muted), lineLimit(1)]}>{L.collected}</Text>
      <Text modifiers={[font({ size: 22, weight: 'bold', design: 'rounded' }), foregroundStyle(c.text), monospacedDigit(), lineLimit(1), minimumScaleFactor(0.5)]}>{m.moneyIn}</Text>
      {line(L.moneyOut, m.moneyOut, c.text)}
      {line(L.net, m.net, m.netNegative ? c.bad : c.ok)}
      <Text modifiers={[font({ size: 9 }), foregroundStyle(c.muted), lineLimit(1)]}>{props.asOf}</Text>
    </VStack>
  );

  if (!medium) return root(summary);

  return root(
    <HStack alignment="top" spacing={12}>
      {summary}
      <Divider />
      <Link destination={props.links.accounts}>
        <VStack alignment="leading" spacing={5} modifiers={[frame({ maxWidth: 1000, maxHeight: 1000, alignment: 'topLeading' })]}>
          <Text modifiers={[font({ size: 11, weight: 'semibold' }), foregroundStyle(c.sub), lineLimit(1)]}>{L.balances}</Text>
          {m.accounts.length === 0 ? <Text modifiers={[font({ size: 11 }), foregroundStyle(c.muted)]}>—</Text> : null}
          {m.accounts.map((a) => (
            <HStack key={a.name} spacing={5}>
              <Image systemName={a.kind === 'bank' ? 'building.columns.fill' : 'banknote'} size={10} color={c.muted} />
              <Text modifiers={[font({ size: 11 }), foregroundStyle(c.sub), lineLimit(1)]}>{a.name}</Text>
              <Spacer />
              <Text modifiers={[font({ size: 12, weight: 'semibold', design: 'rounded' }), foregroundStyle(c.text), monospacedDigit(), lineLimit(1), minimumScaleFactor(0.6)]}>{a.balance}</Text>
            </HStack>
          ))}
          <Spacer />
          {line(L.cash, m.cash, c.text)}
          {line(L.card, m.card, c.text)}
        </VStack>
      </Link>
    </HStack>,
  );
};

export default createWidget<TodayWidgetProps>('OtopolyCash', OtopolyCash);
