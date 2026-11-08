import Slider from '@react-native-community/slider';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { AppState, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { BUILD } from './src/build-info';
import { connect } from './src/connect';
import { loadDevice } from './src/device-store';
import { Settings } from './src/Settings';
import { colors, hsvToHex } from './src/theme';
import { Bulb, commands, type BulbState, type Device } from './src/tuya';

const THROTTLE_MS = 120;

export default function App() {
  const [device, setDevice] = useState<Device | null | undefined>(undefined);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    loadDevice().then(setDevice, () => setDevice(null));
  }, []);

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.screen}>
        <StatusBar style="light" />
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {device === undefined ? null : !device || editing ? (
            <Settings
              initial={device}
              onSaved={(d) => {
                setDevice(d);
                setEditing(false);
              }}
              onCancel={device ? () => setEditing(false) : undefined}
            />
          ) : (
            <Control key={`${device.id}@${device.ip}`} device={device} onEdit={() => setEditing(true)} />
          )}
        </ScrollView>
        <Text style={styles.version} pointerEvents="none">
          v{BUILD.version} · {BUILD.date}
        </Text>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

function Control({ device, onEdit }: { device: Device; onEdit: () => void }) {
  const [bulb] = useState(() => new Bulb(connect, device));
  const [state, setState] = useState<BulbState | null>(null);
  const [error, setError] = useState('');
  const pending = useRef<Record<string, unknown> | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refresh = useCallback(() => {
    bulb.getState().then(
      (s) => {
        setState(s);
        setError('');
      },
      (e: Error) => setError(e.message),
    );
  }, [bulb]);

  useEffect(() => {
    refresh();
    // Em segundo plano a conexão fecha (bateria); ao voltar, reconecta e atualiza.
    const sub = AppState.addEventListener('change', (s) => (s === 'active' ? refresh() : bulb.close()));
    return () => {
      sub.remove();
      if (timer.current) clearTimeout(timer.current);
      bulb.close();
    };
  }, [bulb, refresh]);

  // Envia no máximo um comando a cada THROTTLE_MS, sempre com o valor mais recente.
  const flush = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const dps = pending.current;
    pending.current = null;
    if (dps)
      bulb.set(dps).catch((e: Error) => {
        setError(e.message);
        refresh();
      });
  }, [bulb, refresh]);

  // A tela muda na hora (otimista); o comando segue em seguida.
  const apply = (next: Partial<BulbState>, dps: Record<string, unknown>, immediate = false) => {
    setState((s) => (s ? { ...s, ...next } : s));
    pending.current = dps;
    if (immediate) flush();
    else if (!timer.current) timer.current = setTimeout(flush, THROTTLE_MS);
  };

  if (!state) {
    return (
      <View style={styles.center}>
        <Text style={styles.muted}>{error || 'Conectando à lâmpada…'}</Text>
        {!!error && (
          <View style={styles.row}>
            <Chip label="Tentar de novo" onPress={refresh} />
            <Chip label="Configurar" onPress={onEdit} />
          </View>
        )}
      </View>
    );
  }

  const isColour = state.mode === 'colour';
  const swatch = isColour ? hsvToHex(state.hue, state.saturation, 100) : colors.accent;
  const setBrightness = (b: number, now = false) =>
    apply(
      { brightness: b },
      isColour ? commands.colour(state.hue, state.saturation, b) : commands.white(b, state.temp),
      now,
    );
  const setTemp = (t: number, now = false) =>
    apply({ temp: t, mode: 'white', on: true }, commands.white(state.brightness, t), now);
  const setHue = (h: number, now = false) =>
    apply({ hue: h, mode: 'colour', on: true }, commands.colour(h, state.saturation, state.brightness), now);
  const setSat = (s: number, now = false) =>
    apply({ saturation: s, mode: 'colour', on: true }, commands.colour(state.hue, s, state.brightness), now);

  return (
    <View style={styles.control}>
      <View style={styles.header}>
        <Text style={styles.title}>Lâmpada</Text>
        <Pressable onPress={onEdit} hitSlop={12} accessibilityRole="button">
          <Text style={styles.muted}>Configurar</Text>
        </Pressable>
      </View>

      <Pressable
        accessibilityRole="switch"
        accessibilityState={{ checked: state.on }}
        onPress={() => apply({ on: !state.on }, commands.power(!state.on), true)}
        style={({ pressed }) => [
          styles.power,
          state.on && { backgroundColor: swatch, shadowColor: swatch },
          pressed && styles.pressed,
        ]}
      >
        <Text style={[styles.powerText, state.on && styles.powerTextOn]}>{state.on ? 'Desligar' : 'Ligar'}</Text>
      </Pressable>

      <View style={styles.row}>
        <Chip
          label="Branco"
          active={!isColour}
          onPress={() => apply({ mode: 'white', on: true }, commands.white(state.brightness, state.temp), true)}
        />
        <Chip
          label="Cor"
          active={isColour}
          onPress={() => {
            const sat = state.saturation || 100;
            apply({ mode: 'colour', on: true, saturation: sat }, commands.colour(state.hue, sat, state.brightness), true);
          }}
        />
      </View>

      <Card label="Brilho" value={`${state.brightness}%`}>
        <Slider
          minimumValue={1}
          maximumValue={100}
          step={1}
          value={state.brightness}
          onValueChange={(v) => setBrightness(v)}
          onSlidingComplete={(v) => setBrightness(v, true)}
          minimumTrackTintColor={colors.accent}
          thumbTintColor={colors.accent}
        />
      </Card>

      {isColour ? (
        <>
          <Card label="Cor" value={<View style={[styles.dot, { backgroundColor: swatch }]} />}>
            <Slider
              minimumValue={0}
              maximumValue={360}
              step={1}
              value={state.hue}
              onValueChange={(v) => setHue(v)}
              onSlidingComplete={(v) => setHue(v, true)}
              minimumTrackTintColor={swatch}
              thumbTintColor={swatch}
            />
          </Card>
          <Card label="Saturação" value={`${state.saturation}%`}>
            <Slider
              minimumValue={0}
              maximumValue={100}
              step={1}
              value={state.saturation}
              onValueChange={(v) => setSat(v)}
              onSlidingComplete={(v) => setSat(v, true)}
              minimumTrackTintColor={swatch}
              thumbTintColor={swatch}
            />
          </Card>
        </>
      ) : (
        <Card label="Branco quente ↔ frio" value={`${state.temp}%`}>
          <Slider
            minimumValue={0}
            maximumValue={100}
            step={1}
            value={state.temp}
            onValueChange={(v) => setTemp(v)}
            onSlidingComplete={(v) => setTemp(v, true)}
            minimumTrackTintColor="#ffb259"
            maximumTrackTintColor="#cfe3ff"
            thumbTintColor="#ffffff"
          />
        </Card>
      )}

      <Text style={[styles.status, !!error && styles.error]} accessibilityLiveRegion="polite">
        {error}
      </Text>
    </View>
  );
}

