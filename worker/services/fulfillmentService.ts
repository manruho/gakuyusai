import { createId } from '../../src/lib/ids';
import { normalizeSearchTerm } from './searchService';

export type FulfillmentStatus = 'pending' | 'delivered' | 'canceled';
export type FulfillmentActor = 'pickup' | 'admin' | 'owner' | 'staff';

export function getPickupSaleType(stationId: 1 | 2 | 3 | 4 | undefined): 'normal' | 'presale_pickup' | undefined {
  if (stationId === undefined) return undefined;
  return stationId === 4 ? 'presale_pickup' : 'normal';
}

export function resolvePickupOrderScope(options: {
  stationId?: 1 | 2 | 3 | 4;
  saleType?: 'normal' | 'presale_pickup';
  pickupDate?: string;
  pickupDateFrom?: string;
}) {
  return {
    saleType: options.stationId === undefined ? options.saleType : getPickupSaleType(options.stationId),
    pickupDate: options.pickupDate,
    pickupDateFrom: options.pickupDateFrom,
  };
}

export function getTokyoDate(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  const values = new Map(parts.map((part) => [part.type, part.value]));
  return `${values.get('year')}-${values.get('month')}-${values.get('day')}`;
}

export function isPickupAvailable(pickupDate: string, now = new Date()): boolean {
  return pickupDate <= getTokyoDate(now);
}

