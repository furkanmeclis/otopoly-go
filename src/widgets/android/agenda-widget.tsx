import { Button, Column, Row, Spacer, Text } from '@expo/ui/jetpack-compose';
import { background, cornerRadius, fillMaxSize, fillMaxWidth, padding, paddingAll, size, width } from '@expo/ui/jetpack-compose/modifiers';
import { createWidget, type WidgetEnvironment } from 'expo-widgets';

import type { TodayWidgetProps } from '../types';

/**
 * "Otopoly · Bugünkü takvim" Android widget: the next calendar events and to-dos of the day (timed
 * first). Events need calendar read, to-dos todos read; rows open the calendar / to-do list.
 */
const OtopolyAgendaAndroid = (props: TodayWidgetProps, environment: WidgetEnvironment) => {
  'widget';
  const dark = environment.colorScheme === 'dark';
  const c = dark
    ? { bg: '#1C1714', card: '#2A221E', text: '#F7F1ED', sub: '#C4B3AA', muted: '#8E7C73', info: '#60A5FA', todo: '#4ADE80' }
    : { bg: '#FFFFFF', card: '#F6EFEA', text: '#1A1412', sub: '#6B5E57', muted: '#9C8880', info: '#2563EB', todo: '#15803D' };
  const ok = Boolean(props && props.v === 2);
  // A URL `target` on a Button opens the app at that deep link (patches/expo-widgets: Android has no widgetURL).
  const tap = (url: string) => ({ target: url }) as object;
  const root = (content: any) => (
    <Button {...tap(ok ? props.links.calendar : 'otopoly://calendar')} modifiers={[fillMaxSize()]}>
      <Column modifiers={[fillMaxSize(), background(c.bg), cornerRadius(20), paddingAll(14)]}>{content}</Column>
    </Button>
  );
  const title = (text: string) => (
    <Text color={c.sub} maxLines={1} style={{ fontSize: 12, fontWeight: 'bold' }}>
      {text}
    </Text>
  );

  if (!ok || props.state !== 'ok' || props.agenda.state !== 'ok') {
    const message = !ok
      ? "Otopoly'yi açın · Open Otopoly"
      : props.state === 'noAccess'
        ? props.labels.noAccess
        : props.state === 'signedOut'
          ? props.labels.signedOut
          : props.agenda.state === 'locked'
            ? props.labels.agendaLocked
            : props.labels.loading;
    return root(
      <>
        {title(ok ? props.labels.agenda : 'Otopoly')}
        <Spacer modifiers={[size(1, 14)]} />
        <Text color={c.sub} maxLines={3} style={{ fontSize: 13 }}>
          {message}
        </Text>
      </>,
    );
  }

  const L = props.labels;
  const items = props.agenda.items;
  return root(
    <>
      {title(L.agenda)}
      <Spacer modifiers={[size(1, 8)]} />
      {items.length === 0 ? (
        <Text color={c.muted} maxLines={2} style={{ fontSize: 13 }}>
          {L.agendaEmpty}
        </Text>
      ) : (
        items.map((it) => (
          <Button key={it.id} {...tap(it.url)} modifiers={[fillMaxWidth()]}>
            <Row verticalAlignment="center" modifiers={[fillMaxWidth(), padding(0, 2, 0, 6)]}>
              <Text color={it.kind === 'event' ? c.info : c.todo} maxLines={1} style={{ fontSize: 12, fontWeight: 'bold' }}>
                {it.time}
              </Text>
              <Spacer modifiers={[width(8)]} />
              <Text color={c.text} maxLines={1} style={{ fontSize: 13 }}>
                {it.title}
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

export default createWidget<TodayWidgetProps>('OtopolyAgendaAndroid', OtopolyAgendaAndroid);
