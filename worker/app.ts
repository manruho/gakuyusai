import { Hono, type Context } from 'hono';
import { getStockLevelWithThresholds, getStockStatusText } from '../src/lib/stockLevel';
import { verifyPassword } from '../src/lib/password';
import { signSession, verifySession } from '../src/lib/session';
import { getSetting, getSettings, queryProducts, querySales, querySalesByFilter } from './db/queries';
import {
  buildLoginLockedMessage,
  getLoginThrottle,
  isLoginLocked,
  recordLoginFailure,
  resetLoginThrottle,
} from './services/authService';
import { processSale } from './services/saleService';
import { buildSalesCsv, buildStockEventsCsv } from './services/csvService';
import { cancelSale, listStock, listStockHistory, recordStockEvent } from './services/stockService';

type Env = {
  DB: D1Database;
  STAFF_USERNAME?: string;
  STAFF_PASSWORD_HASH?: string;
  ADMIN_USERNAME?: string;
  ADMIN_PASSWORD_HASH?: string;
  OWNER_USERNAME?: string;
  OWNER_PASSWORD_HASH?: string;
  SESSION_SECRET?: string;
  PUBLIC_SHOP_NAME?: string;
};
const app = new Hono<{ Bindings: Env }>();

async function requireSession(c: Context<{ Bindings: Env }>) {
  const cookie = c.req.header('Cookie') ?? '';
  const token = cookie.match(/(?:^|;\s*)session=([^;]+)/)?.[1];
  if (!token) return null;
  const session = await verifySession(decodeURIComponent(token), c.env.SESSION_SECRET ?? 'dev-secret');
  return session;
}

async function requireRole(c: Context<{ Bindings: Env }>, allowed: Array<'admin' | 'owner'>) {
  const session = await requireSession(c);
  if (!session || !allowed.includes(session.role)) {
    return null;
  }
  return session;
}

