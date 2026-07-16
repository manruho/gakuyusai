import { Hono, type Context } from 'hono';
import { getStockLevelWithThresholds, getStockStatusText } from '../src/lib/stockLevel';
import { verifyPassword } from '../src/lib/password';
import { signSession, verifySession } from '../src/lib/session';
import { buildSessionPayload } from './services/authService';
import { getSetting, getSettings, queryProducts, querySales, querySalesByFilter } from './db/queries';
import { buildLoginLockedMessage, getLoginThrottle, isLoginLocked, recordLoginFailure, resetLoginThrottle, shouldBypassStaffAuth } from './services/authService';
import { processSale } from './services/saleService';
import { buildSalesCsv, buildStockEventsCsv } from './services/csvService';
import { cancelSale, listStock, listStockHistory, recordStockEvent } from './services/stockService';
import { acknowledgeCancellation, deliverOrder, listFulfillmentOrders, listRecentSalesForRegister, restoreOrder } from './services/fulfillmentService';
import { getFulfillmentOrderBySale } from './services/fulfillmentService';
import { getFulfillmentOrderById } from './services/fulfillmentService';
import { getRealtimeConnectionCount, publishRealtimeEvent, type RealtimeEvent, RealtimeHub } from './realtimeHub';
import { createId } from '../src/lib/ids';

type Env = {
  DB: D1Database;
  STAFF_USERNAME?: string;
  STAFF_PASSWORD_HASH?: string;
  ADMIN_USERNAME?: string;
  ADMIN_PASSWORD_HASH?: string;
  OWNER_USERNAME?: string;
  OWNER_PASSWORD_HASH?: string;
  PICKUP_1_USERNAME?: string;
  PICKUP_1_PASSWORD_HASH?: string;
  PICKUP_2_USERNAME?: string;
  PICKUP_2_PASSWORD_HASH?: string;
  PICKUP_3_USERNAME?: string;
  PICKUP_3_PASSWORD_HASH?: string;
  PICKUP_4_USERNAME?: string;
  PICKUP_4_PASSWORD_HASH?: string;
  SESSION_SECRET?: string;
  PUBLIC_SHOP_NAME?: string;
  PREVIEW_AUTH_BYPASS?: string;
  CF_PAGES_BRANCH?: string;
  REALTIME_HUB?: DurableObjectNamespace<RealtimeHub>;
};
const app = new Hono<{ Bindings: Env }>();

async function requireSession(c: Context<{ Bindings: Env }>) {
  if (shouldBypassStaffAuth(c.env)) {
    return {
      role: 'staff' as const,
      username: 'preview-staff',
      registerId: 1 as const,
      exp: Date.now() + 12 * 60 * 60 * 1000,
    };
  }
  const cookie = c.req.header('Cookie') ?? '';
  const token = cookie.match(/(?:^|;\s*)session=([^;]+)/)?.[1];
  if (!token) return null;
  const session = await verifySession(decodeURIComponent(token), c.env.SESSION_SECRET ?? 'dev-secret');
  return session;
}

async function requireRole(c: Context<{ Bindings: Env }>, allowed: Array<'staff' | 'pickup' | 'admin' | 'owner'>) {
  const session = await requireSession(c);
  if (!session || !allowed.includes(session.role)) {
    return null;
  }
  return session;
}

async function requireAdminOrOwner(c: Context<{ Bindings: Env }>) {
  return requireRole(c, ['admin', 'owner']);
}

async function requireOwner(c: Context<{ Bindings: Env }>) {
  return requireRole(c, ['owner']);
}

