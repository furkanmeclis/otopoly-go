import { HStack, Image, Link, Spacer, Text, VStack } from '@expo/ui/swift-ui';
import {
  background,
  clipShape,
  containerBackground,
  font,
  foregroundStyle,
  frame,
  lineLimit,
  minimumScaleFactor,
  monospacedDigit,
  padding,
  widgetURL,
} from '@expo/ui/swift-ui/modifiers';
import { createWidget, type WidgetEnvironment } from 'expo-widgets';

import type { TodayWidgetProps } from './types';

/**
 * "Otopoly · Bugün" home-screen widget (small / medium / large): open jobs by status and, for members
 * with finance read, the day's collections ("tahsilat", every posted income of the Istanbul day).
 *
 * Runs in the widget runtime: everything (palette, helpers) must live inside the function and
 * only @expo/ui/swift-ui components may be rendered. Keep imports un-aliased — the runtime
 * resolves components and modifiers by their exported names.
 */
const OtopolyToday = (props: TodayWidgetProps, environment: WidgetEnvironment) => {
  'widget';
  const dark = environment.colorScheme === 'dark';
  const c = dark
    ? { bg: '#1C1714', card: '#2A221E', text: '#F7F1ED', sub: '#C4B3AA', muted: '#8E7C73', brand: '#F07D55', warn: '#FBBF24', info: '#60A5FA', ok: '#4ADE80', plate: '#F7F1ED', plateText: '#1A1412' }
    : { bg: '#FFFFFF', card: '#F6EFEA', text: '#1A1412', sub: '#6B5E57', muted: '#9C8880', brand: '#EA6E43', warn: '#B45309', info: '#2563EB', ok: '#15803D', plate: '#FFFFFF', plateText: '#1A1412' };
  const family = environment.widgetFamily;
  const ready = Boolean(props && props.v === 2);
  const home = ready ? props.links.home : 'otopoly://operations';

  const root = (content: any, url: string) => (
    <VStack alignment="leading" spacing={0} modifiers={[frame({ maxWidth: 1000, maxHeight: 1000, alignment: 'topLeading' }), containerBackground(c.bg, 'widget'), widgetURL(url)]}>
      {content}
    </VStack>
  );

  const brandRow = (title: string) => (
    <HStack spacing={6}>
      {ready && props.logo ? (
        <Image uiImage={props.logo} modifiers={[frame({ width: 18, height: 18 }), clipShape('roundedRectangle', 5)]} />
      ) : (
        <Image systemName="car.fill" size={13} color={c.brand} />
      )}
      <Text modifiers={[font({ size: 12, weight: 'semibold' }), foregroundStyle(c.sub), lineLimit(1)]}>{title}</Text>
      <Spacer />
    </HStack>
  );

  if (!ready || props.state !== 'ok') {
    const message = !ready ? "Otopoly'yi açın · Open Otopoly" : props.state === 'noAccess' ? props.labels.noAccess : props.labels.signedOut;
    return root(
      <VStack alignment="leading" spacing={8}>
        {brandRow(ready && props.org ? props.org : 'Otopoly')}
        <Spacer />
        <Image systemName="lock.fill" size={18} color={c.muted} />
        <Text modifiers={[font({ size: 13, weight: 'medium' }), foregroundStyle(c.sub), lineLimit(3)]}>{message}</Text>
      </VStack>,
      home,
    );
  }

  const s = props.stats;
  const L = props.labels;

  const statLine = (symbol: any, color: string, label: string, value: number) => (
    <HStack spacing={8}>
      <Image systemName={symbol} size={12} color={color} modifiers={[frame({ width: 26, height: 26 }), background(c.card), clipShape('roundedRectangle', 8)]} />
      <Text modifiers={[font({ size: 13 }), foregroundStyle(c.sub), lineLimit(1)]}>{label}</Text>
      <Spacer />
      <Text modifiers={[font({ size: 17, weight: 'bold', design: 'rounded' }), foregroundStyle(c.text), monospacedDigit()]}>{String(value)}</Text>
    </HStack>
  );

  const money = (size: number) => (
    <VStack alignment="leading" spacing={1}>
      <Text modifiers={[font({ size: 11 }), foregroundStyle(c.sub), lineLimit(1)]}>{L.collected}</Text>
      <Text modifiers={[font({ size, weight: 'bold', design: 'rounded' }), foregroundStyle(c.text), monospacedDigit(), lineLimit(1), minimumScaleFactor(0.6)]}>{s.collected}</Text>
    </VStack>
  );

  if (family === 'systemSmall') {
    return root(
      <VStack alignment="leading" spacing={0}>
        {brandRow(props.org)}
        <Spacer />
        <HStack alignment="firstTextBaseline" spacing={4}>
          <Text modifiers={[font({ size: 40, weight: 'bold', design: 'rounded' }), foregroundStyle(c.brand), monospacedDigit()]}>{String(s.inProgress)}</Text>
          {s.stale > 0 ? <Image systemName="exclamationmark.circle.fill" size={13} color={c.warn} /> : null}
        </HStack>
        <Text modifiers={[font({ size: 12, weight: 'medium' }), foregroundStyle(c.sub), lineLimit(1)]}>{L.inProgress}</Text>
        <Spacer />
        <HStack spacing={10}>
          <HStack spacing={3}>
            <Image systemName="key.fill" size={10} color={c.info} />
            <Text modifiers={[font({ size: 12, weight: 'semibold' }), foregroundStyle(c.text), monospacedDigit()]}>{String(s.ready)}</Text>
          </HStack>
          <HStack spacing={3}>
            <Image systemName="checkmark.circle.fill" size={10} color={c.ok} />
            <Text modifiers={[font({ size: 12, weight: 'semibold' }), foregroundStyle(c.text), monospacedDigit()]}>{String(s.delivered)}</Text>
          </HStack>
        </HStack>
        {props.showMoney ? (
          <Text modifiers={[padding({ top: 4 }), font({ size: 12, weight: 'semibold' }), foregroundStyle(c.sub), monospacedDigit(), lineLimit(1), minimumScaleFactor(0.7)]}>{s.collected}</Text>
        ) : null}
        <Text modifiers={[padding({ top: 2 }), font({ size: 9 }), foregroundStyle(c.muted), lineLimit(1)]}>{props.asOf}</Text>
      </VStack>,
      home,
    );
  }

  if (family === 'systemMedium') {
    return root(
      <HStack alignment="top" spacing={14}>
        <VStack alignment="leading" spacing={0} modifiers={[frame({ maxHeight: 1000, alignment: 'topLeading' })]}>
          {brandRow(props.org)}
          <Spacer />
          <Text modifiers={[font({ size: 34, weight: 'bold', design: 'rounded' }), foregroundStyle(c.brand), monospacedDigit()]}>{String(s.inProgress)}</Text>
          <Text modifiers={[font({ size: 12, weight: 'medium' }), foregroundStyle(c.sub), lineLimit(1)]}>{L.inProgress}</Text>
          <Spacer />
          {props.showMoney ? money(17) : null}
        </VStack>
        <VStack alignment="leading" spacing={7} modifiers={[frame({ maxHeight: 1000 })]}>
          <Spacer />
          {statLine('key.fill', c.info, L.ready, s.ready)}
          {statLine('checkmark.circle.fill', c.ok, L.delivered, s.delivered)}
          {props.showMoney && s.jobsRevenue ? (
            <HStack spacing={8}>
              <Image systemName="wrench.and.screwdriver.fill" size={12} color={c.muted} modifiers={[frame({ width: 26, height: 26 }), background(c.card), clipShape('roundedRectangle', 8)]} />
              <Text modifiers={[font({ size: 13 }), foregroundStyle(c.sub), lineLimit(1)]}>{L.jobsRevenue}</Text>
              <Spacer />
              <Text modifiers={[font({ size: 13, weight: 'semibold', design: 'rounded' }), foregroundStyle(c.text), monospacedDigit(), lineLimit(1), minimumScaleFactor(0.6)]}>{s.jobsRevenue}</Text>
            </HStack>
          ) : (
            statLine('exclamationmark.circle.fill', s.stale > 0 ? c.warn : c.muted, L.open, s.open)
          )}
          <Text modifiers={[font({ size: 10 }), foregroundStyle(c.muted), lineLimit(1)]}>{props.asOf}</Text>
          <Spacer />
        </VStack>
      </HStack>,
      home,
    );
  }

  // systemLarge: stats + the live queue with elapsed timers.
  const rows = props.queue.slice(0, 5);
  const tile = (symbol: any, color: string, label: string, value: string) => (
    <VStack alignment="leading" spacing={3} modifiers={[padding({ all: 10 }), frame({ maxWidth: 1000, alignment: 'leading' }), background(c.card), clipShape('roundedRectangle', 12)]}>
      <Image systemName={symbol} size={13} color={color} />
      <Text modifiers={[font({ size: 20, weight: 'bold', design: 'rounded' }), foregroundStyle(c.text), monospacedDigit(), lineLimit(1), minimumScaleFactor(0.6)]}>{value}</Text>
      <Text modifiers={[font({ size: 11 }), foregroundStyle(c.sub), lineLimit(1)]}>{label}</Text>
    </VStack>
  );

  return root(
    <VStack alignment="leading" spacing={10}>
      <HStack spacing={6}>
        {brandRow(props.org)}
        <Text modifiers={[font({ size: 11 }), foregroundStyle(c.muted), lineLimit(1)]}>{props.asOf}</Text>
      </HStack>
      <HStack spacing={8}>
        {tile('wrench.and.screwdriver.fill', c.warn, L.inProgress, String(s.inProgress))}
        {tile('key.fill', c.info, L.ready, String(s.ready))}
        {tile('checkmark.circle.fill', c.ok, L.delivered, String(s.delivered))}
      </HStack>
      {props.showMoney ? (
        <HStack spacing={8} modifiers={[padding({ horizontal: 12, vertical: 9 }), background(c.card), clipShape('roundedRectangle', 12)]}>
          <Image systemName="turkishlirasign.circle.fill" size={16} color={c.brand} />
          <Text modifiers={[font({ size: 13 }), foregroundStyle(c.sub), lineLimit(1)]}>{L.collected}</Text>
          <Spacer />
          <Text modifiers={[font({ size: 17, weight: 'bold', design: 'rounded' }), foregroundStyle(c.text), monospacedDigit(), lineLimit(1), minimumScaleFactor(0.6)]}>{s.collected}</Text>
        </HStack>
      ) : null}
      <Text modifiers={[font({ size: 12, weight: 'semibold' }), foregroundStyle(c.sub)]}>{L.queue}</Text>
      {rows.length === 0 ? (
        <Text modifiers={[font({ size: 13 }), foregroundStyle(c.muted)]}>{L.queueEmpty}</Text>
      ) : (
        <VStack alignment="leading" spacing={7}>
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
                  <Text modifiers={[font({ size: 11 }), foregroundStyle(c.sub), lineLimit(1)]}>{job.vehicle}</Text>
                </VStack>
                <Spacer />
                {job.status === 'ready' ? (
                  <Text modifiers={[font({ size: 11, weight: 'bold' }), foregroundStyle(c.info)]}>{L.ready}</Text>
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
          {props.queue.length + props.more > rows.length ? (
            <Text modifiers={[font({ size: 11 }), foregroundStyle(c.muted)]}>{`+${props.queue.length + props.more - rows.length} ${L.more}`}</Text>
          ) : null}
        </VStack>
      )}
      <Spacer />
    </VStack>,
    home,
  );
};

export default createWidget<TodayWidgetProps>('OtopolyToday', OtopolyToday);
