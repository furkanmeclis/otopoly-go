import { Column, Image, Row, Spacer, Text } from '@expo/ui/jetpack-compose';
import { background, cornerRadius, fillMaxSize, paddingAll, size, width } from '@expo/ui/jetpack-compose/modifiers';
import { createWidget, type WidgetEnvironment } from 'expo-widgets';

import type { TodayWidgetProps } from '../types';

/**
 * "Otopoly · Bugün" Android home-screen widget (compact, 2×2 by default).
 *
 * Android counterpart of the iOS small widget. Runs in the widget's own Hermes runtime and is drawn
 * with Glance, so: everything lives inside the function, only @expo/ui/jetpack-compose components
 * render, and there is no flexible spacing (Glance has no weight modifier) — layout is top-aligned
 * with fixed gaps. Android does not tell the layout its size, so the queue lives in its own widget.
 */
const OtopolyTodayAndroid = (props: TodayWidgetProps, environment: WidgetEnvironment) => {
  'widget';
  const dark = environment.colorScheme === 'dark';
  const c = dark
    ? { bg: '#1C1714', card: '#2A221E', text: '#F7F1ED', sub: '#C4B3AA', muted: '#8E7C73', brand: '#F07D55', warn: '#FBBF24', info: '#60A5FA', ok: '#4ADE80' }
    : { bg: '#FFFFFF', card: '#F6EFEA', text: '#1A1412', sub: '#6B5E57', muted: '#9C8880', brand: '#EA6E43', warn: '#B45309', info: '#2563EB', ok: '#15803D' };
  const ready = Boolean(props && props.v === 1);

  const brandRow = (title: string) => (
    <Row verticalAlignment="center">
      {ready && props.logo ? (
        <Image source={{ uri: props.logo }} modifiers={[size(18, 18), cornerRadius(5)]} />
      ) : (
        <Text color={c.brand} style={{ fontSize: 13, fontWeight: 'bold' }}>
          ●
        </Text>
      )}
      <Spacer modifiers={[width(6)]} />
      <Text color={c.sub} maxLines={1} style={{ fontSize: 12, fontWeight: 'bold' }}>
        {title}
      </Text>
    </Row>
  );

  const root = (content: any) => <Column modifiers={[fillMaxSize(), background(c.bg), cornerRadius(20), paddingAll(14)]}>{content}</Column>;

  if (!ready || props.state !== 'ok') {
    const message = !ready ? "Otopoly'yi açın" : props.state === 'noAccess' ? props.labels.noAccess : props.labels.signedOut;
    return root(
      <>
        {brandRow(ready && props.org ? props.org : 'Otopoly')}
        <Spacer modifiers={[size(1, 14)]} />
        <Text color={c.sub} maxLines={3} style={{ fontSize: 13 }}>
          {message}
        </Text>
      </>,
    );
  }

  const s = props.stats;
  const L = props.labels;

  const pill = (color: string, label: string, value: number) => (
    <Row verticalAlignment="center" modifiers={[background(c.card), cornerRadius(10), paddingAll(6)]}>
      <Text color={color} style={{ fontSize: 11, fontWeight: 'bold' }}>
        {label}
      </Text>
      <Spacer modifiers={[width(4)]} />
      <Text color={c.text} style={{ fontSize: 12, fontWeight: 'bold' }}>
        {String(value)}
      </Text>
    </Row>
  );

  return root(
    <>
      {brandRow(props.org)}
      <Spacer modifiers={[size(1, 8)]} />
      <Row verticalAlignment="bottom">
        <Text color={c.brand} style={{ fontSize: 38, fontWeight: 'bold' }}>
          {String(s.inProgress)}
        </Text>
        {s.stale > 0 ? (
          <Text color={c.warn} style={{ fontSize: 14, fontWeight: 'bold' }}>
            {' !'}
          </Text>
        ) : null}
      </Row>
      <Text color={c.sub} maxLines={1} style={{ fontSize: 12 }}>
        {L.inProgress}
      </Text>
      <Spacer modifiers={[size(1, 8)]} />
      <Row verticalAlignment="center">
        {pill(c.info, L.ready, s.ready)}
        <Spacer modifiers={[width(6)]} />
        {pill(c.ok, L.delivered, s.delivered)}
      </Row>
      {props.showMoney ? (
        <>
          <Spacer modifiers={[size(1, 8)]} />
          <Text color={c.muted} maxLines={1} style={{ fontSize: 11 }}>
            {L.collected}
          </Text>
          <Text color={c.text} maxLines={1} style={{ fontSize: 15, fontWeight: 'bold' }}>
            {s.collected}
          </Text>
        </>
      ) : null}
    </>,
  );
};

export default createWidget<TodayWidgetProps>('OtopolyTodayAndroid', OtopolyTodayAndroid);
