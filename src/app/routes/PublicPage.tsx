import { useEffect, useState } from 'react';
import { formatDateTime } from '../../lib/date';
import { formatYen } from '../../lib/money';
import type { PublicStatusItem, PublicStatusResponse } from '../../lib/types';

const CATEGORIES = ['おにぎり', 'サイドメニュー', '飲み物'] as const;
type PublicCategory = (typeof CATEGORIES)[number];

const fallback: PublicStatusResponse = {
  shopName: '文化祭食品販売',
  updatedAt: new Date().toISOString(),
  items: [],
  isPublicEnabled: true,
};

function normalizeCategory(item: PublicStatusItem): PublicCategory {
  const raw = `${item.category ?? ''} ${item.displayName ?? ''} ${item.note ?? ''}`.trim();
  if (CATEGORIES.includes(raw as PublicCategory)) return raw as PublicCategory;
  if (/飲み物|ドリンク|ジュース|麦茶|ラムネ|お茶|水/.test(raw)) return '飲み物';
  if (/サイド|唐揚げ|からあげ|玉子|たまご|フライ|ポテト|枝豆|サラダ/.test(raw)) return 'サイドメニュー';
  return 'おにぎり';
}

function splitAllergies(text: string) {
  const items = text
    .split(/[、,\/・\s]+/)
    .map((value) => value.trim())
    .filter(Boolean);
  return items.length ? items : ['なし'];
}

function getOnigiriFlavorClass(item: PublicStatusItem) {
  const raw = `${item.displayName ?? ''} ${item.note ?? ''}`.trim();
  if (/梅|うめ/.test(raw)) return 'ume';
  if (/鮭|しゃけ|サーモン/.test(raw)) return 'salmon';
  if (/昆布|こんぶ|高菜|わかめ/.test(raw)) return 'kombu';
  return '';
}

function getStockMeter(item: PublicStatusItem) {
  if (item.isSoldOut) {
    return { className: 'stock-meter soldout', label: '売り切れ', value: 0 };
  }
  if (item.statusLevel <= 1) {
    return { className: 'stock-meter low', label: 'すくなめ', value: 2 };
  }
  if (item.statusLevel === 2) {
    return { className: 'stock-meter available', label: 'まだある', value: 3 };
  }
  return { className: 'stock-meter plenty', label: 'たっぷり', value: 4 };
}

export function PublicPage() {
  const [data, setData] = useState<PublicStatusResponse>(fallback);
  const [error, setError] = useState<string | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<PublicCategory>('おにぎり');

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      try {
        const response = await fetch('/api/public/status');
        const json = (await response.json()) as { ok: true; data: PublicStatusResponse } | { ok: false };
        if (mounted && json.ok) {
          setData(json.data);
          setError(null);
        } else if (mounted) {
          setError('最新情報を取得できませんでした。\n表示は前回更新時点のものです。');
        }
      } catch {
        if (mounted) {
          setError('最新情報を取得できませんでした。\n表示は前回更新時点のものです。');
        }
      }
    };
    void load();
    const timer = window.setInterval(load, 120000);
    return () => {
      mounted = false;
      window.clearInterval(timer);
    };
  }, []);

  const soldOutCount = data.items.filter((item) => item.isSoldOut).length;
  const visibleItems = data.items.filter((item) => normalizeCategory(item) === selectedCategory);

  return (
    <main className="page page-public">
      <div className="phone-frame">
        <header className="festival-header">
          <h1 className="festival-title">
            <span className="onigiri-mark" aria-hidden="true" />
            <span className="title-text">
              {data.shopName}
              <small>販売状況とアレルギーをすぐ確認できます</small>
            </span>
          </h1>
        </header>

        <section className="notice-board" aria-label="販売情報">
          <div className="notice">
            <strong>{formatDateTime(data.updatedAt)}</strong>
            <span>販売状況を更新しました</span>
          </div>
          <div className="notice">
            <strong>{data.isPublicEnabled ? '公開中' : '停止中'}</strong>
            <span>売り切れ {soldOutCount}品</span>
          </div>
        </section>

        {error ? <p className="public-banner">{error}</p> : null}
        {!data.isPublicEnabled ? <p className="public-banner">公開ページは現在停止中です。</p> : null}

        <div className="section-title">
          <span>今日のメニュー</span>
        </div>

        <nav className="public-category-tabs" aria-label="カテゴリを切り替える">
          {CATEGORIES.map((category) => (
            <button
              key={category}
              type="button"
              className={selectedCategory === category ? 'public-category-tab is-active' : 'public-category-tab'}
              onClick={() => setSelectedCategory(category)}
              aria-pressed={selectedCategory === category}
            >
              <span>{category === '飲み物' ? 'のみもの' : category}</span>
            </button>
          ))}
        </nav>

        <section className="menu-list">
          {visibleItems.map((item) => {
            const category = normalizeCategory(item);
            const allergies = splitAllergies(item.allergyText);
            const stock = getStockMeter(item);
            const flavorClass = category === 'おにぎり' ? getOnigiriFlavorClass(item) : 'side';

            return (
              <article key={item.id} className={item.isSoldOut ? 'menu-card is-soldout' : 'menu-card'}>
                <div className={`mini-onigiri ${flavorClass}`} aria-hidden="true" />
                <div className="menu-content">
                  <h2 className="menu-name">{item.displayName}</h2>
                  <p className="menu-meta">アレルギー: {allergies.join('・')}</p>
                  <div className="menu-bottom">
                    <span className="price">{formatYen(item.price)}</span>
                    <span className={stock.className} aria-label={`在庫: ${stock.label}`}>
                      <span className="stock-meter-caption">在庫</span>
                      <span className="stock-meter-bars" aria-hidden="true">
                        {Array.from({ length: 4 }, (_, index) => (
                          <span
                            key={index}
                            className={index < stock.value ? 'stock-meter-segment is-active' : 'stock-meter-segment'}
                          />
                        ))}
                      </span>
                      <span className="stock-meter-label">{stock.label}</span>
                    </span>
                  </div>
                </div>
              </article>
            );
          })}

          {!visibleItems.length ? (
            <article className="empty-state">
              <h2>{selectedCategory === '飲み物' ? 'のみもの' : selectedCategory}はまだありません</h2>
              <p className="small">別のカテゴリを選ぶと、商品を確認できます。</p>
            </article>
          ) : null}
        </section>

        <p className="footer-note">最新の販売状況は自動で更新されます。</p>
      </div>
    </main>
  );
}
