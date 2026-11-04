import { HStack, Image, Spacer, Text, VStack } from '@expo/ui/swift-ui';
import {
  activityBackgroundTint,
  background,
  clipShape,
  font,
  foregroundStyle,
  frame,
  lineLimit,
  monospacedDigit,
  padding,
} from '@expo/ui/swift-ui/modifiers';
import { createLiveActivity, type LiveActivityEnvironment } from 'expo-widgets';

import type { JobActivityProps } from './types';

/**
 * Live Activity for one job: Lock Screen banner + Dynamic Island.
 * The timer counts up from `startedAt` while the job is in progress and freezes once it is finished.
 */
const JobActivity = (props: JobActivityProps, environment: LiveActivityEnvironment) => {
  'widget';
  const dark = environment.colorScheme === 'dark' || environment.isLuminanceReduced;
  const c = dark
    ? { bg: '#1C1714', text: '#F7F1ED', sub: '#C4B3AA', brand: '#F07D55', ok: '#4ADE80', info: '#60A5FA', muted: '#8E7C73' }
    : { bg: '#FFFFFF', text: '#1A1412', sub: '#6B5E57', brand: '#EA6E43', ok: '#15803D', info: '#2563EB', muted: '#9C8880' };
  const active = props.status === 'in_progress';
  const tone = props.status === 'ready' ? c.info : props.status === 'delivered' ? c.ok : props.status === 'cancelled' ? c.muted : c.brand;
  const symbol = props.status === 'ready' ? 'key.fill' : props.status === 'delivered' ? 'checkmark.circle.fill' : props.status === 'cancelled' ? 'xmark.circle.fill' : 'car.fill';
  const start = new Date(props.startedAt);
  const end = new Date(props.finishedAt || props.startedAt);

  // Counting timer while active; frozen elapsed time once the job has left the bay.
  const timer = (size: number, color: string) =>
    active ? (
      <Text modifiers={[font({ size, weight: 'bold', design: 'rounded' }), foregroundStyle(color), monospacedDigit()]} timerInterval={{ lower: start, upper: new Date(props.startedAt + 12 * 3600 * 1000) }} countsDown={false} />
    ) : (
      <Text modifiers={[font({ size, weight: 'bold', design: 'rounded' }), foregroundStyle(color), monospacedDigit()]} timerInterval={{ lower: start, upper: end }} countsDown={false} pauseTime={end} />
    );

  const plate = (size: number) => (
    <Text modifiers={[font({ size, weight: 'heavy', design: 'monospaced' }), foregroundStyle('#1A1412'), padding({ horizontal: 7, vertical: 3 }), background('#FFFFFF'), clipShape('roundedRectangle', 6), lineLimit(1)]}>
      {props.plate}
    </Text>
  );

  const pill = (
    <HStack spacing={4} modifiers={[padding({ horizontal: 8, vertical: 4 }), background(tone), clipShape('capsule')]}>
      <Image systemName={symbol} size={10} color="#FFFFFF" />
      <Text modifiers={[font({ size: 11, weight: 'bold' }), foregroundStyle('#FFFFFF'), lineLimit(1)]}>{props.labels.status}</Text>
    </HStack>
  );

  return {
    banner: (
      <VStack alignment="leading" spacing={10} modifiers={[padding({ all: 16 }), activityBackgroundTint(c.bg)]}>
        <HStack spacing={8}>
          <Image systemName="car.fill" size={12} color={c.brand} />
          <Text modifiers={[font({ size: 12, weight: 'semibold' }), foregroundStyle(c.sub), lineLimit(1)]}>{props.org}</Text>
          <Spacer />
          {pill}
        </HStack>
        <HStack alignment="center" spacing={12}>
          <VStack alignment="leading" spacing={4}>
            {plate(15)}
            <Text modifiers={[font({ size: 15, weight: 'semibold' }), foregroundStyle(c.text), lineLimit(1)]}>{props.customer}</Text>
            <Text modifiers={[font({ size: 12 }), foregroundStyle(c.sub), lineLimit(1)]}>{props.services || props.vehicle}</Text>
          </VStack>
          <Spacer />
          <VStack alignment="trailing" spacing={2}>
            {timer(28, active ? c.text : tone)}
            <Text modifiers={[font({ size: 11 }), foregroundStyle(c.sub), lineLimit(1)]}>{props.labels.elapsed}</Text>
          </VStack>
        </HStack>
        {props.labels.hint ? <Text modifiers={[font({ size: 12, weight: 'medium' }), foregroundStyle(tone), lineLimit(1)]}>{props.labels.hint}</Text> : null}
      </VStack>
    ),
    compactLeading: <Image systemName={symbol} color={tone} />,
    compactTrailing: active ? (
      <Text modifiers={[font({ size: 14, weight: 'semibold' }), foregroundStyle(c.brand), monospacedDigit(), frame({ maxWidth: 52 })]} timerInterval={{ lower: start, upper: new Date(props.startedAt + 12 * 3600 * 1000) }} countsDown={false} />
    ) : (
      <Text modifiers={[font({ size: 13, weight: 'bold' }), foregroundStyle(tone), lineLimit(1), frame({ maxWidth: 70 })]}>{props.labels.status}</Text>
    ),
    minimal: <Image systemName={symbol} color={tone} />,
    expandedLeading: (
      <VStack alignment="leading" spacing={4} modifiers={[padding({ leading: 6, top: 4 })]}>
        {plate(14)}
        <Text modifiers={[font({ size: 12 }), foregroundStyle('#C4B3AA'), lineLimit(1)]}>{props.vehicle}</Text>
      </VStack>
    ),
    expandedTrailing: (
      <VStack alignment="trailing" spacing={2} modifiers={[padding({ trailing: 6, top: 4 })]}>
        {timer(22, active ? '#F07D55' : tone)}
        <Text modifiers={[font({ size: 11 }), foregroundStyle('#C4B3AA')]}>{props.labels.elapsed}</Text>
      </VStack>
    ),
    expandedBottom: (
      <HStack spacing={8} modifiers={[padding({ horizontal: 6, bottom: 4 })]}>
        <VStack alignment="leading" spacing={1}>
          <Text modifiers={[font({ size: 14, weight: 'semibold' }), foregroundStyle('#F7F1ED'), lineLimit(1)]}>{props.customer}</Text>
          <Text modifiers={[font({ size: 12 }), foregroundStyle('#C4B3AA'), lineLimit(1)]}>{props.services}</Text>
        </VStack>
        <Spacer />
        {pill}
      </HStack>
    ),
  };
};

export default createLiveActivity<JobActivityProps>('JobActivity', JobActivity);
