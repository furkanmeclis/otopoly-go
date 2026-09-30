import { Eraser, Undo2 } from 'lucide-react-native';
import { useRef, useState } from 'react';
import { View, type GestureResponderEvent, type LayoutChangeEvent } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';

import { Button, Row, Txt } from '@/components/ui';
import { useLocale } from '@/lib/i18n/provider';
import { useTheme } from '@/theme/provider';

import { strokesToPngDataUrl, type Point, type Stroke } from '../lib/signature-png';

const PAD_HEIGHT = 200;

function toPath(stroke: Stroke) {
  return stroke.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
}

/**
 * Finger signature pad (web `SignaturePad` with `showButtons`). Emits a PNG data URL after each stroke,
 * or null when cleared. `onDrawingChange` lets the parent lock its ScrollView while the finger is down.
 */
export function SignaturePad({ onChange, onDrawingChange }: { onChange: (dataUrl: string | null) => void; onDrawingChange?: (drawing: boolean) => void }) {
  const t = useTheme();
  const { t: tr } = useLocale();
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [live, setLive] = useState<Stroke | null>(null);
  const [size, setSize] = useState({ width: 0, height: PAD_HEIGHT });
  const current = useRef<Point[]>([]);

  const emit = (next: Stroke[]) => {
    setStrokes(next);
    onChange(next.length ? strokesToPngDataUrl(next, size.width, size.height) : null);
  };

  const point = (e: GestureResponderEvent): Point => ({
    x: Math.max(0, Math.min(size.width, e.nativeEvent.locationX)),
    y: Math.max(0, Math.min(size.height, e.nativeEvent.locationY)),
  });

  const end = (commit: boolean) => {
    onDrawingChange?.(false);
    const stroke = current.current;
    current.current = [];
    setLive(null);
    if (commit && stroke.length) emit([...strokes, stroke]);
  };

  const onLayout = (e: LayoutChangeEvent) => setSize({ width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height });

  const all = live ? [...strokes, live] : strokes;

  return (
    <View style={{ gap: t.spacing.sm }}>
      <View
        onLayout={onLayout}
        accessible
        accessibilityLabel={tr('mobile.documents.signature_pad')}
        accessibilityHint={tr('mobile.documents.signature_pad_hint')}
        style={{
          height: PAD_HEIGHT,
          borderRadius: t.radius.md,
          borderWidth: 1.5,
          borderStyle: 'dashed',
          borderColor: t.colors.borderStrong,
          backgroundColor: t.colors.surface,
          overflow: 'hidden',
        }}
        onStartShouldSetResponder={() => true}
        onStartShouldSetResponderCapture={() => true}
        onMoveShouldSetResponder={() => true}
        onResponderTerminationRequest={() => false}
        onResponderGrant={(e) => {
          onDrawingChange?.(true);
          current.current = [point(e)];
          setLive([...current.current]);
        }}
        onResponderMove={(e) => {
          current.current.push(point(e));
          setLive([...current.current]);
        }}
        onResponderRelease={() => end(true)}
        onResponderTerminate={() => end(false)}
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
      <Row gap={t.spacing.sm}>
        <Button
          size="sm"
          variant="outline"
          label={tr('contracts.editor.undo')}
          icon={<Undo2 size={16} color={t.colors.text} />}
          disabled={strokes.length === 0}
          onPress={() => emit(strokes.slice(0, -1))}
        />
        <Button
          size="sm"
          variant="outline"
          label={tr('common.clear')}
          icon={<Eraser size={16} color={t.colors.text} />}
          disabled={strokes.length === 0}
          onPress={() => emit([])}
        />
      </Row>
    </View>
  );
}
