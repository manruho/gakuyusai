import { useEffect, useMemo, useRef, useState } from 'react';

type Order = {
  id: string;
  sale_id: string;
  pickup_code: string;
  station_id: number;
  pickup_date: string;
  status: 'pending' | 'delivered' | 'canceled';
  created_at: string;
  delivered_at: string | null;
  cancel_acknowledged_at: string | null;
  paymentStatus: 'awaiting_payment' | 'paid' | 'canceled';
  cancelReason: string;
  items: Array<{ product_id: string; product_name: string; quantity: number }>;
};

function formatPickupCode(code: string) {
  return code.length === 6 ? `${code.slice(0, 3)} ${code.slice(3)}` : code;
}

function normalizeSearch(value: string) {
  return value.trim().toUpperCase().replace(/[\s-]/g, '');
}

function getTokyoDate() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const values = new Map(parts.map((part) => [part.type, part.value]));
  return `${values.get('year')}-${values.get('month')}-${values.get('day')}`;
}

function formatPickupDate(value: string) {
  const [, month, day] = value.split('-');
  return `${Number(month)}/${Number(day)}受取`;
}

export function PickupPage() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [message, setMessage] = useState('');
  const [syncState, setSyncState] = useState<'同期中' | '同期済み' | 'エラー'>('同期中');
  const [stationId, setStationId] = useState<number | null>(null);
  const [query, setQuery] = useState('');
  const [newOrderIds, setNewOrderIds] = useState<Set<string>>(new Set());
  const [pendingOrder, setPendingOrder] = useState<Order | null>(null);
  const [isDelivering, setIsDelivering] = useState(false);
  const knownOrderIds = useRef<Set<string> | null>(null);
  const queryRef = useRef('');
  const searchRef = useRef<HTMLInputElement | null>(null);
  const dialogConfirmRef = useRef<HTMLButtonElement | null>(null);
  const searchTimerRef = useRef<number | null>(null);
  const syncTimerRef = useRef<number | null>(null);

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
    const normalizedQuery = queryRef.current;
    const sortedOrders = normalizedQuery
      ? [...nextOrders].sort((left, right) => {
        const leftExact = normalizeSearch(left.pickup_code) === normalizedQuery ? 0 : 1;
        const rightExact = normalizeSearch(right.pickup_code) === normalizedQuery ? 0 : 1;
        return leftExact - rightExact;
      })
      : nextOrders;
    setOrders(sortedOrders);
  };

  const load = async (requestedQuery = queryRef.current) => {
    const normalizedQuery = normalizeSearch(requestedQuery);
    queryRef.current = normalizedQuery;
    try {
      const params = new URLSearchParams({ includeDelivered: 'true', limit: '500' });
      if (normalizedQuery) params.set('q', normalizedQuery);
      const response = await fetch(`/api/pickup/orders?${params.toString()}`);
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

  const scheduleSync = () => {
    if (syncTimerRef.current !== null) window.clearTimeout(syncTimerRef.current);
    syncTimerRef.current = window.setTimeout(() => {
      syncTimerRef.current = null;
      void load();
    }, 250);
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
      socket.addEventListener('open', () => { reconnectAttempt = 0; setSyncState('同期済み'); scheduleSync(); });
      socket.addEventListener('message', scheduleSync);
      socket.addEventListener('close', () => {
        if (disposed) return;
        setSyncState('エラー');
        reconnectAttempt += 1;
        reconnectTimer = window.setTimeout(connect, Math.min(30_000, 1_000 * 2 ** Math.min(reconnectAttempt, 5)));
      });
      socket.addEventListener('error', () => setSyncState('エラー'));
    };
    connect();
    const onVisible = () => { if (document.visibilityState === 'visible') scheduleSync(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      disposed = true;
      window.clearInterval(timer);
      window.clearTimeout(reconnectTimer);
      if (syncTimerRef.current !== null) window.clearTimeout(syncTimerRef.current);
      socket?.close();
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  useEffect(() => {
    searchRef.current?.focus();
    return () => {
      if (searchTimerRef.current !== null) window.clearTimeout(searchTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!pendingOrder) return;
    dialogConfirmRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !isDelivering) setPendingOrder(null);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [pendingOrder, isDelivering]);

  const pending = useMemo(() => orders.filter((order) => order.status === 'pending'), [orders]);
  const delivered = useMemo(() => orders.filter((order) => order.status === 'delivered').slice(0, 10), [orders]);
  const canceled = useMemo(() => orders.filter((order) => order.status === 'canceled' && !order.cancel_acknowledged_at), [orders]);

  const action = async (order: Order, path: 'deliver' | 'restore' | 'ack-cancel') => {
    try {
      const response = await fetch(`/api/pickup/orders/${encodeURIComponent(order.id)}/${path}`, { method: 'POST' });
      const json = (await response.json()) as { ok: true } | { ok: false; error: { message: string } };
      if (!json.ok) {
        setMessage(json.error.message);
        return false;
      }
      await load();
      return true;
    } catch {
      setMessage('受取状態を更新できませんでした。もう一度お試しください。');
      return false;
    }
  };

  const confirmDelivery = async () => {
    if (!pendingOrder || isDelivering) return;
    setIsDelivering(true);
    const completed = await action(pendingOrder, 'deliver');
    setIsDelivering(false);
    if (completed) setPendingOrder(null);
  };

  return (
    <main className="page page-pickup">
      <section className="panel pickup-shell pickup-simple-shell">
        <header className="pickup-header pickup-compact-header"><strong className="pickup-station-title">受取{stationId ?? '－'}</strong><span className="pickup-count">未処理 {pending.length}件</span><div className="pickup-connection">● {syncState}<button type="button" onClick={() => void load()}>再同期</button></div></header>
        {message ? <p className="error">{message}</p> : null}
        <p className="pickup-presale-note">
          {stationId === 4 ? '前売り券（予約済み・未受取分）一覧' : '当日注文（本日受取分）一覧'}
        </p>
        <label className="pickup-search">
          <span>{stationId === 4 ? '前売りID・商品名で検索' : '当日注文番号・商品名で検索'}</span>
          <input
            ref={searchRef}
            value={query}
            onChange={(event) => {
              const value = event.target.value;
              setQuery(value);
              if (searchTimerRef.current !== null) window.clearTimeout(searchTimerRef.current);
              searchTimerRef.current = window.setTimeout(() => void load(value), 180);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                if (searchTimerRef.current !== null) window.clearTimeout(searchTimerRef.current);
                void load(query);
              }
            }}
            inputMode="text"
            autoComplete="off"
            placeholder={stationId === 4 ? '例：ABC DEF' : '例：7KQ2'}
            aria-label={stationId === 4 ? '前売りIDまたは商品名を検索' : '当日注文番号または商品名を検索'}
          />
        </label>
        <section className="pickup-order-table" aria-label="受取注文一覧">
          <div className="pickup-table-row pickup-table-head" aria-hidden="true"><span>{stationId === 4 ? '前売りID' : '当日注文番号'}</span><span>商品・個数</span><span>受渡</span></div>
          {pending.map((order) => {
            const isUpcoming = order.pickup_date > getTokyoDate();
            return (
            <article className={`pickup-table-row${newOrderIds.has(order.id) ? ' is-new-order' : ''}${isUpcoming ? ' is-upcoming' : ''}${order.paymentStatus === 'awaiting_payment' ? ' is-awaiting-payment' : ''}`} key={order.id}>
              <div><strong className="pickup-row-code">{formatPickupCode(order.pickup_code)}</strong>{stationId === 4 ? <span className="pickup-date-label">{formatPickupDate(order.pickup_date)}</span> : null}</div>
              <div className="pickup-row-items">{order.items.map((item) => <span key={item.product_id}><span>{item.product_name}</span><strong>×{item.quantity}</strong></span>)}</div>
              <button type="button" className="pickup-check-button" onClick={() => setPendingOrder(order)} disabled={isUpcoming || order.paymentStatus === 'awaiting_payment'} aria-label={order.paymentStatus === 'awaiting_payment' ? `${formatPickupCode(order.pickup_code)}は会計待ちです` : isUpcoming ? `${formatPickupCode(order.pickup_code)}は${formatPickupDate(order.pickup_date)}` : `${formatPickupCode(order.pickup_code)}を受取済みにする`}>{order.paymentStatus === 'awaiting_payment' ? '会計待ち' : isUpcoming ? '予約済' : '受取'}</button>
            </article>
            );
          })}
          {!pending.length ? <p className="empty-state pickup-empty">未受渡しの注文はありません。</p> : null}
        </section>
        {canceled.length ? <section className="pickup-canceled"><h2>キャンセル確認</h2>{canceled.map((order) => <article className="pickup-cancel-row" key={order.id}><strong>{formatPickupCode(order.pickup_code)}</strong><span>{order.cancelReason || 'レジ側で取り消されました。'}</span><button type="button" onClick={() => void action(order, 'ack-cancel')}>確認</button></article>)}</section> : null}
        {delivered.length ? <section className="pickup-delivered"><h2>直近の受渡済み</h2>{delivered.map((order) => <div className="pickup-delivered-row" key={order.id}><strong className="order-code">{formatPickupCode(order.pickup_code)}</strong><span>{order.items.map((item) => `${item.product_name} ×${item.quantity}`).join('、')}</span><button type="button" onClick={() => void action(order, 'restore')}>戻す</button></div>)}</section> : null}
      </section>
      {pendingOrder ? (
        <div className="pickup-dialog-backdrop" role="presentation">
          <section className="pickup-dialog" role="dialog" aria-modal="true" aria-labelledby="pickup-dialog-title">
            <p className="pickup-dialog-kicker">受取内容の確認</p>
            <h2 id="pickup-dialog-title">{formatPickupCode(pendingOrder.pickup_code)}</h2>
            <div className="pickup-dialog-items">
              {pendingOrder.items.map((item) => (
                <div key={item.product_id}>
                  <strong>{item.product_name}</strong>
                  <span>×{item.quantity}</span>
                </div>
              ))}
            </div>
            <p className="pickup-dialog-warning">商品と個数を確認してから、受取済みにしてください。</p>
            <div className="pickup-dialog-actions">
              <button type="button" onClick={() => setPendingOrder(null)} disabled={isDelivering}>戻る</button>
              <button ref={dialogConfirmRef} type="button" className="pickup-dialog-confirm" onClick={() => void confirmDelivery()} disabled={isDelivering}>
                {isDelivering ? '記録中…' : '受取済みにする'}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </main>
  );
}
