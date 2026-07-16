import { createId } from '../../src/lib/ids';

export type FulfillmentStatus = 'pending' | 'delivered' | 'canceled';
export type FulfillmentActor = 'pickup' | 'admin' | 'owner' | 'staff';

export type FulfillmentOrder = {
  id: string;
  sale_id: string;
  business_date: string;
  register_id: 1 | 2 | 3 | 4;
  station_id: 1 | 2 | 3 | 4;
  pickup_code: string;
  status: FulfillmentStatus;
  delivered_at: string | null;
  delivered_by_username: string | null;
  canceled_at: string | null;
  cancel_acknowledged_at: string | null;
  cancel_acknowledged_by_username: string | null;
  created_at: string;
  updated_at: string;
  total_amount: number;
  items: Array<{ product_id: string; product_name: string; quantity: number }>;
};

type OrderRow = Omit<FulfillmentOrder, 'items'>;

function parseItems(rows: Array<{ sale_id: string; product_id: string; product_name: string; quantity: number }>) {
  const grouped = new Map<string, Array<{ product_id: string; product_name: string; quantity: number }>>();
  for (const row of rows) {
    const items = grouped.get(row.sale_id) ?? [];
    items.push({ product_id: row.product_id, product_name: row.product_name, quantity: row.quantity });
    grouped.set(row.sale_id, items);
  }
  return grouped;
}

export async function listFulfillmentOrders(
  db: D1Database,
  options: { stationId?: 1 | 2 | 3 | 4; saleId?: string; orderId?: string; includeDelivered?: boolean; query?: string; limit?: number } = {},
): Promise<FulfillmentOrder[]> {
  const conditions = [options.stationId ? 'fo.station_id = ?' : '1 = 1'];
  const bindings: unknown[] = options.stationId ? [options.stationId] : [];
  if (options.saleId) { conditions.push('fo.sale_id = ?'); bindings.push(options.saleId); }
  if (options.orderId) { conditions.push('fo.id = ?'); bindings.push(options.orderId); }
  if (!options.includeDelivered) conditions.push("fo.status IN ('pending', 'canceled')");
  const query = options.query?.trim().toLowerCase() ?? '';
  const rows = await db
    .prepare(
      `SELECT fo.id, fo.sale_id, fo.business_date, fo.register_id, fo.station_id, fo.pickup_code,
              fo.status, fo.delivered_at, fo.delivered_by_username, fo.canceled_at,
              fo.cancel_acknowledged_at, fo.cancel_acknowledged_by_username,
              fo.created_at, fo.updated_at, s.total_amount
       FROM fulfillment_orders fo
       JOIN sales s ON s.id = fo.sale_id
       WHERE ${conditions.join(' AND ')}
       ORDER BY CASE WHEN fo.status = 'pending' THEN 0 WHEN fo.status = 'canceled' THEN 1 ELSE 2 END,
                fo.created_at ASC
       LIMIT ?`,
    )
    .bind(...bindings, options.limit ?? 100)
    .all<OrderRow>();
  let orders = (rows.results ?? []) as OrderRow[];
  if (query) {
    orders = orders.filter((order) =>
      [order.pickup_code, order.sale_id, order.status, order.created_at, String(order.register_id)].join(' ').toLowerCase().includes(query),
    );
  }
  const itemsRows = await db
    .prepare(
      `SELECT fo.sale_id, si.product_id, p.display_name AS product_name, si.quantity
       FROM fulfillment_orders fo
       JOIN sale_items si ON si.sale_id = fo.sale_id
       JOIN products p ON p.id = si.product_id
       WHERE fo.sale_id IN (${orders.map(() => '?').join(',') || "''"})`,
    )
    .bind(...orders.map((order) => order.sale_id))
    .all<{ sale_id: string; product_id: string; product_name: string; quantity: number }>();
  const grouped = parseItems((itemsRows.results ?? []) as Array<{ sale_id: string; product_id: string; product_name: string; quantity: number }>);
  return orders.map((order) => ({ ...order, items: grouped.get(order.sale_id) ?? [] }));
}

export async function getFulfillmentOrderBySale(db: D1Database, saleId: string): Promise<FulfillmentOrder | null> {
  const orders = await listFulfillmentOrders(db, { includeDelivered: true, saleId, limit: 1 });
  return orders.find((order) => order.sale_id === saleId) ?? null;
}

export async function getFulfillmentOrderById(db: D1Database, orderId: string): Promise<FulfillmentOrder | null> {
  const orders = await listFulfillmentOrders(db, { includeDelivered: true, orderId, limit: 1 });
  return orders.find((order) => order.id === orderId) ?? null;
}

