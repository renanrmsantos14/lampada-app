import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { Bar } from './src/Bar';
import { BUILD } from './src/build-info';
import { connect } from './src/connect';
import { loadDevice } from './src/device-store';
import { Settings } from './src/Settings';
import { colors, HUE_STOPS, hsvToHex, radius, textOn, whiteTone, WARM, COOL } from './src/theme';
import { Bulb, commands, type BulbState, type Device } from './src/tuya';
import { useUpdater, type Release } from './src/updater';

const THROTTLE_MS = 120;

type Scene = { name: string; state: Pick<BulbState, 'brightness'> & Partial<BulbState> };
const SCENES: Scene[] = [
  { name: 'Leitura', state: { mode: 'white', brightness: 100, temp: 60 } },
  { name: 'Foco', state: { mode: 'white', brightness: 100, temp: 100 } },
  { name: 'Relaxar', state: { mode: 'white', brightness: 50, temp: 0 } },
  { name: 'Noite', state: { mode: 'white', brightness: 10, temp: 0 } },
  { name: 'Pôr do sol', state: { mode: 'colour', brightness: 70, hue: 25, saturation: 85 } },
  { name: 'Oceano', state: { mode: 'colour', brightness: 60, hue: 200, saturation: 75 } },
];

const tone = (s: Partial<BulbState>) =>
  s.mode === 'colour' ? hsvToHex(s.hue ?? 0, s.saturation ?? 100, 100) : whiteTone(s.temp ?? 50);

export default function App() {
  const [device, setDevice] = useState<Device | null | undefined>(undefined);
  const [editing, setEditing] = useState(false);
  const updater = useUpdater();
  const { check } = updater;

  useEffect(() => {
    loadDevice().then(setDevice, () => setDevice(null));
    check(); // auto update: procura versão nova ao abrir
  }, [check]);

  const available = updater.state.status === 'available' ? updater.state.release : null;

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.screen}>
        <StatusBar style="dark" />
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {device === undefined ? null : !device || editing ? (
            <Settings
              initial={device}
              onSaved={(d) => {
                setDevice(d);
                setEditing(false);
              }}
              onBack={device ? () => setEditing(false) : undefined}
              update={updater.state}
              onCheck={check}
              onInstall={updater.install}
            />
          ) : (
            <Control
              key={`${device.id}@${device.ip}`}
              device={device}
              update={available}
              onUpdate={() => setEditing(true)}
              onEdit={() => setEditing(true)}
            />
          )}
          <Text style={styles.version} pointerEvents="none">
            v{BUILD.version} · {BUILD.date}
          </Text>
        </ScrollView>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

type ControlProps = { device: Device; update: Release | null; onUpdate: () => void; onEdit: () => void };

