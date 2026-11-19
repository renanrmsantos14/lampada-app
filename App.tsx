import NetInfo from '@react-native-community/netinfo';
import * as Haptics from 'expo-haptics';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { Bar } from './src/Bar';
import { BUILD } from './src/build-info';
import { connect } from './src/connect';
import { listen } from './src/discover';
import { loadDevice, loadState, saveDevice, saveState } from './src/device-store';
import { Settings } from './src/Settings';
import { HUE_STOPS, hsvToHex, radius, textOn, themed, useColors, whiteTone, WARM, COOL } from './src/theme';
import { Bulb, commands, findBulb, type BulbState, type Device } from './src/tuya';
import { useUpdater, type Release } from './src/updater';

const THROTTLE_MS = 100;
const RETRY_MS = [1000, 2000, 4000, 8000, 15000]; // espera entre tentativas automáticas
const ECHO_MS = 1500; // depois de um toque, ignora estados da lâmpada que ainda não refletem o toque

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

const tap = () => Haptics.selectionAsync().catch(() => {});
const thump = () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});

// Último estado conhecido (sobrevive à troca de IP, que recria o controle).
let lastState: BulbState | null = null;

export default function App() {
  const [device, setDevice] = useState<Device | null | undefined>(undefined);
  const [editing, setEditing] = useState(false);
  const updater = useUpdater();
  const { check } = updater;
  const styles = useStyles();
  const colors = useColors();

  useEffect(() => {
    Promise.all([loadDevice(), loadState()]).then(
      ([d, s]) => {
        lastState = s;
        setDevice(d);
      },
      () => setDevice(null),
    );
    check(); // auto update: procura versão nova ao abrir
  }, [check]);

  const available = updater.state.status === 'available' ? updater.state.release : null;

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.screen}>
        <StatusBar style="auto" />
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
              onMoved={(d) => saveDevice(d).finally(() => setDevice(d))}
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

type Link = 'connecting' | 'online' | 'searching' | 'offline' | 'nowifi';

const LINK_TEXT: Record<Link, string> = {
  connecting: 'Conectando…',
  online: 'Conectada',
  searching: 'Procurando a lâmpada na rede…',
  offline: 'Sem resposta. A lâmpada está ligada na energia?',
  nowifi: 'Sem Wi-Fi. Conecte-se à rede de casa.',
};

type ControlProps = {
  device: Device;
  update: Release | null;
  onUpdate: () => void;
  onEdit: () => void;
  onMoved: (device: Device) => void; // lâmpada achada em outro IP
};

