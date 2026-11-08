import TcpSocket from 'react-native-tcp-socket';
import type { Connect, Socket } from './tuya';

export const connect: Connect = (host, port, onConnect) =>
  TcpSocket.createConnection({ host, port }, onConnect) as unknown as Socket;
