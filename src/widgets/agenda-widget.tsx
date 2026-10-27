import { HStack, Image, Link, RoundedRectangle, Spacer, Text, VStack } from '@expo/ui/swift-ui';
import { containerBackground, font, foregroundStyle, frame, lineLimit, monospacedDigit, widgetURL } from '@expo/ui/swift-ui/modifiers';
import { createWidget, type WidgetEnvironment } from 'expo-widgets';

import type { TodayWidgetProps } from './types';

/**
 * "Otopoly · Bugünkü takvim" (small / medium): the next calendar events and to-dos of the day (timed
 * first, then all-day). Events need calendar read, to-dos todos read; members with neither see a
 * locked card. Medium rows open the calendar / to-do list.
 *
 * Widget runtime: everything inside the function, only @expo/ui/swift-ui components, un-aliased imports.
 */
const OtopolyAgenda = (props: TodayWidgetProps, environment: WidgetEnvironment) => {
  'widget';
  const dark = environment.colorScheme === 'dark';
  const c = dark
    ? { bg: '#1C1714', text: '#F7F1ED', sub: '#C4B3AA', muted: '#8E7C73', brand: '#F07D55', info: '#60A5FA', todo: '#4ADE80' }
    : { bg: '#FFFFFF', text: '#1A1412', sub: '#6B5E57', muted: '#9C8880', brand: '#EA6E43', info: '#2563EB', todo: '#15803D' };
  const ok = Boolean(props && props.v === 2);
  const url = ok ? props.links.calendar : 'otopoly://calendar';
  const medium = environment.widgetFamily === 'systemMedium';

  const root = (content: any) => (
    <VStack alignment="leading" spacing={6} modifiers={[frame({ maxWidth: 1000, maxHeight: 1000, alignment: 'topLeading' }), containerBackground(c.bg, 'widget'), widgetURL(url)]}>
      {content}
    </VStack>
  );
  const title = (text: string) => (
    <HStack spacing={5}>
      <Image systemName="calendar" size={12} color={c.brand} />
      <Text modifiers={[font({ size: 12, weight: 'semibold' }), foregroundStyle(c.sub), lineLimit(1)]}>{text}</Text>
      <Spacer />
    </HStack>
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
        <Spacer />
        <Image systemName={ok && props.agenda.state === 'loading' ? 'hourglass' : 'lock.fill'} size={16} color={c.muted} />
        <Text modifiers={[font({ size: 12 }), foregroundStyle(c.sub), lineLimit(3)]}>{message}</Text>
      </>,
    );
  }

  const L = props.labels;
  const items = props.agenda.items.slice(0, medium ? 3 : 2);
  const row = (it: (typeof items)[number]) => (
    <HStack spacing={7}>
      <RoundedRectangle cornerRadius={2} modifiers={[frame({ width: 3, height: 28 }), foregroundStyle(it.kind === 'event' ? c.info : c.todo)]} />
      <VStack alignment="leading" spacing={1}>
        <Text modifiers={[font({ size: 11, weight: 'semibold' }), foregroundStyle(c.sub), monospacedDigit(), lineLimit(1)]}>{it.time}</Text>
        <Text modifiers={[font({ size: 13, weight: 'medium' }), foregroundStyle(c.text), lineLimit(1)]}>{it.title}</Text>
      </VStack>
      <Spacer />
    </HStack>
  );

  return root(
    <>
      {title(L.agenda)}
      {items.length === 0 ? (
        <VStack alignment="leading" spacing={4}>
          <Spacer />
          <Image systemName="sun.max.fill" size={18} color={c.brand} />
          <Text modifiers={[font({ size: 13 }), foregroundStyle(c.sub), lineLimit(2)]}>{L.agendaEmpty}</Text>
        </VStack>
      ) : (
        <VStack alignment="leading" spacing={6}>
          {items.map((it) =>
            medium ? (
              <Link key={it.id} destination={it.url}>
                {row(it)}
              </Link>
            ) : (
              <VStack key={it.id}>{row(it)}</VStack>
            ),
          )}
        </VStack>
      )}
      <Spacer />
      <Text modifiers={[font({ size: 9 }), foregroundStyle(c.muted), lineLimit(1)]}>{props.asOf}</Text>
    </>,
  );
};

export default createWidget<TodayWidgetProps>('OtopolyAgenda', OtopolyAgenda);