function Control({ device, update, onUpdate, onEdit }: ControlProps) {
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

  const header = (
    <View style={styles.header}>
      <View>
        <Text style={styles.title}>Lâmpada</Text>
        <Text style={[styles.subtitle, !!error && styles.error]} numberOfLines={2}>
          {error || (state ? 'Conectada no Wi-Fi' : 'Conectando…')}
        </Text>
      </View>
      <Pressable onPress={onEdit} hitSlop={12} accessibilityRole="button" style={styles.settings}>
        <Text style={styles.settingsText}>Ajustes</Text>
      </Pressable>
    </View>
  );

  const banner = update && (
    <Pressable onPress={onUpdate} accessibilityRole="button" style={styles.banner}>
      <Text style={styles.bannerText}>Nova versão v{update.version} disponível</Text>
      <Text style={styles.bannerAction}>Atualizar</Text>
    </Pressable>
  );

  if (!state) {
    return (
      <View style={styles.control}>
        {header}
        {banner}
        {!!error && (
          <View style={styles.retry}>
            <Pill label="Tentar de novo" onPress={refresh} />
          </View>
        )}
      </View>
    );
  }

  const isColour = state.mode === 'colour';
  const color = tone(state);
  const onHero = state.on ? textOn(color) : colors.text;
  const white = (b: number, t: number) => commands.white(b, t);
  const colour = (h: number, s: number, b: number) => commands.colour(h, s, b);

  const setBrightness = (b: number, now = false) =>
    apply({ brightness: b, on: true }, isColour ? colour(state.hue, state.saturation, b) : white(b, state.temp), now);
  const setTemp = (t: number, now = false) => apply({ temp: t, mode: 'white', on: true }, white(state.brightness, t), now);
  const setHue = (h: number, now = false) =>
    apply({ hue: h, mode: 'colour', on: true }, colour(h, state.saturation, state.brightness), now);
  const setSat = (s: number, now = false) =>
    apply({ saturation: s, mode: 'colour', on: true }, colour(state.hue, s, state.brightness), now);
  const setMode = (mode: 'white' | 'colour') => {
    if (mode === 'white') return apply({ mode, on: true }, white(state.brightness, state.temp), true);
    const sat = state.saturation || 100;
    apply({ mode, on: true, saturation: sat }, colour(state.hue, sat, state.brightness), true);
  };
  const setScene = ({ state: s }: Scene) => {
    const next = { ...state, ...s, on: true };
    apply(next, next.mode === 'colour' ? colour(next.hue, next.saturation, next.brightness) : white(next.brightness, next.temp), true);
  };

  return (
    <View style={styles.control}>
      {header}
      {banner}

      <Pressable
        accessibilityRole="switch"
        accessibilityState={{ checked: state.on }}
        accessibilityLabel="Ligar ou desligar a lâmpada"
        onPress={() => apply({ on: !state.on }, commands.power(!state.on), true)}
        style={({ pressed }) => [styles.hero, { backgroundColor: state.on ? color : colors.surface }, pressed && styles.pressed]}
      >
        <View>
          <Text style={[styles.heroTitle, { color: onHero }]}>{state.on ? 'Ligada' : 'Desligada'}</Text>
          <Text style={[styles.heroSub, { color: onHero }]}>
            {state.on ? `${isColour ? 'Cor' : 'Branco'} · ${state.brightness}%` : 'Toque para ligar'}
          </Text>
        </View>
        <View style={[styles.switch, state.on && styles.switchOn]}>
          <View style={[styles.knob, state.on && styles.knobOn]} />
        </View>
      </Pressable>

      <View style={styles.segment}>
        {(['white', 'colour'] as const).map((m) => {
          const active = (m === 'colour') === isColour;
          return (
            <Pressable
              key={m}
              onPress={() => setMode(m)}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              style={[styles.segmentItem, active && styles.segmentActive]}
            >
              <Text style={[styles.segmentText, active && styles.segmentTextActive]}>{m === 'white' ? 'Branco' : 'Cor'}</Text>
            </Pressable>
          );
        })}
      </View>

      <View style={styles.card}>
        <Bar
          label="Brilho"
          value={state.brightness}
          min={1}
          max={100}
          display={`${state.brightness}%`}
          fill={color}
          onChange={(v) => setBrightness(v)}
          onCommit={(v) => setBrightness(v, true)}
        />
        {isColour ? (
          <>
            <Bar
              label="Cor"
              value={state.hue}
              min={0}
              max={360}
              display={`${state.hue}°`}
              gradient={HUE_STOPS}
              onChange={(v) => setHue(v)}
              onCommit={(v) => setHue(v, true)}
            />
            <Bar
              label="Intensidade da cor"
              value={state.saturation}
              min={0}
              max={100}
              display={`${state.saturation}%`}
              gradient={['#FFFFFF', hsvToHex(state.hue, 100, 100)]}
              onChange={(v) => setSat(v)}
              onCommit={(v) => setSat(v, true)}
            />
          </>
        ) : (
          <Bar
            label="Tom do branco"
            value={state.temp}
            min={0}
            max={100}
            display={state.temp < 35 ? 'Quente' : state.temp > 65 ? 'Frio' : 'Neutro'}
            gradient={[WARM, '#FFF6E8', COOL]}
            onChange={(v) => setTemp(v)}
            onCommit={(v) => setTemp(v, true)}
          />
        )}
      </View>

      <Text style={styles.sectionTitle}>Cenas</Text>
      <View style={styles.scenes}>
        {SCENES.map((scene) => (
          <Pressable
            key={scene.name}
            onPress={() => setScene(scene)}
            accessibilityRole="button"
            style={({ pressed }) => [styles.scene, pressed && styles.pressed]}
          >
            <View style={[styles.sceneDot, { backgroundColor: tone(scene.state) }]} />
            <Text style={styles.sceneText}>{scene.name}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

function Pill({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" style={styles.pill}>
      <Text style={styles.pillText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 20, paddingBottom: 12, flexGrow: 1 },
  control: { gap: 16 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 },
  title: { color: colors.text, fontSize: 30, fontWeight: '700', letterSpacing: -0.5 },
  subtitle: { color: colors.muted, fontSize: 14, marginTop: 2, maxWidth: 260 },
  error: { color: colors.error },
  settings: { backgroundColor: colors.surface, borderRadius: radius.pill, paddingHorizontal: 16, paddingVertical: 9 },
  settingsText: { color: colors.text, fontSize: 15, fontWeight: '600' },
  banner: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: colors.text,
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  bannerText: { color: '#FFFFFF', fontSize: 14 },
  bannerAction: { color: '#FFFFFF', fontSize: 14, fontWeight: '700' },
  retry: { alignItems: 'flex-start' },
  hero: {
    borderRadius: radius.card,
    padding: 24,
    minHeight: 140,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    borderWidth: 1,
    borderColor: colors.line,
  },
  heroTitle: { fontSize: 34, fontWeight: '700', letterSpacing: -0.5 },
  heroSub: { fontSize: 15, marginTop: 4, opacity: 0.8 },
  switch: { width: 56, height: 32, borderRadius: 16, backgroundColor: colors.track, padding: 3 },
  switchOn: { backgroundColor: 'rgba(22,22,26,0.85)' },
  knob: { width: 26, height: 26, borderRadius: 13, backgroundColor: '#FFFFFF' },
  knobOn: { transform: [{ translateX: 24 }] },
  pressed: { opacity: 0.85, transform: [{ scale: 0.98 }] },
  segment: { flexDirection: 'row', backgroundColor: colors.track, borderRadius: radius.pill, padding: 4 },
  segmentItem: { flex: 1, paddingVertical: 11, borderRadius: radius.pill, alignItems: 'center' },
  segmentActive: { backgroundColor: colors.surface },
  segmentText: { color: colors.muted, fontSize: 15, fontWeight: '600' },
  segmentTextActive: { color: colors.text },
  card: { backgroundColor: colors.surface, borderRadius: radius.card, padding: 20, gap: 22 },
  sectionTitle: { color: colors.text, fontSize: 18, fontWeight: '700', marginTop: 4 },
  scenes: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  scene: {
    width: '30%',
    flexGrow: 1,
    backgroundColor: colors.surface,
    borderRadius: 18,
    paddingVertical: 14,
    paddingHorizontal: 12,
    gap: 10,
  },
  sceneDot: { width: 28, height: 28, borderRadius: 14, borderWidth: 1, borderColor: colors.line },
  sceneText: { color: colors.text, fontSize: 14, fontWeight: '600' },
  pill: { backgroundColor: colors.text, borderRadius: radius.pill, paddingHorizontal: 20, paddingVertical: 12 },
  pillText: { color: '#FFFFFF', fontSize: 15, fontWeight: '600' },
  version: { marginTop: 'auto', paddingTop: 24, alignSelf: 'flex-end', fontSize: 11, color: colors.muted, opacity: 0.7 },
});
