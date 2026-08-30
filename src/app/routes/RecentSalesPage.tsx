import { useEffect, useState } from 'react';
import { formatDateTime } from '../../lib/date';
import { formatYen } from '../../lib/money';

type Sale = {
  id: string;
  created_at: string;
  total_amount: number;
  paid_amount: number;
  change_amount: number;
  status: 'completed' | 'canceled';
  sale_type: 'normal' | 'presale_pickup';
  pickup_code: string;
  fulfillment_status: 'pending' | 'delivered' | 'canceled';
  items: Array<{ productName: string; quantity: number }>;
};

export function RecentSalesPage() {
  const [sales, setSales] = useState<Sale[]>([]);
  const [message, setMessage] = useState('');

  const load = async () => {
    const response = await fetch('/api/staff/register/recent-sales?limit=20');
    const json = (await response.json()) as { ok: true; data: { items: Sale[] } } | { ok: false; error: { message: string } };
    if (json.ok) setSales(json.data.items);
    else setMessage(json.error.message);
  };

  useEffect(() => { void load(); }, []);

  const cancel = async (sale: Sale) => {
    if (!window.confirm(`注文 ${sale.pickup_code} をキャンセルしますか？`)) return;
    const restoreStock = sale.fulfillment_status === 'delivered' ? window.confirm('受渡済みです。商品が返却されたため在庫へ戻しますか？\nキャンセルを押すと在庫を戻しません。') : true;
    const response = await fetch(`/api/sales/${encodeURIComponent(sale.id)}/cancel`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason: 'レジからの取消', restoreStock }),
    });
    const json = (await response.json()) as { ok: true } | { ok: false; error: { message: string } };
    if (!json.ok) setMessage(json.error.message);
    else await load();
  };

  return (
    <main className="page page-admin">
      <section className="panel">
        <div className="admin-hero"><div><p className="eyebrow">Recent Sales</p><h1>最近の会計</h1></div><a className="admin-link-button" href="/staff/register">レジへ戻る</a></div>
        {message ? <p className="error">{message}</p> : null}
        <div className="sales-list">
          {sales.map((sale) => (
            <article className="sale-row" key={sale.id}>
              <div><strong className="order-code">{sale.pickup_code}</strong><small>{formatDateTime(sale.created_at)}</small></div>
              <div><span>{sale.items.map((item) => `${item.productName} ×${item.quantity}`).join('、')}</span><small>{formatYen(sale.total_amount)} / 受取: {sale.fulfillment_status}</small></div>
              {sale.status === 'completed' && sale.sale_type === 'normal' ? <button type="button" className="danger-secondary" onClick={() => void cancel(sale)}>取消</button> : sale.sale_type === 'presale_pickup' ? <span>前売り・取消不可</span> : <span>取消済み</span>}
            </article>
          ))}
          {!sales.length ? <p>最近の会計はありません。</p> : null}
        </div>
      </section>
    </main>
  );
}
