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
  const [paidAmount, setPaidAmount] = useState(0);
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
  const clearPaidAmount = () => setPaidAmount(0);
  const appendPaidDigit = (digit: number) => setPaidAmount((current) => current * 10 + digit);
  const backspacePaidAmount = () => setPaidAmount((current) => Math.floor(current / 10));

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

  const selectedCount = Object.keys(selected).length;

  return (
    <main className="page page-register">
      <section className="register-shell">
        <header className="register-hero">
          <div>
            <p className="eyebrow">Register Desk</p>
            <h1>レジ</h1>
            <p className="small register-subtitle">商品名・値段・合計を大きく見せて、会計ミスを減らす画面です。</p>
          </div>
          <div className="register-total">
            <span>現在の合計</span>
            <strong>{formatYen(total)}</strong>
            <small>{selectedCount}点 / {Object.values(selected).reduce((sum, qty) => sum + qty, 0)}個</small>
          </div>
        </header>
        <div className="register-metrics">
          <div>
            <span>選択商品</span>
            <strong>{selectedCount}</strong>
          </div>
          <div>
            <span>選択個数</span>
            <strong>{Object.values(selected).reduce((sum, qty) => sum + qty, 0)}</strong>
          </div>
          <div>
            <span>現在の合計</span>
            <strong>{formatYen(total)}</strong>
          </div>
        </div>

        <div className="toolbar register-toolbar">
          <button onClick={() => void load()}>在庫を再読み込み</button>
        </div>

        {message ? <p className="error register-message">{message}</p> : null}

        {phase === 'select' ? (
          <section className="register-grid">
            <div className="register-panel register-products">
              <div className="section-head">
                <h2>商品を選ぶ</h2>
                <p className="small">商品名と価格を見ながら、ボタンを押すだけで追加できます。</p>
              </div>
              <div className="cards register-cards">
                {items.map((item) => (
                  <button
                    key={item.id}
                    className="product-button"
                    disabled={!item.isActive || item.isSoldOut}
                    onClick={() => add(item.id)}
                  >
                    <div className="product-head">
                      <strong>{item.displayName}</strong>
                      <span className="product-count">{selected[item.id] ?? 0}</span>
                    </div>
                    <span className="product-price">{formatYen(item.price)}</span>
                    <small>{item.isSoldOut ? '売り切れ' : `残り ${item.currentStock}`}</small>
                  </button>
                ))}
              </div>
            </div>

            <aside className="register-panel register-cart">
              <div className="section-head">
                <h2>カート</h2>
                <p className="small">合計とおつりをここで常に確認できます。</p>
              </div>
              <div className="cart">
                {selectedCount ? (
                  Object.entries(selected).map(([id, quantity]) => {
                    const item = items.find((entry) => entry.id === id);
                    if (!item) return null;
                    return (
                      <div key={id} className="cart-row">
                        <div className="cart-main">
                          <strong>{item.displayName}</strong>
                          <span>{formatYen(item.price)} × {quantity}</span>
                        </div>
                        <div className="cart-price">{formatYen(item.price * quantity)}</div>
                        <div className="toolbar cart-actions">
                          <button onClick={() => remove(id)}>−</button>
                          <button onClick={() => add(id)}>＋</button>
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <p>カートは空です。</p>
                )}
              </div>
              <div className="payment-box">
                <label>
                  預かり金額
                  <input
                    type="text"
                    inputMode="numeric"
                    value={formatYen(paidAmount)}
                    readOnly
                    aria-label="預かり金額"
                  />
                </label>
                <p className="change">おつり {formatYen(change)}</p>
                <div className="numpad">
                  <button onClick={clearPaidAmount}>C</button>
                  <button onClick={backspacePaidAmount}>⌫</button>
                  <button onClick={() => setPaidAmount((current) => current * 100)}>00</button>
                  {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((digit) => (
                    <button key={digit} onClick={() => appendPaidDigit(digit)}>
                      {digit}
                    </button>
                  ))}
                  <button className="numpad-zero" onClick={() => appendPaidDigit(0)}>
                    0
                  </button>
                </div>
              </div>
              <div className="toolbar register-actions">
                <button onClick={clear}>カートを空にする</button>
                <button onClick={() => setPhase('confirm')} disabled={!selectedCount || total <= 0}>
                  確認へ進む
                </button>
              </div>
            </aside>
          </section>
        ) : phase === 'confirm' ? (
          <section className="register-panel register-confirm">
            <h2>{saleType === 'presale_pickup' ? 'この内容で事前販売分の受け渡しを確定しますか？' : 'これでお会計を確定していいですか？'}</h2>
            {Object.entries(selected).map(([id, quantity]) => {
              const item = items.find((entry) => entry.id === id);
              return item ? (
                <p key={id} className="confirm-row">
                  <span>{item.displayName} × {quantity}</span>
                  <strong>{formatYen(item.price * quantity)}</strong>
                </p>
              ) : null;
            })}
            <div className="confirm-summary">
              <p><span>合計</span><strong>{formatYen(total)}</strong></p>
              <p><span>預かり</span><strong>{formatYen(paidAmount)}</strong></p>
              <p><span>おつり</span><strong>{formatYen(change)}</strong></p>
            </div>
            <div className="toolbar">
              <button onClick={() => setPhase('select')}>戻って修正</button>
              <button onClick={confirm}>お会計確定</button>
            </div>
          </section>
        ) : (
          <section className="register-panel register-complete">
            <h2>会計が完了しました</h2>
            <p>{message}</p>
            <div className="toolbar">
              <button onClick={() => setPhase('select')}>次の会計へ</button>
              <button
                onClick={() => {
                  clear();
                  setPaidAmount(0);
                  setSaleType('normal');
                }}
              >
                会計内容をリセット
              </button>
            </div>
          </section>
        )}

        <section className="register-panel register-history">
          <div className="section-head">
            <h2>販売履歴</h2>
            <p className="small">取消が必要な会計をすぐ見つけられます。</p>
          </div>
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

        <section className="register-panel register-advanced">
          <details>
            <summary>販売種別と運用操作</summary>
            <div className="register-advanced-body">
              <div className="toolbar register-sale-type">
                <button onClick={() => setSaleType('normal')} aria-pressed={saleType === 'normal'}>
                  通常販売
                </button>
                <button onClick={() => setSaleType('presale_pickup')} aria-pressed={saleType === 'presale_pickup'}>
                  事前販売
                </button>
              </div>
              <p className="small">販売種別はここにまとめてあります。普段の操作では上部の選択に迷わないよう、下の方に置いています。</p>
            </div>
          </details>
        </section>
      </section>
    </main>
  );
}
