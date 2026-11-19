import TcpSocket from 'react-native-tcp-socket';
import type { Connect, Socket } from './tuya';

export const connect: Connect = (host, port, onConnect, timeoutMs = 4000) =>
  // Sem `interface: 'wifi'`: nesta lib ela prende o processo inteiro a uma rede e
  // falhou em celular real ("Sem conexão com a lâmpada: undefined", v0.0.5).
  TcpSocket.createConnection({ host, port, connectTimeout: timeoutMs }, onConnect) as unknown as Socket;
