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
  created_by_role: 'admin' | 'owner';
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
  created_by_role: 'admin' | 'owner';
  created_at: string;
};

function escapeCsvCell(value: string | number | null | undefined): string {
  const text = value == null ? '' : String(value);
  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

export function buildSalesCsv(rows: SaleRow[]): string {
  const lines = [
    'sale_id,sale_type,payment_method,status,total_amount,paid_amount,change_amount,created_by_role,created_at,canceled_at,product_id,product_name,quantity,unit_price,subtotal',
    ...rows.flatMap((sale) =>
      sale.items.map((item) =>
        [
          escapeCsvCell(sale.id),
          escapeCsvCell(sale.sale_type),
          escapeCsvCell(sale.payment_method),
          escapeCsvCell(sale.status),
          escapeCsvCell(sale.total_amount),
          escapeCsvCell(sale.paid_amount),
          escapeCsvCell(sale.change_amount),
          escapeCsvCell(sale.created_by_role),
          escapeCsvCell(sale.created_at),
          escapeCsvCell(sale.canceled_at ?? ''),
          escapeCsvCell(item.product_id),
          escapeCsvCell(item.product_name),
          escapeCsvCell(item.quantity),
          escapeCsvCell(item.unit_price),
          escapeCsvCell(item.subtotal),
        ].join(','),
      ),
    ),
  ];
  return `\ufeff${lines.join('\n')}`;
}

export function buildStockEventsCsv(rows: StockEventRow[]): string {
  return `\ufeff${[
    'event_id,product_id,product_name,event_type,quantity_delta,related_sale_id,reason,created_by_role,created_at',
    ...rows.map((event) =>
      [
        escapeCsvCell(event.id),
        escapeCsvCell(event.product_id),
        escapeCsvCell(event.display_name),
        escapeCsvCell(event.event_type),
        escapeCsvCell(event.quantity_delta),
        escapeCsvCell(event.related_sale_id ?? ''),
        escapeCsvCell(event.reason),
        escapeCsvCell(event.created_by_role),
        escapeCsvCell(event.created_at),
      ].join(','),
    ),
  ].join('\n')}`;
}