export type FulfillmentOrder = {
  id: string;
  sale_id: string;
  business_date: string;
  pickup_date: string;
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
  options: { stationId?: 1 | 2 | 3 | 4; saleId?: string; orderId?: string; includeDelivered?: boolean; query?: string; limit?: number; saleType?: 'normal' | 'presale_pickup'; pickupDate?: string; pickupDateFrom?: string } = {},
): Promise<FulfillmentOrder[]> {
  // 受取場所の種別はクライアント入力ではなく、対応する場所番号から決める。
  // 受取1〜3は当日販売、受取4だけが前売り券を扱う。
  const scope = resolvePickupOrderScope(options);
  const conditions = [options.stationId ? 'fo.station_id = ?' : '1 = 1'];
  const bindings: unknown[] = options.stationId ? [options.stationId] : [];
  if (options.saleId) { conditions.push('fo.sale_id = ?'); bindings.push(options.saleId); }
  if (options.orderId) { conditions.push('fo.id = ?'); bindings.push(options.orderId); }
  if (scope.saleType) { conditions.push('s.sale_type = ?'); bindings.push(scope.saleType); }
  if (scope.pickupDate) { conditions.push('fo.pickup_date = ?'); bindings.push(scope.pickupDate); }
  if (scope.pickupDateFrom) { conditions.push('fo.pickup_date >= ?'); bindings.push(scope.pickupDateFrom); }
  if (!options.includeDelivered) conditions.push("fo.status IN ('pending', 'canceled')");
  const query = normalizeSearchTerm(options.query);
  if (query) {
    conditions.push(`(
      LOWER(fo.pickup_code || ' ' || fo.sale_id || ' ' || fo.status || ' ' || fo.created_at || ' ' || CAST(fo.register_id AS TEXT)) LIKE ?
      OR EXISTS (
        SELECT 1 FROM sale_items searched_items
        JOIN products searched_products ON searched_products.id = searched_items.product_id
        WHERE searched_items.sale_id = fo.sale_id
          AND LOWER(searched_items.product_id || ' ' || searched_products.display_name) LIKE ?
      )
    )`);
    bindings.push(`%${query}%`, `%${query}%`);
  }
  const limit = options.limit ?? 100;
  const rows = await db
    .prepare(
      `SELECT fo.id, fo.sale_id, fo.business_date, COALESCE(fo.pickup_date, fo.business_date) AS pickup_date,
              fo.register_id, fo.station_id, fo.pickup_code,
              fo.status, fo.delivered_at, fo.delivered_by_username, fo.canceled_at,
              fo.cancel_acknowledged_at, fo.cancel_acknowledged_by_username,
              fo.created_at, fo.updated_at, s.total_amount
       FROM fulfillment_orders fo
       JOIN sales s ON s.id = fo.sale_id
       WHERE ${conditions.join(' AND ')}
       ORDER BY CASE WHEN fo.status = 'pending' THEN 0 WHEN fo.status = 'canceled' THEN 1 ELSE 2 END,
                fo.created_at DESC
       LIMIT ?`,
    )
    .bind(...bindings, limit)
    .all<OrderRow>();
  const orders = (rows.results ?? []) as OrderRow[];
  const itemRows: Array<{ sale_id: string; product_id: string; product_name: string; quantity: number }> = [];
  // D1 allows at most 100 bound parameters per statement. Keep a margin so
  // this remains safe if the query gains another bound value later.
  for (let offset = 0; offset < orders.length; offset += 80) {
    const chunk = orders.slice(offset, offset + 80);
    const itemsRows = await db
      .prepare(
        `SELECT fo.sale_id, si.product_id, p.display_name AS product_name, si.quantity
         FROM fulfillment_orders fo
         JOIN sale_items si ON si.sale_id = fo.sale_id
         JOIN products p ON p.id = si.product_id
         WHERE fo.sale_id IN (${chunk.map(() => '?').join(',') || "''"})`,
      )
      .bind(...chunk.map((order) => order.sale_id))
      .all<{ sale_id: string; product_id: string; product_name: string; quantity: number }>();
    itemRows.push(...((itemsRows.results ?? []) as Array<{ sale_id: string; product_id: string; product_name: string; quantity: number }>));
  }
  const grouped = parseItems(itemRows);
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
  const results = await db.batch([
    db.prepare(
      `UPDATE fulfillment_orders
       SET status = ?,
           delivered_at = CASE WHEN ? = 'delivered' THEN ? WHEN ? = 'pending' THEN NULL ELSE delivered_at END,
           delivered_by_username = CASE WHEN ? = 'delivered' THEN ? WHEN ? = 'pending' THEN NULL ELSE delivered_by_username END,
           updated_at = ?
       WHERE id = ? AND status = ?`,
    ).bind(to, to, now, to, to, username, to, now, orderId, from),
    db.prepare(
      `INSERT INTO fulfillment_events (id, fulfillment_order_id, event_type, from_status, to_status, actor_role, actor_username, created_at)
       SELECT ?, id, ?, ?, ?, ?, ?, ?
       FROM fulfillment_orders
       WHERE id = ? AND status = ? AND updated_at = ?`,
    ).bind(createId('fulfillment_event'), eventType, from, to, actorRole, username, now, orderId, to, now),
  ]) as Array<{ meta?: { changes?: number } }>;
  const result = results[0];
  if ((result.meta?.changes ?? 0) === 0) {
    const exists = await db.prepare('SELECT id FROM fulfillment_orders WHERE id = ?').bind(orderId).all();
    return (exists.results ?? []).length ? { ok: false, code: 'STATUS_CONFLICT', message: '注文状態が別の端末で変更されています。' } : { ok: false, code: 'ORDER_NOT_FOUND', message: '受取注文が見つかりません。' };
  }
  return { ok: true, updatedAt: now };
}

export async function deliverOrder(db: D1Database, orderId: string, role: 'pickup' | 'admin' | 'owner', username: string) {
  const row = await db.prepare(
    'SELECT COALESCE(pickup_date, business_date) AS pickup_date FROM fulfillment_orders WHERE id = ?',
  ).bind(orderId).first<{ pickup_date: string }>();
  if (!row) return { ok: false as const, code: 'ORDER_NOT_FOUND' as const, message: '受取注文が見つかりません。' };
  if (!isPickupAvailable(row.pickup_date)) {
    return { ok: false as const, code: 'PICKUP_NOT_READY' as const, message: `この前売り券は${row.pickup_date}から受取できます。` };
  }
  return transition(db, orderId, 'pending', 'delivered', role, username, 'delivered');
}

export function restoreOrder(db: D1Database, orderId: string, role: 'pickup' | 'admin' | 'owner', username: string) {
  return transition(db, orderId, 'delivered', 'pending', role, username, 'restored');
}

