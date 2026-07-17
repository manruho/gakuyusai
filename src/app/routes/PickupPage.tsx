import { useEffect, useMemo, useRef, useState } from 'react';

type Order = {
  id: string;
  sale_id: string;
  pickup_code: string;
  station_id: number;
  status: 'pending' | 'delivered' | 'canceled';
  created_at: string;
  delivered_at: string | null;
  cancel_acknowledged_at: string | null;
  items: Array<{ product_id: string; product_name: string; quantity: number }>;
};

export function PickupPage() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [message, setMessage] = useState('');
  const [syncState, setSyncState] = useState<'同期中' | '同期済み' | 'エラー'>('同期中');
  const [stationId, setStationId] = useState<number | null>(null);
  const [newOrderIds, setNewOrderIds] = useState<Set<string>>(new Set());
  const [checkedOrderIds, setCheckedOrderIds] = useState<Set<string>>(() => {
    try {
      const saved = JSON.parse(window.localStorage.getItem('gakuyusai:pickup:checked-orders') ?? '[]') as unknown;
      return Array.isArray(saved) ? new Set(saved.filter((id): id is string => typeof id === 'string')) : new Set();
    } catch {
      // 保存済みチェックが壊れていても一覧表示は継続する。
      return new Set();
    }
  });
  const knownOrderIds = useRef<Set<string> | null>(null);

  useEffect(() => {
    window.localStorage.setItem('gakuyusai:pickup:checked-orders', JSON.stringify([...checkedOrderIds]));
  }, [checkedOrderIds]);

  const applyOrders = (nextOrders: Order[]) => {
    const nextIds = new Set(nextOrders.map((order) => order.id));
    if (knownOrderIds.current) {
      const incoming = new Set(nextOrders.filter((order) => !knownOrderIds.current?.has(order.id)).map((order) => order.id));
      if (incoming.size) {
        setNewOrderIds(incoming);
        window.setTimeout(() => setNewOrderIds((current) => {
          const next = new Set(current);
          incoming.forEach((id) => next.delete(id));
          return next;
        }), 900);
      }
    }
    knownOrderIds.current = nextIds;
    setOrders(nextOrders);
  };

  const load = async () => {
    try {
      const response = await fetch('/api/pickup/orders?includeDelivered=true&limit=100');
      const json = (await response.json()) as { ok: true; data: { items: Order[] } } | { ok: false; error: { message: string } };
      if (!json.ok) throw new Error(json.error.message);
      applyOrders(json.data.items);
      setSyncState('同期済み');
      setMessage('');
    } catch (error) {
      setSyncState('エラー');
      setMessage(error instanceof Error ? error.message : '受取注文を同期できませんでした。');
    }
  };

  useEffect(() => {
    void load();
    void fetch('/api/auth/me').then(async (response) => {
      if (!response.ok) return null;
      return (await response.json()) as { ok: true; data: { stationId?: number } } | { ok: false };
    }).then((json) => {
      if (json?.ok && json.data.stationId) setStationId(json.data.stationId);
    });
    const timer = window.setInterval(() => void load(), 60_000);
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    let socket: WebSocket | null = null;
    let reconnectTimer = 0;
    let reconnectAttempt = 0;
    let disposed = false;
    const connect = () => {
      if (disposed) return;
      setSyncState('同期中');
      socket = new WebSocket(`${protocol}//${window.location.host}/api/pickup/live`);
      socket.addEventListener('open', () => { reconnectAttempt = 0; setSyncState('同期済み'); void load(); });
      socket.addEventListener('message', () => void load());
      socket.addEventListener('close', () => {
        if (disposed) return;
        setSyncState('エラー');
        reconnectAttempt += 1;
        reconnectTimer = window.setTimeout(connect, Math.min(30_000, 1_000 * 2 ** Math.min(reconnectAttempt, 5)));
      });
      socket.addEventListener('error', () => setSyncState('エラー'));
    };
    connect();
    const onVisible = () => { if (document.visibilityState === 'visible') void load(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { disposed = true; window.clearInterval(timer); window.clearTimeout(reconnectTimer); socket?.close(); document.removeEventListener('visibilitychange', onVisible); };
  }, []);

  const pending = useMemo(() => orders.filter((order) => order.status === 'pending'), [orders]);
  const delivered = useMemo(() => orders.filter((order) => order.status === 'delivered').slice(0, 10), [orders]);
  const canceled = useMemo(() => orders.filter((order) => order.status === 'canceled' && !order.cancel_acknowledged_at), [orders]);

  const action = async (order: Order, path: 'deliver' | 'restore' | 'ack-cancel') => {
    const response = await fetch(`/api/pickup/orders/${encodeURIComponent(order.id)}/${path}`, { method: 'POST' });
    const json = (await response.json()) as { ok: true } | { ok: false; error: { message: string } };
    if (!json.ok) setMessage(json.error.message);
    else await load();
  };

  const toggleCheck = (orderId: string) => {
    setCheckedOrderIds((current) => {
      const next = new Set(current);
      if (next.has(orderId)) next.delete(orderId);
      else next.add(orderId);
      return next;
    });
  };

  return (
    <main className="page page-pickup">
      <section className="panel pickup-shell pickup-simple-shell">
        <header className="pickup-header pickup-compact-header"><strong className="pickup-station-title">受取{stationId ?? '－'}</strong><span className="pickup-count">未処理 {pending.length}件</span><div className="pickup-connection">● {syncState}<button type="button" onClick={() => void load()}>再同期</button></div></header>
        {message ? <p className="error">{message}</p> : null}
        <section className="pickup-order-table" aria-label="未受渡し注文一覧">
          <div className="pickup-table-row pickup-table-head" aria-hidden="true"><span>No.</span><span>注文番号</span><span>商品・個数</span><span>受渡</span></div>
          {pending.map((order, index) => (
            <article className={`pickup-table-row${newOrderIds.has(order.id) ? ' is-new-order' : ''}`} key={order.id}>
              <span className="pickup-row-no">{pending.length - index}</span>
              <strong className="pickup-row-code">{order.pickup_code}</strong>
              <div className="pickup-row-items">{order.items.map((item) => <span key={item.product_id}><span>{item.product_name}</span><strong>×{item.quantity}</strong></span>)}</div>
              <button type="button" className={`pickup-check-button${checkedOrderIds.has(order.id) ? ' is-checked' : ''}`} onClick={() => toggleCheck(order.id)} aria-label={`${order.pickup_code}のチェックを${checkedOrderIds.has(order.id) ? '外す' : '入れる'}`} aria-pressed={checkedOrderIds.has(order.id)}>{checkedOrderIds.has(order.id) ? '✓' : ''}</button>
            </article>
          ))}
          {!pending.length ? <p className="empty-state pickup-empty">未受渡しの注文はありません。</p> : null}
        </section>
        {canceled.length ? <section className="pickup-canceled"><h2>キャンセル確認</h2>{canceled.map((order) => <article className="pickup-cancel-row" key={order.id}><strong>{order.pickup_code}</strong><span>レジ側で取り消されました。</span><button type="button" onClick={() => void action(order, 'ack-cancel')}>確認</button></article>)}</section> : null}
        {delivered.length ? <section className="pickup-delivered"><h2>直近の受渡済み</h2>{delivered.map((order) => <div className="pickup-delivered-row" key={order.id}><strong className="order-code">{order.pickup_code}</strong><span>{order.items.map((item) => `${item.product_name} ×${item.quantity}`).join('、')}</span><button type="button" onClick={() => void action(order, 'restore')}>戻す</button></div>)}</section> : null}
      </section>
    </main>
  );
}
