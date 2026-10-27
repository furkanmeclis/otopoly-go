import { HStack, Image, Link, Spacer, Text, VStack } from '@expo/ui/swift-ui';
import { background, clipShape, containerBackground, font, foregroundStyle, frame, lineLimit, monospacedDigit, padding, widgetURL } from '@expo/ui/swift-ui/modifiers';
import { createWidget, type WidgetEnvironment } from 'expo-widgets';

import type { TodayWidgetProps } from './types';

/**
 * "Otopoly · Sıradaki araçlar" (medium / large): the open cars, ready ones first, each row opening its
 * job. Ready cars show a "Hazır" badge, cars at work a live elapsed timer (amber after two hours).
 * The header opens the board on the ready column; "+" starts a new job.
 *
 * Widget runtime: everything inside the function, only @expo/ui/swift-ui components, un-aliased imports.
 */
const OtopolyQueue = (props: TodayWidgetProps, environment: WidgetEnvironment) => {
  'widget';
  const dark = environment.colorScheme === 'dark';
  const c = dark
    ? { bg: '#1C1714', card: '#2A221E', text: '#F7F1ED', sub: '#C4B3AA', muted: '#8E7C73', brand: '#F07D55', warn: '#FBBF24', info: '#60A5FA', plate: '#F7F1ED', plateText: '#1A1412' }
    : { bg: '#FFFFFF', card: '#F6EFEA', text: '#1A1412', sub: '#6B5E57', muted: '#9C8880', brand: '#EA6E43', warn: '#B45309', info: '#2563EB', plate: '#FFFFFF', plateText: '#1A1412' };
  const ok = Boolean(props && props.v === 2);
  const home = ok ? props.links.home : 'otopoly://operations';
  const large = environment.widgetFamily === 'systemLarge';

  const root = (content: any) => (
    <VStack alignment="leading" spacing={8} modifiers={[frame({ maxWidth: 1000, maxHeight: 1000, alignment: 'topLeading' }), containerBackground(c.bg, 'widget'), widgetURL(home)]}>
      {content}
    </VStack>
  );

  if (!ok || props.state !== 'ok') {
    const message = !ok ? "Otopoly'yi açın · Open Otopoly" : props.state === 'noAccess' ? props.labels.noAccess : props.labels.signedOut;
    return root(
      <>
        <HStack spacing={6}>
          <Image systemName="car.2.fill" size={13} color={c.brand} />
          <Text modifiers={[font({ size: 13, weight: 'semibold' }), foregroundStyle(c.sub)]}>{ok && props.org ? props.org : 'Otopoly'}</Text>
        </HStack>
        <Spacer />
        <Image systemName="lock.fill" size={16} color={c.muted} />
        <Text modifiers={[font({ size: 13 }), foregroundStyle(c.sub), lineLimit(2)]}>{message}</Text>
      </>,
    );
  }

  const L = props.labels;
  const s = props.stats;
  const max = large ? 7 : 3;
  const rows = props.queue.slice(0, max);
  const hidden = props.queue.length + props.more - rows.length;

  return root(
    <>
      <HStack spacing={6}>
        <Link destination={props.links.ready}>
          <HStack spacing={6}>
            <Image systemName="car.2.fill" size={13} color={c.brand} />
            <Text modifiers={[font({ size: 13, weight: 'bold' }), foregroundStyle(c.text), lineLimit(1)]}>{L.queue}</Text>
            <Text modifiers={[font({ size: 11, weight: 'semibold' }), foregroundStyle(c.info), monospacedDigit()]}>{`${s.ready} ${L.ready}`}</Text>
            <Text modifiers={[font({ size: 11, weight: 'semibold' }), foregroundStyle(s.stale > 0 ? c.warn : c.sub), monospacedDigit()]}>{`${s.inProgress} ${L.inProgress}`}</Text>
          </HStack>
        </Link>
        <Spacer />
        <Link destination={props.links.newJob}>
          <Image systemName="plus.circle.fill" size={20} color={c.brand} />
        </Link>
      </HStack>
      {rows.length === 0 ? (
        <VStack alignment="leading" spacing={4}>
          <Spacer />
          <Text modifiers={[font({ size: 14, weight: 'medium' }), foregroundStyle(c.sub)]}>{L.queueEmpty}</Text>
          <Spacer />
        </VStack>
      ) : (
        <VStack alignment="leading" spacing={large ? 8 : 6}>
          {rows.map((job) => (
            <Link key={job.id} destination={job.url}>
              <HStack spacing={8}>
                <Text
                  modifiers={[
                    font({ size: 11, weight: 'bold', design: 'monospaced' }),
                    foregroundStyle(c.plateText),
                    padding({ horizontal: 6, vertical: 3 }),
                    background(c.plate),
                    clipShape('roundedRectangle', 5),
                    lineLimit(1),
                  ]}
                >
                  {job.plate}
                </Text>
                <VStack alignment="leading" spacing={0}>
                  <Text modifiers={[font({ size: 13, weight: 'semibold' }), foregroundStyle(c.text), lineLimit(1)]}>{job.name}</Text>
                  {large ? <Text modifiers={[font({ size: 11 }), foregroundStyle(c.sub), lineLimit(1)]}>{job.vehicle}</Text> : null}
                </VStack>
                <Spacer />
                {job.status === 'ready' ? (
                  <Text modifiers={[font({ size: 11, weight: 'bold' }), foregroundStyle(c.info), padding({ horizontal: 6, vertical: 2 }), background(c.card), clipShape('capsule')]}>{L.ready}</Text>
                ) : (
                  <Text
                    modifiers={[font({ size: 13, weight: 'semibold', design: 'rounded' }), foregroundStyle(job.stale ? c.warn : c.text), monospacedDigit(), frame({ width: 64, alignment: 'trailing' })]}
                    date={new Date(job.startedAt)}
                    dateStyle="timer"
                  />
                )}
              </HStack>
            </Link>
          ))}
        </VStack>
      )}
      <Spacer />
      <HStack spacing={4}>
        {hidden > 0 ? <Text modifiers={[font({ size: 11 }), foregroundStyle(c.muted)]}>{`+${hidden} ${L.more}`}</Text> : null}
        <Spacer />
        <Text modifiers={[font({ size: 10 }), foregroundStyle(c.muted), lineLimit(1)]}>{props.asOf}</Text>
      </HStack>
    </>,
  );
};

export default createWidget<TodayWidgetProps>('OtopolyQueue', OtopolyQueue);
