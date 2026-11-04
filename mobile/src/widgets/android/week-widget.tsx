import { Box, Button, Column, Row, Spacer, Text } from '@expo/ui/jetpack-compose';
import { background, cornerRadius, fillMaxSize, height, paddingAll, size, width } from '@expo/ui/jetpack-compose/modifiers';
import { createWidget, type WidgetEnvironment } from 'expo-widgets';

import type { TodayWidgetProps } from '../types';

/**
 * "Otopoly · Haftalık ciro" Android widget (finance readers): the day's collections for the last 7
 * business days as bars (today highlighted) and the 7-day total. Locked without finance read.
 */
const OtopolyWeekAndroid = (props: TodayWidgetProps, environment: WidgetEnvironment) => {
  'widget';
  const dark = environment.colorScheme === 'dark';
  const c = dark
    ? { bg: '#1C1714', text: '#F7F1ED', sub: '#C4B3AA', muted: '#8E7C73', brand: '#F07D55', bar: '#4A3D37' }
    : { bg: '#FFFFFF', text: '#1A1412', sub: '#6B5E57', muted: '#9C8880', brand: '#EA6E43', bar: '#EADFD8' };
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
        <Spacer modifiers={[size(1, 14)]} />
        <Text color={c.sub} maxLines={3} style={{ fontSize: 13 }}>
          {message}
        </Text>
      </>,
    );
  }

  const L = props.labels;
  const m = props.money;
  const H = 64;
  return root(
    <>
      {title(L.week)}
      <Text color={c.text} maxLines={1} style={{ fontSize: 20, fontWeight: 'bold' }}>
        {m.weekTotal}
      </Text>
      <Spacer modifiers={[size(1, 8)]} />
      <Row verticalAlignment="bottom">
        {m.week.map((d, i) => (
          <Row key={`${i}-${d.label}`} verticalAlignment="bottom">
            {i > 0 ? <Spacer modifiers={[width(8)]} /> : null}
            <Column horizontalAlignment="center">
              {d.today ? (
                <Text color={c.brand} maxLines={1} style={{ fontSize: 9, fontWeight: 'bold' }}>
                  {d.value}
                </Text>
              ) : null}
              <Box modifiers={[width(16), height(Math.max(3, Math.round(d.ratio * H))), background(d.today ? c.brand : c.bar), cornerRadius(4)]} />
              <Text color={d.today ? c.text : c.muted} maxLines={1} style={{ fontSize: 10 }}>
                {d.label}
              </Text>
            </Column>
          </Row>
        ))}
      </Row>
      <Spacer modifiers={[size(1, 6)]} />
      <Text color={c.muted} maxLines={1} style={{ fontSize: 10 }}>
        {props.asOf}
      </Text>
    </>,
  );
};

export default createWidget<TodayWidgetProps>('OtopolyWeekAndroid', OtopolyWeekAndroid);
