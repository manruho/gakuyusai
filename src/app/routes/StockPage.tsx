import { useEffect, useState } from 'react';
import { formatYen } from '../../lib/money';

type Item = {
  id: string;
  display_name?: string;
  displayName?: string;
  price: number;
  current_stock?: number;
  currentStock?: number;
};

type HistoryItem = {
  id: string;
  product_id: string;
  display_name: string;
  event_type: string;
  quantity_delta: number;
  reason: string;
  created_by_role: string;
  created_at: string;
};

export function StockPage() {
  const [items, setItems] = useState<Item[]>([]);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [historyQuery, setHistoryQuery] = useState('');
  const [message, setMessage] = useState('');

  const load = async (query = '') => {
    const searchParams = query ? `&q=${encodeURIComponent(query)}` : '';
    const [stockResponse, historyResponse] = await Promise.all([
      fetch('/api/staff/stock'),
      fetch(`/api/staff/stock/history?limit=20${searchParams}`),
    ]);
    const stockJson = (await stockResponse.json()) as { ok: true; data: { items: Item[] } } | { ok: false; error: { message: string } };
    const historyJson = (await historyResponse.json()) as
      | { ok: true; data: { items: HistoryItem[] } }
      | { ok: false; error: { message: string } };
    if (stockJson.ok) setItems(stockJson.data.items);
    if (historyJson.ok) setHistory(historyJson.data.items);
  };

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load(historyQuery.trim());
    }, 200);
    return () => window.clearTimeout(timer);
  }, [historyQuery]);

  const adjust = async (productId: string, quantityDelta: number, eventType: 'restock' | 'discard' | 'adjust') => {
    const verb = eventType === 'restock' ? '補充' : eventType === 'discard' ? '廃棄' : '補正';
    const label = eventType === 'restock' ? `+${quantityDelta}` : `${quantityDelta}`;
    if (!window.confirm(`この在庫を${verb}しますか？\n数量: ${label}`)) {
      return;
    }
    const response = await fetch('/api/staff/stock/event', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ productId, quantityDelta, eventType, reason: '' }),
    });
    const json = (await response.json()) as { ok: true } | { ok: false; error: { message: string } };
    if (!json.ok) {
      setMessage(json.error.message);
      return;
    }
    setMessage('更新しました');
    void load();
  };
  return (
    <main className="page">
      <section className="panel">
        <h1>在庫</h1>
        {message ? <p className="error">{message}</p> : null}
        <div className="cards">
          {items.map((item) => {
            const stock = item.current_stock ?? item.currentStock ?? 0;
            const displayName = item.displayName ?? item.display_name ?? item.id;
            return (
              <article key={item.id} className="product-card">
                <h2>{displayName}</h2>
                <p>{formatYen(item.price)}</p>
                <p>現在在庫: {stock}</p>
                <div className="toolbar">
                  <button onClick={() => adjust(item.id, 5, 'restock')}>+5 補充</button>
                  <button onClick={() => adjust(item.id, -1, 'discard')}>-1 廃棄</button>
                  <button onClick={() => adjust(item.id, 0, 'adjust')}>補正記録</button>
                </div>
              </article>
            );
          })}
        </div>
        <section className="summary">
          <h2>在庫イベント履歴</h2>
          <label>
            検索
            <input
              value={historyQuery}
              onChange={(e) => setHistoryQuery(e.target.value)}
              placeholder="product / event / reason"
            />
          </label>
          <div className="history">
            {history.length ? (
              history.map((entry) => (
                <div key={entry.id} className="history-row">
                  <strong>{entry.display_name}</strong>
                  <span>
                    {entry.event_type} {entry.quantity_delta}
                  </span>
                  <small>
                    {entry.created_at} / {entry.created_by_role}
                  </small>
                  {entry.reason ? <small>{entry.reason}</small> : null}
                </div>
              ))
            ) : (
              <p>履歴はまだありません。</p>
            )}
          </div>
        </section>
      </section>
    </main>
  );
}
