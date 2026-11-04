import { Eraser, Undo2 } from 'lucide-react-native';
import { useEffect, useMemo, useRef, useState } from 'react';
import { View, type LayoutChangeEvent } from 'react-native';
import { GestureDetector, usePanGesture, type PanGesture } from 'react-native-gesture-handler';
import Svg, { Circle, Path } from 'react-native-svg';

import { Button, Row, Txt } from '@/components/ui';
import { useLocale } from '@/lib/i18n/provider';
import { useTheme } from '@/theme/provider';

import { strokesToPngDataUrl, type Point, type Stroke } from '../lib/signature-png';

const PAD_HEIGHT = 200;

function toPath(stroke: Stroke) {
  return stroke.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
}

export type SignaturePadController = {
  gesture: PanGesture;
  strokes: Stroke[];
  live: Stroke | null;
  drawing: boolean;
  onLayout: (e: LayoutChangeEvent) => void;
  undo: () => void;
  clear: () => void;
};

/**
 * Signature state + the drawing gesture. The gesture lives in the parent so a surrounding scroll view can
 * wait for it (`<ScrollView requireToFail={pad.gesture}>` from react-native-gesture-handler): on iOS the
 * UIScrollView pan otherwise wins every vertical stroke (only horizontal lines drew), and toggling
 * `scrollEnabled` from JS arrives too late because the native scroll has already started.
 *
 * Emits a PNG data URL after each stroke, or null when cleared.
 */
export function useSignaturePad(onChange: (dataUrl: string | null) => void): SignaturePadController {
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [live, setLive] = useState<Stroke | null>(null);
  const [drawing, setDrawing] = useState(false);
  const size = useRef({ width: 0, height: PAD_HEIGHT });
  const current = useRef<Point[]>([]);
  // Strokes mirror for the gesture callbacks: the gesture config stays stable across renders.
  const strokesRef = useRef<Stroke[]>([]);
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  const { config, emit } = useMemo(() => {
    const emitStrokes = (next: Stroke[]) => {
      strokesRef.current = next;
      setStrokes(next);
      onChangeRef.current(next.length ? strokesToPngDataUrl(next, size.current.width, size.current.height) : null);
    };
    const clamp = (x: number, y: number): Point => ({
      x: Math.max(0, Math.min(size.current.width, x)),
      y: Math.max(0, Math.min(size.current.height, y)),
    });
    return {
      emit: emitStrokes,
      config: {
        runOnJS: true,
        // Start on touch-down: a dot is a valid stroke and the scroll view must not get a head start.
        minDistance: 0,
        maxPointers: 1,
        shouldCancelWhenOutside: false,
        onBegin: (e: { x: number; y: number }) => {
          current.current = [clamp(e.x, e.y)];
          setDrawing(true);
          setLive([...current.current]);
        },
        onUpdate: (e: { x: number; y: number }) => {
          if (!current.current.length) return;
          current.current.push(clamp(e.x, e.y));
          setLive([...current.current]);
        },
        onFinalize: () => {
          const stroke = current.current;
          current.current = [];
          setDrawing(false);
          setLive(null);
          if (stroke.length) emitStrokes([...strokesRef.current, stroke]);
        },
      },
    };
  }, []);
  const gesture = usePanGesture(config);

  return {
    gesture,
    strokes,
    live,
    drawing,
    onLayout: (e) => {
      size.current = { width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height };
    },
    undo: () => emit(strokes.slice(0, -1)),
    clear: () => emit([]),
  };
}

/** Finger signature pad (web `SignaturePad` with `showButtons`). Pair with {@link useSignaturePad}. */
export function SignaturePad({ pad }: { pad: SignaturePadController }) {
  const t = useTheme();
  const { t: tr } = useLocale();
  const all = pad.live ? [...pad.strokes, pad.live] : pad.strokes;

  return (
    <View style={{ gap: t.spacing.sm }}>
      <GestureDetector gesture={pad.gesture}>
        <View
          onLayout={pad.onLayout}
          collapsable={false}
          accessible
          accessibilityLabel={tr('mobile.documents.signature_pad')}
          accessibilityHint={tr('mobile.documents.signature_pad_hint')}
          style={{
            height: PAD_HEIGHT,
            borderRadius: t.radius.md,
            borderWidth: 1.5,
            borderStyle: 'dashed',
            borderColor: pad.drawing ? t.colors.primary : t.colors.borderStrong,
            backgroundColor: t.colors.surface,
            overflow: 'hidden',
          }}
        >
          <Svg width="100%" height="100%" pointerEvents="none">
            {all.map((s, i) =>
              s.length === 1 ? (
                <Circle key={i} cx={s[0].x} cy={s[0].y} r={1.8} fill={t.colors.text} />
              ) : (
                <Path key={i} d={toPath(s)} stroke={t.colors.text} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" fill="none" />
              ),
            )}
          </Svg>
          {all.length === 0 ? (
            <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, bottom: t.spacing.lg, alignItems: 'center' }}>
              <View style={{ width: '70%', height: 1, backgroundColor: t.colors.border, marginBottom: t.spacing.sm }} />
              <Txt variant="caption" tone="muted">
                {tr('mobile.documents.signature_placeholder')}
              </Txt>
            </View>
          ) : null}
        </View>
      </GestureDetector>
      <Row gap={t.spacing.sm}>
        <Button
          size="sm"
          variant="outline"
          label={tr('contracts.editor.undo')}
          icon={<Undo2 size={16} color={t.colors.text} />}
          disabled={pad.strokes.length === 0}
          onPress={pad.undo}
        />
        <Button
          size="sm"
          variant="outline"
          label={tr('common.clear')}
          icon={<Eraser size={16} color={t.colors.text} />}
          disabled={pad.strokes.length === 0}
          onPress={pad.clear}
        />
      </Row>
    </View>
  );
}
