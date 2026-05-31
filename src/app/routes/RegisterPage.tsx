import { useEffect, useMemo, useState } from 'react';
import { formatYen } from '../../lib/money';

type Product = {
  id: string;
  displayName: string;
  price: number;
  currentStock: number;
  isSoldOut: boolean;
  isActive: boolean;
};

type Sale = {
  id: string;
  sale_type: 'normal' | 'presale_pickup';
  total_amount: number;
  paid_amount: number;
  change_amount: number;
  payment_method: 'cash' | 'prepaid';
  status: 'completed' | 'canceled';
  created_at: string;
  canceled_at: string | null;
  items: Array<{ product_id: string; quantity: number; unit_price: number; subtotal: number }>;
};

export function RegisterPage() {
  const [items, setItems] = useState<Product[]>([]);
  const [sales, setSales] = useState<Sale[]>([]);
  const [saleQuery, setSaleQuery] = useState('');
  const [selected, setSelected] = useState<Record<string, number>>({});
  const [paidAmount, setPaidAmount] = useState(1000);
  const [saleType, setSaleType] = useState<'normal' | 'presale_pickup'>('normal');
  const [phase, setPhase] = useState<'select' | 'confirm' | 'complete'>('select');
  const [message, setMessage] = useState('');
  const total = useMemo(
    () => items.reduce((sum, item) => sum + (selected[item.id] ?? 0) * item.price, 0),
    [items, selected],
  );
  const change = Math.max(0, paidAmount - total);
  const load = async (query = '') => {
    const searchParams = query ? `?q=${encodeURIComponent(query)}` : '';
    const [productsResponse, salesResponse] = await Promise.all([
      fetch('/api/staff/register/products'),
      fetch(`/api/admin/sales${searchParams}`),
    ]);
    const productsJson = (await productsResponse.json()) as { ok: true; data: { items: Product[] } } | { ok: false; error: { message: string } };
    const salesJson = (await salesResponse.json()) as { ok: true; data: { items: Sale[] } } | { ok: false; error: { message: string } };
    if (productsJson.ok) setItems(productsJson.data.items);
    if (salesJson.ok) setSales(salesJson.data.items);
    if (!productsJson.ok) setMessage(productsJson.error.message);
  };

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load(saleQuery.trim());
    }, 200);
    return () => window.clearTimeout(timer);
  }, [saleQuery]);

  const add = (id: string) => setSelected((current) => ({ ...current, [id]: (current[id] ?? 0) + 1 }));
  const remove = (id: string) =>
    setSelected((current) => {
      const next = { ...current };
      const count = (next[id] ?? 0) - 1;
      if (count <= 0) {
        delete next[id];
      } else {
        next[id] = count;
      }
      return next;
    });
  const clear = () => setSelected({});

  const cancelSale = async (saleId: string) => {
    if (!window.confirm('この販売を取り消しますか？')) {
      return;
    }
    const response = await fetch(`/api/sales/${encodeURIComponent(saleId)}/cancel`, { method: 'POST' });
    const json = (await response.json()) as { ok: true } | { ok: false; error: { message: string } };
    if (!json.ok) {
      setMessage(json.error.message);
      return;
    }
    setMessage('販売を取り消しました');
    void load();
  };

  const confirm = async () => {
    const response = await fetch('/api/staff/register/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        idempotencyKey: crypto.randomUUID(),
        saleType,
        paymentMethod: saleType === 'normal' ? 'cash' : 'prepaid',
        paidAmount,
        items: Object.entries(selected).map(([productId, quantity]) => ({ productId, quantity })),
      }),
    });
    const json = (await response.json()) as
      | { ok: true; data: { saleId: string; totalAmount: number; paidAmount: number; changeAmount: number } }
      | { ok: false; error: { message: string } };
    if (!json.ok) {
      setMessage(json.error.message);
      return;
    }
    setMessage(`会計が完了しました: ${json.data.saleId}`);
    setPhase('complete');
    clear();
    void load();
  };

  return (
    <main className="page">
      <section className="panel">
        <h1>レジ</h1>
        <div className="toolbar">
          <button onClick={() => setSaleType('normal')} aria-pressed={saleType === 'normal'}>
            通常販売
          </button>
          <button onClick={() => setSaleType('presale_pickup')} aria-pressed={saleType === 'presale_pickup'}>
            事前販売
          </button>
          <button onClick={() => void load()}>在庫を再読み込み</button>
        </div>
        {message ? <p className="error">{message}</p> : null}
        {phase === 'select' ? (
          <>
            <div className="cards">
              {items.map((item) => (
                <button
                  key={item.id}
                  className="product-button"
                  disabled={!item.isActive || item.isSoldOut}
                  onClick={() => add(item.id)}
                >
                  <strong>{item.displayName}</strong>
                  <span>{formatYen(item.price)}</span>
                  <small>{item.isSoldOut ? '売り切れ' : `残り ${item.currentStock}`}</small>
                </button>
              ))}
            </div>
            <section className="summary">
              <p>合計: {formatYen(total)}</p>
              <div className="cart">
                {Object.keys(selected).length ? (
                  Object.entries(selected).map(([id, quantity]) => {
                    const item = items.find((entry) => entry.id === id);
                    if (!item) return null;
                    return (
                      <div key={id} className="cart-row">
                        <span>
                          {item.displayName} × {quantity}
                        </span>
                        <span>{formatYen(item.price * quantity)}</span>
                        <div className="toolbar">
                          <button onClick={() => remove(id)}>1つ減らす</button>
                          <button onClick={() => add(id)}>1つ増やす</button>
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <p>カートは空です。</p>
                )}
              </div>
              <label>
                預かり金額
                <input type="number" value={paidAmount} onChange={(e) => setPaidAmount(Number(e.target.value))} />
              </label>
              <p>おつり: {formatYen(change)}</p>
              <div className="toolbar">
                <button onClick={clear}>カートを空にする</button>
                <button onClick={() => setPhase('confirm')} disabled={!Object.keys(selected).length || total <= 0}>
                  確認へ進む
                </button>
              </div>
            </section>
          </>
        ) : phase === 'confirm' ? (
          <section className="summary">
            <h2>{saleType === 'presale_pickup' ? 'この内容で事前販売分の受け渡しを確定しますか？' : 'これでお会計を確定していいですか？'}</h2>
            {Object.entries(selected).map(([id, quantity]) => {
              const item = items.find((entry) => entry.id === id);
              return item ? (
                <p key={id}>
                  {item.displayName} × {quantity} {formatYen(item.price * quantity)}
                </p>
              ) : null;
            })}
            <p>合計 {formatYen(total)}</p>
            <p>預かり {formatYen(paidAmount)}</p>
            <p>おつり {formatYen(change)}</p>
            <div className="toolbar">
              <button onClick={() => setPhase('select')}>戻って修正</button>
              <button onClick={confirm}>お会計確定</button>
            </div>
          </section>
        ) : (
          <section className="summary">
            <h2>会計が完了しました</h2>
            <p>{message}</p>
            <div className="toolbar">
              <button onClick={() => setPhase('select')}>次の会計へ</button>
              <button
                onClick={() => {
                  clear();
                  setPaidAmount(1000);
                  setSaleType('normal');
                }}
              >
                会計内容をリセット
              </button>
            </div>
          </section>
        )}
        <section className="summary">
          <h2>販売履歴</h2>
          <label>
            検索
            <input
              value={saleQuery}
              onChange={(e) => setSaleQuery(e.target.value)}
              placeholder="sale id / type / status / product"
            />
          </label>
          <div className="history">
            {sales.length ? (
              sales.map((sale) => (
                <div key={sale.id} className="history-row">
                  <strong>
                    {sale.sale_type} / {sale.status}
                  </strong>
                  <span>
                    {formatYen(sale.total_amount)} / {sale.created_at}
                  </span>
                  <small>
                    預かり {formatYen(sale.paid_amount)} / おつり {formatYen(sale.change_amount)}
                  </small>
                  <small>
                    商品数 {sale.items.reduce((sum, item) => sum + item.quantity, 0)} / 明細 {sale.items.length}
                  </small>
                  <div className="toolbar">
                    <button onClick={() => cancelSale(sale.id)} disabled={sale.status === 'canceled'}>
                      取消
                    </button>
                  </div>
                </div>
              ))
            ) : (
              <p>販売履歴はまだありません。</p>
            )}
          </div>
        </section>
      </section>
    </main>
  );
}
