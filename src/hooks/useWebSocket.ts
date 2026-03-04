import { useRef, useCallback } from 'react';
import type { ClientMessage, ServerMessage } from '../types';

export function useWebSocket(onMessage: (data: ServerMessage) => void) {
  const wsRef = useRef<WebSocket | null>(null);

  const connect = useCallback((onOpen: () => void) => {
    if (wsRef.current && wsRef.current.readyState <= 1) {
      onOpen();
      return;
    }
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const isLocal =
      location.hostname === 'localhost' || location.hostname === '127.0.0.1';
    const wsUrl = isLocal
      ? `${proto}//${location.hostname}:8765`
      : `${proto}//${location.host}/ws`;

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = onOpen;
    ws.onmessage = (e) => {
      try {
        onMessage(JSON.parse(e.data) as ServerMessage);
      } catch {
        /* ignore malformed */
      }
    };
    ws.onclose = () => {
      onMessage({ type: 'auth_error', msg: 'Connection lost. Refresh.' } as ServerMessage);
    };
    ws.onerror = () => {
      onMessage({ type: 'auth_error', msg: 'Cannot connect to server.' } as ServerMessage);
    };
  }, [onMessage]);

  const send = useCallback((msg: ClientMessage) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg));
    }
  }, []);

  const close = useCallback(() => {
    wsRef.current?.close();
    wsRef.current = null;
  }, []);

  return { connect, send, close };
}
