import { Column, Image, LazyColumn, Row, Spacer, Text } from '@expo/ui/jetpack-compose';
import { background, cornerRadius, fillMaxSize, fillMaxWidth, padding, paddingAll, size, width } from '@expo/ui/jetpack-compose/modifiers';
import { createWidget, type WidgetEnvironment } from 'expo-widgets';

import type { TodayWidgetProps } from '../types';

/**
 * "Otopoly · İş Kuyruğu" Android home-screen widget (4×3 by default, resizable).
 *
 * Android counterpart of the iOS large widget: today's counts plus the live queue. The queue is a
 * LazyColumn, which Android widgets can scroll, so every waiting car stays reachable. Glance has no
 * timer text, so each row shows the pre-formatted start time instead of a running clock.
 */
const OtopolyQueueAndroid = (props: TodayWidgetProps, environment: WidgetEnvironment) => {
  'widget';
  const dark = environment.colorScheme === 'dark';
  const c = dark
    ? { bg: '#1C1714', card: '#2A221E', text: '#F7F1ED', sub: '#C4B3AA', muted: '#8E7C73', brand: '#F07D55', warn: '#FBBF24', info: '#60A5FA', ok: '#4ADE80', plate: '#F7F1ED', plateText: '#1A1412' }
    : { bg: '#FFFFFF', card: '#F6EFEA', text: '#1A1412', sub: '#6B5E57', muted: '#9C8880', brand: '#EA6E43', warn: '#B45309', info: '#2563EB', ok: '#15803D', plate: '#FFFFFF', plateText: '#1A1412' };
  const ready = Boolean(props && props.v === 1);

  const header = (title: string, subtitle: string) => (
    <Row verticalAlignment="center">
      {ready && props.logo ? (
        <Image source={{ uri: props.logo }} modifiers={[size(22, 22), cornerRadius(6)]} />
      ) : (
        <Text color={c.brand} style={{ fontSize: 14, fontWeight: 'bold' }}>
          ●
        </Text>
      )}
      <Spacer modifiers={[width(8)]} />
      <Column>
        <Text color={c.text} maxLines={1} style={{ fontSize: 13, fontWeight: 'bold' }}>
          {title}
        </Text>
        {subtitle ? (
          <Text color={c.muted} maxLines={1} style={{ fontSize: 10 }}>
            {subtitle}
          </Text>
        ) : null}
      </Column>
    </Row>
  );

  const root = (content: any) => <Column modifiers={[fillMaxSize(), background(c.bg), cornerRadius(20), paddingAll(14)]}>{content}</Column>;

  if (!ready || props.state !== 'ok') {
    const message = !ready ? "Otopoly'yi açın" : props.state === 'noAccess' ? props.labels.noAccess : props.labels.signedOut;
    return root(
      <>
        {header(ready && props.org ? props.org : 'Otopoly', '')}
        <Spacer modifiers={[size(1, 16)]} />
        <Text color={c.sub} maxLines={3} style={{ fontSize: 14 }}>
          {message}
        </Text>
      </>,
    );
  }

  const s = props.stats;
  const L = props.labels;

  const tile = (color: string, label: string, value: string) => (
    <Column modifiers={[background(c.card), cornerRadius(12), padding(10, 8, 12, 8)]}>
      <Text color={c.text} maxLines={1} style={{ fontSize: 20, fontWeight: 'bold' }}>
        {value}
      </Text>
      <Text color={color} maxLines={1} style={{ fontSize: 11, fontWeight: 'bold' }}>
        {label}
      </Text>
    </Column>
  );

  return root(
    <>
      {header(props.org, props.updatedTime ? `${L.updated} ${props.updatedTime}` : '')}
      <Spacer modifiers={[size(1, 10)]} />
      <Row verticalAlignment="top">
        {tile(s.stale > 0 ? c.warn : c.brand, L.inProgress, String(s.inProgress))}
        <Spacer modifiers={[width(6)]} />
        {tile(c.info, L.ready, String(s.ready))}
        <Spacer modifiers={[width(6)]} />
        {tile(c.ok, L.delivered, String(s.delivered))}
      </Row>
      {props.showMoney ? (
        <>
          <Spacer modifiers={[size(1, 8)]} />
          <Row verticalAlignment="center" modifiers={[fillMaxWidth(), background(c.card), cornerRadius(12), padding(12, 8, 12, 8)]}>
            <Text color={c.sub} maxLines={1} style={{ fontSize: 12 }}>
              {`${L.collected}  `}
            </Text>
            <Text color={c.text} maxLines={1} style={{ fontSize: 15, fontWeight: 'bold' }}>
              {s.collected}
            </Text>
          </Row>
        </>
      ) : null}
      <Spacer modifiers={[size(1, 10)]} />
      <Text color={c.sub} style={{ fontSize: 12, fontWeight: 'bold' }}>
        {L.queue}
      </Text>
      <Spacer modifiers={[size(1, 6)]} />
      {props.queue.length === 0 ? (
        <Text color={c.muted} style={{ fontSize: 13 }}>
          {L.queueEmpty}
        </Text>
      ) : (
        <LazyColumn modifiers={[fillMaxWidth()]}>
          {props.queue.map((job) => (
            <Row key={job.id} verticalAlignment="center" modifiers={[fillMaxWidth(), padding(0, 0, 0, 8)]}>
              <Text color={c.plateText} maxLines={1} modifiers={[background(c.plate), cornerRadius(5), padding(6, 3, 6, 3)]} style={{ fontSize: 11, fontWeight: 'bold' }}>
                {job.plate}
              </Text>
              <Spacer modifiers={[width(8)]} />
              <Column>
                <Text color={c.text} maxLines={1} style={{ fontSize: 13, fontWeight: 'bold' }}>
                  {job.name}
                </Text>
                <Text color={job.status === 'ready' ? c.info : job.stale ? c.warn : c.sub} maxLines={1} style={{ fontSize: 11 }}>
                  {job.status === 'ready' ? `${L.ready} · ${job.vehicle}` : job.since ? `${L.started} ${job.since} · ${job.vehicle}` : job.vehicle}
                </Text>
              </Column>
            </Row>
          ))}
        </LazyColumn>
      )}
    </>,
  );
};

export default createWidget<TodayWidgetProps>('OtopolyQueueAndroid', OtopolyQueueAndroid);
