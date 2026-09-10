import { useEffect, useMemo, useState } from 'react';
import { formatYen } from '../../lib/money';

type Item = { id: string; display_name?: string; displayName?: string; category?: string; price: number; initial_stock?: number; initialStock?: number; current_stock?: number; currentStock?: number; sold_quantity?: number; soldQuantity?: number };
type HistoryItem = { id: string; product_id: string; display_name: string; event_type: string; quantity_delta: number; reason: string; created_by_role: string; created_at: string };
type NoonRestockStatus = {
  businessDate: string;
  applied: boolean;
  alreadyApplied: boolean;
  itemCount: number;
  totalQuantity: number;
  appliedAt: string | null;
  appliedByUsername: string | null;
  items: Array<{ productId: string; displayName: string; quantity: number }>;
};

export function StockPage() {
  const [items, setItems] = useState<Item[]>([]);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [historyQuery, setHistoryQuery] = useState('');
  const [message, setMessage] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('すべて');
  const [noonRestock, setNoonRestock] = useState<NoonRestockStatus | null>(null);
  const [isApplyingNoonRestock, setIsApplyingNoonRestock] = useState(false);

  const load = async (query = '') => {
    const searchParams = query ? `&q=${encodeURIComponent(query)}` : '';
    const [stockResponse, historyResponse] = await Promise.all([fetch('/api/staff/stock'), fetch(`/api/staff/stock/history?limit=20${searchParams}`)]);
    const stockJson = (await stockResponse.json()) as { ok: true; data: { items: Item[] } } | { ok: false; error: { message: string } };
    const historyJson = (await historyResponse.json()) as { ok: true; data: { items: HistoryItem[] } } | { ok: false; error: { message: string } };
    if (stockJson.ok) setItems(stockJson.data.items);
    else setMessage(stockJson.error.message);
    if (historyJson.ok) setHistory(historyJson.data.items);
  };

  const loadNoonRestock = async () => {
    try {
      const response = await fetch('/api/staff/stock/noon-restock');
      const json = (await response.json()) as { ok: true; data: NoonRestockStatus } | { ok: false; error: { message: string } };
      if (json.ok) setNoonRestock(json.data);
      else setMessage(json.error.message);
    } catch {
      setMessage('12時分の一括補充状態を確認できませんでした。');
    }
  };

  useEffect(() => {
    void load();
    void loadNoonRestock();
    const timer = window.setInterval(() => {
      void load();
      void loadNoonRestock();
    }, 30_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(historyQuery.trim()), 200);
    return () => window.clearTimeout(timer);
  }, [historyQuery]);

  const adjust = async (productId: string, quantityDelta: number, eventType: 'restock' | 'discard' | 'adjust') => {
    const verb = eventType === 'restock' ? '補充' : eventType === 'discard' ? '廃棄' : '補正';
    const label = eventType === 'restock' ? `+${quantityDelta}` : `${quantityDelta}`;
    if (!window.confirm(`この在庫を${verb}しますか？\n数量: ${label}`)) return;
    const response = await fetch('/api/staff/stock/event', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ productId, quantityDelta, eventType, reason: '' }) });
    const json = (await response.json()) as { ok: true } | { ok: false; error: { message: string } };
    if (!json.ok) { setMessage(json.error.message); return; }
    setMessage('在庫を更新しました');
    void load(historyQuery.trim());
  };

  const reconcile = async (item: Item) => {
    const currentStock = item.current_stock ?? item.currentStock ?? 0;
    const displayName = item.displayName ?? item.display_name ?? item.id;
    const input = window.prompt(`${displayName}の実在庫数を入力してください。\n現在の登録在庫: ${currentStock}`, String(currentStock));
    if (input === null) return;
    const actualStock = Number(input);
    if (!Number.isInteger(actualStock) || actualStock < 0) { setMessage('実在庫数は0以上の整数で入力してください。'); return; }
    await adjust(item.id, actualStock - currentStock, 'adjust');
  };

  const applyNoonRestock = async () => {
    if (!noonRestock || noonRestock.applied || isApplyingNoonRestock) return;
    if (!window.confirm(
      `${noonRestock.businessDate}の12時分として、${noonRestock.itemCount}商品・合計${noonRestock.totalQuantity}個を一括補充します。\n同じ日には一度だけ実行できます。よろしいですか？`,
    )) return;

    setIsApplyingNoonRestock(true);
    setMessage('');
    try {
      const response = await fetch('/api/staff/stock/noon-restock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmation: 'APPLY_NOON_RESTOCK' }),
      });
      const json = (await response.json()) as { ok: true; data: NoonRestockStatus } | { ok: false; error: { message: string } };
      if (!json.ok) {
        setMessage(json.error.message);
        return;
      }
      setNoonRestock(json.data);
      setMessage(json.data.alreadyApplied ? '本日の12時一括補充はすでに実施済みです。' : '12時分の在庫を一括補充しました。');
      await load(historyQuery.trim());
    } catch {
      setMessage('12時分の一括補充に失敗しました。通信状態を確認してください。');
    } finally {
      setIsApplyingNoonRestock(false);
    }
  };

  const categories = useMemo(() => ['すべて', ...Array.from(new Set(items.map((item) => item.category || 'その他')))], [items]);
  const visibleItems = useMemo(() => selectedCategory === 'すべて' ? items : items.filter((item) => (item.category || 'その他') === selectedCategory), [items, selectedCategory]);
  const totals = useMemo(() => items.reduce((summary, item) => {
    const initial = item.initial_stock ?? item.initialStock ?? 0;
    const current = item.current_stock ?? item.currentStock ?? 0;
    const sold = item.sold_quantity ?? item.soldQuantity ?? 0;
    return { current: summary.current + current, sold: summary.sold + sold, attention: summary.attention + (initial > 0 && current / initial <= 0.2 ? 1 : 0) };
  }, { current: 0, sold: 0, attention: 0 }), [items]);

  return (
    <main className="page page-admin page-inventory-admin">
      <section className="panel inventory-admin-shell">
        <header className="admin-hero inventory-admin-header">
          <div><p className="eyebrow">在庫管理</p><h1>商品別 在庫一覧</h1><p className="small">残数・販売済み数・残り割合をまとめて確認できます。30秒ごとに自動更新します。</p></div>
          <div className="toolbar"><a className="admin-link-button" href="/admin">管理トップ</a><button type="button" onClick={() => void load()}>最新に更新</button></div>
        </header>
        {message ? <p className="admin-feedback" role="status">{message}</p> : null}
        <section className="inventory-overview" aria-label="在庫集計">
          <div><span>商品数</span><strong>{items.length}</strong><small>品</small></div>
          <div><span>現在の総在庫</span><strong>{totals.current}</strong><small>個・本</small></div>
          <div><span>販売済み</span><strong>{totals.sold}</strong><small>個・本</small></div>
          <div className={totals.attention ? 'needs-attention' : ''}><span>残り少ない</span><strong>{totals.attention}</strong><small>品</small></div>
        </section>
        <section className={`noon-restock-panel${noonRestock?.applied ? ' is-applied' : ''}`} aria-labelledby="noon-restock-heading">
          <div className="noon-restock-copy">
            <p className="eyebrow">12:00 Restock</p>
            <h2 id="noon-restock-heading">12時分の一括補充</h2>
            <p>おにぎり16種を465個、唐揚げを200個追加します。時刻による自動実行はなく、このボタンを押したときだけ反映されます。</p>
            {noonRestock?.applied ? (
              <p className="noon-restock-status" role="status">
                実施済み：{new Date(noonRestock.appliedAt ?? '').toLocaleString('ja-JP')} / {noonRestock.appliedByUsername ?? '不明'}
              </p>
            ) : <p className="noon-restock-status is-pending">本日分は未実施です。</p>}
          </div>
          <div className="noon-restock-action">
            <strong>合計 {noonRestock?.totalQuantity ?? 665}個</strong>
            <button
              type="button"
              onClick={() => void applyNoonRestock()}
              disabled={!noonRestock || noonRestock.applied || isApplyingNoonRestock}
            >
              {isApplyingNoonRestock ? '補充しています…' : noonRestock?.applied ? '本日分は実施済み' : '12時分を一括補充'}
            </button>
          </div>
          <details className="noon-restock-details">
            <summary>補充する商品と個数を確認</summary>
            <div>
              {(noonRestock?.items ?? []).map((item) => (
                <span key={item.productId}>{item.displayName}<strong>+{item.quantity}</strong></span>
              ))}
            </div>
          </details>
        </section>
        <nav className="inventory-category-tabs" aria-label="在庫カテゴリ">
          {categories.map((category) => <button key={category} type="button" className={selectedCategory === category ? 'is-active' : ''} onClick={() => setSelectedCategory(category)}>{category === '飲み物' ? 'のみもの' : category}<strong>{category === 'すべて' ? items.length : items.filter((item) => (item.category || 'その他') === category).length}</strong></button>)}
        </nav>
        <section className="inventory-list" aria-label="商品別在庫">
          <div className="inventory-row inventory-list-head" aria-hidden="true"><span>商品</span><span>残数</span><span>販売状況</span><span>在庫操作</span></div>
          {visibleItems.map((item) => {
            const stock = item.current_stock ?? item.currentStock ?? 0;
            const initial = item.initial_stock ?? item.initialStock ?? 0;
            const sold = item.sold_quantity ?? item.soldQuantity ?? 0;
            const percent = initial > 0 ? Math.max(0, Math.min(100, Math.round(stock / initial * 100))) : 0;
            const displayName = item.displayName ?? item.display_name ?? item.id;
            const state = stock <= 0 ? 'soldout' : percent <= 20 ? 'critical' : percent <= 50 ? 'low' : 'healthy';
            return <article key={item.id} className={`inventory-row is-${state}`}>
              <div className="inventory-product"><span>{item.category === '飲み物' ? 'のみもの' : item.category}</span><h2>{displayName}</h2><small>{formatYen(item.price)}</small></div>
              <div className="inventory-remaining"><span>残り</span><strong>{stock}</strong><small>／ 初期 {initial}</small></div>
              <div className="inventory-progress"><div><span>販売済み {sold}</span><strong>{percent}% 残</strong></div><span className="inventory-progress-track"><span style={{ width: `${percent}%` }} /></span><small>{stock <= 0 ? '売り切れ' : percent <= 20 ? '残りわずか' : percent <= 50 ? '少なめ' : '在庫あり'}</small></div>
              <div className="inventory-actions"><button onClick={() => adjust(item.id, 5, 'restock')}>+5 補充</button><button onClick={() => adjust(item.id, -1, 'discard')}>-1 廃棄</button><button onClick={() => void reconcile(item)}>棚卸し</button></div>
            </article>;
          })}
        </section>
        <section className="summary inventory-history-panel">
          <h2>在庫イベント履歴</h2>
          <label>履歴を検索<input value={historyQuery} onChange={(event) => setHistoryQuery(event.target.value)} placeholder="商品名・操作・理由" /></label>
          <div className="history">{history.length ? history.map((entry) => <div key={entry.id} className="history-row"><strong>{entry.display_name}</strong><span>{entry.event_type} {entry.quantity_delta}</span><small>{entry.created_at} / {entry.created_by_role}</small>{entry.reason ? <small>{entry.reason}</small> : null}</div>) : <p>履歴はまだありません。</p>}</div>
        </section>
      </section>
    </main>
  );
}
