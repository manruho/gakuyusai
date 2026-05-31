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

type ReceiptItem = {
  id: string;
  displayName: string;
  quantity: number;
  unitPrice: number;
  subtotal: number;
};

export function RegisterPage() {
  const [items, setItems] = useState<Product[]>([]);
  const [selected, setSelected] = useState<Record<string, number>>({});
  const [paidAmount, setPaidAmount] = useState(0);
  const [saleType, setSaleType] = useState<'normal' | 'presale_pickup'>('normal');
  const [phase, setPhase] = useState<'select' | 'pay' | 'complete'>('select');
  const [message, setMessage] = useState('');
  const [role, setRole] = useState<'admin' | 'owner' | null>(null);
  const [receipt, setReceipt] = useState<{ saleId: string; items: ReceiptItem[]; totalAmount: number; paidAmount: number; changeAmount: number } | null>(null);
  const total = useMemo(
    () => items.reduce((sum, item) => sum + (selected[item.id] ?? 0) * item.price, 0),
    [items, selected],
  );
  const change = Math.max(0, paidAmount - total);

  const load = async () => {
    const productsResponse = await fetch('/api/staff/register/products');
    const productsJson = (await productsResponse.json()) as { ok: true; data: { items: Product[] } } | { ok: false; error: { message: string } };
    if (productsJson.ok) setItems(productsJson.data.items);
    if (!productsJson.ok) setMessage(productsJson.error.message);
  };

  useEffect(() => {
    void load();
    void fetch('/api/auth/me')
      .then(async (response) => {
        if (!response.ok) return null;
        return (await response.json()) as { ok: true; data: { role: 'admin' | 'owner' } } | { ok: false };
      })
      .then((json) => {
        if (json && json.ok) setRole(json.data.role);
      });
  }, []);

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

  const confirm = async () => {
    const selectedItems = Object.entries(selected).flatMap(([productId, quantity]) => {
      const product = items.find((entry) => entry.id === productId);
      if (!product || quantity <= 0) return [];
      return [
        {
          id: product.id,
          displayName: product.displayName,
          quantity,
          unitPrice: product.price,
          subtotal: product.price * quantity,
        },
      ];
    });
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
    setReceipt({
      saleId: json.data.saleId,
      items: selectedItems,
      totalAmount: json.data.totalAmount,
      paidAmount: json.data.paidAmount,
      changeAmount: json.data.changeAmount,
    });
    setMessage('');
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
            {role === 'admin' ? (
              <p className="register-subtitle">
                <a href="/admin">販売履歴と設定へ</a>
              </p>
            ) : null}
          </div>
          <div className="register-total">
            <span>現在の合計</span>
            <strong>{formatYen(total)}</strong>
          </div>
        </header>

        {message ? <p className="error register-message">{message}</p> : null}

        {phase === 'select' ? (
          <section className="register-select">
            <div className="register-panel register-products">
              <div className="section-head">
                <h2>商品を選ぶ</h2>
              </div>
              <div className="product-list">
                {items.map((item) => (
                  <button
                    key={item.id}
                    className="product-row"
                    disabled={!item.isActive || item.isSoldOut}
                    onClick={() => add(item.id)}
                  >
                    <div className="product-row-main">
                      <strong>{item.displayName}</strong>
                      <span className="product-row-price">{formatYen(item.price)}</span>
                    </div>
                    <div className="product-row-meta">
                      <small>{item.isSoldOut ? '売り切れ' : `残り ${item.currentStock}`}</small>
                      <span className="product-count">{selected[item.id] ?? 0} 点</span>
                    </div>
                  </button>
                ))}
              </div>
              <div className="toolbar register-actions">
                <button onClick={clear}>選択を空にする</button>
                <button onClick={() => setPhase('pay')} disabled={!selectedCount || total <= 0}>
                  会計へ進む
                </button>
              </div>
            </div>

            <aside className="register-panel register-cart">
              <div className="section-head">
                <h2>選択中</h2>
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
                          <span>{quantity}点</span>
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
                  <p>商品を選んでください。</p>
                )}
              </div>
              <div className="register-summary">
                <div>
                  <span>合計</span>
                  <strong>{formatYen(total)}</strong>
                </div>
                <div>
                  <span>個数</span>
                  <strong>{Object.values(selected).reduce((sum, qty) => sum + qty, 0)}</strong>
                </div>
              </div>
            </aside>
          </section>
        ) : phase === 'pay' ? (
          <section className="register-pay">
            <div className="register-panel register-confirm register-pay-left">
              <div className="section-head">
                <h2>会計</h2>
              </div>
              <div className="register-detail-head">
                <div>
                  <span>商品明細</span>
                  <strong>{Object.values(selected).reduce((sum, qty) => sum + qty, 0)} 点</strong>
                </div>
                <div>
                  <span>会計合計</span>
                  <strong>{formatYen(total)}</strong>
                </div>
              </div>
              <div className="receipt receipt-inline">
                <div className="receipt-items">
                  {Object.entries(selected).map(([id, quantity]) => {
                    const item = items.find((entry) => entry.id === id);
                    if (!item) return null;
                    return (
                      <div key={id} className="receipt-item">
                        <div>
                          <strong>{item.displayName}</strong>
                          <span>
                            単価 {formatYen(item.price)} / 数量 {quantity}
                          </span>
                        </div>
                        <strong className="receipt-item-total">{formatYen(item.price * quantity)}</strong>
                      </div>
                    );
                  })}
                </div>
              </div>
              <div className="confirm-summary">
                <p><span className="payment-label">合計</span><strong>{formatYen(total)}</strong></p>
                <p><span className="payment-label">預かり</span><strong>{formatYen(paidAmount)}</strong></p>
                <p><span className="payment-label">おつり</span><strong>{formatYen(change)}</strong></p>
              </div>
            </div>
            <div className="register-panel register-pay-right">
              <div className="payment-box">
                <label>
                  <span className="payment-label">預かり金額</span>
                  <input type="text" inputMode="numeric" value={formatYen(paidAmount)} readOnly aria-label="預かり金額" />
                </label>
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
                <button onClick={() => setPhase('select')}>商品選択へ戻る</button>
                <button onClick={confirm} disabled={!selectedCount || total <= 0}>
                  お会計確定
                </button>
              </div>
            </div>
          </section>
        ) : (
          <section className="register-panel register-complete">
            <h2>会計が完了しました</h2>
            {receipt ? (
              <div className="receipt">
                <div className="receipt-meta">
                  <p>
                    <span>合計</span>
                    <strong>{formatYen(receipt.totalAmount)}</strong>
                  </p>
                  <p>
                    <span>預かり</span>
                    <strong>{formatYen(receipt.paidAmount)}</strong>
                  </p>
                  <p>
                    <span>おつり</span>
                    <strong>{formatYen(receipt.changeAmount)}</strong>
                  </p>
                </div>
                <div className="receipt-items">
                  {receipt.items.map((item) => (
                    <div key={item.id} className="receipt-item">
                      <div>
                        <strong>{item.displayName}</strong>
                        <span>
                          {formatYen(item.unitPrice)} × {item.quantity}
                        </span>
                      </div>
                      <strong>{formatYen(item.subtotal)}</strong>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
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
            </div>
          </details>
        </section>
      </section>
    </main>
  );
}
