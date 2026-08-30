import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { formatYen } from "../../lib/money";

type Product = {
  id: string;
  displayName: string;
  category: string;
  price: number;
  currentStock: number;
  statusLevel: number;
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

type Receipt = {
  saleId: string;
  items: ReceiptItem[];
  totalAmount: number;
  paidAmount: number;
  changeAmount: number;
  pickupCode: string;
  registerId: number;
  stationId: number;
};

const CATEGORIES = ["おにぎり", "サイドメニュー", "飲み物"] as const;
type ProductCategory = (typeof CATEGORIES)[number];
type SaleType = "normal" | "presale_pickup";
type Phase = "select" | "pay" | "complete";
const MAX_PAID_AMOUNT_DIGITS = 6;
const MAX_PAID_AMOUNT = 10 ** MAX_PAID_AMOUNT_DIGITS - 1;

async function readApiResponse<T>(response: Response): Promise<T> {
  const raw = await response.text();
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new Error(`サーバーが応答できませんでした（HTTP ${response.status}）。もう一度お試しください。`);
  }
}

function normalizeCategory(item: Product): ProductCategory {
  const raw = `${item.category ?? ""} ${item.displayName ?? ""}`.trim();
  if (CATEGORIES.includes(raw as ProductCategory))
    return raw as ProductCategory;
  if (/飲み物|ドリンク|ジュース|麦茶|ラムネ|お茶|水/.test(raw)) return "飲み物";
  if (/サイド|唐揚げ|からあげ|玉子|たまご|フライ|ポテト|枝豆|サラダ/.test(raw))
    return "サイドメニュー";
  return "おにぎり";
}

function getCategoryLabel(category: ProductCategory) {
  return category === "飲み物" ? "のみもの" : category;
}

function formatPickupCode(code: string) {
  return code.length === 6 ? `${code.slice(0, 3)} ${code.slice(3)}` : code;
}