function Control({ device, update, onUpdate, onEdit, onMoved }: ControlProps) {
  const styles = useStyles();
  const colors = useColors();
  const [bulb] = useState(() => new Bulb(connect, device));
  const [state, setState] = useState<BulbState | null>(lastState);
  const [link, setLink] = useState<Link>('connecting');
  const pending = useRef<Record<string, unknown> | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastLocal = useRef(0); // hora do último toque do usuário

  const retry = useRef<{ attempt: number; timer: ReturnType<typeof setTimeout> | null }>({ attempt: 0, timer: null });
  const searching = useRef(false);
  const wifi = useRef(true);
  const online = useRef(false); // a última leitura deu certo
  const moved = useRef(onMoved);
  moved.current = onMoved;

  // Estado vindo da lâmpada; ignorado logo após um toque (ela ainda não aplicou o comando).
  const remote = useCallback((s: BulbState) => {
    if (Date.now() - lastLocal.current > ECHO_MS) setState(s);
  }, []);

  // Guarda o estado para a próxima abertura do app.
  useEffect(() => {
    if (!state) return;
    lastState = state;
    const t = setTimeout(() => saveState(state), 800);
    return () => clearTimeout(t);
  }, [state]);

  // Procura a lâmpada na rede (o roteador pode ter mudado o IP dela).
  const search = useCallback(() => {
    if (searching.current) return;
    searching.current = true;
    setLink('searching');
    const done = () => {
      searching.current = false;
      setLink((l) => (l === 'searching' ? 'offline' : l));
    };
    // Achou no mesmo IP: a lâmpada só estava lenta, o ciclo de tentativas segue.
    findBulb(connect, device, listen).then((found) => (found && found.ip !== device.ip ? moved.current(found) : done()), done);
  }, [device]);

  // Lê o estado; se falhar, tenta de novo sozinho com espera crescente até conseguir.
  const refresh = useCallback(() => {
    const r = retry.current;
    if (r.timer) clearTimeout(r.timer);
    r.timer = null;
    bulb.getState().then(
      (s) => {
        r.attempt = 0;
        online.current = true;
        setLink('online');
        remote(s);
      },
      () => {
        if (AppState.currentState !== 'active') return;
        if (!wifi.current) setLink('nowifi');
        else if (r.attempt % 4 === 0)
          search(); // na 1ª falha e depois a cada 4
        else if (!searching.current) setLink('offline');
        r.timer = setTimeout(refresh, RETRY_MS[Math.min(r.attempt++, RETRY_MS.length - 1)]);
      },
    );
  }, [bulb, search, remote]);

  // Reinicia o ciclo: fecha a conexão velha (presa à rede anterior) e reconecta já.
  const reconnect = useCallback(() => {
    retry.current.attempt = 0;
    bulb.close();
    setLink((l) => (l === 'searching' ? l : 'connecting'));
    refresh();
  }, [bulb, refresh]);

  useEffect(() => {
    bulb.onStatus = remote; // mudou pelo interruptor ou outro app: atualiza na hora
    // A conexão morreu sozinha (o IP costuma mudar quando a lâmpada reinicia): relê já e, se
    // falhar, procura, em vez de mostrar "Conectada" até o próximo toque. Só depois de uma
    // leitura boa, para uma lâmpada que aceita e derruba a conexão não virar laço sem espera.
    bulb.onLost = () => {
      if (AppState.currentState !== 'active' || !online.current) return;
      online.current = false;
      setLink('connecting');
      refresh();
    };
    refresh();
    // Em segundo plano a conexão fecha (bateria); ao voltar, reconecta e atualiza.
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') return reconnect();
      if (retry.current.timer) clearTimeout(retry.current.timer);
      bulb.close();
    });
    // Wi-Fi caiu/voltou ou trocou de rede: o socket antigo morre em silêncio, então reconecta na hora.
    let lastNet = '';
    const unsubNet = NetInfo.addEventListener((n) => {
      wifi.current = n.type === 'wifi' && n.isConnected !== false;
      const key = `${n.type}:${n.isConnected}:${(n.details as { ipAddress?: string } | null)?.ipAddress ?? ''}`;
      if (lastNet && key !== lastNet && AppState.currentState === 'active') reconnect();
      if (!wifi.current) setLink('nowifi');
      lastNet = key;
    });
    return () => {
      bulb.onStatus = null;
      bulb.onLost = null;
      sub.remove();
      unsubNet();
      if (timer.current) clearTimeout(timer.current);
      if (retry.current.timer) clearTimeout(retry.current.timer);
      bulb.close();
    };
  }, [bulb, refresh, reconnect, remote]);

  // Envia no máximo um comando a cada THROTTLE_MS, sempre com o valor mais recente.
  const flush = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const dps = pending.current;
    pending.current = null;
    if (dps)
      bulb.set(dps).then(
        () => setLink('online'),
        () => refresh(),
      );
  }, [bulb, refresh]);

  // A tela muda na hora (otimista); o comando segue em seguida.
  const apply = (next: Partial<BulbState>, dps: Record<string, unknown>, immediate = false) => {
    lastLocal.current = Date.now();
    setState((s) => (s ? { ...s, ...next } : s));
    pending.current = dps;
    if (immediate) flush();
    else if (!timer.current) timer.current = setTimeout(flush, THROTTLE_MS);
  };

  const usable = link === 'online' || link === 'connecting';
  const bad = link === 'offline' || link === 'nowifi';
  const header = (
    <View style={styles.header}>
      <View style={styles.headerText}>
        <Text style={styles.title}>Lâmpada</Text>
        <View style={styles.status} accessibilityLiveRegion="polite">
          <View style={[styles.dot, { backgroundColor: link === 'online' ? colors.ok : bad ? colors.error : colors.muted }]} />
          <Text style={[styles.subtitle, bad && styles.error]}>{LINK_TEXT[link]}</Text>
        </View>
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

  const retryButton = bad && (
    <View style={styles.retry}>
      <Pill label="Tentar de novo" onPress={reconnect} />
    </View>
  );

  if (!state) {
    return (
      <View style={styles.control}>
        {header}
        {banner}
        {retryButton}
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
    tap();
    if (mode === 'white') return apply({ mode, on: true }, white(state.brightness, state.temp), true);
    const sat = state.saturation || 100;
    apply({ mode, on: true, saturation: sat }, colour(state.hue, sat, state.brightness), true);
  };
  const setScene = ({ state: s }: Scene) => {
    tap();
    const next = { ...state, ...s, on: true };
    apply(
      next,
      next.mode === 'colour' ? colour(next.hue, next.saturation, next.brightness) : white(next.brightness, next.temp),
      true,
    );
  };

  return (
    <View style={styles.control}>
      {header}
      {banner}
      {retryButton}

      {/* Sem conexão: mostra o último estado conhecido, mas sem aceitar toques. */}
      <View style={[styles.control, !usable && styles.disabled]} pointerEvents={usable ? 'auto' : 'none'}>
        <Pressable
          accessibilityRole="switch"
          accessibilityState={{ checked: state.on }}
          accessibilityLabel="Ligar ou desligar a lâmpada"
          onPress={() => {
            thump();
            apply({ on: !state.on }, commands.power(!state.on), true);
          }}
          style={({ pressed }) => [
            styles.hero,
            { backgroundColor: state.on ? color : colors.surface },
            pressed && styles.pressed,
          ]}
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
    </View>
  );
}

function Pill({ label, onPress }: { label: string; onPress: () => void }) {
  const styles = useStyles();
  return (
    <Pressable onPress={onPress} accessibilityRole="button" style={styles.pill}>
      <Text style={styles.pillText}>{label}</Text>
    </Pressable>
  );
}

const useStyles = themed((colors) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.bg },
    content: { padding: 20, paddingBottom: 12, flexGrow: 1 },
    control: { gap: 16 },
    header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 },
    title: { color: colors.text, fontSize: 30, fontWeight: '700', letterSpacing: -0.5 },
    headerText: { flex: 1, paddingRight: 12 },
    status: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 },
    dot: { width: 8, height: 8, borderRadius: 4 },
    subtitle: { color: colors.muted, fontSize: 14, flexShrink: 1 },
    disabled: { opacity: 0.45 },
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
    bannerText: { color: colors.inverse, fontSize: 14 },
    bannerAction: { color: colors.inverse, fontSize: 14, fontWeight: '700' },
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
    pillText: { color: colors.inverse, fontSize: 15, fontWeight: '600' },
    version: { marginTop: 'auto', paddingTop: 24, alignSelf: 'flex-end', fontSize: 11, color: colors.muted, opacity: 0.7 },
  }),
);
