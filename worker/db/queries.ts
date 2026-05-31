export type ProductRow = {
  id: string;
  name: string;
  display_name: string;
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
};

type SettingRow = { key: string; value: string };

export async function queryProducts(db: D1Database, onlyPublic = false): Promise<ProductRow[]> {
  const where = onlyPublic ? 'WHERE p.is_public = 1 AND p.is_active = 1' : '';
  const rows = await db.prepare(
    `SELECT p.id, p.name, p.display_name, p.price, p.initial_stock, i.current_stock,
            p.is_public, p.is_active, p.sort_order, p.allergy_text, p.description, p.note,
            p.created_at, p.updated_at
     FROM products p
     JOIN product_inventory i ON i.product_id = p.id
     ${where}
     ORDER BY p.sort_order ASC, p.created_at ASC`,
  ).all();
  return (rows.results ?? []) as ProductRow[];
}

export async function getSettings(db: D1Database): Promise<Record<string, string>> {
  const rows = await db.prepare('SELECT key, value FROM settings').all();
  return Object.fromEntries(((rows.results ?? []) as SettingRow[]).map((row) => [row.key, row.value]));
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
    created_by_role: 'admin' | 'owner';
    created_at: string;
    canceled_at: string | null;
  }>
> {
  const rows = await db
    .prepare(
      `SELECT id, idempotency_key, sale_type, total_amount, paid_amount, change_amount,
              payment_method, status, created_by_role, created_at, canceled_at
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
    created_by_role: 'admin' | 'owner';
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
    created_by_role: 'admin' | 'owner';
    created_at: string;
    canceled_at: string | null;
  }>
> {
  const query = filter.query?.trim().toLowerCase() ?? '';
  const limit = filter.limit ?? 100;
  const rows = await db
    .prepare(
      `SELECT s.id, s.idempotency_key, s.sale_type, s.total_amount, s.paid_amount, s.change_amount,
              s.payment_method, s.status, s.created_by_role, s.created_at, s.canceled_at,
              GROUP_CONCAT(si.product_id, ' ') AS product_ids
       FROM sales s
       LEFT JOIN sale_items si ON si.sale_id = s.id
       GROUP BY s.id
       ORDER BY s.created_at DESC
       LIMIT ?`,
    )
    .bind(limit)
    .all();

  const sales = (rows.results ?? []) as Array<
    {
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
      product_ids?: string | null;
    }
  >;

  if (!query) {
    return sales.map(({ product_ids: _productIds, ...sale }) => sale);
  }

  return sales
    .filter((sale) => {
      const haystack = [
        sale.id,
        sale.idempotency_key,
        sale.sale_type,
        sale.status,
        sale.created_by_role,
        sale.created_at,
        sale.canceled_at ?? '',
        sale.product_ids ?? '',
      ]
        .join(' ')
        .toLowerCase();
      return haystack.includes(query);
    })
    .map(({ product_ids: _productIds, ...sale }) => sale);
}
