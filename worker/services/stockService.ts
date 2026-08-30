import { createId } from '../../src/lib/ids';
import { normalizeSearchTerm } from './searchService';
import { z } from 'zod';

export const stockEventSchema = z.object({
  productId: z.string().trim().min(1).max(100),
  quantityDelta: z.number().int().min(-1_000_000).max(1_000_000),
  eventType: z.enum(['restock', 'discard', 'adjust']),
  reason: z.string().trim().max(500).optional(),
}).superRefine((input, context) => {
  if (input.eventType === 'restock' && input.quantityDelta <= 0) {
    context.addIssue({ code: 'custom', path: ['quantityDelta'], message: '補充数は1以上にしてください。' });
  }
  if (input.eventType === 'discard' && input.quantityDelta >= 0) {
    context.addIssue({ code: 'custom', path: ['quantityDelta'], message: '廃棄数は1以上にしてください。' });
  }
});

export type StockEventInput = z.infer<typeof stockEventSchema>;

type ProductRow = {
  id: string;
  display_name: string;
  category: string;
  price: number;
  current_stock: number;
  initial_stock: number;
  sort_order: number;
  sold_quantity: number;
};

type StockEventRow = {
  id: string;
  product_id: string;
  display_name: string;
  event_type: string;
  quantity_delta: number;
  related_sale_id: string | null;
  reason: string;
  created_by_role: 'staff' | 'admin' | 'owner';
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
  created_by_role: 'staff' | 'admin' | 'owner';
  created_at: string;
  canceled_at: string | null;
  register_id: number;
};

export async function listStock(db: D1Database): Promise<ProductRow[]> {
  const rows = await db
    .prepare(
      `SELECT p.id, p.display_name, p.category, p.price, i.current_stock, p.initial_stock, p.sort_order,
              COALESCE((
                SELECT SUM(si.quantity)
                FROM sale_items si
                JOIN sales s ON s.id = si.sale_id
                WHERE si.product_id = p.id AND s.status = 'completed'
              ), 0) AS sold_quantity
       FROM products p
       JOIN product_inventory i ON i.product_id = p.id
       WHERE p.deleted_at IS NULL
       ORDER BY p.sort_order ASC, p.created_at ASC`,
    )
    .all();
  return (rows.results ?? []) as ProductRow[];
}

export async function listStockHistory(
  db: D1Database,
  options: { limit?: number; query?: string } = {},
): Promise<StockEventRow[]> {
  const query = normalizeSearchTerm(options.query);
  const where = query
    ? `WHERE LOWER(
         se.id || ' ' || se.product_id || ' ' || p.display_name || ' ' || se.event_type || ' ' ||
         CAST(se.quantity_delta AS TEXT) || ' ' || COALESCE(se.related_sale_id, '') || ' ' ||
         se.reason || ' ' || se.created_by_role || ' ' || se.created_at
       ) LIKE ?`
    : '';
  const rows = await db
    .prepare(
      `SELECT se.id, se.product_id, p.display_name, se.event_type, se.quantity_delta,
              se.related_sale_id, se.reason, se.created_by_role, se.created_at
       FROM stock_events se
       JOIN products p ON p.id = se.product_id
       ${where}
       ORDER BY se.created_at DESC
       ${options.limit === undefined ? '' : 'LIMIT ?'}`,
    )
    .bind(...(query ? [`%${query}%`] : []), ...(options.limit === undefined ? [] : [options.limit]))
    .all();
  return (rows.results ?? []) as StockEventRow[];
}

