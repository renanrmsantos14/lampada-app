import dgram from 'react-native-udp';
import type { Listen } from './tuya';

// Escuta o anúncio UDP da lâmpada. Entrar num grupo multicast qualquer faz a lib pegar o
// MulticastLock do Android; sem ele, alguns celulares descartam broadcast do Wi-Fi.
export const listen: Listen = (port, onMessage) => {
  // Os tipos da lib não expõem o EventEmitter; `on` existe em runtime.
  const socket = dgram.createSocket({ type: 'udp4', reusePort: true }) as ReturnType<typeof dgram.createSocket> & {
    on(event: string, cb: (...args: never[]) => void): unknown;
  };
  socket.on('message', (msg: Uint8Array) => onMessage(new Uint8Array(msg)));
  socket.on('error', () => {});
  socket.bind(port, () => {
    try {
      socket.addMembership('239.255.255.250');
    } catch {
      // sem o lock, o broadcast ainda chega na maioria dos aparelhos
    }
  });
  return () => {
    try {
      socket.close();
    } catch {
      // já fechado
    }
  };
};
