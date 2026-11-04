import { Button, Column, Row, Spacer, Text } from '@expo/ui/jetpack-compose';
import { background, cornerRadius, fillMaxSize, fillMaxWidth, padding, paddingAll, size, width } from '@expo/ui/jetpack-compose/modifiers';
import { createWidget, type WidgetEnvironment } from 'expo-widgets';

import type { TodayWidgetProps } from '../types';

/**
 * "Otopoly · Uyarılar" Android widget: unpaid deliveries of the day, products at or below their minimum
 * stock, subscription renewals due, reviews waiting for a follow-up — each row opens its list. Sources
 * the member may not read are left out by the server.
 */
const OtopolyAlertsAndroid = (props: TodayWidgetProps, environment: WidgetEnvironment) => {
  'widget';
  const dark = environment.colorScheme === 'dark';
  const c = dark
    ? { bg: '#1C1714', card: '#2A221E', text: '#F7F1ED', sub: '#C4B3AA', muted: '#8E7C73', warn: '#FBBF24', ok: '#4ADE80' }
    : { bg: '#FFFFFF', card: '#F6EFEA', text: '#1A1412', sub: '#6B5E57', muted: '#9C8880', warn: '#B45309', ok: '#15803D' };
  const ok = Boolean(props && props.v === 2);
  // A URL `target` on a Button opens the app at that deep link (patches/expo-widgets: Android has no widgetURL).
  const tap = (url: string) => ({ target: url }) as object;
  const root = (content: any) => (
    <Button {...tap(ok ? props.links.home : 'otopoly://operations')} modifiers={[fillMaxSize()]}>
      <Column modifiers={[fillMaxSize(), background(c.bg), cornerRadius(20), paddingAll(14)]}>{content}</Column>
    </Button>
  );
  const title = (text: string, count: number) => (
    <Row verticalAlignment="center">
      <Text color={c.sub} maxLines={1} style={{ fontSize: 12, fontWeight: 'bold' }}>
        {text}
      </Text>
      {count > 0 ? (
        <>
          <Spacer modifiers={[width(6)]} />
          <Text color={c.warn} style={{ fontSize: 12, fontWeight: 'bold' }}>
            {String(count)}
          </Text>
        </>
      ) : null}
    </Row>
  );

  if (!ok || props.state !== 'ok' || props.alerts.state !== 'ok') {
    const message = !ok ? "Otopoly'yi açın · Open Otopoly" : props.state === 'noAccess' ? props.labels.noAccess : props.state === 'signedOut' ? props.labels.signedOut : props.labels.loading;
    return root(
      <>
        {title(ok ? props.labels.alerts : 'Otopoly', 0)}
        <Spacer modifiers={[size(1, 14)]} />
        <Text color={c.sub} maxLines={3} style={{ fontSize: 13 }}>
          {message}
        </Text>
      </>,
    );
  }

  const L = props.labels;
  const items = props.alerts.items;
  return root(
    <>
      {title(L.alerts, props.alerts.total)}
      <Spacer modifiers={[size(1, 8)]} />
      {items.length === 0 ? (
        <Text color={c.ok} maxLines={1} style={{ fontSize: 14, fontWeight: 'bold' }}>
          {`✓ ${L.alertsEmpty}`}
        </Text>
      ) : (
        items.map((it) => (
          <Button key={it.key} {...tap(it.url)} modifiers={[fillMaxWidth()]}>
            <Row verticalAlignment="center" modifiers={[fillMaxWidth(), background(c.card), cornerRadius(10), padding(10, 7, 10, 7)]}>
              <Text color={c.warn} style={{ fontSize: 14, fontWeight: 'bold' }}>
                {String(it.count)}
              </Text>
              <Spacer modifiers={[width(8)]} />
              <Text color={c.text} maxLines={1} style={{ fontSize: 13 }}>
                {it.label}
              </Text>
            </Row>
          </Button>
        ))
      )}
      <Spacer modifiers={[size(1, 6)]} />
      <Text color={c.muted} maxLines={1} style={{ fontSize: 10 }}>
        {props.asOf}
      </Text>
    </>,
  );
};

export default createWidget<TodayWidgetProps>('OtopolyAlertsAndroid', OtopolyAlertsAndroid);
