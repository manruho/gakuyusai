import { z } from "zod";
import { createId } from "../../src/lib/ids";

export const PICKUP_CODE_CHARS = '23479ACDEFHJKMNPQRTUVWXYZ';
const PICKUP_CODE_LENGTH = 4;

const saleItemSchema = z.object({
  productId: z.string().trim().min(1).max(100),
  quantity: z.number().int().positive(),
});

export const saleRequestSchema = z.object({
  idempotencyKey: z.string().trim().min(1).max(200),
  saleType: z.enum(["normal", "presale_pickup"]),
  paymentMethod: z.enum(["cash", "prepaid"]),
  paidAmount: z.number().int().nonnegative(),
  items: z.array(saleItemSchema).min(1).max(100).superRefine((items, context) => {
    const seen = new Set<string>();
    for (const [index, item] of items.entries()) {
      if (seen.has(item.productId)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: [index, 'productId'],
          message: '同じ商品を複数行に分けて指定できません。',
        });
      }
      seen.add(item.productId);
    }
  }),
});

export type SaleRequest = z.infer<typeof saleRequestSchema>;

export type SalesDay = 'all' | 'day1' | 'day2';

export function parseSalesDay(value: string | null | undefined): SalesDay {
  return value === 'day1' || value === 'day2' ? value : 'all';
}

type SaleError = {
  status: 400 | 403 | 404 | 409;
  code: string;
  message: string;
};

export function validateSalePayment(
  request: Pick<SaleRequest, "saleType" | "paymentMethod" | "paidAmount">,
  totalAmount: number,
): SaleError | null {
  if (
    (request.saleType === "normal" && request.paymentMethod !== "cash") ||
    (request.saleType === "presale_pickup" && request.paymentMethod !== "cash")
  ) {
    return {
      status: 400,
      code: "INVALID_PAYMENT",
      message: "支払い方法が販売種別と一致しません。",
    };
  }
  if (request.paidAmount < totalAmount) {
    return {
      status: 400,
      code: "INSUFFICIENT_PAYMENT",
      message: `預かり金額が不足しています。あと${totalAmount - request.paidAmount}円です。`,
    };
  }
  return null;
}

export function validatePresaleRegister(saleType: SaleRequest['saleType'], registerId: 1 | 2 | 3 | 4): SaleError | null {
  if (saleType === 'presale_pickup' && registerId !== 4) {
    return {
      status: 403,
      code: 'PRESALE_REGISTER_ONLY',
      message: '前売り券の販売はレジ4でのみ利用できます。',
    };
  }
  if (saleType === 'normal' && registerId === 4) {
    return {
      status: 403,
      code: 'REGISTER4_PRESALE_ONLY',
      message: 'レジ4は前売り券専用です。',
    };
  }
  return null;
}

export function validateSalesDay(salesDay: SalesDay, saleType: SaleRequest['saleType']): SaleError | null {
  if (salesDay === 'day1' && saleType !== 'presale_pickup') {
    return {
      status: 409,
      code: 'DAY1_PRESALE_ONLY',
      message: '1日目は前売り券の販売のみ受け付けています。',
    };
  }
  if (salesDay === 'day2' && saleType !== 'normal') {
    return {
      status: 409,
      code: 'DAY2_NORMAL_ONLY',
      message: '2日目は通常販売のみ受け付けています。',
    };
  }
  return null;
}

type SaleRecord = {
  id: string;
  idempotency_key: string;
  sale_type: "normal" | "presale_pickup";
  total_amount: number;
  paid_amount: number;
  change_amount: number;
  payment_method: "cash" | "prepaid";
  status: "completed" | "canceled";
  created_by_role: "staff" | "admin" | "owner";
  created_at: string;
  canceled_at: string | null;
  pickup_code?: string | null;
  register_id?: number;
};

type ProductRow = {
  id: string;
  display_name: string;
  price: number;
  current_stock: number;
};

type SaleLineItem = {
  product: ProductRow;
  quantity: number;
  subtotal: number;
};

function splitIntoChunks<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let offset = 0; offset < items.length; offset += size) {
    chunks.push(items.slice(offset, offset + size));
  }
  return chunks;
}

