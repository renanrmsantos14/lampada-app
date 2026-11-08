import { LinearGradient } from 'expo-linear-gradient';
import { useRef, useState } from 'react';
import { PanResponder, StyleSheet, Text, View } from 'react-native';
import { colors, radius } from './theme';

type Props = {
  label: string;
  value: number;
  min: number;
  max: number;
  display: string;
  /** Barra preenchida até o valor nesta cor; sem `gradient`. */
  fill?: string;
  /** Faixa de cores de fundo (temperatura, matiz, saturação). */
  gradient?: string[];
  onChange: (v: number) => void;
  onCommit: (v: number) => void;
};

// Barra grossa de arrastar: toca para ir direto ao valor, arrasta para ajustar.
export function Bar(props: Props) {
  const { label, value, min, max, display, fill, gradient } = props;
  const latest = useRef(props);
  latest.current = props;
  const width = useRef(1);
  const startX = useRef(0);
  const last = useRef(value);

  const toValue = (x: number) => {
    const { min, max } = latest.current;
    return Math.round(min + Math.min(1, Math.max(0, x / width.current)) * (max - min));
  };
  const emit = (x: number) => {
    const v = toValue(x);
    if (v !== last.current) latest.current.onChange((last.current = v));
  };

  const [responder] = useState(() =>
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (e) => {
        startX.current = e.nativeEvent.locationX;
        last.current = Number.NaN;
        emit(startX.current);
      },
      onPanResponderMove: (_, g) => emit(startX.current + g.dx),
      onPanResponderRelease: (_, g) => latest.current.onCommit(toValue(startX.current + g.dx)),
    }),
  );

  const ratio = (value - min) / (max - min || 1);
  const step = Math.max(1, Math.round((max - min) / 20));
  const nudge = (d: number) => props.onCommit(Math.min(max, Math.max(min, value + d)));

  return (
    <View style={styles.wrap}>
      <View style={styles.labels}>
        <Text style={styles.label}>{label}</Text>
        <Text style={styles.value}>{display}</Text>
      </View>
      <View
        style={styles.bar}
        onLayout={(e) => (width.current = e.nativeEvent.layout.width || 1)}
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel={label}
        accessibilityValue={{ min, max, now: value, text: display }}
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={(e) => nudge(e.nativeEvent.actionName === 'increment' ? step : -step)}
        {...responder.panHandlers}
      >
        <View style={StyleSheet.absoluteFill} pointerEvents="none">
          {gradient ? (
            <LinearGradient colors={gradient as [string, string, ...string[]]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={StyleSheet.absoluteFill} />
          ) : (
            <View style={[styles.fill, { width: `${ratio * 100}%`, backgroundColor: fill }]} />
          )}
          <View style={[styles.thumb, { left: `${ratio * 100}%` }]} />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 10 },
  labels: { flexDirection: 'row', justifyContent: 'space-between' },
  label: { color: colors.text, fontSize: 15, fontWeight: '600' },
  value: { color: colors.muted, fontSize: 15, fontVariant: ['tabular-nums'] },
  bar: { height: 56, borderRadius: radius.bar, backgroundColor: colors.track, overflow: 'hidden' },
  fill: { position: 'absolute', left: 0, top: 0, bottom: 0 },
  thumb: {
    position: 'absolute',
    top: 10,
    bottom: 10,
    width: 6,
    marginLeft: -3,
    borderRadius: 3,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.25)',
  },
});