function Card({ label, value, children }: { label: string; value: ReactNode; children: ReactNode }) {
  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <Text style={styles.muted}>{label}</Text>
        {typeof value === 'string' ? <Text style={styles.muted}>{value}</Text> : value}
      </View>
      {children}
    </View>
  );
}

function Chip({ label, active, onPress }: { label: string; active?: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[styles.chip, active && styles.chipActive]} accessibilityRole="button">
      <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 16, paddingBottom: 48, flexGrow: 1 },
  control: { gap: 16 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 16, paddingTop: 120 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  title: { color: colors.text, fontSize: 22, fontWeight: '600' },
  muted: { color: colors.muted, fontSize: 14, textAlign: 'center' },
  power: {
    alignSelf: 'center',
    width: 160,
    height: 160,
    borderRadius: 80,
    backgroundColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: 8,
    shadowOpacity: 0.6,
    shadowRadius: 24,
    elevation: 12,
  },
  pressed: { transform: [{ scale: 0.96 }] },
  powerText: { color: colors.muted, fontSize: 20, fontWeight: '600' },
  powerTextOn: { color: '#1a1300' },
  row: { flexDirection: 'row', gap: 8, justifyContent: 'center' },
  chip: { paddingVertical: 10, paddingHorizontal: 20, borderRadius: 999, backgroundColor: colors.card },
  chipActive: { backgroundColor: colors.text },
  chipText: { color: colors.muted, fontSize: 15, fontWeight: '500' },
  chipTextActive: { color: colors.bg },
  card: { backgroundColor: colors.card, borderRadius: 16, padding: 16, gap: 8 },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  dot: { width: 18, height: 18, borderRadius: 9 },
  status: { minHeight: 20, textAlign: 'center', color: colors.muted, fontSize: 14 },
  error: { color: colors.error },
  version: { position: 'absolute', right: 10, bottom: 6, fontSize: 11, color: colors.muted, opacity: 0.6 },
});
