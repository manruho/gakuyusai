import { useEffect, useState } from 'react';
import { formatDateTime } from '../../lib/date';
import { formatYen } from '../../lib/money';
import { getStockStatusText } from '../../lib/stockLevel';
import type { PublicStatusResponse } from '../../lib/types';

const fallback: PublicStatusResponse = {
  shopName: '文化祭食品販売',
  updatedAt: new Date().toISOString(),
  items: [],
  isPublicEnabled: true,
};

export function PublicPage() {
  const [data, setData] = useState<PublicStatusResponse>(fallback);
  const [error, setError] = useState<string | null>(null);

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

  return (
    <main className="page page-public">
      <header className="hero">
        <p className="eyebrow">Public Status</p>
        <h1>{data.shopName}</h1>
        <p className="lede">最終更新: {formatDateTime(data.updatedAt)}</p>
        {error ? <p className="error">{error}</p> : null}
        {!data.isPublicEnabled ? <p className="soldout">公開ページは現在停止中です。</p> : null}
      </header>
      <section className="cards">
        {data.items.map((item) => (
          <article key={item.id} className="product-card">
            <h2>{item.displayName}</h2>
            <p className="price">{formatYen(item.price)}</p>
            <p className={`status status-${item.statusLevel}`}>{item.statusText}</p>
            {item.isSoldOut ? <p className="soldout">売り切れ</p> : null}
            <p className="small">{item.allergyText || 'アレルギー表示なし'}</p>
            <p className="small">{item.note}</p>
          </article>
        ))}
        {!data.items.length ? <p className="empty">公開中の商品はありません。</p> : null}
      </section>
    </main>
  );
}