function buildSaleItemStatements(db: D1Database, saleId: string, items: SaleLineItem[]): D1PreparedStatement[] {
  // Six bindings per row; keep each statement below D1's 100-binding limit.
  return splitIntoChunks(items, 16).map((chunk) => db.prepare(
    `INSERT INTO sale_items (id, sale_id, product_id, quantity, unit_price, subtotal)
     VALUES ${chunk.map(() => '(?, ?, ?, ?, ?, ?)').join(', ')}`,
  ).bind(...chunk.flatMap((item) => [
    createId('sale_item'), saleId, item.product.id, item.quantity, item.product.price, item.subtotal,
  ])));
}

function buildInventoryUpdateStatements(db: D1Database, items: SaleLineItem[], now: string): D1PreparedStatement[] {
  // Three bindings per product (CASE id, quantity, and IN id).
  return splitIntoChunks(items, 33).map((chunk) => {
    const caseExpression = chunk.map(() => 'WHEN ? THEN ?').join(' ');
    return db.prepare(
      `UPDATE product_inventory
       SET current_stock = current_stock - CASE product_id ${caseExpression} ELSE 0 END,
           updated_at = ?
       WHERE product_id IN (${chunk.map(() => '?').join(', ')})`,
    ).bind(
      ...chunk.flatMap((item) => [item.product.id, item.quantity]),
      now,
      ...chunk.map((item) => item.product.id),
    );
  });
}

function buildStockEventStatements(
  db: D1Database,
  saleId: string,
  saleType: SaleRequest['saleType'],
  role: 'staff' | 'admin' | 'owner',
  items: SaleLineItem[],
  now: string,
): D1PreparedStatement[] {
  // Eight bindings per row; keep each statement below D1's 100-binding limit.
  return splitIntoChunks(items, 12).map((chunk) => db.prepare(
    `INSERT INTO stock_events (id, product_id, event_type, quantity_delta, related_sale_id, reason, created_by_role, created_at)
     VALUES ${chunk.map(() => '(?, ?, ?, ?, ?, ?, ?, ?)').join(', ')}`,
  ).bind(...chunk.flatMap((item) => [
    createId('stock_event'), item.product.id, saleType === 'normal' ? 'sale' : 'presale_pickup',
    -item.quantity, saleId, '', role, now,
  ])));
}

async function matchesIdempotencyRequest(
  db: D1Database,
  sale: SaleRecord,
  request: SaleRequest,
): Promise<boolean> {
  if (
    sale.sale_type !== request.saleType ||
    sale.payment_method !== request.paymentMethod ||
    sale.paid_amount !== request.paidAmount
  ) return false;

  const rows = await db
    .prepare('SELECT product_id, quantity FROM sale_items WHERE sale_id = ? ORDER BY product_id ASC')
    .bind(sale.id)
    .all<{ product_id: string; quantity: number }>();
  const stored = (rows.results ?? []) as Array<{ product_id: string; quantity: number }>;
  const requested = [...request.items].sort((left, right) => left.productId.localeCompare(right.productId));
  return stored.length === requested.length && stored.every((item, index) =>
    item.product_id === requested[index]?.productId && item.quantity === requested[index]?.quantity,
  );
}

export type SaleResult = {
  saleId: string;
  totalAmount: number;
  paidAmount: number;
  changeAmount: number;
  reused: boolean;
  pickupCode: string;
  registerId: 1 | 2 | 3 | 4;
  stationId: 1 | 2 | 3 | 4;
  createdAt: string;
  items: Array<{ productId: string; productName: string; quantity: number }>;
};

async function findSaleByIdempotencyKey(
  db: D1Database,
  idempotencyKey: string,
): Promise<SaleRecord | null> {
  const rows = await db
    .prepare(
      `SELECT s.id, s.idempotency_key, s.sale_type, s.total_amount, s.paid_amount, s.change_amount,
              s.payment_method, s.status, s.created_by_role, s.created_at, s.canceled_at,
              s.register_id, fo.pickup_code
       FROM sales s
       LEFT JOIN fulfillment_orders fo ON fo.sale_id = s.id
       WHERE s.idempotency_key = ?`,
    )
    .bind(idempotencyKey)
    .all();
  return ((rows.results ?? []) as SaleRecord[])[0] ?? null;
}

