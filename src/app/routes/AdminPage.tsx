import { useEffect, useState } from 'react';
import { formatYen } from '../../lib/money';

type Product = {
  id: string;
  name: string;
  displayName: string;
  price: number;
  initial_stock?: number;
  initialStock?: number;
  is_public?: number;
  isPublic?: boolean;
  is_active?: number;
  isActive?: boolean;
  sort_order?: number;
  sortOrder?: number;
  allergy_text?: string;
  allergyText?: string;
  description?: string;
  note?: string;
};

type Settings = {
  public_status_enabled: string;
  sales_open: string;
  staff_username: string;
  admin_username: string;
  owner_username: string;
  staff_password_hash: string;
  admin_password_hash: string;
  owner_password_hash: string;
  threshold_low: string;
  threshold_mid: string;
  threshold_high: string;
};

type EditForm = {
  id: string;
  name: string;
  displayName: string;
  price: number;
  initialStock: number;
  isPublic: boolean;
  isActive: boolean;
  sortOrder: number;
  allergyText: string;
  description: string;
  note: string;
};

const emptyForm: EditForm = {
  id: '',
  name: '',
  displayName: '',
  price: 0,
  initialStock: 0,
  isPublic: true,
  isActive: true,
  sortOrder: 0,
  allergyText: '',
  description: '',
  note: '',
};

const defaultSettings: Settings = {
  public_status_enabled: 'true',
  sales_open: 'true',
  staff_username: 'staff',
  admin_username: 'admin',
  owner_username: 'owner',
  staff_password_hash: '',
  admin_password_hash: '',
  owner_password_hash: '',
  threshold_low: '0.15',
  threshold_mid: '0.35',
  threshold_high: '0.65',
};