async function transition(
  db: D1Database,
  orderId: string,
  from: FulfillmentStatus,
  to: FulfillmentStatus,
  actorRole: FulfillmentActor,
  username: string,
  eventType: 'delivered' | 'restored' | 'cancel_acknowledged',
): Promise<{ ok: true; updatedAt: string } | { ok: false; code: 'ORDER_NOT_FOUND' | 'STATUS_CONFLICT'; message: string }> {
  const now = new Date().toISOString();
  const result = (await db
    .prepare(
      `UPDATE fulfillment_orders
       SET status = ?, delivered_at = CASE WHEN ? = 'delivered' THEN ? ELSE delivered_at END,
           delivered_by_username = CASE WHEN ? = 'delivered' THEN ? ELSE delivered_by_username END,
           updated_at = ?
       WHERE id = ? AND status = ?`,
    )
    .bind(to, to, now, to, username, now, orderId, from)
    .run()) as { meta?: { changes?: number } };
  if ((result.meta?.changes ?? 0) === 0) {
    const exists = await db.prepare('SELECT id FROM fulfillment_orders WHERE id = ?').bind(orderId).all();
    return (exists.results ?? []).length ? { ok: false, code: 'STATUS_CONFLICT', message: '注文状態が別の端末で変更されています。' } : { ok: false, code: 'ORDER_NOT_FOUND', message: '受取注文が見つかりません。' };
  }
  await db.prepare(
    `INSERT INTO fulfillment_events (id, fulfillment_order_id, event_type, from_status, to_status, actor_role, actor_username, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(createId('fulfillment_event'), orderId, eventType, from, to, actorRole, username, now).run();
  return { ok: true, updatedAt: now };
}

export function deliverOrder(db: D1Database, orderId: string, role: 'pickup' | 'admin' | 'owner', username: string) {
  return transition(db, orderId, 'pending', 'delivered', role, username, 'delivered');
}

export function restoreOrder(db: D1Database, orderId: string, role: 'pickup' | 'admin' | 'owner', username: string) {
  return transition(db, orderId, 'delivered', 'pending', role, username, 'restored');
}

export async function acknowledgeCancellation(db: D1Database, orderId: string, role: 'pickup' | 'admin' | 'owner', username: string) {
  const now = new Date().toISOString();
  const result = (await db.prepare(
    `UPDATE fulfillment_orders
     SET cancel_acknowledged_at = ?, cancel_acknowledged_by_username = ?, updated_at = ?
     WHERE id = ? AND status = 'canceled' AND cancel_acknowledged_at IS NULL`,
  ).bind(now, username, now, orderId).run()) as { meta?: { changes?: number } };
  if ((result.meta?.changes ?? 0) === 0) {
    const exists = await db.prepare('SELECT id, status FROM fulfillment_orders WHERE id = ?').bind(orderId).all<{ id: string; status: FulfillmentStatus }>();
    if (!(exists.results ?? []).length) return { ok: false as const, code: 'ORDER_NOT_FOUND', message: '受取注文が見つかりません。' };
    return { ok: false as const, code: 'STATUS_CONFLICT', message: '取消確認済み、または注文状態が不正です。' };
  }
  await db.prepare(
    `INSERT INTO fulfillment_events (id, fulfillment_order_id, event_type, from_status, to_status, actor_role, actor_username, created_at)
     VALUES (?, ?, 'cancel_acknowledged', 'canceled', 'canceled', ?, ?, ?)`,
  ).bind(createId('fulfillment_event'), orderId, role, username, now).run();
  return { ok: true as const, updatedAt: now };
}

export async function listRecentSalesForRegister(db: D1Database, registerId: 1 | 2 | 3 | 4, limit = 20) {
  const rows = await db.prepare(
    `SELECT s.id, s.created_at, s.total_amount, s.paid_amount, s.change_amount, s.status,
            s.register_id, fo.pickup_code, fo.status AS fulfillment_status
     FROM sales s JOIN fulfillment_orders fo ON fo.sale_id = s.id
     WHERE s.register_id = ? ORDER BY s.created_at DESC LIMIT ?`,
  ).bind(registerId, Math.max(1, Math.min(limit, 100))).all<{
    id: string; created_at: string; total_amount: number; paid_amount: number; change_amount: number;
    status: 'completed' | 'canceled'; register_id: number; pickup_code: string; fulfillment_status: FulfillmentStatus;
  }>();
  const sales = (rows.results ?? []) as Array<{ id: string; created_at: string; total_amount: number; paid_amount: number; change_amount: number; status: 'completed' | 'canceled'; register_id: number; pickup_code: string; fulfillment_status: FulfillmentStatus }>;
  const itemRows = await db.prepare(
    `SELECT si.sale_id, p.display_name AS product_name, si.quantity
     FROM sale_items si JOIN products p ON p.id = si.product_id
     WHERE si.sale_id IN (${sales.map(() => '?').join(',') || "''"})`,
  ).bind(...sales.map((sale) => sale.id)).all<{ sale_id: string; product_name: string; quantity: number }>();
  const grouped = new Map<string, Array<{ productName: string; quantity: number }>>();
  for (const row of (itemRows.results ?? []) as Array<{ sale_id: string; product_name: string; quantity: number }>) {
    const items = grouped.get(row.sale_id) ?? [];
    items.push({ productName: row.product_name, quantity: row.quantity });
    grouped.set(row.sale_id, items);
  }
  return sales.map((sale) => ({ ...sale, items: grouped.get(sale.id) ?? [] }));
}
