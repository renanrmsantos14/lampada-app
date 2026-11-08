import { useEffect, useState, type ComponentProps, type ReactNode } from 'react';
import { ActivityIndicator, BackHandler, Linking, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { BUILD } from './build-info';
import { connect } from './connect';
import { saveDevice } from './device-store';
import { colors, radius } from './theme';
import { Bulb, type Device } from './tuya';
import { REPO, type Release, type UpdateState } from './updater';

type Props = {
  initial: Device | null;
  onSaved: (device: Device) => void;
  onBack?: () => void;
  update: UpdateState;
  onCheck: () => void;
  onInstall: (release: Release) => void;
};

const IP_RE = /^(\d{1,3}\.){3}\d{1,3}$/;

export function Settings({ initial, onSaved, onBack, update, onCheck, onInstall }: Props) {
  const [form, setForm] = useState<Device>(initial ?? { id: '', ip: '', key: '' });
  const [error, setError] = useState('');
  const [testing, setTesting] = useState(false);
  const field = (name: keyof Device) => (text: string) => setForm((f) => ({ ...f, [name]: text.trim() }));

  useEffect(() => {
    if (!onBack) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => (onBack(), true));
    return () => sub.remove();
  }, [onBack]);

  async function save() {
    if (!form.id) return setError('Informe o ID da lâmpada.');
    if (!IP_RE.test(form.ip)) return setError('IP inválido (ex.: 192.168.0.50).');
    if (form.key.length !== 16) return setError('A chave local tem 16 caracteres.');
    setError('');
    setTesting(true);
    const bulb = new Bulb(connect, form);
    try {
      await bulb.getState(); // confirma IP e chave antes de salvar
      await saveDevice(form);
      onSaved(form);
    } catch (e) {
      setError(`Não consegui falar com a lâmpada: ${(e as Error).message}`);
    } finally {
      bulb.close();
      setTesting(false);
    }
  }

  return (
    <View style={styles.wrap}>
      <View style={styles.header}>
        {onBack && (
          <Pressable onPress={onBack} hitSlop={12} accessibilityRole="button" accessibilityLabel="Voltar">
            <Text style={styles.back}>‹ Voltar</Text>
          </Pressable>
        )}
        <Text style={styles.title}>Ajustes</Text>
      </View>

      <Section title="Lâmpada" hint="Dados do devices.json gerado pelo tinytuya wizard. A chave fica guardada só neste celular.">
        <Field label="ID do dispositivo" value={form.id} onChangeText={field('id')} />
        <Field label="IP na rede local" value={form.ip} onChangeText={field('ip')} keyboardType="decimal-pad" />
        <Field label="Chave local (local_key)" value={form.key} onChangeText={field('key')} secureTextEntry />
        {!!error && <Text style={styles.error}>{error}</Text>}
        <Button label="Testar e salvar" busy={testing} onPress={save} primary />
      </Section>

      <Section title="Atualizações">
        <Row label="Versão instalada" value={`v${BUILD.version} · ${BUILD.date}`} />
        <UpdateStatus update={update} />
        {update.status === 'available' || (update.status === 'error' && update.release) ? (
          <Button label={`Baixar e instalar v${update.release!.version}`} onPress={() => onInstall(update.release!)} primary />
        ) : (
          <Button
            label="Procurar atualização"
            busy={update.status === 'checking' || update.status === 'downloading'}
            onPress={onCheck}
          />
        )}
      </Section>

      <Pressable onPress={() => Linking.openURL(`https://github.com/${REPO}`)} accessibilityRole="link">
        <Text style={styles.link}>Código-fonte no GitHub</Text>
      </Pressable>
    </View>
  );
}

function UpdateStatus({ update }: { update: UpdateState }) {
  const text = {
    idle: '',
    checking: 'Procurando…',
    latest: 'Você está na versão mais recente.',
    available: update.status === 'available' && `Nova versão v${update.release.version} disponível.`,
    downloading: update.status === 'downloading' && `Baixando v${update.release.version}… ${Math.round(update.progress * 100)}%`,
    error: update.status === 'error' && update.message,
  }[update.status];
  if (!text) return null;
  return (
    <Text style={[styles.status, update.status === 'error' && styles.error]}>
      {text}
      {update.status === 'available' && '\nSe o Android pedir, permita instalar apps desta fonte e toque de novo.'}
    </Text>
  );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {!!hint && <Text style={styles.hint}>{hint}</Text>}
      {children}
    </View>
  );
}

function Field({ label, ...input }: { label: string } & ComponentProps<typeof TextInput>) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput style={styles.input} autoCapitalize="none" autoCorrect={false} placeholderTextColor={colors.muted} {...input} />
    </View>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

function Button({ label, onPress, busy, primary }: { label: string; onPress: () => void; busy?: boolean; primary?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={busy}
      accessibilityRole="button"
      style={({ pressed }) => [styles.button, primary && styles.primary, (pressed || busy) && styles.dim]}
    >
      {busy ? (
        <ActivityIndicator color={primary ? '#FFFFFF' : colors.text} />
      ) : (
        <Text style={[styles.buttonText, primary && styles.primaryText]}>{label}</Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 20 },
  header: { gap: 8 },
  back: { color: colors.muted, fontSize: 16 },
  title: { color: colors.text, fontSize: 30, fontWeight: '700', letterSpacing: -0.5 },
  section: { backgroundColor: colors.surface, borderRadius: radius.card, padding: 20, gap: 14 },
  sectionTitle: { color: colors.text, fontSize: 18, fontWeight: '700' },
  hint: { color: colors.muted, fontSize: 14, lineHeight: 20, marginTop: -6 },
  field: { gap: 6 },
  label: { color: colors.muted, fontSize: 14 },
  input: { backgroundColor: colors.bg, color: colors.text, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12, fontSize: 16 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  rowValue: { color: colors.text, fontSize: 15, fontWeight: '500' },
  status: { color: colors.text, fontSize: 14, lineHeight: 20 },
  error: { color: colors.error, fontSize: 14 },
  button: { borderRadius: radius.pill, paddingVertical: 15, alignItems: 'center', backgroundColor: colors.track },
  primary: { backgroundColor: colors.text },
  dim: { opacity: 0.6 },
  buttonText: { color: colors.text, fontSize: 16, fontWeight: '600' },
  primaryText: { color: '#FFFFFF' },
  link: { color: colors.muted, fontSize: 14, textAlign: 'center', textDecorationLine: 'underline' },
});
