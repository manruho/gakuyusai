import { useEffect, useMemo, useState } from 'react';
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
  current_stock?: number;
  currentStock?: number;
  category?: string;
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
  sales_day: 'all' | 'day1' | 'day2';
  staff_username: string;
  admin_username: string;
  owner_username: string;
  threshold_low: string;
  threshold_mid: string;
  threshold_high: string;
  pickup_1_username: string;
  pickup_2_username: string;
  pickup_3_username: string;
  pickup_4_username: string;
  register_1_presale_enabled: string;
  register_2_presale_enabled: string;
  register_3_presale_enabled: string;
};

type EditForm = {
  id: string;
  name: string;
  displayName: string;
  category: string;
  price: number;
  initialStock: number;
  isPublic: boolean;
  isActive: boolean;
  sortOrder: number;
  allergyText: string;
  description: string;
  note: string;
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

const CATEGORIES = ['おにぎり', 'サイドメニュー', '飲み物'] as const;
type ProductCategory = (typeof CATEGORIES)[number];

function normalizeCategory(item: Product): ProductCategory {
  const raw = `${item.category ?? ''}`.trim();
  if (CATEGORIES.includes(raw as ProductCategory)) return raw as ProductCategory;
  const fallback = `${item.displayName ?? ''} ${item.name ?? ''}`.trim();
  if (/飲み物|ドリンク|ジュース|麦茶|ラムネ|お茶|水/.test(fallback)) return '飲み物';
  if (/サイド|唐揚げ|からあげ|玉子|たまご|フライ|ポテト|枝豆|サラダ/.test(fallback)) return 'サイドメニュー';
  return 'おにぎり';
}

function getCategoryLabel(category: ProductCategory) {
  return category === '飲み物' ? 'のみもの' : category;
}

const emptyForm: EditForm = {
  id: '',
  name: '',
  displayName: '',
  category: 'おにぎり',
  price: 0,
  initialStock: 0,
  isPublic: true,
  isActive: true,
  sortOrder: 0,
  allergyText: '',
  description: '',
  note: '',
};

function toEditForm(item: Product): EditForm {
  return {
    id: item.id,
    name: item.name,
    displayName: item.displayName,
    category: item.category ?? normalizeCategory(item),
    price: item.price,
    initialStock: item.initialStock ?? item.initial_stock ?? 0,
    isPublic: Boolean(item.isPublic ?? item.is_public),
    isActive: Boolean(item.isActive ?? item.is_active),
    sortOrder: item.sortOrder ?? item.sort_order ?? 0,
    allergyText: item.allergyText ?? item.allergy_text ?? '',
    description: item.description ?? '',
    note: item.note ?? '',
  };
}

const defaultSettings: Settings = {
  public_status_enabled: 'true',
  sales_open: 'true',
  sales_day: 'all',
  staff_username: 'staff',
  admin_username: 'admin',
  owner_username: 'owner',
  threshold_low: '0.15',
  threshold_mid: '0.35',
  threshold_high: '0.65',
  pickup_1_username: 'pickup-1',
  pickup_2_username: 'pickup-2',
  pickup_3_username: 'pickup-3',
  pickup_4_username: 'pickup-4',
  register_1_presale_enabled: 'false',
  register_2_presale_enabled: 'false',
  register_3_presale_enabled: 'false',
};

export function AdminPage() {
  const [viewer, setViewer] = useState<{ username: string; role: 'admin' | 'owner' } | null>(null);
  const [items, setItems] = useState<Product[]>([]);
  const [message, setMessage] = useState('');
  const [csv, setCsv] = useState('');
  const [saleQuery, setSaleQuery] = useState('');
  const [sales, setSales] = useState<Sale[]>([]);
  const [summary, setSummary] = useState<{ totalSales: number; completedSales: number; totalProducts: number; totalQuantity: number } | null>(null);
  const [drafts, setDrafts] = useState<Record<string, EditForm>>({});
  const [newDraft, setNewDraft] = useState<EditForm | null>(null);
  const [savingProductId, setSavingProductId] = useState<string | null>(null);
  const [settings, setSettings] = useState<Settings>(defaultSettings);
  const [selectedCategory, setSelectedCategory] = useState<ProductCategory>('おにぎり');

  const load = async () => {
    const response = await fetch('/api/admin/products');
    const json = (await response.json()) as { ok: true; data: { items: Product[] } } | { ok: false; error: { message: string } };
    if (json.ok) {
      setItems(json.data.items);
      setDrafts(Object.fromEntries(json.data.items.map((item) => [item.id, toEditForm(item)])));
    }
  };

  const visibleItems = useMemo(
    () => items.filter((item) => normalizeCategory(item) === selectedCategory),
    [items, selectedCategory],
  );

  const itemCounts = useMemo(
    () =>
      CATEGORIES.map((category) => ({
        category,
        count: items.filter((item) => normalizeCategory(item) === category).length,
      })),
    [items],
  );

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

  const loadSales = async (query = '') => {
    const search = query ? `?q=${encodeURIComponent(query)}&limit=50` : '?limit=50';
    const response = await fetch(`/api/admin/sales${search}`);
    const json = (await response.json()) as { ok: true; data: { items: Sale[] } } | { ok: false; error: { message: string } };
    if (json.ok) setSales(json.data.items);
  };

  useEffect(() => {
    void fetch('/api/auth/me')
      .then(async (response) => {
        if (!response.ok) return null;
        return (await response.json()) as { ok: true; data: { username: string; role: 'admin' | 'owner' } } | { ok: false };
      })
      .then((json) => {
        if (json && json.ok) {
          setViewer(json.data);
          if (json.data.role === 'owner') {
            void load();
            void loadSettings();
          }
        }
      });
    void loadSummary();
    void loadSales();
  }, []);

  if (viewer && viewer.username === 'staff') {
    return (
      <main className="page page-admin">
        <section className="panel admin-denied">
          <h1>アクセスできません</h1>
          <p className="small">販売履歴と設定は admin / owner だけが見られます。</p>
          <a className="admin-link-button" href="/staff/register">
            レジへ戻る
          </a>
        </section>
      </main>
    );
  }

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadSales(saleQuery.trim());
    }, 200);
    return () => window.clearTimeout(timer);
  }, [saleQuery]);

  const togglePublic = async (key: string, value: string) => {
    const response = await fetch('/api/admin/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, value }),
    });
    const json = (await response.json()) as { ok: true } | { ok: false; error: { message: string } };
    if (json.ok) {
      setSettings((current) => ({ ...current, [key]: value }));
      setMessage('設定を更新しました');
    } else {
      setMessage(json.error.message);
    }
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

  const updateDraft = (id: string, changes: Partial<EditForm>) => {
    setDrafts((current) => ({ ...current, [id]: { ...(current[id] ?? emptyForm), ...changes } }));
  };

  const saveProduct = async (draft: EditForm, isNew = false) => {
    if (!draft.id.trim() || !draft.name.trim() || !draft.displayName.trim()) {
      setMessage('商品ID・商品名・表示名を入力してください');
      return;
    }
    setSavingProductId(draft.id);
    const isExisting = !isNew && items.some((item) => item.id === draft.id);
    const response = await fetch(isExisting ? `/api/admin/products/${encodeURIComponent(draft.id)}` : '/api/admin/products', {
      method: isExisting ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(draft),
    });
    const json = (await response.json()) as { ok: true } | { ok: false; error: { message: string } };
    setMessage(json.ok ? '商品を保存しました' : json.error.message);
    if (json.ok) {
      if (isNew) setNewDraft(null);
      void load();
    }
    setSavingProductId(null);
  };

  const archiveProduct = async (item: Product) => {
    const confirmation = window.prompt(`「${item.displayName}」を消去します。\n販売履歴がある場合も履歴を保護したうえで商品一覧から消えます。\n実行するには「消去」と入力してください。`);
    if (confirmation !== '消去') {
      setMessage('消去をキャンセルしました。「消去」と正確に入力した場合だけ実行されます。');
      return;
    }
    const response = await fetch(`/api/admin/products/${encodeURIComponent(item.id)}`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ confirmation }) });
    const json = (await response.json()) as { ok: true } | { ok: false; error: { message: string } };
    setMessage(json.ok ? '商品を消去しました。販売履歴は保持されています。' : json.error.message);
    if (json.ok) void load();
  };

  const saveSettings = async () => {
    const response = await fetch('/api/admin/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(settings),
    });
    const json = (await response.json()) as { ok: true } | { ok: false; error: { message: string } };
    setMessage(json.ok ? 'アカウント名と運用設定を更新しました' : json.error.message);
    if (json.ok) void loadSettings();
  };

  return (
    <main className="page page-admin">
      <section className="panel">
        <div className="admin-hero">
          <div>
            <p className="eyebrow">運用管理</p>
            <h1>管理画面</h1>
            <p className="small">上から順に、状態確認 → 履歴確認 → 商品・設定変更を行えます。</p>
          </div>
          <div className="toolbar">
            <a className="admin-link-button" href="/admin/inventory">
              在庫一覧
            </a>
            <a className="admin-link-button" href="/staff/register">
              レジへ
            </a>
            <a className="admin-link-button" href="/admin/fulfillment">
              受取状況
            </a>
          </div>
        </div>
        <nav className="admin-nav" aria-label="管理画面のメニュー">
          <a href="#overview">概要</a>
          <a href="/admin/inventory">在庫一覧</a>
          <a href="#sales-history">販売履歴</a>
          {viewer?.role === 'owner' ? <a href="#products">商品マスタ</a> : null}
          {viewer?.role === 'owner' ? <a href="#settings">設定</a> : null}
          <a href="#exports">CSV出力</a>
        </nav>
        {message ? <p className="admin-feedback" role="status">{message}</p> : null}
        <section className="admin-panel" id="overview">
          <div className="section-head">
            <div>
              <p className="admin-section-kicker">01 / 概要</p>
              <h2>今日の運用状態</h2>
            </div>
            <p className="small">現在の状態を確認してから、必要な操作を選択してください。</p>
          </div>
          {viewer?.role === 'owner' ? <div className="admin-status-grid">
            <div className="admin-status-card">
              <div><span>公開ページ</span><strong>{settings.public_status_enabled === 'true' ? '公開中' : '停止中'}</strong></div>
              <button type="button" onClick={() => void togglePublic('public_status_enabled', settings.public_status_enabled === 'true' ? 'false' : 'true')}>
                {settings.public_status_enabled === 'true' ? '公開を停止' : '公開する'}
              </button>
            </div>
            <div className="admin-status-card">
              <div><span>販売受付</span><strong>{settings.sales_open === 'true' ? '受付中' : '停止中'}</strong></div>
              <button type="button" onClick={() => void togglePublic('sales_open', settings.sales_open === 'true' ? 'false' : 'true')}>
                {settings.sales_open === 'true' ? '販売を停止' : '販売を開始'}
              </button>
            </div>
          </div> : null}
          <div className="admin-tool-row">
            <button type="button" onClick={() => void loadSummary()}>集計を更新</button>
            <button type="button" onClick={() => void loadCsv()}>CSVプレビューを読み込む</button>
          </div>
        </section>
        {viewer?.role === 'owner' ? <section className="admin-panel" id="settings">
          <div className="section-head">
            <div>
              <p className="admin-section-kicker">02 / 設定</p>
              <h2>システム設定</h2>
            </div>
            <p className="small">変更した項目を確認してから、最後に保存してください。</p>
          </div>
          <div className="form-grid admin-form-grid">
            <div className="admin-form-subhead"><strong>ログインアカウント</strong><span>担当者ごとのログイン名です。パスワードハッシュはブラウザへ返さず、Cloudflare Secrets で管理します。</span></div>
            <label>
              staff username
              <span className="field-help">スタッフ用のログイン名です。</span>
              <input value={settings.staff_username} onChange={(e) => setSettings((current) => ({ ...current, staff_username: e.target.value }))} />
            </label>
            <label>
              admin username
              <span className="field-help">管理画面の受付用です。</span>
              <input value={settings.admin_username} onChange={(e) => setSettings((current) => ({ ...current, admin_username: e.target.value }))} />
            </label>
            <label>
              owner username
              <span className="field-help">設定変更権限を持つログイン名です。</span>
              <input value={settings.owner_username} onChange={(e) => setSettings((current) => ({ ...current, owner_username: e.target.value }))} />
            </label>
            <div className="admin-form-subhead"><strong>在庫表示のしきい値</strong><span>公開ページの在庫表示を切り替える基準値です。</span></div>
            <div className="admin-form-subhead"><strong>文化祭の日程モード</strong><span>会計API側でも販売種別を制限します。通常運用では「制限なし」を選択してください。</span></div>
            <label>
              販売日
              <select value={settings.sales_day} onChange={(e) => setSettings((current) => ({ ...current, sales_day: e.target.value as Settings['sales_day'] }))}>
                <option value="all">制限なし</option>
                <option value="day1">1日目：前売り券のみ</option>
                <option value="day2">2日目：通常販売のみ</option>
              </select>
            </label>
            <label>
              しきい値 low
              <span className="field-help">在庫表示の最小ラインです。</span>
              <input value={settings.threshold_low} onChange={(e) => setSettings((current) => ({ ...current, threshold_low: e.target.value }))} />
            </label>
            <label>
              しきい値 mid
              <span className="field-help">中間ラインです。</span>
              <input value={settings.threshold_mid} onChange={(e) => setSettings((current) => ({ ...current, threshold_mid: e.target.value }))} />
            </label>
            <label>
              しきい値 high
              <span className="field-help">十分ある状態のラインです。</span>
              <input value={settings.threshold_high} onChange={(e) => setSettings((current) => ({ ...current, threshold_high: e.target.value }))} />
            </label>
            <div className="admin-form-subhead"><strong>レジの販売モード</strong><span>レジ1〜3は個別に前売り券専用へ切り替えられます。レジ4は常に前売り券専用です。変更後は次の会計から反映されます。</span></div>
            {[1, 2, 3].map((registerId) => {
              const key = `register_${registerId}_presale_enabled` as keyof Settings;
              const enabled = settings[key] === 'true';
              return (
                <label className="settings-toggle" key={registerId}>
                  <span><strong>レジ{registerId}</strong><small>{enabled ? 'ON：前売り券専用' : 'OFF：通常レジ'}</small></span>
                  <input
                    type="checkbox"
                    checked={enabled}
                    onChange={(event) => setSettings((current) => ({ ...current, [key]: event.target.checked ? 'true' : 'false' }))}
                    aria-label={`レジ${registerId}を前売り券専用にする`}
                  />
                </label>
              );
            })}
            <div className="settings-toggle settings-toggle-fixed">
              <span><strong>レジ4</strong><small>ON：前売り券専用（固定）</small></span>
              <input type="checkbox" checked readOnly aria-label="レジ4は前売り券専用（固定）" />
            </div>
            <div className="admin-form-subhead"><strong>受取窓口アカウント</strong><span>受取1〜4のログイン情報です。受取場所ごとに設定できます。</span></div>
            {[1, 2, 3, 4].map((stationId) => {
              const usernameKey = `pickup_${stationId}_username` as keyof Settings;
              return (
                <div className="settings-group" key={stationId}>
                  <strong>受取{stationId} アカウント</strong>
                  <label>username<input value={settings[usernameKey]} onChange={(e) => setSettings((current) => ({ ...current, [usernameKey]: e.target.value }))} /></label>
                </div>
              );
            })}
          </div>
          <div className="toolbar admin-primary-actions admin-save-bar">
            <span className="small">パスワード変更は Cloudflare Pages の Secret 更新で行います。</span>
            <button type="button" onClick={() => void saveSettings()}>設定を保存</button>
          </div>
        </section> : null}
        {summary ? (
          <div className="summary admin-summary">
            <p>売上合計: {formatYen(summary.totalSales)}</p>
            <p>会計件数: {summary.completedSales}</p>
            <p>商品数: {summary.totalProducts}</p>
            <p>販売数: {summary.totalQuantity}</p>
          </div>
        ) : null}
        <section className="admin-panel admin-history-panel" id="sales-history">
          <div className="section-head">
            <div>
              <p className="admin-section-kicker">03 / 確認</p>
              <h2>販売履歴</h2>
            </div>
            <p className="small">検索すると自動で絞り込みます。最新50件を表示しています。</p>
          </div>
          <label>
            検索
            <input value={saleQuery} onChange={(e) => setSaleQuery(e.target.value)} placeholder="sale id / type / status / product" />
          </label>
          <div className="history admin-history">
            {sales.length ? (
              sales.map((sale) => (
                <div key={sale.id} className="history-row admin-history-row">
                  <div className="history-row-main">
                    <strong>
                      {sale.sale_type} / {sale.status}
                    </strong>
                    <span>
                      {formatYen(sale.total_amount)} / {sale.created_at}
                    </span>
                  </div>
                  <div className="history-row-meta">
                    <small>
                      預かり {formatYen(sale.paid_amount)} / おつり {formatYen(sale.change_amount)}
                    </small>
                    <small>{sale.items.length} 点</small>
                  </div>
                </div>
              ))
            ) : (
              <p className="empty">販売履歴はまだありません。</p>
            )}
          </div>
        </section>
        {viewer?.role === 'owner' ? <section className="admin-panel" id="products">
          <div className="section-head">
            <div>
              <p className="admin-section-kicker">04 / 変更</p>
              <h2>商品マスタ</h2>
            </div>
            <p className="small">表のセルを直接編集し、行ごとの保存ボタンで確定します。保存するまで本番データは変わりません。</p>
          </div>
          <div className="product-editor product-database-editor">
            <div className="product-browser">
              <nav className="admin-category-tabs" aria-label="商品カテゴリを切り替える">
                {itemCounts.map(({ category, count }) => (
                  <button
                    key={category}
                    type="button"
                    className={selectedCategory === category ? 'admin-category-tab is-active' : 'admin-category-tab'}
                    onClick={() => setSelectedCategory(category)}
                    aria-pressed={selectedCategory === category}
                  >
                    <span>{getCategoryLabel(category)}</span>
                    <strong>{count}</strong>
                  </button>
                ))}
              </nav>
              <div className="admin-product-list-head">
                <span>{getCategoryLabel(selectedCategory)}の商品 {visibleItems.length}件</span>
                <button type="button" onClick={() => setNewDraft(newDraft ?? { ...emptyForm, sortOrder: items.length + 1 })}>＋ 新しい商品</button>
              </div>
              <div className="admin-product-table-wrap">
                <table className="admin-product-table">
                  <thead><tr><th>商品ID</th><th>商品名</th><th>表示名</th><th>カテゴリ</th><th>価格</th><th>初期在庫</th><th>現在庫</th><th>公開</th><th>有効</th><th>表示順</th><th>説明・備考</th><th>操作</th></tr></thead>
                  <tbody>
                    {newDraft ? (
                      <tr className="admin-product-edit-row is-new-row">
                        <td><input value={newDraft.id} placeholder="商品ID" onChange={(event) => setNewDraft({ ...newDraft, id: event.target.value })} /></td>
                        <td><input value={newDraft.name} placeholder="内部名" onChange={(event) => setNewDraft({ ...newDraft, name: event.target.value })} /></td>
                        <td><input value={newDraft.displayName} placeholder="表示名" onChange={(event) => setNewDraft({ ...newDraft, displayName: event.target.value })} /></td>
                        <td><select value={newDraft.category} onChange={(event) => setNewDraft({ ...newDraft, category: event.target.value })}>{CATEGORIES.map((category) => <option key={category} value={category}>{getCategoryLabel(category)}</option>)}</select></td>
                        <td><input className="number-input" type="number" value={newDraft.price} onChange={(event) => setNewDraft({ ...newDraft, price: Number(event.target.value) })} /></td>
                        <td><input className="number-input" type="number" value={newDraft.initialStock} onChange={(event) => setNewDraft({ ...newDraft, initialStock: Number(event.target.value) })} /></td>
                        <td>—</td>
                        <td><input type="checkbox" checked={newDraft.isPublic} onChange={(event) => setNewDraft({ ...newDraft, isPublic: event.target.checked })} /></td>
                        <td><input type="checkbox" checked={newDraft.isActive} onChange={(event) => setNewDraft({ ...newDraft, isActive: event.target.checked })} /></td>
                        <td><input className="number-input" type="number" value={newDraft.sortOrder} onChange={(event) => setNewDraft({ ...newDraft, sortOrder: Number(event.target.value) })} /></td>
                        <td><input value={newDraft.allergyText} placeholder="アレルギー" onChange={(event) => setNewDraft({ ...newDraft, allergyText: event.target.value })} /><input value={newDraft.description} placeholder="説明" onChange={(event) => setNewDraft({ ...newDraft, description: event.target.value })} /><input value={newDraft.note} placeholder="備考" onChange={(event) => setNewDraft({ ...newDraft, note: event.target.value })} /></td>
                        <td className="admin-product-actions"><button type="button" onClick={() => void saveProduct(newDraft, true)} disabled={savingProductId === newDraft.id || !newDraft.id || !newDraft.name || !newDraft.displayName}>追加</button><button type="button" className="table-link-button" onClick={() => setNewDraft(null)}>取消</button></td>
                      </tr>
                    ) : null}
                    {visibleItems.map((item) => {
                      const draft = drafts[item.id] ?? toEditForm(item);
                      const currentStock = item.currentStock ?? item.current_stock ?? 0;
                      return (
                        <tr key={item.id} className="admin-product-edit-row">
                          <td><input value={draft.id} disabled /></td>
                          <td><input value={draft.name} onChange={(event) => updateDraft(item.id, { name: event.target.value })} /></td>
                          <td><input value={draft.displayName} onChange={(event) => updateDraft(item.id, { displayName: event.target.value })} /></td>
                          <td><select value={draft.category} onChange={(event) => updateDraft(item.id, { category: event.target.value })}>{CATEGORIES.map((category) => <option key={category} value={category}>{getCategoryLabel(category)}</option>)}</select></td>
                          <td><input className="number-input" type="number" value={draft.price} onChange={(event) => updateDraft(item.id, { price: Number(event.target.value) })} /></td>
                          <td><input className="number-input" type="number" value={draft.initialStock} onChange={(event) => updateDraft(item.id, { initialStock: Number(event.target.value) })} /></td>
                          <td>{currentStock}</td>
                          <td><input type="checkbox" checked={draft.isPublic} onChange={(event) => updateDraft(item.id, { isPublic: event.target.checked })} /></td>
                          <td><input type="checkbox" checked={draft.isActive} onChange={(event) => updateDraft(item.id, { isActive: event.target.checked })} /></td>
                          <td><input className="number-input" type="number" value={draft.sortOrder} onChange={(event) => updateDraft(item.id, { sortOrder: Number(event.target.value) })} /></td>
                          <td><input value={draft.allergyText} placeholder="アレルギー" onChange={(event) => updateDraft(item.id, { allergyText: event.target.value })} /><input value={draft.description} placeholder="説明" onChange={(event) => updateDraft(item.id, { description: event.target.value })} /><input value={draft.note} placeholder="備考" onChange={(event) => updateDraft(item.id, { note: event.target.value })} /></td>
                          <td className="admin-product-actions"><button type="button" onClick={() => void saveProduct(draft)} disabled={savingProductId === item.id}>{savingProductId === item.id ? '保存中' : '保存'}</button><button type="button" className="table-link-button danger-text" onClick={() => void archiveProduct(item)}>消去</button></td>
                        </tr>
                      );
                    })}
                    {!visibleItems.length && !newDraft ? <tr><td colSpan={12} className="admin-table-empty">商品がありません。「＋ 新しい商品」から追加できます。</td></tr> : null}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </section> : null}
        <section className="admin-panel" id="exports">
          <div className="section-head">
            <div>
              <p className="admin-section-kicker">05 / 出力</p>
              <h2>CSV出力</h2>
            </div>
            <p className="small">必要なデータをダウンロードして、表計算ソフトで確認できます。</p>
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
