import { createId } from '../../src/lib/ids';
import { generatePickupCode, validateSalePayment } from './saleService';

const DRAFT_TTL_MS = 3 * 60 * 1000;

type DraftStatus = 'awaiting_payment' | 'completed' | 'canceled' | 'expired';
type DraftItem = { product_id: string; product_name: string; quantity: number; unit_price: number; subtotal: number };
export type CheckoutDraft = {
  id: string; idempotency_key: string; business_date: string; register_id: 1 | 2 | 3 | 4;
  station_id: 1 | 2 | 3 | 4; pickup_code: string; status: DraftStatus; total_amount: number;
  sale_id: string | null; expires_at: string; canceled_at: string | null; cancel_reason: string;
  cancel_acknowledged_at: string | null; created_at: string; updated_at: string; items: DraftItem[];
};

function businessDate(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

async function loadItems(db: D1Database, draftId: string): Promise<DraftItem[]> {
  const rows = await db.prepare(
    'SELECT product_id, product_name, quantity, unit_price, subtotal FROM checkout_draft_items WHERE draft_id = ? ORDER BY rowid',
  ).bind(draftId).all<DraftItem>();
  return (rows.results ?? []) as DraftItem[];
}

export async function getCheckoutDraft(db: D1Database, draftId: string): Promise<CheckoutDraft | null> {
  const row = await db.prepare('SELECT * FROM checkout_drafts WHERE id = ?').bind(draftId).first<Omit<CheckoutDraft, 'items'>>();
  return row ? { ...row, items: await loadItems(db, draftId) } : null;
}

export async function createCheckoutDraft(db: D1Database, input: {
  idempotencyKey: string; registerId: 1 | 2 | 3 | 4; stationId: 1 | 2 | 3 | 4;
  role: 'staff' | 'admin' | 'owner'; username: string; items: Array<{ productId: string; quantity: number }>;
}): Promise<CheckoutDraft> {
  const existing = await db.prepare('SELECT id FROM checkout_drafts WHERE idempotency_key = ?').bind(input.idempotencyKey).first<{ id: string }>();
  if (existing) {
    const draft = (await getCheckoutDraft(db, existing.id))!;
    const requested = [...input.items].sort((a, b) => a.productId.localeCompare(b.productId));
    const stored = draft.items.map((item) => ({ productId: item.product_id, quantity: item.quantity })).sort((a, b) => a.productId.localeCompare(b.productId));
    if (draft.register_id !== input.registerId || stored.length !== requested.length || stored.some((item, index) => item.productId !== requested[index]?.productId || item.quantity !== requested[index]?.quantity)) {
      throw new Error('IDEMPOTENCY_KEY_REUSED');
    }
    return draft;
  }
  const ids = [...new Set(input.items.map((item) => item.productId))];
  const rows = await db.prepare(
    `SELECT p.id, p.display_name, p.price FROM products p
     WHERE p.id IN (${ids.map(() => '?').join(',')}) AND p.is_active = 1 AND p.deleted_at IS NULL`,
  ).bind(...ids).all<{ id: string; display_name: string; price: number }>();
  const products = new Map((rows.results ?? []).map((row) => [row.id, row]));
  if (products.size !== ids.length) throw new Error('NOT_FOUND');
  const items = input.items.map((item) => {
    const product = products.get(item.productId)!;
    return { product_id: product.id, product_name: product.display_name, quantity: item.quantity, unit_price: product.price, subtotal: product.price * item.quantity };
  });
  const now = new Date();
  const draftId = createId('checkout_draft');
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const pickupCode = generatePickupCode();
    try {
      await db.batch([
        db.prepare(
          `INSERT INTO checkout_drafts
           (id, idempotency_key, business_date, register_id, station_id, sale_type, pickup_code, status,
            total_amount, expires_at, created_by_role, created_by_username, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, 'normal', ?, 'awaiting_payment', ?, ?, ?, ?, ?, ?)`,
        ).bind(draftId, input.idempotencyKey, businessDate(now), input.registerId, input.stationId, pickupCode,
          items.reduce((sum, item) => sum + item.subtotal, 0), new Date(now.getTime() + DRAFT_TTL_MS).toISOString(),
          input.role, input.username, now.toISOString(), now.toISOString()),
        ...items.map((item) => db.prepare(
          `INSERT INTO checkout_draft_items (id, draft_id, product_id, product_name, quantity, unit_price, subtotal)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        ).bind(createId('checkout_draft_item'), draftId, item.product_id, item.product_name, item.quantity, item.unit_price, item.subtotal)),
        ...items.map((item) => db.prepare(
          `UPDATE product_inventory SET current_stock = current_stock - ?, updated_at = ? WHERE product_id = ?`,
        ).bind(item.quantity, now.toISOString(), item.product_id)),
      ]);
      return (await getCheckoutDraft(db, draftId))!;
    } catch (error) {
      if (error instanceof Error && /pickup_code/i.test(error.message)) continue;
      throw error;
    }
  }
  throw new Error('ORDER_CODE_CONFLICT');
}

export async function expireCheckoutDrafts(db: D1Database, now = new Date()): Promise<CheckoutDraft[]> {
  const rows = await db.prepare(
    `SELECT id FROM checkout_drafts WHERE status = 'awaiting_payment' AND expires_at <= ?`,
  ).bind(now.toISOString()).all<{ id: string }>();
  const expired: CheckoutDraft[] = [];
  for (const row of rows.results ?? []) {
    const timestamp = now.toISOString();
    const results = await db.batch([
      db.prepare(
        `UPDATE checkout_drafts SET status = 'expired', canceled_at = ?, cancel_reason = '会計待ち時間切れ', updated_at = ?
         WHERE id = ? AND status = 'awaiting_payment' AND expires_at <= ?`,
      ).bind(timestamp, timestamp, row.id, timestamp),
      db.prepare(
        `UPDATE product_inventory SET current_stock = current_stock + COALESCE((
           SELECT quantity FROM checkout_draft_items cdi JOIN checkout_drafts cd ON cd.id = cdi.draft_id
           WHERE cdi.product_id = product_inventory.product_id AND cd.id = ? AND cd.status = 'expired' AND cd.updated_at = ?
         ), 0), updated_at = ?
         WHERE product_id IN (SELECT product_id FROM checkout_draft_items WHERE draft_id = ?)`,
      ).bind(row.id, timestamp, timestamp, row.id),
    ]) as Array<{ meta?: { changes?: number } }>;
    if ((results[0]?.meta?.changes ?? 0) > 0) {
      const draft = await getCheckoutDraft(db, row.id);
      if (draft) expired.push(draft);
    }
  }
  return expired;
}

export async function cancelCheckoutDraft(db: D1Database, draftId: string, reason = 'レジで取消'): Promise<CheckoutDraft | null> {
  const now = new Date().toISOString();
  await db.batch([
    db.prepare(
      `UPDATE checkout_drafts SET status = 'canceled', canceled_at = ?, cancel_reason = ?, updated_at = ?
       WHERE id = ? AND status = 'awaiting_payment'`,
    ).bind(now, reason, now, draftId),
    db.prepare(
      `UPDATE product_inventory SET current_stock = current_stock + COALESCE((
         SELECT quantity FROM checkout_draft_items cdi JOIN checkout_drafts cd ON cd.id = cdi.draft_id
         WHERE cdi.product_id = product_inventory.product_id AND cd.id = ? AND cd.status = 'canceled' AND cd.updated_at = ?
       ), 0), updated_at = ?
       WHERE product_id IN (SELECT product_id FROM checkout_draft_items WHERE draft_id = ?)`,
    ).bind(draftId, now, now, draftId),
  ]);
  return getCheckoutDraft(db, draftId);
}

export async function acknowledgeDraftCancellation(db: D1Database, draftId: string, username: string) {
  const now = new Date().toISOString();
  const result = await db.prepare(
    `UPDATE checkout_drafts SET cancel_acknowledged_at = ?, cancel_acknowledged_by_username = ?, updated_at = ?
     WHERE id = ? AND status IN ('canceled', 'expired') AND cancel_acknowledged_at IS NULL`,
  ).bind(now, username, now, draftId).run();
  return (result.meta.changes ?? 0) > 0;
}

export async function listCheckoutDrafts(db: D1Database, stationId: number, query = ''): Promise<CheckoutDraft[]> {
  const normalized = query.trim().toLowerCase();
  const rows = await db.prepare(
    `SELECT DISTINCT cd.* FROM checkout_drafts cd
     LEFT JOIN checkout_draft_items cdi ON cdi.draft_id = cd.id
     WHERE cd.station_id = ? AND cd.business_date = ?
       AND cd.status <> 'completed' AND cd.cancel_acknowledged_at IS NULL
       AND (? = '' OR LOWER(cd.pickup_code || ' ' || cdi.product_name) LIKE ?)
     ORDER BY cd.created_at DESC LIMIT 500`,
  ).bind(stationId, businessDate(), normalized, `%${normalized}%`).all<Omit<CheckoutDraft, 'items'>>();
  return Promise.all((rows.results ?? []).map(async (row) => ({ ...row, items: await loadItems(db, row.id) })));
}

export async function completeCheckoutDraft(db: D1Database, input: {
  draftId: string; paidAmount: number; paymentMethod: 'cash'; role: 'staff' | 'admin' | 'owner';
}) {
  await expireCheckoutDrafts(db);
  const draft = await getCheckoutDraft(db, input.draftId);
  if (!draft) return { error: { status: 404, code: 'DRAFT_NOT_FOUND', message: '会計待ち注文が見つかりません。' } } as const;
  if (draft.status === 'completed' && draft.sale_id) {
    const sale = await db.prepare('SELECT total_amount, paid_amount, change_amount, created_at FROM sales WHERE id = ?').bind(draft.sale_id).first<{ total_amount: number; paid_amount: number; change_amount: number; created_at: string }>();
    if (sale) return { draft, saleId: draft.sale_id, totalAmount: sale.total_amount, paidAmount: sale.paid_amount, changeAmount: sale.change_amount, createdAt: sale.created_at, reused: true } as const;
  }
  if (draft.status !== 'awaiting_payment') return { error: { status: 409, code: 'DRAFT_NOT_ACTIVE', message: 'この注文は取消または期限切れです。商品を選び直してください。' } } as const;
  const paymentError = validateSalePayment({ saleType: 'normal', paymentMethod: input.paymentMethod, paidAmount: input.paidAmount }, draft.total_amount);
  if (paymentError) return { error: paymentError } as const;
  const now = new Date().toISOString();
  const saleId = createId('sale');
  const changeAmount = input.paidAmount - draft.total_amount;
  await db.batch([
    db.prepare(`UPDATE checkout_drafts SET status = 'completed', updated_at = ? WHERE id = ? AND status = 'awaiting_payment' AND expires_at > ?`).bind(now, draft.id, now),
    db.prepare(`INSERT INTO sales (id, idempotency_key, sale_type, total_amount, paid_amount, change_amount, payment_method, status, created_by_role, created_at, register_id)
      SELECT ?, idempotency_key, 'normal', total_amount, ?, ?, 'cash', 'completed', ?, ?, register_id FROM checkout_drafts WHERE id = ? AND status = 'completed' AND sale_id IS NULL`)
      .bind(saleId, input.paidAmount, changeAmount, input.role, now, draft.id),
    db.prepare(`UPDATE checkout_drafts SET sale_id = ? WHERE id = ? AND status = 'completed' AND sale_id IS NULL`).bind(saleId, draft.id),
    ...draft.items.map((item) => db.prepare(`INSERT INTO sale_items (id, sale_id, product_id, quantity, unit_price, subtotal) VALUES (?, ?, ?, ?, ?, ?)`)
      .bind(createId('sale_item'), saleId, item.product_id, item.quantity, item.unit_price, item.subtotal)),
    ...draft.items.map((item) => db.prepare(`INSERT INTO stock_events (id, product_id, event_type, quantity_delta, related_sale_id, created_by_role, created_at) VALUES (?, ?, 'sale', ?, ?, ?, ?)`)
      .bind(createId('stock_event'), item.product_id, -item.quantity, saleId, input.role, now)),
    db.prepare(`INSERT INTO fulfillment_orders (id, sale_id, business_date, pickup_date, register_id, station_id, pickup_code, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`)
      .bind(draft.id, saleId, draft.business_date, draft.business_date, draft.register_id, draft.station_id, draft.pickup_code, draft.created_at, now),
    db.prepare(`INSERT INTO fulfillment_events (id, fulfillment_order_id, event_type, from_status, to_status, actor_role, actor_username, created_at)
      VALUES (?, ?, 'created', NULL, 'pending', ?, 'system', ?)`)
      .bind(createId('fulfillment_event'), draft.id, input.role, now),
  ]);
  return { draft: { ...draft, status: 'completed' as const, sale_id: saleId }, saleId, totalAmount: draft.total_amount, paidAmount: input.paidAmount, changeAmount, createdAt: now, reused: false } as const;
}
