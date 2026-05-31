import { z } from 'zod';
import { createId } from '../../src/lib/ids';

const saleItemSchema = z.object({
  productId: z.string().min(1),
  quantity: z.number().int().positive(),
});

export const saleRequestSchema = z.object({
  idempotencyKey: z.string().min(1),
  saleType: z.enum(['normal', 'presale_pickup']),
  paymentMethod: z.enum(['cash', 'prepaid']),
  paidAmount: z.number().int().nonnegative(),
  items: z.array(saleItemSchema).min(1),
});

export type SaleRequest = z.infer<typeof saleRequestSchema>;

type SaleRecord = {
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

type ProductRow = {
  id: string;
  price: number;
  current_stock: number;
};

export type SaleResult = {
  saleId: string;
  totalAmount: number;
  paidAmount: number;
  changeAmount: number;
  reused: boolean;
};

export async function processSale(
  db: D1Database,
  role: 'admin' | 'owner',
  request: unknown,
): Promise<SaleResult | { error: { status: 400 | 404 | 409; code: string; message: string } }> {
  try {
    const parsed = saleRequestSchema.safeParse(request);
    if (!parsed.success) {
      return { error: { status: 400, code: 'INVALID_REQUEST', message: '販売内容が不正です。' } };
    }

    const body = parsed.data;
    const existingRows = await db
      .prepare(
        `SELECT id, idempotency_key, sale_type, total_amount, paid_amount, change_amount,
                payment_method, status, created_by_role, created_at, canceled_at
         FROM sales
         WHERE idempotency_key = ?`,
      )
      .bind(body.idempotencyKey)
      .all();
    const existing = (existingRows.results ?? []) as SaleRecord[];
    if (existing.length) {
      const sale = existing[0];
      return {
        saleId: sale.id,
        totalAmount: sale.total_amount,
        paidAmount: sale.paid_amount,
        changeAmount: sale.change_amount,
        reused: true,
      };
    }

    const productsRows = await db
      .prepare(
        `SELECT id, price, current_stock
         FROM products p
         JOIN product_inventory i ON i.product_id = p.id
         WHERE p.id IN (${body.items.map(() => '?').join(',')})`,
      )
      .bind(...body.items.map((item) => item.productId))
      .all();
    const products = (productsRows.results ?? []) as ProductRow[];
    const productMap = new Map(products.map((product) => [product.id, product]));

    const lineItems = body.items.map((item) => {
      const product = productMap.get(item.productId);
      if (!product) {
        throw new Error('NOT_FOUND');
      }
      if (product.current_stock < item.quantity) {
        throw new Error('INSUFFICIENT_STOCK');
      }
      return {
        product,
        quantity: item.quantity,
        subtotal: product.price * item.quantity,
      };
    });

    const totalAmount = lineItems.reduce((sum, item) => sum + item.subtotal, 0);
    const changeAmount = Math.max(0, body.paidAmount - totalAmount);
    const saleId = createId('sale');
    const now = new Date().toISOString();

    await db.batch([
      db.prepare(
        `INSERT INTO sales (id, idempotency_key, sale_type, total_amount, paid_amount, change_amount, payment_method, status, created_by_role, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'completed', ?, ?)`,
      ).bind(saleId, body.idempotencyKey, body.saleType, totalAmount, body.paidAmount, changeAmount, body.paymentMethod, role, now),
      ...lineItems.flatMap((item) => [
        db.prepare(
          `INSERT INTO sale_items (id, sale_id, product_id, quantity, unit_price, subtotal)
           VALUES (?, ?, ?, ?, ?, ?)`,
        ).bind(createId('sale_item'), saleId, item.product.id, item.quantity, item.product.price, item.subtotal),
        db.prepare(`UPDATE product_inventory SET current_stock = current_stock - ?, updated_at = ? WHERE product_id = ?`).bind(
          item.quantity,
          now,
          item.product.id,
        ),
        db.prepare(
          `INSERT INTO stock_events (id, product_id, event_type, quantity_delta, related_sale_id, reason, created_by_role, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        ).bind(createId('stock_event'), item.product.id, body.saleType === 'normal' ? 'sale' : 'presale_pickup', -item.quantity, saleId, '', role, now),
      ]),
    ]);

    return {
      saleId,
      totalAmount,
      paidAmount: body.paidAmount,
      changeAmount,
      reused: false,
    };
  } catch (error) {
    if (error instanceof Error && error.message === 'INSUFFICIENT_STOCK') {
      return { error: { status: 409, code: 'INSUFFICIENT_STOCK', message: '在庫が不足しています。' } };
    }
    if (error instanceof Error && error.message === 'NOT_FOUND') {
      return { error: { status: 404, code: 'NOT_FOUND', message: '商品が見つかりません。' } };
    }
    throw error;
  }
}