function buildSessionCookie(token: string, secure: boolean): string {
  const parts = [`session=${token}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=43200'];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

app.get('/api/health', (c) =>
  c.json({
    ok: true,
    data: { status: 'ok', time: new Date().toISOString() },
  }),
);

app.get('/api/schema', (c) =>
  c.json({
    ok: true,
    data: {
      tables: ['products', 'product_inventory', 'sales', 'sale_items', 'stock_events', 'settings', 'login_attempts'],
    },
  }),
);

app.get('/api/public/status', async (c) => {
  const products = await queryProducts(c.env.DB, true);
  const settings = await getSettings(c.env.DB);
  const shopName = c.env.PUBLIC_SHOP_NAME ?? settings.shop_name ?? '文化祭食品販売';
  const thresholds = {
    low: Number(settings.threshold_low ?? '0.15'),
    mid: Number(settings.threshold_mid ?? '0.35'),
    high: Number(settings.threshold_high ?? '0.65'),
  };
  const updatedAt = products[0]?.updated_at ?? new Date().toISOString();
  const response = c.json({
    ok: true,
    data: {
      shopName,
      updatedAt,
      isPublicEnabled: settings.public_status_enabled !== 'false',
      items: products.map((item) => {
        const statusLevel = getStockLevelWithThresholds(item.current_stock, item.initial_stock, thresholds);
        return {
          id: item.id,
          displayName: item.display_name,
          price: item.price,
          statusLevel,
          statusText: getStockStatusText(statusLevel),
          isSoldOut: item.current_stock <= 0,
          allergyText: item.allergy_text,
          note: item.note,
        };
      }),
    },
  });
  response.headers.set('Cache-Control', 'public, max-age=20, s-maxage=20');
  return response;
});

app.post('/api/auth/login', async (c) => {
  const body = await c.req.json<{ username: string; password: string }>();
  const staffUsername = (await getSetting(c.env.DB, 'staff_username')) ?? c.env.STAFF_USERNAME ?? 'staff';
  const staffPasswordHash = (await getSetting(c.env.DB, 'staff_password_hash')) ?? c.env.STAFF_PASSWORD_HASH ?? '';
  const adminUsername = (await getSetting(c.env.DB, 'admin_username')) ?? c.env.ADMIN_USERNAME ?? 'admin';
  const ownerUsername = (await getSetting(c.env.DB, 'owner_username')) ?? c.env.OWNER_USERNAME ?? 'owner';
  const staffPasswordHashFallback = staffPasswordHash;
  const adminPasswordHash = (await getSetting(c.env.DB, 'admin_password_hash')) ?? c.env.ADMIN_PASSWORD_HASH ?? '';
  const ownerPasswordHash = (await getSetting(c.env.DB, 'owner_password_hash')) ?? c.env.OWNER_PASSWORD_HASH ?? '';
  const ip = c.req.header('cf-connecting-ip') ?? c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? null;
  const throttle = await getLoginThrottle(c.env.DB, body.username, ip);
  if (isLoginLocked(throttle)) {
    return c.json(
      { ok: false, error: { code: 'LOGIN_LOCKED', message: buildLoginLockedMessage(throttle?.lockedUntil ?? null) } },
      429,
    );
  }
  const role = body.username === ownerUsername ? 'owner' : body.username === staffUsername || body.username === adminUsername ? 'admin' : null;
  const hash =
    body.username === ownerUsername
      ? ownerPasswordHash
      : body.username === staffUsername
        ? staffPasswordHashFallback
        : body.username === adminUsername
          ? adminPasswordHash
          : null;
  if (!role || !hash || !(await verifyPassword(body.password, hash))) {
    const failure = await recordLoginFailure(c.env.DB, body.username, ip);
    return c.json(
      {
        ok: false,
        error: {
          code: failure.lockedUntil ? 'LOGIN_LOCKED' : 'INVALID_CREDENTIALS',
          message: failure.lockedUntil ? buildLoginLockedMessage(failure.lockedUntil) : 'ユーザー名またはパスワードが違います。',
        },
      },
      failure.lockedUntil ? 429 : 401,
    );
  }
  await resetLoginThrottle(c.env.DB, body.username, ip);
  const token = await signSession(
    {
      role,
      username: body.username,
      exp: Date.now() + 12 * 60 * 60 * 1000,
    },
    c.env.SESSION_SECRET ?? 'dev-secret',
  );
  const response = c.json({ ok: true, data: { role } });
  response.headers.set('Set-Cookie', buildSessionCookie(token, new URL(c.req.url).protocol === 'https:'));
  return response;
});

app.get('/api/auth/me', async (c) => {
  const session = await requireSession(c);
  if (!session) return c.json({ ok: false, error: { code: 'UNAUTHORIZED', message: '未ログインです。' } }, 401);
  return c.json({ ok: true, data: session });
});

app.post('/api/auth/logout', (c) => {
  const response = c.json({ ok: true, data: { loggedOut: true } });
  response.headers.set('Set-Cookie', `session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${new URL(c.req.url).protocol === 'https:' ? '; Secure' : ''}`);
  return response;
});

app.get('/api/staff/register/products', async (c) => {
  const session = await requireRole(c, ['admin', 'owner']);
  if (!session) return c.json({ ok: false, error: { code: 'UNAUTHORIZED', message: '未ログインです。' } }, 401);
  const products = await queryProducts(c.env.DB);
  return c.json({
    ok: true,
    data: {
      items: products.map((item) => ({
        id: item.id,
        displayName: item.display_name,
        price: item.price,
        currentStock: item.current_stock,
        statusLevel: getStockLevelWithThresholds(item.current_stock, item.initial_stock),
        statusText: getStockStatusText(getStockLevelWithThresholds(item.current_stock, item.initial_stock)),
        isSoldOut: item.current_stock <= 0,
        isActive: item.is_active === 1,
      })),
    },
  });
});

app.get('/api/register/products', async (c) => {
  const session = await requireRole(c, ['admin', 'owner']);
  if (!session) return c.json({ ok: false, error: { code: 'UNAUTHORIZED', message: '未ログインです。' } }, 401);
  const products = await queryProducts(c.env.DB);
  return c.json({
    ok: true,
    data: {
      items: products.map((item) => ({
        id: item.id,
        displayName: item.display_name,
        price: item.price,
        currentStock: item.current_stock,
        statusLevel: getStockLevelWithThresholds(item.current_stock, item.initial_stock),
        statusText: getStockStatusText(getStockLevelWithThresholds(item.current_stock, item.initial_stock)),
        isSoldOut: item.current_stock <= 0,
        isActive: item.is_active === 1,
      })),
    },
  });
});

app.post('/api/staff/register/checkout', async (c) => {
  return handleSaleCheckout(c);
});

app.post('/api/sales', async (c) => {
  return handleSaleCheckout(c);
});

async function handleSaleCheckout(c: Context<{ Bindings: Env }>) {
  const session = await requireRole(c, ['admin', 'owner']);
  if (!session) return c.json({ ok: false, error: { code: 'UNAUTHORIZED', message: '未ログインです。' } }, 401);
  const result = await processSale(c.env.DB, session.role, await c.req.json());
  if ('error' in result) {
    return c.json(
      { ok: false, error: { code: result.error.code, message: result.error.message } },
      { status: result.error.status },
    );
  }
  return c.json({
    ok: true,
    data: {
      saleId: result.saleId,
      totalAmount: result.totalAmount,
      paidAmount: result.paidAmount,
      changeAmount: result.changeAmount,
    },
  });
}

app.get('/api/staff/stock', async (c) => {
  return handleStockList(c);
});

app.get('/api/stock', async (c) => {
  return handleStockList(c);
});

async function handleStockList(c: Context<{ Bindings: Env }>) {
  const session = await requireRole(c, ['admin', 'owner']);
  if (!session) return c.json({ ok: false, error: { code: 'UNAUTHORIZED', message: '未ログインです。' } }, 401);
  const products = await listStock(c.env.DB);
  return c.json({ ok: true, data: { items: products } });
}

app.post('/api/staff/stock/event', async (c) => {
  return handleStockEvent(c);
});

app.post('/api/stock/events', async (c) => {
  return handleStockEvent(c);
});

async function handleStockEvent(c: Context<{ Bindings: Env }>) {
  const session = await requireRole(c, ['admin', 'owner']);
  if (!session) return c.json({ ok: false, error: { code: 'UNAUTHORIZED', message: '未ログインです。' } }, 401);
  const body = await c.req.json<{ productId: string; quantityDelta: number; eventType: 'restock' | 'discard' | 'adjust'; reason?: string }>();
  const result = await recordStockEvent(c.env.DB, session.role, body);
  return c.json({ ok: true, data: result });
}

app.post('/api/sales/:saleId/cancel', async (c) => {
  const session = await requireRole(c, ['admin', 'owner']);
  if (!session) return c.json({ ok: false, error: { code: 'UNAUTHORIZED', message: '未ログインです。' } }, 401);
  const saleId = c.req.param('saleId');
  const result = await cancelSale(c.env.DB, session.role, saleId);
  if (!result.ok) {
    return c.json({ ok: false, error: { code: result.code, message: result.message } }, { status: result.status });
  }
  return c.json({ ok: true, data: { saleId, canceled: true, canceledAt: result.canceledAt } });
});

app.get('/api/staff/stock/history', async (c) => {
  const session = await requireRole(c, ['admin', 'owner']);
  if (!session) return c.json({ ok: false, error: { code: 'UNAUTHORIZED', message: '未ログインです。' } }, 401);
  const limit = Math.max(1, Math.min(Number(c.req.query('limit') ?? '20'), 100));
  const query = c.req.query('q') ?? '';
  const rows = await listStockHistory(c.env.DB, { limit, query });
  return c.json({
    ok: true,
    data: {
      items: rows,
    },
  });
});

app.get('/api/admin/products', async (c) => {
  const session = await requireRole(c, ['owner']);
  if (!session) return c.json({ ok: false, error: { code: 'UNAUTHORIZED', message: '未ログインです。' } }, 401);
  const products = await queryProducts(c.env.DB);
  return c.json({ ok: true, data: { items: products } });
});

app.get('/api/admin/settings', async (c) => {
  const session = await requireRole(c, ['owner']);
  if (!session) return c.json({ ok: false, error: { code: 'UNAUTHORIZED', message: '未ログインです。' } }, 401);
  const settings = await getSettings(c.env.DB);
  return c.json({ ok: true, data: { settings } });
});

app.post('/api/admin/products', async (c) => {
  const session = await requireRole(c, ['owner']);
  if (!session) return c.json({ ok: false, error: { code: 'UNAUTHORIZED', message: '未ログインです。' } }, 401);
  const body = await c.req.json<{
    id: string;
    name: string;
    displayName: string;
    price: number;
    initialStock: number;
    isPublic: boolean;
    isActive: boolean;
    sortOrder: number;
    allergyText: string;
    description: string;
    note: string;
  }>();
  const now = new Date().toISOString();
  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO products (id, name, display_name, price, initial_stock, is_public, is_active, sort_order, allergy_text, description, note, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         name=excluded.name,
         display_name=excluded.display_name,
         price=excluded.price,
         initial_stock=excluded.initial_stock,
         is_public=excluded.is_public,
         is_active=excluded.is_active,
         sort_order=excluded.sort_order,
         allergy_text=excluded.allergy_text,
         description=excluded.description,
         note=excluded.note,
         updated_at=excluded.updated_at`,
    ).bind(
      body.id,
      body.name,
      body.displayName,
      body.price,
      body.initialStock,
      body.isPublic ? 1 : 0,
      body.isActive ? 1 : 0,
      body.sortOrder,
      body.allergyText,
      body.description,
      body.note,
      now,
      now,
    ),
    c.env.DB.prepare(
      `INSERT INTO product_inventory (product_id, current_stock, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(product_id) DO UPDATE SET updated_at=excluded.updated_at`,
    ).bind(body.id, body.initialStock, now),
  ]);
  return c.json({ ok: true, data: { updatedAt: now } });
});

