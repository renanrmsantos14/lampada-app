import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { connect } from './connect';
import { saveDevice } from './device-store';
import { colors } from './theme';
import { Bulb, type Device } from './tuya';

type Props = { initial: Device | null; onSaved: (device: Device) => void; onCancel?: () => void };

const IP_RE = /^(\d{1,3}\.){3}\d{1,3}$/;

export function Settings({ initial, onSaved, onCancel }: Props) {
  const [form, setForm] = useState<Device>(initial ?? { id: '', ip: '', key: '' });
  const [error, setError] = useState('');
  const [testing, setTesting] = useState(false);
  const field = (name: keyof Device) => (text: string) => setForm((f) => ({ ...f, [name]: text.trim() }));

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
      <Text style={styles.title}>Configurar lâmpada</Text>
      <Text style={styles.hint}>
        Use os dados do devices.json gerado pelo tinytuya wizard. A chave fica guardada só neste celular.
      </Text>
      <Text style={styles.label}>ID do dispositivo</Text>
      <TextInput style={styles.input} value={form.id} onChangeText={field('id')} autoCapitalize="none" autoCorrect={false} />
      <Text style={styles.label}>IP na rede local</Text>
      <TextInput style={styles.input} value={form.ip} onChangeText={field('ip')} keyboardType="decimal-pad" />
      <Text style={styles.label}>Chave local (local_key)</Text>
      <TextInput
        style={styles.input}
        value={form.key}
        onChangeText={field('key')}
        autoCapitalize="none"
        autoCorrect={false}
        secureTextEntry
      />
      {!!error && <Text style={styles.error}>{error}</Text>}
      <Pressable style={[styles.button, testing && styles.disabled]} onPress={save} disabled={testing}>
        {testing ? <ActivityIndicator color="#1a1300" /> : <Text style={styles.buttonText}>Testar e salvar</Text>}
      </Pressable>
      {onCancel && (
        <Pressable onPress={onCancel} disabled={testing} style={styles.cancel}>
          <Text style={styles.cancelText}>Cancelar</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 8 },
  title: { color: colors.text, fontSize: 22, fontWeight: '600', marginBottom: 4 },
  hint: { color: colors.muted, fontSize: 14, marginBottom: 8 },
  label: { color: colors.muted, fontSize: 14, marginTop: 8 },
  input: { backgroundColor: colors.card, color: colors.text, borderRadius: 12, padding: 14, fontSize: 16 },
  error: { color: colors.error, fontSize: 14, marginTop: 8 },
  button: { backgroundColor: colors.accent, borderRadius: 12, padding: 16, alignItems: 'center', marginTop: 16 },
  disabled: { opacity: 0.6 },
  buttonText: { color: '#1a1300', fontSize: 16, fontWeight: '600' },
  cancel: { padding: 14, alignItems: 'center' },
  cancelText: { color: colors.muted, fontSize: 16 },
});