export function AdminPage() {
  const [items, setItems] = useState<Product[]>([]);
  const [message, setMessage] = useState('');
  const [csv, setCsv] = useState('');
  const [summary, setSummary] = useState<{ totalSales: number; completedSales: number; totalProducts: number; totalQuantity: number } | null>(null);
  const [form, setForm] = useState<EditForm>(emptyForm);
  const [settings, setSettings] = useState<Settings>(defaultSettings);

  const load = async () => {
    const response = await fetch('/api/admin/products');
    const json = (await response.json()) as { ok: true; data: { items: Product[] } } | { ok: false; error: { message: string } };
    if (json.ok) {
      setItems(json.data.items);
      if (!form.id && json.data.items[0]) {
        const first = json.data.items[0];
        setForm({
          id: first.id,
          name: first.name,
          displayName: first.displayName,
          price: first.price,
          initialStock: first.initialStock ?? first.initial_stock ?? 0,
          isPublic: Boolean(first.isPublic ?? first.is_public),
          isActive: Boolean(first.isActive ?? first.is_active),
          sortOrder: first.sortOrder ?? first.sort_order ?? 0,
          allergyText: first.allergyText ?? first.allergy_text ?? '',
          description: first.description ?? '',
          note: first.note ?? '',
        });
      }
    }
  };

  const loadSettings = async () => {
    const response = await fetch('/api/admin/settings');
    const json = (await response.json()) as { ok: true; data: { settings: Record<string, string> } } | { ok: false; error: { message: string } };
    if (json.ok) {
      setSettings((current) => ({
        ...current,
        ...json.data.settings,
      }));
    }
  };

  useEffect(() => {
    void load();
    void loadSummary();
    void loadSettings();
  }, []);

  const togglePublic = async (key: string, value: string) => {
    const response = await fetch('/api/admin/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, value }),
    });
    const json = (await response.json()) as { ok: true } | { ok: false; error: { message: string } };
    setMessage(json.ok ? '設定を更新しました' : json.error.message);
  };

  const loadCsv = async () => {
    const response = await fetch('/api/admin/csv');
    const text = await response.text();
    setCsv(text);
  };

  const downloadCsv = async (path: string, fileName: string) => {
    const response = await fetch(path);
    const text = await response.text();
    const blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = fileName;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const loadSummary = async () => {
    const response = await fetch('/api/admin/summary');
    const json = (await response.json()) as
      | { ok: true; data: { totalSales: number; completedSales: number; totalProducts: number; totalQuantity: number } }
      | { ok: false; error: { message: string } };
    if (json.ok) setSummary(json.data);
  };

  const saveProduct = async () => {
    const response = await fetch(`/api/admin/products/${encodeURIComponent(form.id)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    });
    const json = (await response.json()) as { ok: true } | { ok: false; error: { message: string } };
    setMessage(json.ok ? '商品を保存しました' : json.error.message);
    if (json.ok) void load();
  };

  const saveSettings = async () => {
    const response = await fetch('/api/admin/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(settings),
    });
    const json = (await response.json()) as { ok: true } | { ok: false; error: { message: string } };
    setMessage(json.ok ? 'ログイン情報としきい値を更新しました' : json.error.message);
    if (json.ok) void loadSettings();
  };

  return (
    <main className="page">
      <section className="panel">
        <h1>管理画面</h1>
        {message ? <p className="error">{message}</p> : null}
        <section className="admin-panel">
          <div className="section-head">
            <h2>運用設定</h2>
            <p className="small">公開ON/OFF、販売ON/OFF、CSV、集計をここにまとめています。</p>
          </div>
          <div className="toolbar admin-primary-actions">
            <button onClick={() => togglePublic('public_status_enabled', 'true')}>公開ON</button>
            <button onClick={() => togglePublic('public_status_enabled', 'false')}>公開OFF</button>
            <button onClick={() => togglePublic('sales_open', 'true')}>販売ON</button>
            <button onClick={loadCsv}>CSV取得</button>
            <button onClick={loadSummary}>集計更新</button>
          </div>
        </section>
        <section className="admin-panel">
          <div className="section-head">
            <h2>システム設定</h2>
            <p className="small">ログイン情報としきい値を変更します。保存は1回だけ押してください。</p>
          </div>
          <div className="form-grid admin-form-grid">
            <label>
              staff username
              <input value={settings.staff_username} onChange={(e) => setSettings((current) => ({ ...current, staff_username: e.target.value }))} />
            </label>
            <label>
              admin username
              <input value={settings.admin_username} onChange={(e) => setSettings((current) => ({ ...current, admin_username: e.target.value }))} />
            </label>
            <label>
              owner username
              <input value={settings.owner_username} onChange={(e) => setSettings((current) => ({ ...current, owner_username: e.target.value }))} />
            </label>
            <label>
              staff password hash
              <textarea value={settings.staff_password_hash} onChange={(e) => setSettings((current) => ({ ...current, staff_password_hash: e.target.value }))} />
            </label>
            <label>
              admin password hash
              <textarea value={settings.admin_password_hash} onChange={(e) => setSettings((current) => ({ ...current, admin_password_hash: e.target.value }))} />
            </label>
            <label>
              owner password hash
              <textarea value={settings.owner_password_hash} onChange={(e) => setSettings((current) => ({ ...current, owner_password_hash: e.target.value }))} />
            </label>
            <label>
              しきい値 low
              <input value={settings.threshold_low} onChange={(e) => setSettings((current) => ({ ...current, threshold_low: e.target.value }))} />
            </label>
            <label>
              しきい値 mid
              <input value={settings.threshold_mid} onChange={(e) => setSettings((current) => ({ ...current, threshold_mid: e.target.value }))} />
            </label>
            <label>
              しきい値 high
              <input value={settings.threshold_high} onChange={(e) => setSettings((current) => ({ ...current, threshold_high: e.target.value }))} />
            </label>
          </div>
          <div className="toolbar admin-primary-actions">
            <button onClick={saveSettings}>ログイン情報としきい値を保存</button>
          </div>
        </section>
        {summary ? (
          <div className="summary admin-summary">
            <p>売上合計: {formatYen(summary.totalSales)}</p>
            <p>会計件数: {summary.completedSales}</p>
            <p>商品数: {summary.totalProducts}</p>
            <p>販売数: {summary.totalQuantity}</p>
          </div>
        ) : null}
        <section className="admin-panel">
          <div className="section-head">
            <h2>商品編集</h2>
            <p className="small">一覧から選んで編集して、保存を押します。</p>
          </div>
          <div className="cards admin-product-cards">
            {items.map((item) => (
              <article
                key={item.id}
                className="product-card"
                role="button"
                tabIndex={0}
                onClick={() =>
                  setForm({
                    id: item.id,
                    name: item.name,
                    displayName: item.displayName,
                    price: item.price,
                    initialStock: item.initialStock ?? item.initial_stock ?? 0,
                    isPublic: Boolean(item.isPublic ?? item.is_public),
                    isActive: Boolean(item.isActive ?? item.is_active),
                    sortOrder: item.sortOrder ?? item.sort_order ?? 0,
                    allergyText: item.allergyText ?? item.allergy_text ?? '',
                    description: item.description ?? '',
                    note: item.note ?? '',
                  })
                }
              >
                <h2>{item.displayName}</h2>
                <p>{item.name}</p>
                <p>{formatYen(item.price)}</p>
                <p>初期在庫: {item.initialStock ?? item.initial_stock ?? '-'}</p>
                <p>アレルギー: {item.allergyText ?? item.allergy_text ?? '-'}</p>
                <p>備考: {item.note ?? '-'}</p>
              </article>
            ))}
          </div>
          <div className="form-grid">
            <label>
              ID
              <input value={form.id} onChange={(e) => setForm((current) => ({ ...current, id: e.target.value }))} />
            </label>
            <label>
              商品名
              <input value={form.name} onChange={(e) => setForm((current) => ({ ...current, name: e.target.value }))} />
            </label>
            <label>
              表示名
              <input value={form.displayName} onChange={(e) => setForm((current) => ({ ...current, displayName: e.target.value }))} />
            </label>
            <label>
              価格
              <input type="number" value={form.price} onChange={(e) => setForm((current) => ({ ...current, price: Number(e.target.value) }))} />
            </label>
            <label>
              初期在庫
              <input type="number" value={form.initialStock} onChange={(e) => setForm((current) => ({ ...current, initialStock: Number(e.target.value) }))} />
            </label>
            <label>
              表示順
              <input type="number" value={form.sortOrder} onChange={(e) => setForm((current) => ({ ...current, sortOrder: Number(e.target.value) }))} />
            </label>
            <label>
              アレルギー
              <input value={form.allergyText} onChange={(e) => setForm((current) => ({ ...current, allergyText: e.target.value }))} />
            </label>
            <label>
              備考
              <input value={form.note} onChange={(e) => setForm((current) => ({ ...current, note: e.target.value }))} />
            </label>
            <label>
              説明
              <textarea value={form.description} onChange={(e) => setForm((current) => ({ ...current, description: e.target.value }))} />
            </label>
          </div>
          <div className="toolbar admin-primary-actions">
            <label>
              <input
                type="checkbox"
                checked={form.isPublic}
                onChange={(e) => setForm((current) => ({ ...current, isPublic: e.target.checked }))}
              />
              公開
            </label>
            <label>
              <input
                type="checkbox"
                checked={form.isActive}
                onChange={(e) => setForm((current) => ({ ...current, isActive: e.target.checked }))}
              />
              有効
            </label>
            <button onClick={saveProduct} disabled={!form.id}>
              保存
            </button>
          </div>
        </section>
        <section className="admin-panel">
          <div className="section-head">
            <h2>CSVプレビュー</h2>
            <p className="small">出力前に中身を確認できます。</p>
          </div>
          {csv ? (
            <label>
              CSVプレビュー
              <textarea readOnly value={csv} rows={8} />
            </label>
          ) : (
            <p className="small">まだCSVを読み込んでいません。</p>
          )}
          <div className="toolbar admin-primary-actions">
            <button onClick={() => void downloadCsv('/api/admin/export/sales.csv', 'sales.csv')}>
              売上CSV
            </button>
            <button onClick={() => void downloadCsv('/api/admin/export/stock-events.csv', 'stock-events.csv')}>
              在庫イベントCSV
            </button>
          </div>
        </section>
      </section>
    </main>
  );
}