app.put('/api/admin/products/:id', async (c) => {
  const session = await requireRole(c, ['owner']);
  if (!session) return c.json({ ok: false, error: { code: 'UNAUTHORIZED', message: '未ログインです。' } }, 401);
  const id = c.req.param('id');
  const body = await c.req.json<{
    name: string;
    displayName: string;
    price: number;
    initialStock: number;
    isPublic: boolean;
    isActive: boolean;
    sortOrder: number;
    allergyText: string;
    description: string;
    note: string;
  }>();
  const now = new Date().toISOString();
  await c.env.DB.batch([
    c.env.DB.prepare(
      `UPDATE products SET
         name = ?,
         display_name = ?,
         price = ?,
         initial_stock = ?,
         is_public = ?,
         is_active = ?,
         sort_order = ?,
         allergy_text = ?,
         description = ?,
         note = ?,
         updated_at = ?
       WHERE id = ?`,
    ).bind(
      body.name,
      body.displayName,
      body.price,
      body.initialStock,
      body.isPublic ? 1 : 0,
      body.isActive ? 1 : 0,
      body.sortOrder,
      body.allergyText,
      body.description,
      body.note,
      now,
      id,
    ),
    c.env.DB.prepare(
      `UPDATE product_inventory SET updated_at = ? WHERE product_id = ?`,
    ).bind(now, id),
  ]);
  return c.json({ ok: true, data: { updatedAt: now } });
});

