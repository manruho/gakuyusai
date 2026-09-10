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

export const NOON_RESTOCK_CONFIRMATION = 'APPLY_NOON_RESTOCK' as const;
export const NOON_RESTOCK_BATCH_KEY = 'official-noon-restock-v1';
export const NOON_RESTOCK_ITEMS = [
  { productId: 'onigiri_shio', displayName: '塩', quantity: 35 },
  { productId: 'onigiri_ume_official', displayName: '梅', quantity: 30 },
  { productId: 'onigiri_shiso_kombu', displayName: 'しそ昆布', quantity: 20 },
  { productId: 'onigiri_okaka_official', displayName: 'おかか', quantity: 30 },
  { productId: 'onigiri_tuna_mayo_official', displayName: 'ツナマヨ', quantity: 50 },
  { productId: 'onigiri_takana_chirimen', displayName: '高菜ちりめん', quantity: 10 },
  { productId: 'onigiri_tori_soboro', displayName: 'とりそぼろ', quantity: 15 },
  { productId: 'onigiri_teriyaki_chicken', displayName: '照り焼きチキン', quantity: 25 },
  { productId: 'onigiri_ebi_mayo', displayName: 'エビマヨ', quantity: 30 },
  { productId: 'onigiri_chanja', displayName: 'チャンじゃ', quantity: 30 },
  { productId: 'onigiri_yaki_tarako', displayName: '焼きたらこ', quantity: 40 },
  { productId: 'onigiri_kinira_nikumiso', displayName: '黄ニラ肉みそ', quantity: 35 },
  { productId: 'onigiri_karashi_mentaiko', displayName: '辛子明太', quantity: 50 },
  { productId: 'onigiri_sake_official', displayName: '鮭', quantity: 30 },
  { productId: 'onigiri_ebi_tenmusu', displayName: 'エビ天むす', quantity: 25 },
  { productId: 'onigiri_nibuta_chashu', displayName: '煮豚チャーシュー', quantity: 10 },
  { productId: 'side_karaage_official', displayName: '唐揚げ', quantity: 200 },
] as const;

export const NOON_RESTOCK_TOTAL_QUANTITY = NOON_RESTOCK_ITEMS.reduce(
  (total, item) => total + item.quantity,
  0,
);

type StockRestockBatchRow = {
  id: string;
  business_date: string;
  item_count: number;
  total_quantity: number;
  applied_by_role: 'admin' | 'owner';
  applied_by_username: string;
  applied_at: string;
};

export type NoonRestockStatus = {
  businessDate: string;
  applied: boolean;
  alreadyApplied: boolean;
  itemCount: number;
  totalQuantity: number;
  appliedAt: string | null;
  appliedByRole: 'admin' | 'owner' | null;
  appliedByUsername: string | null;
  items: Array<{ productId: string; displayName: string; quantity: number }>;
};

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

async function findNoonRestockBatch(
  db: D1Database,
  businessDate: string,
): Promise<StockRestockBatchRow | null> {
  return db.prepare(
    `SELECT id, business_date, item_count, total_quantity,
            applied_by_role, applied_by_username, applied_at
     FROM stock_restock_batches
     WHERE batch_key = ? AND business_date = ?`,
  ).bind(NOON_RESTOCK_BATCH_KEY, businessDate).first<StockRestockBatchRow>();
}

function toNoonRestockStatus(
  businessDate: string,
  batch: StockRestockBatchRow | null,
  alreadyApplied: boolean,
): NoonRestockStatus {
  return {
    businessDate,
    applied: batch !== null,
    alreadyApplied,
    itemCount: batch?.item_count ?? NOON_RESTOCK_ITEMS.length,
    totalQuantity: batch?.total_quantity ?? NOON_RESTOCK_TOTAL_QUANTITY,
    appliedAt: batch?.applied_at ?? null,
    appliedByRole: batch?.applied_by_role ?? null,
    appliedByUsername: batch?.applied_by_username ?? null,
    items: NOON_RESTOCK_ITEMS.map((item) => ({ ...item })),
  };
}

export async function getNoonRestockStatus(
  db: D1Database,
  businessDate: string,
): Promise<NoonRestockStatus> {
  return toNoonRestockStatus(businessDate, await findNoonRestockBatch(db, businessDate), false);
}

export async function applyNoonRestock(
  db: D1Database,
  role: 'admin' | 'owner',
  username: string,
  businessDate: string,
): Promise<NoonRestockStatus | { error: 'PRODUCTS_NOT_AVAILABLE'; missingProductIds: string[] }> {
  const existing = await findNoonRestockBatch(db, businessDate);
  if (existing) return toNoonRestockStatus(businessDate, existing, true);

  const productIds = NOON_RESTOCK_ITEMS.map((item) => item.productId);
  const placeholders = productIds.map(() => '?').join(',');
  const products = await db.prepare(
    `SELECT i.product_id
     FROM product_inventory i
     JOIN products p ON p.id = i.product_id
     WHERE i.product_id IN (${placeholders})
       AND p.is_active = 1
       AND p.deleted_at IS NULL`,
  ).bind(...productIds).all<{ product_id: string }>();
  const availableProductIds = new Set((products.results ?? []).map((row) => row.product_id));
  const missingProductIds = productIds.filter((productId) => !availableProductIds.has(productId));
  if (missingProductIds.length) return { error: 'PRODUCTS_NOT_AVAILABLE', missingProductIds };

  const now = new Date().toISOString();
  try {
    await db.batch([
      db.prepare(
        `INSERT INTO stock_restock_batches (
           id, batch_key, business_date, item_count, total_quantity,
           applied_by_role, applied_by_username, applied_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        createId('stock_restock_batch'),
        NOON_RESTOCK_BATCH_KEY,
        businessDate,
        NOON_RESTOCK_ITEMS.length,
        NOON_RESTOCK_TOTAL_QUANTITY,
        role,
        username,
        now,
      ),
      ...NOON_RESTOCK_ITEMS.flatMap((item) => [
        db.prepare(
          `UPDATE product_inventory
           SET current_stock = current_stock + ?, updated_at = ?
           WHERE product_id = ?`,
        ).bind(item.quantity, now, item.productId),
        db.prepare(
          `INSERT INTO stock_events (
             id, product_id, event_type, quantity_delta, reason, created_by_role, created_at
           ) VALUES (?, ?, 'restock', ?, ?, ?, ?)`,
        ).bind(
          createId('stock_event'),
          item.productId,
          item.quantity,
          `12時一括補充（${businessDate}）`,
          role,
          now,
        ),
      ]),
    ]);
  } catch (error) {
    if (error instanceof Error && /UNIQUE constraint failed:.*stock_restock_batches/i.test(error.message)) {
      const concurrentBatch = await findNoonRestockBatch(db, businessDate);
      if (concurrentBatch) return toNoonRestockStatus(businessDate, concurrentBatch, true);
    }
    throw error;
  }

  const applied = await findNoonRestockBatch(db, businessDate);
  if (!applied) throw new Error('NOON_RESTOCK_NOT_RECORDED');
  return toNoonRestockStatus(businessDate, applied, false);
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
