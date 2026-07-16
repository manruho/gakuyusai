import { useEffect, useMemo, useState } from 'react';

type Order = {
  id: string;
  pickup_code: string;
  station_id: number;
  register_id: number;
  status: 'pending' | 'delivered' | 'canceled';
  created_at: string;
  cancel_acknowledged_at: string | null;
  items: Array<{ product_id: string; product_name: string; quantity: number }>;
};

export function FulfillmentAdminPage() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [connected, setConnected] = useState<Array<{ stationId: number; connections: number }>>([]);
  const [message, setMessage] = useState('');
  const load = async () => {
    const [ordersResponse, summaryResponse] = await Promise.all([
      fetch('/api/admin/fulfillment/orders?limit=1000'),
      fetch('/api/admin/fulfillment/summary'),
    ]);
    const json = (await ordersResponse.json()) as { ok: true; data: { items: Order[] } } | { ok: false; error: { message: string } };
    const summary = (await summaryResponse.json()) as { ok: true; data: { connected: Array<{ stationId: number; connections: number }> } } | { ok: false; error: { message: string } };
    if (json.ok) setOrders(json.data.items); else setMessage(json.error.message);
    if (summary.ok) setConnected(summary.data.connected);
  };
  useEffect(() => { void load(); const timer = window.setInterval(() => void load(), 60_000); return () => window.clearInterval(timer); }, []);
  const pending = useMemo(() => orders.filter((order) => order.status === 'pending'), [orders]);
  const canceled = useMemo(() => orders.filter((order) => order.status === 'canceled' && !order.cancel_acknowledged_at), [orders]);
  const oldest = pending[0] ? Math.max(0, Math.floor((Date.now() - Date.parse(pending[0].created_at)) / 60_000)) : 0;
  return (
    <main className="page page-admin">
      <section className="panel">
        <div className="admin-hero"><div><p className="eyebrow">Fulfillment Monitor</p><h1>受取状況</h1><p className="small">全レジ・全受取場所の注文状態</p></div><a className="admin-link-button" href="/admin">管理画面へ戻る</a></div>
        {message ? <p className="error">{message}</p> : null}
        <div className="fulfillment-summary-grid"><div><strong>{pending.length}</strong><span>未受渡し</span></div><div><strong>{oldest}</strong><span>最古の経過分</span></div><div><strong>{canceled.length}</strong><span>取消未確認</span></div></div>
        <div className="fulfillment-stations">{[1, 2, 3, 4].map((stationId) => { const station = orders.filter((order) => order.station_id === stationId); const live = connected.find((item) => item.stationId === stationId)?.connections ?? 0; return <article key={stationId}><h2>受取{stationId}</h2><p>未受渡し {station.filter((order) => order.status === 'pending').length}件</p><p>受渡済み {station.filter((order) => order.status === 'delivered').length}件</p><p>取消 {station.filter((order) => order.status === 'canceled').length}件</p><small>{live ? '● 接続中' : '○ 未接続'}</small></article>; })}</div>
        <section className="admin-panel"><h2>注文一覧</h2><div className="sales-list">{orders.slice(0, 100).map((order) => <article className="sale-row" key={order.id}><div><strong className="order-code">{order.pickup_code}</strong><small>レジ{order.register_id} / 受取{order.station_id}</small></div><div><span>{order.items.map((item) => `${item.product_name} ×${item.quantity}`).join('、')}</span><small>{order.status} / {order.created_at}</small></div><span>{order.status === 'canceled' && !order.cancel_acknowledged_at ? '取消未確認' : ''}</span></article>)}</div></section>
      </section>
    </main>
  );
}
