import TcpSocket from 'react-native-tcp-socket';
import type { Connect, Socket } from './tuya';

export const connect: Connect = (host, port, onConnect) =>
  // interface 'wifi': no Android, se o Wi-Fi está "sem internet" o sistema manda
  // o tráfego pelo 4G, onde o IP local da lâmpada não existe. Força a rota pelo Wi-Fi.
  TcpSocket.createConnection({ host, port, interface: 'wifi', connectTimeout: 4000 }, onConnect) as unknown as Socket;