export async function acknowledgeCancellation(db: D1Database, orderId: string, role: 'pickup' | 'admin' | 'owner', username: string) {
  const now = new Date().toISOString();
  const results = await db.batch([
    db.prepare(
      `UPDATE fulfillment_orders
       SET cancel_acknowledged_at = ?, cancel_acknowledged_by_username = ?, updated_at = ?
       WHERE id = ? AND status = 'canceled' AND cancel_acknowledged_at IS NULL`,
    ).bind(now, username, now, orderId),
    db.prepare(
      `INSERT INTO fulfillment_events (id, fulfillment_order_id, event_type, from_status, to_status, actor_role, actor_username, created_at)
       SELECT ?, id, 'cancel_acknowledged', 'canceled', 'canceled', ?, ?, ?
       FROM fulfillment_orders
       WHERE id = ? AND status = 'canceled' AND cancel_acknowledged_at = ? AND updated_at = ?`,
    ).bind(createId('fulfillment_event'), role, username, now, orderId, now, now),
  ]) as Array<{ meta?: { changes?: number } }>;
  const result = results[0];
  if ((result.meta?.changes ?? 0) === 0) {
    const exists = await db.prepare('SELECT id, status FROM fulfillment_orders WHERE id = ?').bind(orderId).all<{ id: string; status: FulfillmentStatus }>();
    if (!(exists.results ?? []).length) return { ok: false as const, code: 'ORDER_NOT_FOUND', message: '受取注文が見つかりません。' };
    return { ok: false as const, code: 'STATUS_CONFLICT', message: '取消確認済み、または注文状態が不正です。' };
  }
  return { ok: true as const, updatedAt: now };
}

export async function getFulfillmentSummary(db: D1Database) {
  const rows = await db.prepare(
    `SELECT station_id,
            SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending,
            SUM(CASE WHEN status = 'delivered' THEN 1 ELSE 0 END) AS delivered,
            SUM(CASE WHEN status = 'canceled' THEN 1 ELSE 0 END) AS canceled,
            SUM(CASE WHEN status = 'canceled' AND cancel_acknowledged_at IS NULL THEN 1 ELSE 0 END) AS unacknowledged_canceled
     FROM fulfillment_orders
     GROUP BY station_id`,
  ).all<{ station_id: number; pending: number; delivered: number; canceled: number; unacknowledged_canceled: number }>();
  const byStation = new Map(((rows.results ?? []) as Array<{ station_id: number; pending: number; delivered: number; canceled: number; unacknowledged_canceled: number }>).map((row) => [row.station_id, row]));
  const stations = [1, 2, 3, 4].map((stationId) => {
    const row = byStation.get(stationId);
    return { stationId, pending: row?.pending ?? 0, delivered: row?.delivered ?? 0, canceled: row?.canceled ?? 0 };
  });
  return {
    byStation: stations,
    pending: stations.reduce((sum, station) => sum + station.pending, 0),
    unacknowledgedCanceled: ((rows.results ?? []) as Array<{ unacknowledged_canceled: number }>).reduce((sum, row) => sum + (row.unacknowledged_canceled ?? 0), 0),
  };
}

export async function listRecentSalesForRegister(db: D1Database, registerId: 1 | 2 | 3 | 4, limit = 20) {
  const rows = await db.prepare(
    `SELECT s.id, s.created_at, s.total_amount, s.paid_amount, s.change_amount, s.status, s.sale_type,
            s.register_id, fo.pickup_code, fo.status AS fulfillment_status
     FROM sales s JOIN fulfillment_orders fo ON fo.sale_id = s.id
     WHERE s.register_id = ? ORDER BY s.created_at DESC LIMIT ?`,
  ).bind(registerId, Math.max(1, Math.min(limit, 100))).all<{
    id: string; created_at: string; total_amount: number; paid_amount: number; change_amount: number;
    status: 'completed' | 'canceled'; sale_type: 'normal' | 'presale_pickup'; register_id: number; pickup_code: string; fulfillment_status: FulfillmentStatus;
  }>();
  const sales = (rows.results ?? []) as Array<{ id: string; created_at: string; total_amount: number; paid_amount: number; change_amount: number; status: 'completed' | 'canceled'; sale_type: 'normal' | 'presale_pickup'; register_id: number; pickup_code: string; fulfillment_status: FulfillmentStatus }>;
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