export function RegisterPage() {
  const navigate = useNavigate();
  const [items, setItems] = useState<Product[]>([]);
  const [selected, setSelected] = useState<Record<string, number>>({});
  const [selectedOrder, setSelectedOrder] = useState<string[]>([]);
  const [selectedCategory, setSelectedCategory] =
    useState<ProductCategory>("おにぎり");
  const [paidAmount, setPaidAmount] = useState(0);
  const [saleType, setSaleType] = useState<SaleType>("normal");
  const [phase, setPhase] = useState<Phase>("select");
  const [message, setMessage] = useState("");
  const [checkoutError, setCheckoutError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isCanceling, setIsCanceling] = useState(false);
  const [role, setRole] = useState<"staff" | "admin" | "owner" | null>(null);
  const [registerId, setRegisterId] = useState(1);
  const [registerReady, setRegisterReady] = useState(false);
  const [registerError, setRegisterError] = useState("");
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const idempotencyKeyRef = useRef<string | null>(null);
  const submittingRef = useRef(false);
  const loadRequestRef = useRef(0);
  const phaseHeadingRef = useRef<HTMLHeadingElement>(null);

  const total = useMemo(
    () =>
      items.reduce(
        (sum, item) => sum + (selected[item.id] ?? 0) * item.price,
        0,
      ),
    [items, selected],
  );
  const visibleItems = useMemo(
    () => items.filter((item) => normalizeCategory(item) === selectedCategory),
    [items, selectedCategory],
  );
  const selectedEntries = useMemo(() => {
    const ids = Object.keys(selected);
    const orderedIds = [
      ...selectedOrder.filter((id) => selected[id] > 0),
      ...ids.filter((id) => !selectedOrder.includes(id)),
    ];
    return orderedIds.flatMap((id) => {
      const quantity = selected[id] ?? 0;
      const item = items.find((entry) => entry.id === id);
      return item && quantity > 0 ? [{ item, quantity }] : [];
    });
  }, [items, selected, selectedOrder]);
  const selectedCount = selectedEntries.reduce(
    (sum, entry) => sum + entry.quantity,
    0,
  );
  const shortage = Math.max(0, total - paidAmount);
  const change = Math.max(0, paidAmount - total);
  const canConfirm =
    selectedCount > 0 &&
    total > 0 &&
    paidAmount >= total &&
    !isSubmitting;

  const load = async () => {
    const requestId = ++loadRequestRef.current;
    setIsLoading(true);
    try {
      const productsResponse = await fetch("/api/staff/register/products");
      const productsJson = (await productsResponse.json()) as
        | { ok: true; data: { items: Product[] } }
        | { ok: false; error: { message: string } };
      if (!productsJson.ok) throw new Error(productsJson.error.message);
      if (requestId !== loadRequestRef.current) return;
      setItems(productsJson.data.items);
      setMessage("");
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "在庫を再読み込みできませんでした。",
      );
    } finally {
      if (requestId === loadRequestRef.current) setIsLoading(false);
    }
  };

  useEffect(() => {
    void load();
    void fetch("/api/auth/me")
      .then(async (response) => {
        if (!response.ok) return null;
        return (await response.json()) as
          | { ok: true; data: { role: "staff" | "admin" | "owner" } }
          | { ok: false };
      })
      .then((json) => {
        if (json && json.ok) setRole(json.data.role);
      });
    void fetch('/api/staff/register/current')
      .then(async (response) => (await response.json()) as { ok: true; data: { registerId: number | null } } | { ok: false })
      .then((json) => {
        if (!json.ok) throw new Error('register lookup failed');
        if (!json.data.registerId) {
          navigate('/staff/register/select', { replace: true });
          return;
        }
        setRegisterId(json.data.registerId);
        setRegisterReady(true);
      })
      .catch(() => setRegisterError('レジ情報を確認できませんでした。画面を再読み込みしてください。'));
  }, [navigate]);

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "instant" });
    phaseHeadingRef.current?.focus({ preventScroll: true });
  }, [phase]);

  useEffect(() => {
    setSaleType(registerId === 4 ? "presale_pickup" : "normal");
  }, [registerId]);

  const add = (id: string) => {
    const item = items.find((entry) => entry.id === id);
    if (
      !item ||
      !item.isActive ||
      item.isSoldOut ||
      (selected[id] ?? 0) >= item.currentStock
    )
      return;
    setSelected((current) => ({ ...current, [id]: (current[id] ?? 0) + 1 }));
    setSelectedOrder((current) => [
      id,
      ...current.filter((entry) => entry !== id),
    ]);
  };

  const remove = (id: string) => {
    setSelected((current) => {
      const next = { ...current };
      const count = (next[id] ?? 0) - 1;
      if (count <= 0) delete next[id];
      else next[id] = count;
      return next;
    });
    if ((selected[id] ?? 0) <= 1)
      setSelectedOrder((order) => order.filter((entry) => entry !== id));
  };

  const deleteItem = (id: string) => {
    const item = items.find((entry) => entry.id === id);
    if (
      !item ||
      !window.confirm(
        `${item.displayName}をカートからすべて削除します。よろしいですか？`,
      )
    )
      return;

    setSelected((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });
    setSelectedOrder((current) => current.filter((entry) => entry !== id));
  };

  const clear = () => {
    setSelected({});
    setSelectedOrder([]);
  };

  const resetCheckoutKey = () => {
    idempotencyKeyRef.current = null;
    submittingRef.current = false;
  };

  const startPayment = () => {
    setPaidAmount(0);
    setCheckoutError("");
    resetCheckoutKey();
    setPhase("pay");
  };

  const appendPaidDigit = (digit: number) => {
    setPaidAmount((current) => {
      const next = current * 10 + digit;
      return next <= MAX_PAID_AMOUNT ? next : current;
    });
  };

  const confirm = async () => {
    if (!canConfirm || submittingRef.current) return;
    submittingRef.current = true;
    setIsSubmitting(true);
    setCheckoutError("");
    const idempotencyKey = idempotencyKeyRef.current ?? crypto.randomUUID();
    idempotencyKeyRef.current = idempotencyKey;
    const selectedItems = selectedEntries.map(({ item, quantity }) => ({
      id: item.id,
      displayName: item.displayName,
      quantity,
      unitPrice: item.price,
      subtotal: item.price * quantity,
    }));

    try {
      const response = await fetch("/api/staff/register/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          idempotencyKey,
          saleType,
          paymentMethod: "cash",
          paidAmount,
          items: selectedEntries.map(({ item, quantity }) => ({
            productId: item.id,
            quantity,
          })),
        }),
      });
      const json = await readApiResponse<
        | {
            ok: true;
            data: {
              saleId: string;
              totalAmount: number;
              paidAmount: number;
              changeAmount: number;
              pickupCode: string;
              registerId: number;
              stationId: number;
            };
          }
        | { ok: false; error: { message: string } }
      >(response);
      if (!json.ok) throw new Error(json.error.message);
      setReceipt({
        saleId: json.data.saleId,
        items: selectedItems,
        totalAmount: json.data.totalAmount,
        paidAmount: json.data.paidAmount,
        changeAmount: json.data.changeAmount,
        pickupCode: json.data.pickupCode,
        registerId: json.data.registerId,
        stationId: json.data.stationId,
      });
      setPhase("complete");
      clear();
      void load();
    } catch (error) {
      setCheckoutError(
        error instanceof Error ? error.message : "通信に失敗しました。",
      );
    } finally {
      submittingRef.current = false;
      setIsSubmitting(false);
    }
  };

  const nextCheckout = () => {
    clear();
    setPaidAmount(0);
    setSaleType(registerId === 4 ? "presale_pickup" : "normal");
    setReceipt(null);
    setCheckoutError("");
    resetCheckoutKey();
    setPhase("select");
  };

  const cancelReceipt = async () => {
    if (
      !receipt ||
      isCanceling ||
      !window.confirm("この会計を取り消し、在庫を戻します。よろしいですか？")
    )
      return;
    setIsCanceling(true);
    setCheckoutError("");
    try {
      const response = await fetch(
        `/api/sales/${encodeURIComponent(receipt.saleId)}/cancel`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ restoreStock: true }) },
      );
      const json = (await response.json()) as
        | { ok: true }
        | { ok: false; error: { message: string } };
      if (!json.ok) throw new Error(json.error.message);
      await load();
      nextCheckout();
    } catch (error) {
      setCheckoutError(
        error instanceof Error ? error.message : "会計を取り消せませんでした。",
      );
    } finally {
      setIsCanceling(false);
    }
  };

  if (!registerReady) {
    return (
      <main className="page page-register register-mode-loading">
        <section className="register-shell">
          <div className="register-loading" role="status" aria-live="polite">
            {registerError || 'レジ情報を確認しています…'}
            {registerError ? <button type="button" onClick={() => window.location.reload()}>再読み込み</button> : null}
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className={`page page-register register-mode-${saleType}`}>
      <section className="register-shell">
        <header className="register-topbar">
          <div className="register-brand">
            <strong>レジ{registerId}</strong>
            <span className="register-current-mode">
              {saleType === "normal" ? "通常販売" : "事前販売"}
            </span>
          </div>
          <span className="register-station-label">受取{registerId} / 色紙 {['赤', '青', '緑', '水色'][registerId - 1]}</span>
          {registerId === 4 ? (
            <span className="register-special-mode">前売り専用</span>
          ) : (
            <div
              className="register-mode-switch"
              aria-label="販売モードを切り替える"
            >
              <button
                type="button"
                onClick={() => setSaleType("normal")}
                aria-pressed={saleType === "normal"}
                disabled={phase !== "select"}
              >
                通常
              </button>
            </div>
          )}
          {role === "admin" || role === "owner" ? (
            <a href="/admin">管理画面へ</a>
          ) : null}
        </header>

        {message ? <p className="error register-message">{message}</p> : null}

        {phase === "select" ? (
          <section className="register-select">
            <div className="register-panel register-products">
              <div className="section-head">
                <h2 ref={phaseHeadingRef} tabIndex={-1}>
                  商品を選ぶ
                </h2>
              </div>
              <nav
                className="register-category-tabs"
                aria-label="カテゴリを切り替える"
              >
                {CATEGORIES.map((category) => (
                  <button
                    key={category}
                    type="button"
                    className={
                      selectedCategory === category
                        ? "register-category-tab is-active"
                        : "register-category-tab"
                    }
                    onClick={() => setSelectedCategory(category)}
                    aria-pressed={selectedCategory === category}
                  >
                    {getCategoryLabel(category)}
                  </button>
                ))}
              </nav>
              <div className="product-list">
                {visibleItems.map((item) => {
                  const quantity = selected[item.id] ?? 0;
                  const disabled = !item.isActive || item.isSoldOut;
                  const productCategory = normalizeCategory(item);
                  const categoryClass =
                    productCategory === "おにぎり"
                      ? "is-category-onigiri"
                      : productCategory === "サイドメニュー"
                        ? "is-category-side"
                        : "is-category-drink";
                  const badge = !item.isActive
                    ? "停止中"
                    : item.isSoldOut
                      ? "売り切れ"
                      : item.statusLevel <= 0
                        ? "残り少なめ"
                        : "";
                  return (
                    <article
                      key={item.id}
                      className={`product-row ${categoryClass}${quantity > 0 ? " product-row-selected" : ""}${disabled ? " is-disabled" : ""}`}
                    >
                      <button
                        type="button"
                        className="product-main-button"
                        disabled={disabled || quantity >= item.currentStock}
                        onClick={() => add(item.id)}
                        aria-label={`${item.displayName} を 1 個追加する`}
                      >
                        <span className="product-row-title">
                          <strong>{item.displayName}</strong>
                          <span className="product-row-price">
                            {formatYen(item.price)}
                          </span>
                        </span>
                        <span className="product-row-meta">
                          <span className="product-count">{quantity} 点</span>
                          {badge ? (
                            <span
                              className={`stock-badge ${!item.isActive ? "is-stopped" : item.isSoldOut ? "is-soldout" : "is-low"}`}
                            >
                              {badge}
                            </span>
                          ) : null}
                        </span>
                      </button>
                      <div className="product-row-actions">
                        <button
                          type="button"
                          className="product-mini-button"
                          onClick={() => add(item.id)}
                          disabled={disabled || quantity >= item.currentStock}
                          aria-label={`${item.displayName} を 1 個追加する`}
                        >
                          ＋
                        </button>
                        <button
                          type="button"
                          className="product-mini-button"
                          onClick={() => remove(item.id)}
                          disabled={quantity <= 0}
                          aria-label={`${item.displayName} を 1 個減らす`}
                        >
                          −
                        </button>
                      </div>
                    </article>
                  );
                })}
                {!visibleItems.length ? (
                  <p className="register-empty-category">
                    {getCategoryLabel(selectedCategory)}の商品はありません。
                  </p>
                ) : null}
              </div>
              <div className="register-product-utilities">
                <button
                  type="button"
                  className="register-minor-action"
                  onClick={() => void load()}
                  disabled={isLoading}
                >
                  {isLoading ? "在庫を読み込み中…" : "在庫を再読み込み"}
                </button>
              </div>
            </div>

            <aside className="register-panel register-cart">
              <div className="section-head">
                <h2 className="cart-title">選択中</h2>
              </div>
              <div className="register-summary">
                <div>
                  <span className="summary-label">合計</span>
                  <strong>{formatYen(total)}</strong>
                </div>
                <div>
                  <span className="summary-label">個数</span>
                  <strong>{selectedCount}</strong>
                </div>
              </div>
              <div className="cart">
                {selectedEntries.length ? (
                  selectedEntries.map(({ item, quantity }) => (
                    <div key={item.id} className="cart-row">
                      <div className="cart-main">
                        <strong>{item.displayName}</strong>
                        <span>{formatYen(item.price * quantity)}</span>
                      </div>
                      <div className="cart-actions">
                        <div className="cart-stepper">
                          <button
                            type="button"
                            className="cart-step-button"
                            onClick={() => remove(item.id)}
                            aria-label={`${item.displayName} を 1 個減らす`}
                          >
                            −
                          </button>
                          <div
                            className="cart-quantity"
                            aria-label={`${item.displayName} の個数`}
                          >
                            <span>個数</span>
                            <strong>{quantity}</strong>
                          </div>
                          <button
                            type="button"
                            className="cart-step-button"
                            onClick={() => add(item.id)}
                            disabled={quantity >= item.currentStock}
                            aria-label={`${item.displayName} を 1 個追加する`}
                          >
                            ＋
                          </button>
                        </div>
                        <button
                          type="button"
                          className="cart-delete"
                          onClick={() => deleteItem(item.id)}
                          aria-label={`${item.displayName}をカートからすべて削除する`}
                        >
                          ×
                        </button>
                      </div>
                    </div>
                  ))
                ) : (
                  <p>商品を選んでください。</p>
                )}
              </div>
              <div className="register-cart-footer">
                <button
                  type="button"
                  className="primary-action"
                  onClick={startPayment}
                  disabled={!selectedCount || total <= 0}
                >
                  {saleType === "normal" ? "会計へ進む" : "前売り会計へ"}
                </button>
                <button
                  type="button"
                  className="register-minor-action"
                  onClick={clear}
                  disabled={!selectedCount}
                >
                  選択を空にする
                </button>
              </div>
            </aside>
          </section>
        ) : phase === "pay" ? (
          <section className="register-pay">
            <div className="register-panel register-confirm register-pay-left">
              <div className="section-head">
                <h2 ref={phaseHeadingRef} tabIndex={-1}>
                  {saleType === "normal" ? "お会計" : "前売り会計"}
                </h2>
              </div>
              <div className="checkout-overview">
                <div className="checkout-total">
                  <span>
                      {saleType === "normal" ? "今回のお会計" : "前売り券の合計"}
                  </span>
                  <strong>{formatYen(total)}</strong>
                  <small>{selectedCount}点</small>
                </div>
                {saleType === "normal" ? (
                  <>
                    <div className="checkout-paid">
                      <span>受け取った金額</span>
                      <strong>{formatYen(paidAmount)}</strong>
                    </div>
                    <div
                      className={
                        shortage > 0
                          ? "checkout-guidance is-short"
                          : "checkout-guidance is-ready"
                      }
                    >
                      <strong>
                        {shortage > 0
                          ? `あと${formatYen(shortage)}`
                          : `おつり ${formatYen(change)}`}
                      </strong>
                      <span>
                        {shortage > 0
                          ? "受け取ってください"
                          : "お返ししてください"}
                      </span>
                    </div>
                  </>
                ) : (
                  <div className="checkout-guidance is-presale">
                    <strong>前日に現金を受け取ります</strong>
                    <span>おつりを確認して前売り券を発行してください</span>
                  </div>
                )}
              </div>
              <section className="checkout-items" aria-labelledby="checkout-items-heading">
                <div className="checkout-items-heading" id="checkout-items-heading">
                  今回の注文内容（{selectedCount}点）
                </div>
                <div className="receipt receipt-inline">
                  <div className="receipt-items">
                    {selectedEntries.map(({ item, quantity }) => (
                      <div key={item.id} className="receipt-item">
                        <div>
                          <strong>{item.displayName}</strong>
                          <span>
                            {formatYen(item.price)} × {quantity}
                          </span>
                        </div>
                        <strong>{formatYen(item.price * quantity)}</strong>
                      </div>
                    ))}
                  </div>
                </div>
              </section>
            </div>
            <div className="register-panel register-pay-right">
              <div className="payment-box">
                  <label>
                    <span className="payment-label">受け取った金額を入力</span>
                    <input
                      type="text"
                      inputMode="numeric"
                      value={formatYen(paidAmount)}
                      readOnly
                      aria-label="預かり金額"
                      aria-describedby="paid-amount-limit"
                    />
                    <small id="paid-amount-limit" className="payment-input-hint">
                      最大{MAX_PAID_AMOUNT_DIGITS}桁
                    </small>
                  </label>
                  <div className="payment-shortcuts">
                    <button type="button" onClick={() => setPaidAmount(total)}>
                      ちょうど
                    </button>
                    {[1000, 5000, 10000].map((amount) => (
                      <button
                        type="button"
                        key={amount}
                        onClick={() => setPaidAmount(amount)}
                      >
                        {formatYen(amount)}
                      </button>
                    ))}
                  </div>
                  <div className="numpad">
                    {[7, 8, 9, 4, 5, 6, 1, 2, 3].map((digit) => (
                      <button
                        type="button"
                        key={digit}
                        onClick={() => appendPaidDigit(digit)}
                        disabled={paidAmount * 10 + digit > MAX_PAID_AMOUNT}
                      >
                        {digit}
                      </button>
                    ))}
                    <button type="button" onClick={() => setPaidAmount(0)}>
                      C
                    </button>
                    <button
                      type="button"
                      onClick={() => appendPaidDigit(0)}
                      disabled={paidAmount * 10 > MAX_PAID_AMOUNT}
                    >
                      0
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setPaidAmount((current) => Math.floor(current / 10))
                      }
                    >
                      ⌫
                    </button>
                  </div>
              </div>
              {checkoutError ? (
                <div className="checkout-error" role="alert">
                  <strong>確定できませんでした</strong>
                  <span>{checkoutError}</span>
                  <button
                    type="button"
                    onClick={() => void confirm()}
                    disabled={isSubmitting}
                  >
                    もう一度試す
                  </button>
                </div>
              ) : null}
              <div className="toolbar register-actions">
                <button
                  type="button"
                  onClick={() => {
                    setCheckoutError("");
                    resetCheckoutKey();
                    setPhase("select");
                  }}
                  disabled={isSubmitting}
                >
                  商品選択へ戻る
                </button>
                <button
                  type="button"
                  className="primary-action"
                  onClick={() => void confirm()}
                  disabled={!canConfirm}
                >
                  {isSubmitting
                    ? "確定中…"
                    : saleType === "normal"
                      ? "お会計確定"
                      : "前売り券を発行"}
                </button>
              </div>
            </div>
          </section>
        ) : (
          <section className="register-panel register-complete">
            <h2 ref={phaseHeadingRef} tabIndex={-1}>
              {saleType === "normal" ? "会計が完了しました" : "前売り券を発行しました"}
            </h2>
            {receipt ? (
              <>
                <p className="complete-instruction">
                  {receipt.changeAmount > 0
                    ? <><span>おつりは</span> <strong>{formatYen(receipt.changeAmount)}</strong> <span>です。</span></>
                    : "おつりはありません"}
                </p>
                <div className="receipt">
                  <div className="receipt-order-code">
                    <span>注文番号</span>
                    <strong>{formatPickupCode(receipt.pickupCode)}</strong>
                  </div>
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
                </div>
              </>
            ) : null}
            {checkoutError ? <p className="error">{checkoutError}</p> : null}
            <div className="toolbar complete-actions">
              <button
                type="button"
                className="primary-action"
                onClick={nextCheckout}
              >
                次の会計へ
              </button>
              {saleType === "normal" && (role === "staff" || role === "admin" || role === "owner") && receipt ? (
                <button
                  type="button"
                  className="danger-secondary"
                  onClick={() => void cancelReceipt()}
                  disabled={isCanceling}
                >
                  {isCanceling ? "取消中…" : "この会計を取り消す"}
                </button>
              ) : null}
              <a href="/staff/register/recent-sales">最近の会計</a>
            </div>
          </section>
        )}
      </section>
    </main>
  );
}
