import { DurableObject } from 'cloudflare:workers';

export type RealtimeEvent = {
  eventId: string;
  type: 'order.created' | 'order.delivered' | 'order.restored' | 'order.canceled' | 'order.cancel_acknowledged';
  stationId: 1 | 2 | 3 | 4;
  occurredAt: string;
  data: Record<string, unknown>;
};

type ConnectionAttachment = { channel: string; joinedAt: number };

/** 受取窓口または管理画面ごとのWebSocket接続を束ねる。正式データはD1に保持する。 */
export class RealtimeHub extends DurableObject {
  async fetch(request: Request): Promise<Response> {
    if (request.method === 'POST' && new URL(request.url).pathname === '/publish') {
      const event = (await request.json()) as RealtimeEvent;
      const message = JSON.stringify(event);
      for (const socket of this.ctx.getWebSockets()) {
        try {
          socket.send(message);
        } catch {
          socket.close(1011, '送信に失敗しました');
        }
      }
      return Response.json({ ok: true, sent: this.ctx.getWebSockets().length });
    }

    if (request.method === 'GET' && new URL(request.url).pathname === '/status') {
      return Response.json({ connected: this.ctx.getWebSockets().length });
    }

    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('WebSocket upgrade required', { status: 426 });
    }
    const channel = new URL(request.url).searchParams.get('channel') ?? 'pickup';
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ channel, joinedAt: Date.now() } satisfies ConnectionAttachment);
    server.send(JSON.stringify({ type: 'connection.ready', channel }));
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(socket: WebSocket, message: string | ArrayBuffer) {
    if (typeof message !== 'string') return;
    if (message === 'ping') socket.send(JSON.stringify({ type: 'pong' }));
  }

  async webSocketClose(socket: WebSocket, code: number, reason: string) {
    socket.close(code, reason);
  }
}

export async function publishRealtimeEvent(
  namespace: DurableObjectNamespace<RealtimeHub> | undefined,
  event: RealtimeEvent,
): Promise<void> {
  if (!namespace) return;
  const targets = [`station-${event.stationId}`, 'admin-all'];
  await Promise.all(targets.map((name) => namespace.getByName(name).fetch('https://realtime/publish', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(event),
  })));
}

export async function getRealtimeConnectionCount(namespace: DurableObjectNamespace<RealtimeHub> | undefined, channel: string): Promise<number> {
  if (!namespace) return 0;
  const response = await namespace.getByName(channel).fetch('https://realtime/status');
  if (!response.ok) return 0;
  const body = (await response.json()) as { connected?: number };
  return body.connected ?? 0;
}
