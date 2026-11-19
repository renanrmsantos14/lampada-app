import * as SecureStore from 'expo-secure-store';
import type { BulbState, Device } from './tuya';

const KEY = 'lampada.device';

export async function loadDevice(): Promise<Device | null> {
  const raw = await SecureStore.getItemAsync(KEY);
  return raw ? (JSON.parse(raw) as Device) : null;
}

export function saveDevice(device: Device): Promise<void> {
  return SecureStore.setItemAsync(KEY, JSON.stringify(device));
}

// Último estado visto: o app abre já com os controles prontos, sem esperar a rede.
const STATE_KEY = 'lampada.state';

export async function loadState(): Promise<BulbState | null> {
  const raw = await SecureStore.getItemAsync(STATE_KEY).catch(() => null);
  return raw ? (JSON.parse(raw) as BulbState) : null;
}

export function saveState(state: BulbState): Promise<void> {
  return SecureStore.setItemAsync(STATE_KEY, JSON.stringify(state)).catch(() => {});
}
