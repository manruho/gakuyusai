type SaleItemRow = {
  product_id: string;
  product_name: string;
  quantity: number;
  unit_price: number;
  subtotal: number;
};

type SaleRow = {
  id: string;
  sale_type: 'normal' | 'presale_pickup';
  total_amount: number;
  paid_amount: number;
  change_amount: number;
  payment_method: 'cash' | 'prepaid';
  status: 'completed' | 'canceled';
  created_by_role: 'staff' | 'admin' | 'owner';
  created_at: string;
  canceled_at: string | null;
  items: SaleItemRow[];
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

function escapeCsvCell(value: string | number | null | undefined): string {
  const text = value == null ? '' : String(value);
  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

type SalesCsvRow = Omit<SaleRow, 'items'> & SaleItemRow;

export const SALES_CSV_HEADER = 'sale_id,sale_type,payment_method,status,total_amount,paid_amount,change_amount,created_by_role,created_at,canceled_at,product_id,product_name,quantity,unit_price,subtotal';
export const STOCK_EVENTS_CSV_HEADER = 'event_id,product_id,product_name,event_type,quantity_delta,related_sale_id,reason,created_by_role,created_at';

export function salesCsvLine(row: SalesCsvRow): string {
  return [
    row.id,
    row.sale_type,
    row.payment_method,
    row.status,
    row.total_amount,
    row.paid_amount,
    row.change_amount,
    row.created_by_role,
    row.created_at,
    row.canceled_at,
    row.product_id,
    row.product_name,
    row.quantity,
    row.unit_price,
    row.subtotal,
  ].map(escapeCsvCell).join(',');
}

export function stockEventCsvLine(row: StockEventRow): string {
  return [
    row.id,
    row.product_id,
    row.display_name,
    row.event_type,
    row.quantity_delta,
    row.related_sale_id,
    row.reason,
    row.created_by_role,
    row.created_at,
  ].map(escapeCsvCell).join(',');
}

export async function listSalesCsvPage(db: D1Database, limit: number, offset: number): Promise<SalesCsvRow[]> {
  const rows = await db.prepare(
    `SELECT s.id, s.sale_type, s.total_amount, s.paid_amount, s.change_amount,
            s.payment_method, s.status, s.created_by_role, s.created_at, s.canceled_at,
            si.product_id, p.display_name AS product_name, si.quantity, si.unit_price, si.subtotal
     FROM sales s
     JOIN sale_items si ON si.sale_id = s.id
     JOIN products p ON p.id = si.product_id
     ORDER BY s.created_at DESC, s.id DESC, si.id ASC
     LIMIT ? OFFSET ?`,
  ).bind(limit, offset).all<SalesCsvRow>();
  return rows.results ?? [];
}

export async function listStockEventsCsvPage(db: D1Database, limit: number, offset: number): Promise<StockEventRow[]> {
  const rows = await db.prepare(
    `SELECT se.id, se.product_id, p.display_name, se.event_type, se.quantity_delta,
            se.related_sale_id, se.reason, se.created_by_role, se.created_at
     FROM stock_events se
     JOIN products p ON p.id = se.product_id
     ORDER BY se.created_at DESC, se.id DESC
     LIMIT ? OFFSET ?`,
  ).bind(limit, offset).all<StockEventRow>();
  return rows.results ?? [];
}

export function buildSalesCsv(rows: SaleRow[]): string {
  const lines = [
    SALES_CSV_HEADER,
    ...rows.flatMap((sale) =>
      sale.items.map((item) =>
        salesCsvLine({ ...sale, ...item }),
      ),
    ),
  ];
  return `\ufeff${lines.join('\n')}`;
}

export function buildStockEventsCsv(rows: StockEventRow[]): string {
  return `\ufeff${[
    STOCK_EVENTS_CSV_HEADER,
    ...rows.map(stockEventCsvLine),
  ].join('\n')}`;
}