function buildSessionCookie(token: string, secure: boolean): string {
  const parts = [`session=${token}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=43200'];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

function parseId(value: string | undefined): 1 | 2 | 3 | 4 | null {
  const number = Number(value);
  return number === 1 || number === 2 || number === 3 || number === 4 ? number : null;
}

function toRealtimeEvent(order: Awaited<ReturnType<typeof getFulfillmentOrderBySale>>, type: RealtimeEvent['type']): RealtimeEvent | null {
  if (!order) return null;
  return {
    eventId: createId('event'),
    type,
    stationId: order.station_id,
    occurredAt: new Date().toISOString(),
    data: {
      saleId: order.sale_id,
      pickupCode: order.pickup_code,
      registerId: order.register_id,
      status: order.status,
      createdAt: order.created_at,
      items: order.items.map((item) => ({ productId: item.product_id, productName: item.product_name, quantity: item.quantity })),
    },
  };
}

async function scheduleRealtimeEvent(c: Context<{ Bindings: Env }>, event: RealtimeEvent): Promise<void> {
  const task = publishRealtimeEvent(c.env.REALTIME_HUB, event).catch((error) => {
    console.error('Realtime notification failed', error);
  });
  try {
    c.executionCtx.waitUntil(task);
  } catch {
    // Pagesの一部実行環境ではExecutionContextが提供されないため、ここで完了を待つ。
    await task;
  }
}

app.get('/api/health', (c) =>
  c.json({
    ok: true,
    data: { status: 'ok', time: new Date().toISOString() },
  }),
);

app.get('/api/public/status', async (c) => {
  const products = await queryProducts(c.env.DB, true);
  const settings = await getSettings(c.env.DB);
  const isPublicEnabled = settings.public_status_enabled !== 'false';
  const shopName = c.env.PUBLIC_SHOP_NAME ?? settings.shop_name ?? '文化祭食品販売';
  const thresholds = {
    low: Number(settings.threshold_low ?? '0.15'),
    mid: Number(settings.threshold_mid ?? '0.35'),
    high: Number(settings.threshold_high ?? '0.65'),
  };
  const latestUpdatedAt = products.reduce((latest, item) => (item.updated_at > latest ? item.updated_at : latest), products[0]?.updated_at ?? new Date().toISOString());
  const response = c.json({
    ok: true,
    data: {
      shopName,
      updatedAt: latestUpdatedAt,
      isPublicEnabled,
      items: (isPublicEnabled ? products : []).map((item) => {
        const statusLevel = getStockLevelWithThresholds(item.current_stock, item.initial_stock, thresholds);
        return {
          id: item.id,
          displayName: item.display_name,
          category: item.category,
          price: item.price,
          statusLevel,
          statusText: getStockStatusText(statusLevel),
          isSoldOut: item.current_stock <= 0,
          allergyText: item.allergy_text,
          description: item.description,
          note: item.note,
        };
      }),
    },
  });
  response.headers.set('Cache-Control', 'public, max-age=20, s-maxage=20');
  return response;
});

app.post('/api/auth/login', async (c) => {
  const body = await c.req.json<{
    username?: string;
    password?: string;
    loginTarget?: 'staff' | 'pickup' | 'admin' | 'owner';
    stationId?: number;
  }>();
  const staffUsername = (await getSetting(c.env.DB, 'staff_username')) ?? c.env.STAFF_USERNAME ?? 'staff';
  const staffPasswordHash = (await getSetting(c.env.DB, 'staff_password_hash')) ?? c.env.STAFF_PASSWORD_HASH ?? '';
  const adminUsername = (await getSetting(c.env.DB, 'admin_username')) ?? c.env.ADMIN_USERNAME ?? 'admin';
  const ownerUsername = (await getSetting(c.env.DB, 'owner_username')) ?? c.env.OWNER_USERNAME ?? 'owner';
  const staffPasswordHashFallback = staffPasswordHash;
  const adminPasswordHash = (await getSetting(c.env.DB, 'admin_password_hash')) ?? c.env.ADMIN_PASSWORD_HASH ?? '';
  const ownerPasswordHash = (await getSetting(c.env.DB, 'owner_password_hash')) ?? c.env.OWNER_PASSWORD_HASH ?? '';
  const pickupCredentials = await Promise.all([1, 2, 3, 4].map(async (stationId) => ({
    stationId: stationId as 1 | 2 | 3 | 4,
    username: (await getSetting(c.env.DB, `pickup_${stationId}_username`)) ?? (typeof c.env[`PICKUP_${stationId}_USERNAME` as keyof Env] === 'string' ? c.env[`PICKUP_${stationId}_USERNAME` as keyof Env] as string : undefined) ?? `pickup-${stationId}`,
    passwordHash: (await getSetting(c.env.DB, `pickup_${stationId}_password_hash`)) ?? (typeof c.env[`PICKUP_${stationId}_PASSWORD_HASH` as keyof Env] === 'string' ? c.env[`PICKUP_${stationId}_PASSWORD_HASH` as keyof Env] as string : undefined) ?? '',
  })));
  const selectedPickup = body.loginTarget === 'pickup'
    ? pickupCredentials.find((credential) => credential.stationId === body.stationId)
    : undefined;
  const selectedUsername = body.loginTarget === 'staff'
    ? staffUsername
    : body.loginTarget === 'admin'
      ? adminUsername
      : body.loginTarget === 'owner'
        ? ownerUsername
        : selectedPickup?.username;
  const username = body.username ?? selectedUsername ?? '';
  const password = body.password ?? '';
  const ip = c.req.header('cf-connecting-ip') ?? c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? null;
  const throttle = await getLoginThrottle(c.env.DB, username, ip);
  if (isLoginLocked(throttle)) {
    return c.json(
      {
        ok: false,
        error: {
          code: 'LOGIN_LOCKED',
          message: buildLoginLockedMessage(throttle?.lockedUntil ?? null),
        },
      },
      429,
    );
  }
  const pickup = pickupCredentials.find((credential) => credential.username === username);
  const role = username === ownerUsername ? 'owner' : username === adminUsername ? 'admin' : username === staffUsername ? 'staff' : pickup ? 'pickup' : null;
  const hash = username === ownerUsername ? ownerPasswordHash : username === staffUsername ? staffPasswordHashFallback : username === adminUsername ? adminPasswordHash : pickup?.passwordHash ?? null;
  if (!role || !hash || !(await verifyPassword(password, hash))) {
    const failure = await recordLoginFailure(c.env.DB, username, ip);
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
  await resetLoginThrottle(c.env.DB, username, ip);
  const token = await signSession(buildSessionPayload(role, username, role === 'pickup' ? { stationId: pickup?.stationId } : {}), c.env.SESSION_SECRET ?? 'dev-secret');
  const response = c.json({ ok: true, data: { role } });
  response.headers.set('Set-Cookie', buildSessionCookie(token, new URL(c.req.url).protocol === 'https:'));
  return response;
});

app.get('/api/auth/me', async (c) => {
  const session = await requireSession(c);
  if (!session)
    return c.json(
      {
        ok: false,
        error: { code: 'UNAUTHORIZED', message: '未ログインです。' },
      },
      401,
    );
  return c.json({ ok: true, data: session });
});

app.post('/api/auth/logout', (c) => {
  const response = c.json({ ok: true, data: { loggedOut: true } });
  response.headers.set('Set-Cookie', `session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${new URL(c.req.url).protocol === 'https:' ? '; Secure' : ''}`);
  return response;
});

app.post('/api/staff/register/select', async (c) => {
  const session = await requireRole(c, ['staff']);
  if (!session) return c.json({ ok: false, error: { code: 'UNAUTHORIZED', message: '未ログインです。' } }, 401);
  const body = await c.req.json<{ registerId?: number }>();
  const registerId = parseId(String(body.registerId));
  if (!registerId) return c.json({ ok: false, error: { code: 'INVALID_REGISTER_ID', message: 'レジ番号が不正です。' } }, 400);
  const token = await signSession(buildSessionPayload('staff', session.username, { registerId }), c.env.SESSION_SECRET ?? 'dev-secret');
  const response = c.json({ ok: true, data: { registerId, stationId: registerId } });
  response.headers.set('Set-Cookie', buildSessionCookie(token, new URL(c.req.url).protocol === 'https:'));
  return response;
});

app.get('/api/staff/register/current', async (c) => {
  const session = await requireRole(c, ['staff', 'admin', 'owner']);
  if (!session) return c.json({ ok: false, error: { code: 'UNAUTHORIZED', message: '未ログインです。' } }, 401);
  return c.json({ ok: true, data: { registerId: session.registerId ?? null, stationId: session.registerId ?? null } });
});

app.get('/api/staff/register/recent-sales', async (c) => {
  const session = await requireRole(c, ['staff', 'admin', 'owner']);
  if (!session) return c.json({ ok: false, error: { code: 'UNAUTHORIZED', message: '未ログインです。' } }, 401);
  const registerId = session.role === 'staff' ? session.registerId : parseId(c.req.query('registerId')) ?? session.registerId ?? 1;
  const items = await listRecentSalesForRegister(c.env.DB, registerId ?? 1, Number(c.req.query('limit') ?? '20'));
  return c.json({ ok: true, data: { items } });
});

app.get('/api/pickup/orders', async (c) => {
  const session = await requireRole(c, ['pickup', 'admin', 'owner']);
  if (!session) return c.json({ ok: false, error: { code: 'UNAUTHORIZED', message: '未ログインです。' } }, 401);
  const stationId = session.role === 'pickup' ? session.stationId : parseId(c.req.query('stationId')) ?? undefined;
  const items = await listFulfillmentOrders(c.env.DB, {
    stationId,
    includeDelivered: c.req.query('includeDelivered') === 'true',
    query: c.req.query('q'),
    limit: Math.max(1, Math.min(Number(c.req.query('limit') ?? '100'), 500)),
  });
  return c.json({ ok: true, data: { items } });
});

app.get('/api/pickup/live', async (c) => {
  const session = await requireRole(c, ['pickup', 'admin', 'owner']);
  if (!session) return c.json({ ok: false, error: { code: 'UNAUTHORIZED', message: '未ログインです。' } }, 401);
  if (c.req.header('Upgrade')?.toLowerCase() !== 'websocket') return c.json({ ok: false, error: { code: 'WEBSOCKET_REQUIRED', message: 'WebSocket接続が必要です。' } }, 426);
  if (!c.env.REALTIME_HUB) return c.json({ ok: false, error: { code: 'REALTIME_UNAVAILABLE', message: 'リアルタイム通知は利用できません。定期同期を使用してください。' } }, 503);
  const channel = session.role === 'pickup' ? `station-${session.stationId}` : 'admin-all';
  const url = new URL(c.req.url);
  url.searchParams.set('channel', channel);
  const stub = c.env.REALTIME_HUB.getByName(channel);
  return stub.fetch(new Request(url, c.req.raw));
});

async function requirePickupOrderAccess(c: Context<{ Bindings: Env }>, orderId: string) {
  const session = await requireRole(c, ['pickup', 'admin', 'owner']);
  if (!session) return null;
  if (session.role !== 'pickup') return session;
  const rows = await c.env.DB.prepare('SELECT station_id FROM fulfillment_orders WHERE id = ?').bind(orderId).all<{ station_id: number }>();
  if (!(rows.results ?? []).length || Number((rows.results ?? [])[0].station_id) !== session.stationId) return null;
  return session;
}

app.post('/api/pickup/orders/:orderId/deliver', async (c) => {
  const orderId = c.req.param('orderId');
  const session = await requirePickupOrderAccess(c, orderId);
  if (!session) return c.json({ ok: false, error: { code: 'FORBIDDEN_STATION', message: 'この受取場所の注文ではありません。' } }, 403);
  const result = await deliverOrder(c.env.DB, orderId, session.role as 'pickup' | 'admin' | 'owner', session.username);
  if (!result.ok) return c.json({ ok: false, error: { code: result.code, message: result.message } }, result.code === 'ORDER_NOT_FOUND' ? 404 : 409);
  const event = toRealtimeEvent(await getFulfillmentOrderById(c.env.DB, orderId), 'order.delivered');
  if (event) await scheduleRealtimeEvent(c, event);
  return c.json({ ok: true, data: result });
});

app.post('/api/pickup/orders/:orderId/restore', async (c) => {
  const orderId = c.req.param('orderId');
  const session = await requirePickupOrderAccess(c, orderId);
  if (!session) return c.json({ ok: false, error: { code: 'FORBIDDEN_STATION', message: 'この受取場所の注文ではありません。' } }, 403);
  const result = await restoreOrder(c.env.DB, orderId, session.role as 'pickup' | 'admin' | 'owner', session.username);
  if (!result.ok) return c.json({ ok: false, error: { code: result.code, message: result.message } }, result.code === 'ORDER_NOT_FOUND' ? 404 : 409);
  const event = toRealtimeEvent(await getFulfillmentOrderById(c.env.DB, orderId), 'order.restored');
  if (event) await scheduleRealtimeEvent(c, event);
  return c.json({ ok: true, data: result });
});

app.post('/api/pickup/orders/:orderId/ack-cancel', async (c) => {
  const orderId = c.req.param('orderId');
  const session = await requirePickupOrderAccess(c, orderId);
  if (!session) return c.json({ ok: false, error: { code: 'FORBIDDEN_STATION', message: 'この受取場所の注文ではありません。' } }, 403);
  const result = await acknowledgeCancellation(c.env.DB, orderId, session.role as 'pickup' | 'admin' | 'owner', session.username);
  if (!result.ok) return c.json({ ok: false, error: { code: result.code, message: result.message } }, result.code === 'ORDER_NOT_FOUND' ? 404 : 409);
  const event = toRealtimeEvent(await getFulfillmentOrderById(c.env.DB, orderId), 'order.cancel_acknowledged');
  if (event) await scheduleRealtimeEvent(c, event);
  return c.json({ ok: true, data: result });
});

app.get('/api/admin/fulfillment/orders', async (c) => {
  const session = await requireAdminOrOwner(c);
  if (!session) return c.json({ ok: false, error: { code: 'UNAUTHORIZED', message: '未ログインです。' } }, 401);
  const items = await listFulfillmentOrders(c.env.DB, {
    stationId: parseId(c.req.query('stationId')) ?? undefined,
    includeDelivered: true,
    query: c.req.query('q'),
    limit: Math.max(1, Math.min(Number(c.req.query('limit') ?? '500'), 1000)),
  });
  return c.json({ ok: true, data: { items } });
});

app.get('/api/admin/fulfillment/summary', async (c) => {
  const session = await requireAdminOrOwner(c);
  if (!session) return c.json({ ok: false, error: { code: 'UNAUTHORIZED', message: '未ログインです。' } }, 401);
  const orders = await listFulfillmentOrders(c.env.DB, { includeDelivered: true, limit: 1000 });
  const byStation = [1, 2, 3, 4].map((stationId) => {
    const stationOrders = orders.filter((order) => order.station_id === stationId);
    return { stationId, pending: stationOrders.filter((order) => order.status === 'pending').length, delivered: stationOrders.filter((order) => order.status === 'delivered').length, canceled: stationOrders.filter((order) => order.status === 'canceled').length };
  });
  const connected = await Promise.all([1, 2, 3, 4].map(async (stationId) => ({ stationId, connections: await getRealtimeConnectionCount(c.env.REALTIME_HUB, `station-${stationId}`) })));
  return c.json({ ok: true, data: { byStation, connected, pending: orders.filter((order) => order.status === 'pending').length, unacknowledgedCanceled: orders.filter((order) => order.status === 'canceled' && !order.cancel_acknowledged_at).length } });
});

app.get('/api/staff/register/products', async (c) => {
  const session = await requireRole(c, ['staff', 'admin', 'owner']);
  if (!session)
    return c.json(
      {
        ok: false,
        error: { code: 'UNAUTHORIZED', message: '未ログインです。' },
      },
      401,
    );
  const products = await queryProducts(c.env.DB);
  return c.json({
    ok: true,
    data: {
      items: products.map((item) => ({
        id: item.id,
        displayName: item.display_name,
        category: item.category,
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
  const session = await requireRole(c, ['staff', 'admin', 'owner']);
  if (!session)
    return c.json(
      {
        ok: false,
        error: { code: 'UNAUTHORIZED', message: '未ログインです。' },
      },
      401,
    );
  const products = await queryProducts(c.env.DB);
  return c.json({
    ok: true,
    data: {
      items: products.map((item) => ({
        id: item.id,
        displayName: item.display_name,
        category: item.category,
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
  const session = await requireRole(c, ['staff', 'admin', 'owner']);
  if (!session)
    return c.json(
      {
        ok: false,
        error: { code: 'UNAUTHORIZED', message: '未ログインです。' },
      },
      401,
    );
  const salesOpen = (await getSetting(c.env.DB, 'sales_open')) ?? 'true';
  if (salesOpen !== 'true') {
    return c.json({ ok: false, error: { code: 'SALES_CLOSED', message: '現在は販売を停止しています。' } }, 409);
  }
  const registerId = session.registerId ?? 1;
  try {
    const requestBody = await c.req.json<{ idempotencyKey?: string }>();
    const result = await processSale(c.env.DB, session.role as 'staff' | 'admin' | 'owner', registerId, requestBody);
    if ('error' in result) {
      return c.json(
        {
          ok: false,
          error: { code: result.error.code, message: result.error.message },
        },
        { status: result.error.status },
      );
    }
    if (!result.reused) {
      const event = toRealtimeEvent(await getFulfillmentOrderBySale(c.env.DB, result.saleId), 'order.created');
      if (event) await scheduleRealtimeEvent(c, event);
    }
    return c.json({
      ok: true,
      data: {
        saleId: result.saleId,
        totalAmount: result.totalAmount,
        paidAmount: result.paidAmount,
        changeAmount: result.changeAmount,
        idempotencyKey: requestBody.idempotencyKey,
        registerId: result.registerId,
        stationId: result.stationId,
        pickupCode: result.pickupCode,
        fulfillmentStatus: 'pending',
        createdAt: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error('Checkout failed', error);
    return c.json(
      { ok: false, error: { code: 'CHECKOUT_FAILED', message: '会計処理に失敗しました。もう一度お試しください。' } },
      500,
    );
  }
}

app.get('/api/staff/stock', async (c) => {
  return handleStockList(c);
});

app.get('/api/stock', async (c) => {
  return handleStockList(c);
});

async function handleStockList(c: Context<{ Bindings: Env }>) {
  const session = await requireAdminOrOwner(c);
  if (!session)
    return c.json(
      {
        ok: false,
        error: { code: 'UNAUTHORIZED', message: '未ログインです。' },
      },
      401,
    );
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
  const session = await requireAdminOrOwner(c);
  if (!session)
    return c.json(
      {
        ok: false,
        error: { code: 'UNAUTHORIZED', message: '未ログインです。' },
      },
      401,
    );
  const body = await c.req.json<{
    productId: string;
    quantityDelta: number;
    eventType: 'restock' | 'discard' | 'adjust';
    reason?: string;
  }>();
  const result = await recordStockEvent(c.env.DB, session.role as 'admin' | 'owner', body);
  return c.json({ ok: true, data: result });
}

app.post('/api/sales/:saleId/cancel', async (c) => {
  const session = await requireRole(c, ['staff', 'admin', 'owner']);
  if (!session)
    return c.json(
      {
        ok: false,
        error: { code: 'UNAUTHORIZED', message: '未ログインです。' },
      },
      401,
    );
  const saleId = c.req.param('saleId');
  const body = await c.req.json<{ reason?: string; restoreStock?: boolean }>().catch(() => ({}));
  const result = await cancelSale(c.env.DB, session.role as 'staff' | 'admin' | 'owner', saleId, session.username, session.registerId, body);
  if (!result.ok) {
    return c.json({ ok: false, error: { code: result.code, message: result.message } }, { status: result.status });
  }
  const event = toRealtimeEvent(await getFulfillmentOrderBySale(c.env.DB, saleId), 'order.canceled');
  if (event) await scheduleRealtimeEvent(c, event);
  return c.json({
    ok: true,
    data: { saleId, canceled: true, canceledAt: result.canceledAt, restoreStock: result.restoreStock },
  });
});

app.get('/api/staff/stock/history', async (c) => {
  const session = await requireRole(c, ['admin', 'owner']);
  if (!session)
    return c.json(
      {
        ok: false,
        error: { code: 'UNAUTHORIZED', message: '未ログインです。' },
      },
      401,
    );
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
  const session = await requireOwner(c);
  if (!session)
    return c.json(
      {
        ok: false,
        error: { code: 'UNAUTHORIZED', message: '未ログインです。' },
      },
      401,
    );
  const products = await queryProducts(c.env.DB);
  return c.json({ ok: true, data: { items: products } });
});

app.get('/api/admin/settings', async (c) => {
  const session = await requireOwner(c);
  if (!session)
    return c.json(
      {
        ok: false,
        error: { code: 'UNAUTHORIZED', message: '未ログインです。' },
      },
      401,
    );
  const settings = await getSettings(c.env.DB);
  return c.json({ ok: true, data: { settings } });
});

app.post('/api/admin/products', async (c) => {
  const session = await requireOwner(c);
  if (!session)
    return c.json(
      {
        ok: false,
        error: { code: 'UNAUTHORIZED', message: '未ログインです。' },
      },
      401,
    );
  const body = await c.req.json<{
    id: string;
    name: string;
    displayName: string;
    category?: string;
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
      `INSERT INTO products (id, name, display_name, category, price, initial_stock, is_public, is_active, sort_order, allergy_text, description, note, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         name=excluded.name,
         display_name=excluded.display_name,
         category=excluded.category,
         price=excluded.price,
         initial_stock=excluded.initial_stock,
         is_public=excluded.is_public,
         is_active=excluded.is_active,
         sort_order=excluded.sort_order,
         allergy_text=excluded.allergy_text,
         description=excluded.description,
         note=excluded.note,
         deleted_at=NULL,
         updated_at=excluded.updated_at`,
    ).bind(body.id, body.name, body.displayName, body.category ?? '', body.price, body.initialStock, body.isPublic ? 1 : 0, body.isActive ? 1 : 0, body.sortOrder, body.allergyText, body.description, body.note, now, now),
    c.env.DB.prepare(
      `INSERT INTO product_inventory (product_id, current_stock, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(product_id) DO UPDATE SET updated_at=excluded.updated_at`,
    ).bind(body.id, body.initialStock, now),
  ]);
  return c.json({ ok: true, data: { updatedAt: now } });
});

app.put('/api/admin/products/:id', async (c) => {
  const session = await requireOwner(c);
  if (!session)
    return c.json(
      {
        ok: false,
        error: { code: 'UNAUTHORIZED', message: '未ログインです。' },
      },
      401,
    );
  const id = c.req.param('id');
  const body = await c.req.json<{
    name: string;
    displayName: string;
    category?: string;
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
         category = ?,
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
    ).bind(body.name, body.displayName, body.category ?? '', body.price, body.initialStock, body.isPublic ? 1 : 0, body.isActive ? 1 : 0, body.sortOrder, body.allergyText, body.description, body.note, now, id),
    c.env.DB.prepare(`UPDATE product_inventory SET updated_at = ? WHERE product_id = ?`).bind(now, id),
  ]);
  return c.json({ ok: true, data: { updatedAt: now } });
});

app.delete('/api/admin/products/:id', async (c) => {
  const session = await requireOwner(c);
  if (!session) {
    return c.json({ ok: false, error: { code: 'UNAUTHORIZED', message: '未ログインです。' } }, 401);
  }
  const id = c.req.param('id');
  const body = await c.req.json<{ confirmation?: string }>().catch(() => ({ confirmation: undefined }));
  if (body.confirmation !== '消去') {
    return c.json({ ok: false, error: { code: 'CONFIRMATION_REQUIRED', message: '確認欄に「消去」と入力してください。' } }, 400);
  }
  const sales = await c.env.DB.prepare('SELECT COUNT(*) AS count FROM sale_items WHERE product_id = ?').bind(id).all<{ count: number }>();
  const now = new Date().toISOString();
  const product = await c.env.DB.prepare('SELECT id FROM products WHERE id = ?').bind(id).all<{ id: string }>();
  if (!(product.results ?? []).length) {
    return c.json({ ok: false, error: { code: 'NOT_FOUND', message: '商品が見つかりません。' } }, 404);
  }
  if (Number((sales.results ?? [])[0]?.count ?? 0) > 0) {
    await c.env.DB.prepare('UPDATE products SET is_public = 0, is_active = 0, deleted_at = ?, updated_at = ? WHERE id = ?').bind(now, now, id).run();
    return c.json({ ok: true, data: { deleted: true, preservedHistory: true, updatedAt: now } });
  }
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM product_inventory WHERE product_id = ?').bind(id),
    c.env.DB.prepare('DELETE FROM products WHERE id = ?').bind(id),
  ]);
  return c.json({ ok: true, data: { deleted: true, updatedAt: now } });
});

app.post('/api/admin/settings', async (c) => {
  const session = await requireOwner(c);
  if (!session)
    return c.json(
      {
        ok: false,
        error: { code: 'UNAUTHORIZED', message: '未ログインです。' },
      },
      401,
    );
  const body = await c.req.json<{ key: string; value: string }>();
  const now = new Date().toISOString();
  await c.env.DB.prepare(
    `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`,
  )
    .bind(body.key, body.value, now)
    .run();
  return c.json({ ok: true, data: { updatedAt: now } });
});

app.put('/api/admin/settings', async (c) => {
  const session = await requireOwner(c);
  if (!session)
    return c.json(
      {
        ok: false,
        error: { code: 'UNAUTHORIZED', message: '未ログインです。' },
      },
      401,
    );
  const body = await c.req.json<Record<string, string>>();
  const now = new Date().toISOString();
  const entries = Object.entries(body);
  if (!entries.length) {
    return c.json(
      {
        ok: false,
        error: { code: 'INVALID_REQUEST', message: '設定が空です。' },
      },
      400,
    );
  }
  await c.env.DB.batch(
    entries.map(([key, value]) =>
      c.env.DB.prepare(
        `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
           ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`,
      ).bind(key, value, now),
    ),
  );
  return c.json({ ok: true, data: { updatedAt: now } });
});

app.get('/api/admin/csv', async (c) => {
  const session = await requireAdminOrOwner(c);
  if (!session) return c.text('unauthorized', 401);
  const products = await queryProducts(c.env.DB);
  const csv = ['id,name,display_name,price,current_stock'].concat(products.map((p) => [p.id, p.name, p.display_name, p.price, p.current_stock].join(','))).join('\n');
  return c.text(csv, 200, { 'Content-Type': 'text/csv; charset=utf-8' });
});

app.get('/api/admin/summary', async (c) => {
  const session = await requireAdminOrOwner(c);
  if (!session)
    return c.json(
      {
        ok: false,
        error: { code: 'UNAUTHORIZED', message: '未ログインです。' },
      },
      401,
    );
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
  if (!session)
    return c.json(
      {
        ok: false,
        error: { code: 'UNAUTHORIZED', message: '未ログインです。' },
      },
      401,
    );
  const query = c.req.query('q') ?? '';
  const limit = Math.max(1, Math.min(Number(c.req.query('limit') ?? '100'), 500));
  const sales = await querySalesByFilter(c.env.DB, { query, limit });
  const items = await c.env.DB.prepare(`SELECT sale_id, product_id, quantity, unit_price, subtotal FROM sale_items ORDER BY sale_id DESC, id ASC`).all<{
    sale_id: string;
    product_id: string;
    quantity: number;
    unit_price: number;
    subtotal: number;
  }>();
  const grouped = new Map<
    string,
    Array<{
      product_id: string;
      quantity: number;
      unit_price: number;
      subtotal: number;
    }>
  >();
  for (const row of (items.results ?? []) as Array<{
    sale_id: string;
    product_id: string;
    quantity: number;
    unit_price: number;
    subtotal: number;
  }>) {
    const list = grouped.get(row.sale_id) ?? [];
    list.push({
      product_id: row.product_id,
      quantity: row.quantity,
      unit_price: row.unit_price,
      subtotal: row.subtotal,
    });
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
  const session = await requireAdminOrOwner(c);
  if (!session) return c.text('unauthorized', 401);
  const sales = await querySalesByFilter(c.env.DB, { limit: 1000 });
  const items = await c.env.DB.prepare(
    `SELECT si.sale_id, si.product_id, p.display_name, si.quantity, si.unit_price, si.subtotal
       FROM sale_items si
       JOIN products p ON p.id = si.product_id
       ORDER BY si.sale_id DESC, si.id ASC`,
  ).all<{
    sale_id: string;
    product_id: string;
    display_name: string;
    quantity: number;
    unit_price: number;
    subtotal: number;
  }>();
  const grouped = new Map<
    string,
    Array<{
      product_id: string;
      product_name: string;
      quantity: number;
      unit_price: number;
      subtotal: number;
    }>
  >();
  for (const row of (items.results ?? []) as Array<{
    sale_id: string;
    product_id: string;
    display_name: string;
    quantity: number;
    unit_price: number;
    subtotal: number;
  }>) {
    const list = grouped.get(row.sale_id) ?? [];
    list.push({
      product_id: row.product_id,
      product_name: row.display_name,
      quantity: row.quantity,
      unit_price: row.unit_price,
      subtotal: row.subtotal,
    });
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
  const session = await requireAdminOrOwner(c);
  if (!session) return c.text('unauthorized', 401);
  const events = await listStockHistory(c.env.DB, { limit: 1000 });
  const csv = buildStockEventsCsv(events);
  return c.text(csv, 200, { 'Content-Type': 'text/csv; charset=utf-8' });
});

export { app };
export default app;