app.post('/api/admin/settings', async (c) => {
  const session = await requireRole(c, ['owner']);
  if (!session) return c.json({ ok: false, error: { code: 'UNAUTHORIZED', message: '未ログインです。' } }, 401);
  const body = await c.req.json<{ key: string; value: string }>();
  const now = new Date().toISOString();
  await c.env.DB.prepare(
    `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`,
  ).bind(body.key, body.value, now).run();
  return c.json({ ok: true, data: { updatedAt: now } });
});

app.put('/api/admin/settings', async (c) => {
  const session = await requireRole(c, ['owner']);
  if (!session) return c.json({ ok: false, error: { code: 'UNAUTHORIZED', message: '未ログインです。' } }, 401);
  const body = await c.req.json<Record<string, string>>();
  const now = new Date().toISOString();
  const entries = Object.entries(body);
  if (!entries.length) {
    return c.json({ ok: false, error: { code: 'INVALID_REQUEST', message: '設定が空です。' } }, 400);
  }
  await c.env.DB.batch(
    entries.map(([key, value]) =>
      c.env.DB
        .prepare(
          `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
           ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`,
        )
        .bind(key, value, now),
    ),
  );
  return c.json({ ok: true, data: { updatedAt: now } });
});

app.get('/api/admin/csv', async (c) => {
  const session = await requireRole(c, ['admin', 'owner']);
  if (!session) return c.text('unauthorized', 401);
  const products = await queryProducts(c.env.DB);
  const csv = ['id,name,display_name,price,current_stock']
    .concat(products.map((p) => [p.id, p.name, p.display_name, p.price, p.current_stock].join(',')))
    .join('\n');
  return c.text(csv, 200, { 'Content-Type': 'text/csv; charset=utf-8' });
});

