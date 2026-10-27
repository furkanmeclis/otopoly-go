import { Button, Column, Row, Spacer, Text } from '@expo/ui/jetpack-compose';
import { background, cornerRadius, fillMaxSize, fillMaxWidth, padding, paddingAll, size, width } from '@expo/ui/jetpack-compose/modifiers';
import { createWidget, type WidgetEnvironment } from 'expo-widgets';

import type { TodayWidgetProps } from '../types';

/**
 * "Otopoly · Kasa durumu" Android widget (finance readers): the day's collections, money out and net,
 * and the cash / bank balances. Members without finance read see a locked card (the snapshot never
 * carries money for them). Glance: fixed gaps, no flexible spacing. Tap opens Finance.
 */
const OtopolyCashAndroid = (props: TodayWidgetProps, environment: WidgetEnvironment) => {
  'widget';
  const dark = environment.colorScheme === 'dark';
  const c = dark
    ? { bg: '#1C1714', card: '#2A221E', text: '#F7F1ED', sub: '#C4B3AA', muted: '#8E7C73', brand: '#F07D55', ok: '#4ADE80', bad: '#F87171' }
    : { bg: '#FFFFFF', card: '#F6EFEA', text: '#1A1412', sub: '#6B5E57', muted: '#9C8880', brand: '#EA6E43', ok: '#15803D', bad: '#B91C1C' };
  const ok = Boolean(props && props.v === 2);
  // A URL `target` on a Button opens the app at that deep link (patches/expo-widgets: Android has no widgetURL).
  const tap = (url: string) => ({ target: url }) as object;
  const root = (content: any) => (
    <Button {...tap(ok ? props.links.finance : 'otopoly://finance')} modifiers={[fillMaxSize()]}>
      <Column modifiers={[fillMaxSize(), background(c.bg), cornerRadius(20), paddingAll(14)]}>{content}</Column>
    </Button>
  );
  const title = (text: string) => (
    <Text color={c.sub} maxLines={1} style={{ fontSize: 12, fontWeight: 'bold' }}>
      {text}
    </Text>
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
        <Spacer modifiers={[size(1, 14)]} />
        <Text color={c.sub} maxLines={3} style={{ fontSize: 13 }}>
          {message}
        </Text>
      </>,
    );
  }

  const L = props.labels;
  const m = props.money;
  const pair = (label: string, value: string, color: string) => (
    <Row verticalAlignment="center" modifiers={[fillMaxWidth()]}>
      <Text color={c.sub} maxLines={1} style={{ fontSize: 12 }}>
        {`${label}  `}
      </Text>
      <Text color={color} maxLines={1} style={{ fontSize: 13, fontWeight: 'bold' }}>
        {value}
      </Text>
    </Row>
  );

  return root(
    <>
      {title(L.cashTitle)}
      <Spacer modifiers={[size(1, 6)]} />
      <Text color={c.muted} maxLines={1} style={{ fontSize: 11 }}>
        {L.collected}
      </Text>
      <Text color={c.text} maxLines={1} style={{ fontSize: 22, fontWeight: 'bold' }}>
        {m.moneyIn}
      </Text>
      <Spacer modifiers={[size(1, 4)]} />
      {pair(L.moneyOut, m.moneyOut, c.text)}
      {pair(L.net, m.net, m.netNegative ? c.bad : c.ok)}
      {m.accounts.length > 0 ? (
        <>
          <Spacer modifiers={[size(1, 8)]} />
          <Column modifiers={[fillMaxWidth(), background(c.card), cornerRadius(12), padding(10, 8, 10, 8)]}>
            <Text color={c.sub} maxLines={1} style={{ fontSize: 11, fontWeight: 'bold' }}>
              {L.balances}
            </Text>
            {m.accounts.map((a) => (
              <Row key={a.name} verticalAlignment="center">
                <Text color={c.sub} maxLines={1} style={{ fontSize: 12 }}>
                  {a.name}
                </Text>
                <Spacer modifiers={[width(8)]} />
                <Text color={c.text} maxLines={1} style={{ fontSize: 12, fontWeight: 'bold' }}>
                  {a.balance}
                </Text>
              </Row>
            ))}
          </Column>
        </>
      ) : null}
      <Spacer modifiers={[size(1, 6)]} />
      <Text color={c.muted} maxLines={1} style={{ fontSize: 10 }}>
        {props.asOf}
      </Text>
    </>,
  );
};

export default createWidget<TodayWidgetProps>('OtopolyCashAndroid', OtopolyCashAndroid);
