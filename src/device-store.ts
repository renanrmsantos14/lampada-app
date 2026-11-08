import * as SecureStore from 'expo-secure-store';
import type { Device } from './tuya';

const KEY = 'lampada.device';

export async function loadDevice(): Promise<Device | null> {
  const raw = await SecureStore.getItemAsync(KEY);
  return raw ? (JSON.parse(raw) as Device) : null;
}

export function saveDevice(device: Device): Promise<void> {
  return SecureStore.setItemAsync(KEY, JSON.stringify(device));
}