app.get('/api/admin/summary', async (c) => {
  const session = await requireRole(c, ['admin', 'owner']);
  if (!session) return c.json({ ok: false, error: { code: 'UNAUTHORIZED', message: '未ログインです。' } }, 401);
  const sales = await querySales(c.env.DB);
  const products = await queryProducts(c.env.DB);
  const stockEvents = await listStockHistory(c.env.DB, { limit: 500 });
  const completedSales = sales.filter((sale) => sale.status === 'completed');
  const totalSales = completedSales.reduce((sum, sale) => sum + sale.total_amount, 0);
  const totalQuantity = stockEvents.filter((event) => event.event_type === 'sale' || event.event_type === 'presale_pickup').reduce((sum, event) => sum + Math.abs(event.quantity_delta), 0);
  return c.json({
    ok: true,
    data: {
      totalSales,
      completedSales: completedSales.length,
      totalProducts: products.length,
      totalQuantity,
    },
  });
});

app.get('/api/admin/sales', async (c) => {
  const session = await requireRole(c, ['admin', 'owner']);
  if (!session) return c.json({ ok: false, error: { code: 'UNAUTHORIZED', message: '未ログインです。' } }, 401);
  const query = c.req.query('q') ?? '';
  const limit = Math.max(1, Math.min(Number(c.req.query('limit') ?? '100'), 500));
  const sales = await querySalesByFilter(c.env.DB, { query, limit });
  const items = await c.env.DB
    .prepare(
      `SELECT sale_id, product_id, quantity, unit_price, subtotal FROM sale_items ORDER BY sale_id DESC, id ASC`,
    )
    .all<{ sale_id: string; product_id: string; quantity: number; unit_price: number; subtotal: number }>();
  const grouped = new Map<string, Array<{ product_id: string; quantity: number; unit_price: number; subtotal: number }>>();
  for (const row of (items.results ?? []) as Array<{ sale_id: string; product_id: string; quantity: number; unit_price: number; subtotal: number }>) {
    const list = grouped.get(row.sale_id) ?? [];
    list.push({ product_id: row.product_id, quantity: row.quantity, unit_price: row.unit_price, subtotal: row.subtotal });
    grouped.set(row.sale_id, list);
  }
  return c.json({
    ok: true,
    data: {
      items: sales.map((sale) => ({
        ...sale,
        items: grouped.get(sale.id) ?? [],
      })),
    },
  });
});

app.get('/api/admin/export/sales.csv', async (c) => {
  const session = await requireRole(c, ['admin', 'owner']);
  if (!session) return c.text('unauthorized', 401);
  const sales = await querySalesByFilter(c.env.DB, { limit: 1000 });
  const items = await c.env.DB
    .prepare(
      `SELECT si.sale_id, si.product_id, p.display_name, si.quantity, si.unit_price, si.subtotal
       FROM sale_items si
       JOIN products p ON p.id = si.product_id
       ORDER BY si.sale_id DESC, si.id ASC`,
    )
    .all<{ sale_id: string; product_id: string; display_name: string; quantity: number; unit_price: number; subtotal: number }>();
  const grouped = new Map<string, Array<{ product_id: string; product_name: string; quantity: number; unit_price: number; subtotal: number }>>();
  for (const row of (items.results ?? []) as Array<{ sale_id: string; product_id: string; display_name: string; quantity: number; unit_price: number; subtotal: number }>) {
    const list = grouped.get(row.sale_id) ?? [];
    list.push({ product_id: row.product_id, product_name: row.display_name, quantity: row.quantity, unit_price: row.unit_price, subtotal: row.subtotal });
    grouped.set(row.sale_id, list);
  }
  const csv = buildSalesCsv(
    sales.map((sale) => ({
      ...sale,
      items: grouped.get(sale.id) ?? [],
    })),
  );
  return c.text(csv, 200, { 'Content-Type': 'text/csv; charset=utf-8' });
});

app.get('/api/admin/export/stock-events.csv', async (c) => {
  const session = await requireRole(c, ['admin', 'owner']);
  if (!session) return c.text('unauthorized', 401);
  const events = await listStockHistory(c.env.DB, { limit: 1000 });
  const csv = buildStockEventsCsv(events);
  return c.text(csv, 200, { 'Content-Type': 'text/csv; charset=utf-8' });
});

export { app };
export default app;
