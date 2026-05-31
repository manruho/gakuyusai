import { createId } from '../../src/lib/ids';

export type StockEventInput = {
  productId: string;
  quantityDelta: number;
  eventType: 'restock' | 'discard' | 'adjust';
  reason?: string;
};

type ProductRow = {
  id: string;
  display_name: string;
  current_stock: number;
  initial_stock: number;
};

type StockEventRow = {
  id: string;
  product_id: string;
  display_name: string;
  event_type: string;
  quantity_delta: number;
  related_sale_id: string | null;
  reason: string;
  created_by_role: 'admin' | 'owner';
  created_at: string;
};

type SaleRow = {
  id: string;
  idempotency_key: string;
  sale_type: 'normal' | 'presale_pickup';
  total_amount: number;
  paid_amount: number;
  change_amount: number;
  payment_method: 'cash' | 'prepaid';
  status: 'completed' | 'canceled';
  created_by_role: 'admin' | 'owner';
  created_at: string;
  canceled_at: string | null;
};

export async function listStock(db: D1Database): Promise<ProductRow[]> {
  const rows = await db
    .prepare(
      `SELECT p.id, p.display_name, i.current_stock, p.initial_stock
       FROM products p
       JOIN product_inventory i ON i.product_id = p.id
       ORDER BY p.sort_order ASC, p.created_at ASC`,
    )
    .all();
  return (rows.results ?? []) as ProductRow[];
}

export async function listStockHistory(
  db: D1Database,
  options: { limit?: number; query?: string } = {},
): Promise<StockEventRow[]> {
  const rows = await db
    .prepare(
      `SELECT se.id, se.product_id, p.display_name, se.event_type, se.quantity_delta,
              se.related_sale_id, se.reason, se.created_by_role, se.created_at
       FROM stock_events se
       JOIN products p ON p.id = se.product_id
       ORDER BY se.created_at DESC
       LIMIT ?`,
    )
    .bind(options.limit ?? 20)
    .all();
  const items = (rows.results ?? []) as StockEventRow[];
  const query = options.query?.trim().toLowerCase() ?? '';
  if (!query) {
    return items;
  }
  return items.filter((entry) =>
    [
      entry.id,
      entry.product_id,
      entry.display_name,
      entry.event_type,
      String(entry.quantity_delta),
      entry.related_sale_id ?? '',
      entry.reason,
      entry.created_by_role,
      entry.created_at,
    ]
      .join(' ')
      .toLowerCase()
      .includes(query),
  );
}

export async function recordStockEvent(
  db: D1Database,
  role: 'admin' | 'owner',
  input: StockEventInput,
): Promise<{ updatedAt: string }> {
  const now = new Date().toISOString();
  await db.batch([
    db.prepare(`UPDATE product_inventory SET current_stock = MAX(0, current_stock + ?), updated_at = ? WHERE product_id = ?`).bind(
      input.quantityDelta,
      now,
      input.productId,
    ),
    db.prepare(
      `INSERT INTO stock_events (id, product_id, event_type, quantity_delta, reason, created_by_role, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).bind(createId('stock_event'), input.productId, input.eventType, input.quantityDelta, input.reason ?? '', role, now),
  ]);
  return { updatedAt: now };
}

export async function cancelSale(
  db: D1Database,
  role: 'admin' | 'owner',
  saleId: string,
): Promise<
  | { ok: true; canceledAt: string }
  | { ok: false; status: 404; code: 'NOT_FOUND'; message: string }
  | { ok: false; status: 409; code: 'ALREADY_CANCELED'; message: string }
> {
  const saleRows = await db
    .prepare(
      `SELECT id, idempotency_key, sale_type, total_amount, paid_amount, change_amount,
              payment_method, status, created_by_role, created_at, canceled_at
       FROM sales WHERE id = ?`,
    )
    .bind(saleId)
    .all();
  const sale = ((saleRows.results ?? []) as SaleRow[])[0];
  if (!sale) {
    return { ok: false, status: 404, code: 'NOT_FOUND', message: '販売が見つかりません。' };
  }
  if (sale.status === 'canceled') {
    return { ok: false, status: 409, code: 'ALREADY_CANCELED', message: 'この販売はすでに取り消されています。' };
  }
  const items = await db
    .prepare(`SELECT sale_id, product_id, quantity FROM sale_items WHERE sale_id = ?`)
    .bind(saleId)
    .all<{ sale_id: string; product_id: string; quantity: number }>();
  const now = new Date().toISOString();
  await db.batch([
    db.prepare(`UPDATE sales SET status = 'canceled', canceled_at = ? WHERE id = ?`).bind(now, saleId),
    ...((items.results ?? []) as Array<{ sale_id: string; product_id: string; quantity: number }>).flatMap((item) => [
      db.prepare(
        `UPDATE product_inventory SET current_stock = current_stock + ?, updated_at = ? WHERE product_id = ?`,
      ).bind(item.quantity, now, item.product_id),
      db.prepare(
        `INSERT INTO stock_events (id, product_id, event_type, quantity_delta, related_sale_id, reason, created_by_role, created_at)
         VALUES (?, ?, 'cancel', ?, ?, ?, ?, ?)`,
      ).bind(createId('stock_event'), item.product_id, item.quantity, saleId, '販売取消', role, now),
    ]),
  ]);
  return { ok: true, canceledAt: now };
}