function reusedSaleResult(sale: SaleRecord): SaleResult {
  // 既存販売の注文情報は会計の再送でも必ず同じ値を返す。
  return {
    saleId: sale.id,
    totalAmount: sale.total_amount,
    paidAmount: sale.paid_amount,
    changeAmount: sale.change_amount,
    reused: true,
    pickupCode: sale.pickup_code ?? '',
    registerId: (sale.register_id ?? 1) as 1 | 2 | 3 | 4,
    stationId: (sale.register_id ?? 1) as 1 | 2 | 3 | 4,
    createdAt: sale.created_at,
    items: [],
  };
}

function getBusinessDate(offsetDays = 0): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const values = new Map(parts.map((part) => [part.type, part.value]));
  const date = new Date(Date.UTC(
    Number(values.get('year')),
    Number(values.get('month')) - 1,
    Number(values.get('day')) + offsetDays,
  ));
  return date.toISOString().slice(0, 10);
}

export function generatePickupCode(length = PICKUP_CODE_LENGTH): string {
  const values = new Uint32Array(length);
  crypto.getRandomValues(values);
  return Array.from(values, (value) => PICKUP_CODE_CHARS[value % PICKUP_CODE_CHARS.length]).join('');
}

export async function processSale(
  db: D1Database,
  role: "staff" | "admin" | "owner",
  registerId: 1 | 2 | 3 | 4,
  request: unknown,
  options: { salesDay?: SalesDay } = {},
): Promise<SaleResult | { error: SaleError }> {
  let idempotencyKey: string | null = null;
  try {
    const parsed = saleRequestSchema.safeParse(request);
    if (!parsed.success) {
      return {
        error: {
          status: 400,
          code: "INVALID_REQUEST",
          message: "販売内容が不正です。",
        },
      };
    }

    const body = parsed.data;
    const registerError = validatePresaleRegister(body.saleType, registerId);
    if (registerError) return { error: registerError };
    const salesDayError = validateSalesDay(options.salesDay ?? 'all', body.saleType);
    if (salesDayError) return { error: salesDayError };
    idempotencyKey = body.idempotencyKey;
    const existing = await findSaleByIdempotencyKey(db, body.idempotencyKey);
    if (existing) {
      if (!(await matchesIdempotencyRequest(db, existing, body))) {
        return {
          error: {
            status: 409,
            code: 'IDEMPOTENCY_KEY_REUSED',
            message: '同じ会計キーに別の注文内容を指定できません。新しい会計を開始してください。',
          },
        };
      }
      return reusedSaleResult(existing);
    }

    const productsRows = await db
      .prepare(
        `SELECT p.id, p.display_name, p.price, i.current_stock
         FROM products p
         JOIN product_inventory i ON i.product_id = p.id
         WHERE p.id IN (${body.items.map(() => "?").join(",")})
           AND p.is_active = 1
           AND p.deleted_at IS NULL`,
      )
      .bind(...body.items.map((item) => item.productId))
      .all();
    const products = (productsRows.results ?? []) as ProductRow[];
    const productMap = new Map(
      products.map((product) => [product.id, product]),
    );

    const lineItems = body.items.map((item) => {
      const product = productMap.get(item.productId);
      if (!product) {
        throw new Error("NOT_FOUND");
      }
      if (product.current_stock < item.quantity) {
        throw new Error("INSUFFICIENT_STOCK");
      }
      return {
        product,
        quantity: item.quantity,
        subtotal: product.price * item.quantity,
      };
    });

    const totalAmount = lineItems.reduce((sum, item) => sum + item.subtotal, 0);
    const paymentError = validateSalePayment(body, totalAmount);
    if (paymentError) return { error: paymentError };
    const changeAmount = Math.max(0, body.paidAmount - totalAmount);
    const saleId = createId("sale");
    const now = new Date().toISOString();
    const businessDate = getBusinessDate();
    const pickupDate = body.saleType === 'presale_pickup' ? getBusinessDate(1) : businessDate;
    let pickupCode = '';
    let committed = false;
    for (let attempt = 0; attempt < 10 && !committed; attempt += 1) {
      pickupCode = generatePickupCode(body.saleType === 'presale_pickup' ? 6 : PICKUP_CODE_LENGTH);
      try {
        await db.batch([
          db
            .prepare(
              `INSERT INTO sales (id, idempotency_key, sale_type, total_amount, paid_amount, change_amount, payment_method, status, created_by_role, created_at, register_id)
             VALUES (?, ?, ?, ?, ?, ?, ?, 'completed', ?, ?, ?)`,
            )
            .bind(
              saleId,
              body.idempotencyKey,
              body.saleType,
              totalAmount,
              body.paidAmount,
              changeAmount,
              body.paymentMethod,
              role,
              now,
              registerId,
            ),
          ...buildSaleItemStatements(db, saleId, lineItems),
          ...buildInventoryUpdateStatements(db, lineItems, now),
          ...buildStockEventStatements(db, saleId, body.saleType, role, lineItems, now),
          db.prepare(
            `INSERT INTO fulfillment_orders (id, sale_id, business_date, pickup_date, register_id, station_id, pickup_code, status, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
          ).bind(createId('fulfillment'), saleId, businessDate, pickupDate, registerId, registerId, pickupCode, now, now),
          db.prepare(
            `INSERT INTO fulfillment_events (id, fulfillment_order_id, event_type, from_status, to_status, actor_role, actor_username, created_at)
             SELECT ?, id, 'created', NULL, 'pending', ?, ?, ? FROM fulfillment_orders WHERE sale_id = ?`,
          ).bind(createId('fulfillment_event'), role, 'system', now, saleId),
        ]);
        committed = true;
      } catch (error) {
        if (error instanceof Error && /UNIQUE constraint failed:.*(pickup_code|idempotency_key)/i.test(error.message)) {
          const existing = await findSaleByIdempotencyKey(db, body.idempotencyKey);
          if (existing) {
            if (!(await matchesIdempotencyRequest(db, existing, body))) {
              return { error: { status: 409, code: 'IDEMPOTENCY_KEY_REUSED', message: '同じ会計キーに別の注文内容を指定できません。新しい会計を開始してください。' } };
            }
            return reusedSaleResult(existing);
          }
          continue;
        }
        throw error;
      }
    }
    if (!committed) {
      return { error: { status: 409, code: 'ORDER_CODE_CONFLICT', message: '注文番号を発行できませんでした。もう一度お試しください。' } };
    }

    return {
      saleId,
      totalAmount,
      paidAmount: body.paidAmount,
      changeAmount,
      reused: false,
      pickupCode,
      registerId,
      stationId: registerId,
      createdAt: now,
      items: lineItems.map((item) => ({
        productId: item.product.id,
        productName: item.product.display_name,
        quantity: item.quantity,
      })),
    };
  } catch (error) {
    if (
      idempotencyKey &&
      error instanceof Error &&
      /UNIQUE constraint failed:\s*sales\.idempotency_key/i.test(error.message)
    ) {
      const existing = await findSaleByIdempotencyKey(db, idempotencyKey);
      if (existing) {
        const parsed = saleRequestSchema.safeParse(request);
        if (parsed.success && await matchesIdempotencyRequest(db, existing, parsed.data)) return reusedSaleResult(existing);
        return { error: { status: 409, code: 'IDEMPOTENCY_KEY_REUSED', message: '同じ会計キーに別の注文内容を指定できません。新しい会計を開始してください。' } };
      }
    }
    if (error instanceof Error && (error.message === "INSUFFICIENT_STOCK" || /CHECK constraint failed:.*current_stock/i.test(error.message))) {
      return {
        error: {
          status: 409,
          code: "INSUFFICIENT_STOCK",
          message: "在庫が不足しています。",
        },
      };
    }
    if (error instanceof Error && error.message === "NOT_FOUND") {
      return {
        error: {
          status: 404,
          code: "NOT_FOUND",
          message: "商品が見つかりません。",
        },
      };
    }
    throw error;
  }
}