export async function recordStockEvent(
  db: D1Database,
  role: 'admin' | 'owner',
  input: StockEventInput,
): Promise<{ updatedAt: string }> {
  const now = new Date().toISOString();
  const products = await db.prepare(
    'SELECT product_id FROM product_inventory WHERE product_id = ?',
  ).bind(input.productId).all<{ product_id: string }>();
  if (!(products.results ?? []).length) {
    throw new Error('PRODUCT_NOT_FOUND');
  }
  await db.batch([
    db.prepare(`UPDATE product_inventory SET current_stock = current_stock + ?, updated_at = ? WHERE product_id = ?`).bind(
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
  role: 'staff' | 'admin' | 'owner',
  saleId: string,
  username = 'system',
  registerId?: 1 | 2 | 3 | 4,
  options: { reason?: string; restoreStock?: boolean } = {},
): Promise<
  | { ok: true; canceledAt: string; restoreStock: boolean }
  | { ok: false; status: 403 | 404 | 409; code: 'FORBIDDEN_REGISTER' | 'NOT_FOUND' | 'ALREADY_CANCELED' | 'INVALID_RESTORE' | 'PRESALE_NOT_CANCELLABLE'; message: string }
> {
  const saleRows = await db
    .prepare(
      `SELECT id, idempotency_key, sale_type, total_amount, paid_amount, change_amount,
              payment_method, status, created_by_role, created_at, canceled_at, register_id
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
  if (sale.sale_type === 'presale_pickup') {
    return { ok: false, status: 409, code: 'PRESALE_NOT_CANCELLABLE', message: '前売り券はキャンセルできません。' };
  }
  if (role === 'staff' && (!registerId || sale.register_id !== registerId)) {
    return { ok: false, status: 403, code: 'FORBIDDEN_REGISTER', message: '現在選択中のレジの販売だけを取り消せます。' };
  }
  const fulfillmentRows = await db.prepare(
    `SELECT id, status FROM fulfillment_orders WHERE sale_id = ?`,
  ).bind(saleId).all<{ id: string; status: 'pending' | 'delivered' | 'canceled' }>();
  const fulfillment = (fulfillmentRows.results ?? [])[0];
  const restoreStock = fulfillment?.status === 'delivered' ? options.restoreStock === true : true;
  if (fulfillment?.status === 'delivered' && options.restoreStock === undefined) {
    return { ok: false, status: 409, code: 'INVALID_RESTORE', message: '受渡済み注文は在庫を戻すか選択してください。' };
  }
  const items = await db
    .prepare(`SELECT sale_id, product_id, quantity FROM sale_items WHERE sale_id = ?`)
    .bind(saleId)
    .all<{ sale_id: string; product_id: string; quantity: number }>();
  const now = new Date().toISOString();
  try {
    await db.batch([
      db.prepare(
        `INSERT INTO sale_cancellations (sale_id, canceled_at, canceled_by_username)
         VALUES (?, ?, ?)`,
      ).bind(saleId, now, username),
      db.prepare(`UPDATE sales SET status = 'canceled', canceled_at = ?, cancel_reason = ?, cancel_restore_stock = ?, canceled_by_username = ? WHERE id = ? AND status = 'completed'`).bind(now, options.reason ?? '', restoreStock ? 1 : 0, username, saleId),
      ...(restoreStock ? ((items.results ?? []) as Array<{ sale_id: string; product_id: string; quantity: number }>).flatMap((item) => [
        db.prepare(
          `UPDATE product_inventory SET current_stock = current_stock + ?, updated_at = ? WHERE product_id = ?`,
        ).bind(item.quantity, now, item.product_id),
        db.prepare(
          `INSERT INTO stock_events (id, product_id, event_type, quantity_delta, related_sale_id, reason, created_by_role, created_at)
           VALUES (?, ?, 'cancel', ?, ?, ?, ?, ?)`,
        ).bind(createId('stock_event'), item.product_id, item.quantity, saleId, options.reason ?? '販売取消', role, now),
      ]) : []),
      ...(fulfillment ? [
        db.prepare(`UPDATE fulfillment_orders SET status = 'canceled', canceled_at = ?, updated_at = ? WHERE id = ?`).bind(now, now, fulfillment.id),
        db.prepare(
          `INSERT INTO fulfillment_events (id, fulfillment_order_id, event_type, from_status, to_status, actor_role, actor_username, reason, metadata_json, created_at)
           VALUES (?, ?, 'canceled', ?, 'canceled', ?, ?, ?, ?, ?)`,
        ).bind(createId('fulfillment_event'), fulfillment.id, fulfillment.status, role, username, options.reason ?? '', JSON.stringify({ restoreStock }), now),
      ] : []),
    ]);
  } catch (error) {
    if (error instanceof Error && /UNIQUE constraint failed:.*sale_cancellations\.sale_id/i.test(error.message)) {
      return { ok: false, status: 409, code: 'ALREADY_CANCELED', message: 'この販売はすでに取り消されています。' };
    }
    throw error;
  }
  return { ok: true, canceledAt: now, restoreStock };
}
