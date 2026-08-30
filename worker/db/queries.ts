import { normalizeSearchTerm } from '../services/searchService';

export type ProductRow = {
  id: string;
  name: string;
  display_name: string;
  category: string;
  price: number;
  initial_stock: number;
  current_stock: number;
  is_public: number;
  is_active: number;
  sort_order: number;
  allergy_text: string;
  description: string;
  note: string;
  created_at: string;
  updated_at: string;
  inventory_updated_at: string;
};

type SettingRow = { key: string; value: string; updated_at: string };

export async function queryProducts(db: D1Database, onlyPublic = false): Promise<ProductRow[]> {
  const where = onlyPublic ? 'WHERE p.is_public = 1 AND p.is_active = 1 AND p.deleted_at IS NULL' : 'WHERE p.deleted_at IS NULL';
  const rows = await db.prepare(
    `SELECT p.id, p.name, p.display_name, p.category, p.price, p.initial_stock, i.current_stock,
            p.is_public, p.is_active, p.sort_order, p.allergy_text, p.description, p.note,
            p.created_at, p.updated_at, i.updated_at AS inventory_updated_at
     FROM products p
     JOIN product_inventory i ON i.product_id = p.id
     ${where}
     ORDER BY p.sort_order ASC, p.created_at ASC`,
  ).all();
  return (rows.results ?? []) as ProductRow[];
}

export async function getSettings(db: D1Database): Promise<Record<string, string>> {
  return (await getSettingsSnapshot(db)).values;
}

export async function getSettingsSnapshot(
  db: D1Database,
  keys?: readonly string[],
): Promise<{ values: Record<string, string>; updatedAt: string | null }> {
  if (keys?.length === 0) return { values: {}, updatedAt: null };
  const rows = await db.prepare(
    `SELECT key, value, updated_at FROM settings${keys ? ` WHERE key IN (${keys.map(() => '?').join(',')})` : ''}`,
  ).bind(...(keys ?? [])).all<SettingRow>();
  const results = rows.results ?? [];
  return {
    values: Object.fromEntries(results.map((row) => [row.key, row.value])),
    updatedAt: results.reduce<string | null>((latest, row) => !latest || row.updated_at > latest ? row.updated_at : latest, null),
  };
}

export async function getSetting(db: D1Database, key: string): Promise<string | null> {
  const rows = await db.prepare('SELECT value FROM settings WHERE key = ?').bind(key).all<{ value: string }>();
  return ((rows.results ?? []) as Array<{ value: string }>)[0]?.value ?? null;
}

export async function querySales(db: D1Database): Promise<
  Array<{
    id: string;
    idempotency_key: string;
    sale_type: 'normal' | 'presale_pickup';
    total_amount: number;
    paid_amount: number;
    change_amount: number;
    payment_method: 'cash' | 'prepaid';
    status: 'completed' | 'canceled';
    created_by_role: 'staff' | 'admin' | 'owner';
    register_id: number;
    created_at: string;
    canceled_at: string | null;
  }>
> {
  const rows = await db
    .prepare(
      `SELECT id, idempotency_key, sale_type, total_amount, paid_amount, change_amount,
              payment_method, status, created_by_role, register_id, created_at, canceled_at
       FROM sales
       ORDER BY created_at DESC`,
    )
    .all();
  return (rows.results ?? []) as Array<{
    id: string;
    idempotency_key: string;
    sale_type: 'normal' | 'presale_pickup';
    total_amount: number;
    paid_amount: number;
    change_amount: number;
    payment_method: 'cash' | 'prepaid';
    status: 'completed' | 'canceled';
    created_by_role: 'staff' | 'admin' | 'owner';
    register_id: number;
    created_at: string;
    canceled_at: string | null;
  }>;
}

export async function querySalesByFilter(
  db: D1Database,
  filter: { query?: string; limit?: number } = {},
): Promise<
  Array<{
    id: string;
    idempotency_key: string;
    sale_type: 'normal' | 'presale_pickup';
    total_amount: number;
    paid_amount: number;
    change_amount: number;
    payment_method: 'cash' | 'prepaid';
    status: 'completed' | 'canceled';
    created_by_role: 'staff' | 'admin' | 'owner';
    register_id: number;
    created_at: string;
    canceled_at: string | null;
  }>
> {
  const query = normalizeSearchTerm(filter.query);
  const limit = filter.limit;
  const where = query
    ? `WHERE LOWER(
         s.id || ' ' || s.idempotency_key || ' ' || s.sale_type || ' ' || s.status || ' ' ||
         s.created_by_role || ' ' || s.created_at || ' ' || COALESCE(s.canceled_at, '')
       ) LIKE ?
       OR EXISTS (
         SELECT 1
         FROM sale_items searched_items
         JOIN products searched_products ON searched_products.id = searched_items.product_id
         WHERE searched_items.sale_id = s.id
           AND LOWER(searched_items.product_id || ' ' || searched_products.display_name) LIKE ?
       )`
    : '';
  const rows = await db
    .prepare(
      `SELECT s.id, s.idempotency_key, s.sale_type, s.total_amount, s.paid_amount, s.change_amount,
              s.payment_method, s.status, s.created_by_role, s.register_id, s.created_at, s.canceled_at
       FROM sales s
       ${where}
       ORDER BY s.created_at DESC
       ${limit === undefined ? '' : 'LIMIT ?'}`,
    )
    .bind(...(query ? [`%${query}%`, `%${query}%`] : []), ...(limit === undefined ? [] : [limit]))
    .all();

  return (rows.results ?? []) as Awaited<ReturnType<typeof querySales>>;
}

export async function queryAdminSummary(db: D1Database): Promise<{
  totalSales: number;
  completedSales: number;
  totalProducts: number;
  totalQuantity: number;
}> {
  const rows = await db.prepare(
    `SELECT
       COALESCE((SELECT SUM(total_amount) FROM sales WHERE status = 'completed'), 0) AS totalSales,
       (SELECT COUNT(*) FROM sales WHERE status = 'completed') AS completedSales,
       (SELECT COUNT(*) FROM products WHERE deleted_at IS NULL) AS totalProducts,
       COALESCE((
         SELECT SUM(si.quantity)
         FROM sale_items si
         JOIN sales s ON s.id = si.sale_id
         WHERE s.status = 'completed'
       ), 0) AS totalQuantity`,
  ).all<{
    totalSales: number;
    completedSales: number;
    totalProducts: number;
    totalQuantity: number;
  }>();
  return (rows.results ?? [])[0] ?? {
    totalSales: 0,
    completedSales: 0,
    totalProducts: 0,
    totalQuantity: 0,
  };
}
