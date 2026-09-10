import { Hono, type Context } from 'hono';
import { getStockLevelWithThresholds, getStockStatusText } from '../src/lib/stockLevel';
import { verifyPassword } from '../src/lib/password';
import { signSession, verifySession } from '../src/lib/session';
import { buildSessionPayload } from './services/authService';
import { getSettings, getSettingsSnapshot, queryAdminSummary, queryProducts, querySalesByFilter, type ProductRow } from './db/queries';
import { buildLoginLockedMessage, getLoginThrottle, isLoginLocked, recordLoginFailure, resetLoginThrottle, shouldBypassStaffAuth } from './services/authService';
import { getPresaleLimit, parseSalesDay, processSale, type SaleResult } from './services/saleService';
import { listSalesCsvPage, listStockEventsCsvPage, SALES_CSV_HEADER, salesCsvLine, STOCK_EVENTS_CSV_HEADER, stockEventCsvLine } from './services/csvService';
import { applyNoonRestock, cancelSale, getNoonRestockStatus, listStock, listStockHistory, NOON_RESTOCK_CONFIRMATION, recordStockEvent, stockEventSchema } from './services/stockService';
import { acknowledgeCancellation, deliverOrder, getFulfillmentSummary, getPickupSaleType, getTokyoDate, listFulfillmentOrders, listRecentSalesForRegister, restoreOrder } from './services/fulfillmentService';
import { getFulfillmentOrderBySale } from './services/fulfillmentService';
import { getFulfillmentOrderById } from './services/fulfillmentService';
import { getRealtimeConnectionCount, publishRealtimeEvent, type RealtimeEvent, RealtimeHub } from './realtimeHub';
import { createId } from '../src/lib/ids';
import { EDITABLE_SETTING_NAMES, editableSettingsSchema, getRegisterConfiguration, getRegisterSaleType, getRegisterStationId, readStockThresholds, sanitizeSettings, validateThresholdOrder } from './services/settingsService';
import { z } from 'zod';
import { acknowledgeDraftCancellation, cancelCheckoutDraft, completeCheckoutDraft, createCheckoutDraft, expireCheckoutDrafts, getCheckoutDraft, listCheckoutDrafts } from './services/checkoutDraftService';

type Env = Omit<Cloudflare.Env, 'REALTIME_HUB' | 'PREVIEW_AUTH_BYPASS'> & {
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

const productFieldsSchema = z.object({
  name: z.string().trim().min(1).max(100),
  displayName: z.string().trim().min(1).max(100),
  category: z.string().trim().max(50).optional(),
  price: z.number().int().min(0).max(10_000_000),
  initialStock: z.number().int().min(0).max(1_000_000),
  isPublic: z.boolean(),
  isActive: z.boolean(),
  sortOrder: z.number().int().min(-1_000_000).max(1_000_000),
  allergyText: z.string().max(2_000),
  description: z.string().max(2_000),
  note: z.string().max(2_000),
});

const productCreateSchema = productFieldsSchema.extend({
  id: z.string().trim().min(1).max(100),
});

const settingEntrySchema = z.object({
  key: z.string().trim().min(1).max(100),
  value: z.string().max(10_000),
}).strict();

const loginSchema = z.object({
  username: z.string().trim().max(100).optional(),
  password: z.string().max(10_000).optional(),
  loginTarget: z.enum(['staff', 'pickup', 'admin', 'owner']).optional(),
  stationId: z.number().int().min(1).max(4).optional(),
});

const registerSelectionSchema = z.object({
  registerId: z.number().int().min(1).max(4),
});

const cancelSaleSchema = z.object({
  reason: z.string().trim().max(500).optional(),
  restoreStock: z.boolean().optional(),
});

const deleteConfirmationSchema = z.object({
  confirmation: z.string().optional(),
});

const noonRestockSchema = z.object({
  confirmation: z.literal(NOON_RESTOCK_CONFIRMATION),
}).strict();

const checkoutDraftSchema = z.object({
  idempotencyKey: z.string().trim().min(1).max(200),
  saleType: z.literal('normal'),
  items: z.array(z.object({ productId: z.string().trim().min(1).max(100), quantity: z.number().int().positive() })).min(1).max(100).superRefine((items, context) => {
    const seen = new Set<string>();
    items.forEach((item, index) => {
      if (seen.has(item.productId)) context.addIssue({ code: 'custom', path: [index, 'productId'], message: '同じ商品を複数行に分けて指定できません。' });
      seen.add(item.productId);
    });
  }),
}).strict();
const completeDraftSchema = z.object({ paidAmount: z.number().int().nonnegative(), paymentMethod: z.literal('cash') }).strict();

async function requireSession(c: Context<{ Bindings: Env }>) {
  if (shouldBypassStaffAuth(c.env)) {
    const cookie = c.req.header('Cookie') ?? '';
    const previewRegisterId = parseId(cookie.match(/(?:^|;\s*)preview_register_id=([^;]+)/)?.[1]);
    return {
      role: 'staff' as const,
      username: 'preview-staff',
      registerId: previewRegisterId ?? 1,
      exp: Date.now() + 12 * 60 * 60 * 1000,
    };
  }
  const cookie = c.req.header('Cookie') ?? '';
  const token = cookie.match(/(?:^|;\s*)session=([^;]+)/)?.[1];
  if (!token || !c.env.SESSION_SECRET) return null;
  try {
    return await verifySession(decodeURIComponent(token), c.env.SESSION_SECRET);
  } catch {
    return null;
  }
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

async function ownerAccessDenied(c: Context<{ Bindings: Env }>): Promise<Response> {
  const session = await requireSession(c);
  if (!session) {
    return c.json({ ok: false, error: { code: 'UNAUTHORIZED', message: '未ログインです。' } }, 401);
  }
  return c.json({ ok: false, error: { code: 'FORBIDDEN', message: 'owner 権限が必要です。' } }, 403);
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

function parseLimit(value: string | undefined, fallback: number, maximum: number): number {
  const number = Number(value);
  return Number.isInteger(number) ? Math.max(1, Math.min(number, maximum)) : fallback;
}

function createCsvResponse<Row>(
  fileName: string,
  header: string,
  loadPage: (limit: number, offset: number) => Promise<Row[]>,
  toLine: (row: Row) => string,
): Response {
  const pageSize = 500;
  const encoder = new TextEncoder();
  let offset = 0;
  let firstChunk = true;
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const rows = await loadPage(pageSize, offset);
        const prefix = firstChunk ? `\ufeff${header}\n` : '';
        firstChunk = false;
        controller.enqueue(encoder.encode(`${prefix}${rows.map(toLine).join('\n')}${rows.length ? '\n' : ''}`));
        offset += rows.length;
        if (rows.length < pageSize) controller.close();
      } catch (error) {
        controller.error(error);
      }
    },
  });
  return new Response(body, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${fileName}"`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

function latestProductUpdatedAt(products: ProductRow[]): string {
  return products.reduce((latest, item) => {
    const itemLatest = item.inventory_updated_at > item.updated_at ? item.inventory_updated_at : item.updated_at;
    return itemLatest > latest ? itemLatest : latest;
  }, products[0] ? '' : new Date().toISOString());
}

function latestUpdatedAt(products: ProductRow[], settingsUpdatedAt: string | null): string {
  const productUpdatedAt = latestProductUpdatedAt(products);
  return settingsUpdatedAt && settingsUpdatedAt > productUpdatedAt ? settingsUpdatedAt : productUpdatedAt;
}

async function putInCache(c: Context<{ Bindings: Env }>, key: Request, response: Response): Promise<void> {
  const cache = await caches.open('gakuyusai-public-status-v1');
  const task = cache.put(key, response.clone()).catch((error: unknown) => {
    console.error(JSON.stringify({ message: 'public status cache write failed', error: String(error) }));
  });
  try {
    c.executionCtx.waitUntil(task);
  } catch {
    await task;
  }
}

function toAdminProduct(item: ProductRow) {
  return {
    id: item.id,
    name: item.name,
    displayName: item.display_name,
    category: item.category,
    price: item.price,
    initialStock: item.initial_stock,
    currentStock: item.current_stock,
    isPublic: item.is_public === 1,
    isActive: item.is_active === 1,
    sortOrder: item.sort_order,
    allergyText: item.allergy_text,
    description: item.description,
    note: item.note,
    createdAt: item.created_at,
    updatedAt: item.inventory_updated_at > item.updated_at ? item.inventory_updated_at : item.updated_at,
  };
}

function toRegisterProduct(item: ProductRow) {
  const presaleLimit = getPresaleLimit(item.initial_stock);
  const presaleRemaining = Math.max(0, presaleLimit - item.presale_sold_quantity);
  const statusLevel = getStockLevelWithThresholds(item.current_stock, item.initial_stock);
  return {
    id: item.id,
    displayName: item.display_name,
    category: item.category,
    price: item.price,
    currentStock: item.current_stock,
    presaleRemaining,
    isPresaleLimitReached: presaleRemaining <= 0,
    statusLevel,
    statusText: getStockStatusText(statusLevel),
    isSoldOut: item.current_stock <= 0,
    isActive: item.is_active === 1,
  };
}

type SaleItemRow = {
  sale_id: string;
  product_id: string;
  display_name: string;
  quantity: number;
  unit_price: number;
  subtotal: number;
};

async function querySaleItemsForSales(db: D1Database, saleIds: string[]): Promise<SaleItemRow[]> {
  if (!saleIds.length) return [];
  const statements: D1PreparedStatement[] = [];
  for (let offset = 0; offset < saleIds.length; offset += 80) {
    const chunk = saleIds.slice(offset, offset + 80);
    statements.push(
      db.prepare(
        `SELECT si.sale_id, si.product_id, p.display_name, si.quantity, si.unit_price, si.subtotal
         FROM sale_items si
         JOIN products p ON p.id = si.product_id
         WHERE si.sale_id IN (${chunk.map(() => '?').join(',')})
         ORDER BY si.sale_id DESC, si.id ASC`,
      ).bind(...chunk),
    );
  }
  const results = await db.batch<SaleItemRow>(statements);
  return results.flatMap((result) => result.results ?? []);
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

function toCreatedRealtimeEvent(result: SaleResult): RealtimeEvent {
  return {
    eventId: createId('event'),
    type: 'order.created',
    stationId: result.stationId,
    occurredAt: new Date().toISOString(),
    data: {
      saleId: result.saleId,
      pickupCode: result.pickupCode,
      registerId: result.registerId,
      status: 'pending',
      createdAt: result.createdAt,
      items: result.items,
    },
  };
}

function toDraftRealtimeEvent(draft: NonNullable<Awaited<ReturnType<typeof getCheckoutDraft>>>, type: RealtimeEvent['type']): RealtimeEvent {
  return {
    eventId: createId('event'), type, stationId: draft.station_id, occurredAt: new Date().toISOString(),
    data: { draftId: draft.id, pickupCode: draft.pickup_code, registerId: draft.register_id, status: draft.status,
      expiresAt: draft.expires_at, items: draft.items.map((item) => ({ productId: item.product_id, productName: item.product_name, quantity: item.quantity })) },
  };
}

async function expireAndNotify(c: Context<{ Bindings: Env }>) {
  const expired = await expireCheckoutDrafts(c.env.DB);
  await Promise.all(expired.map((draft) => scheduleRealtimeEvent(c, toDraftRealtimeEvent(draft, 'order.expired'))));
}

async function scheduleRealtimeEvent(c: Context<{ Bindings: Env }>, event: RealtimeEvent): Promise<void> {
  const task = publishRealtimeEvent(c.env.REALTIME_HUB, event).catch((error) => {
    console.error(JSON.stringify({ message: 'realtime notification failed', error: String(error) }));
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

app.use('/api/*', async (c, next) => {
  await next();
  if (c.req.path !== '/api/public/status') {
    c.header('Cache-Control', 'private, no-store');
  }
  c.header('X-Content-Type-Options', 'nosniff');
});

app.get('/api/public/status', async (c) => {
  const cacheUrl = new URL(c.req.url);
  cacheUrl.search = '';
  const cacheKey = new Request(cacheUrl, { method: 'GET' });
  const cache = await caches.open('gakuyusai-public-status-v1');
  const cached = await cache.match(cacheKey);
  if (cached) return cached;
  const businessDate = getTokyoDate();
  const [products, settingsSnapshot, noonRestock] = await Promise.all([
    queryProducts(c.env.DB, true),
    getSettingsSnapshot(c.env.DB, [
      'public_status_enabled',
      'shop_name',
      'threshold_low',
      'threshold_mid',
      'threshold_high',
    ]),
    c.env.DB.prepare(
      `SELECT created_at
       FROM stock_events
       WHERE event_type = 'restock'
         AND quantity_delta > 0
         AND date(datetime(created_at), '+9 hours') = ?
         AND time(datetime(created_at), '+9 hours') >= '12:00:00'
       ORDER BY created_at DESC
       LIMIT 1`,
    ).bind(businessDate).first<{ created_at: string }>(),
  ]);
  const settings = settingsSnapshot.values;
  const isPublicEnabled = settings.public_status_enabled !== 'false';
  const shopName = c.env.PUBLIC_SHOP_NAME ?? settings.shop_name ?? '文化祭食品販売';
  const thresholds = readStockThresholds(settings);
  const response = c.json({
    ok: true,
    data: {
      shopName,
      updatedAt: latestUpdatedAt(products, settingsSnapshot.updatedAt),
      noonRestockedAt: noonRestock?.created_at ?? null,
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
  response.headers.set('Cache-Control', 'public, max-age=10, s-maxage=30');
  await putInCache(c, cacheKey, response);
  return response;
});

app.post('/api/auth/login', async (c) => {
  if (!c.env.SESSION_SECRET) {
    console.error(JSON.stringify({ message: 'SESSION_SECRET is not configured', path: '/api/auth/login' }));
    return c.json(
      { ok: false, error: { code: 'SERVER_MISCONFIGURED', message: '認証設定が不足しています。管理者に連絡してください。' } },
      500,
    );
  }
  const parsed = loginSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ ok: false, error: { code: 'INVALID_REQUEST', message: 'ログイン情報が不正です。' } }, 400);
  }
  const body = parsed.data;
  const settings = await getSettings(c.env.DB);
  const setting = (key: string, fallback = '') => settings[key] ?? fallback;
  // Wrangler Secrets are authoritative. D1 hashes are a legacy fallback and are never returned by an API.
  const staffUsername = setting('staff_username', c.env.STAFF_USERNAME ?? 'staff');
  const staffPasswordHash = c.env.STAFF_PASSWORD_HASH ?? setting('staff_password_hash');
  const adminUsername = setting('admin_username', c.env.ADMIN_USERNAME ?? 'admin');
  const ownerUsername = setting('owner_username', c.env.OWNER_USERNAME ?? 'owner');
  const adminPasswordHash = c.env.ADMIN_PASSWORD_HASH ?? setting('admin_password_hash');
  const ownerPasswordHash = c.env.OWNER_PASSWORD_HASH ?? setting('owner_password_hash');
  const pickupCredentials = [1, 2, 3, 4].map((stationId) => ({
    stationId: stationId as 1 | 2 | 3 | 4,
    username: setting(
      `pickup_${stationId}_username`,
      (typeof c.env[`PICKUP_${stationId}_USERNAME` as keyof Env] === 'string' ? c.env[`PICKUP_${stationId}_USERNAME` as keyof Env] as string : undefined)
        ?? `pickup-${stationId}`,
    ),
    passwordHash: (typeof c.env[`PICKUP_${stationId}_PASSWORD_HASH` as keyof Env] === 'string' ? c.env[`PICKUP_${stationId}_PASSWORD_HASH` as keyof Env] as string : undefined)
      ?? setting(`pickup_${stationId}_password_hash`),
  }));
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
  const pickup = pickupCredentials.find((credential) => credential.username === username);
  const role = username === ownerUsername ? 'owner' : username === adminUsername ? 'admin' : username === staffUsername ? 'staff' : pickup ? 'pickup' : null;
  const hash = username === ownerUsername ? ownerPasswordHash : username === staffUsername ? staffPasswordHash : username === adminUsername ? adminPasswordHash : pickup?.passwordHash ?? null;
  const throttleSubject = role === 'pickup'
    ? `pickup-${pickup?.stationId ?? body.stationId ?? 'unknown'}`
    : role ?? (body.loginTarget === 'pickup' ? `pickup-${body.stationId ?? 'unknown'}` : body.loginTarget ?? 'unknown');
  const throttle = await getLoginThrottle(c.env.DB, throttleSubject, ip);
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
  if (!role || !hash || !(await verifyPassword(password, hash))) {
    const failure = await recordLoginFailure(c.env.DB, throttleSubject, ip);
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
  await resetLoginThrottle(c.env.DB, throttleSubject, ip);
  const token = await signSession(buildSessionPayload(role, username, role === 'pickup' ? { stationId: pickup?.stationId } : {}), c.env.SESSION_SECRET);
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
  const secure = new URL(c.req.url).protocol === 'https:' ? '; Secure' : '';
  response.headers.append('Set-Cookie', `session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`);
  response.headers.append('Set-Cookie', `preview_register_id=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`);
  return response;
});

app.post('/api/staff/register/select', async (c) => {
  const session = await requireRole(c, ['staff', 'admin', 'owner']);
  if (!session) return c.json({ ok: false, error: { code: 'UNAUTHORIZED', message: '未ログインです。' } }, 401);
  const parsed = registerSelectionSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ ok: false, error: { code: 'INVALID_REGISTER_ID', message: 'レジ番号が不正です。' } }, 400);
  const registerId = parseId(String(parsed.data.registerId));
  if (!registerId) return c.json({ ok: false, error: { code: 'INVALID_REGISTER_ID', message: 'レジ番号が不正です。' } }, 400);
  const settings = await getSettings(c.env.DB);
  const stationId = getRegisterStationId(settings, registerId);
  if (shouldBypassStaffAuth(c.env)) {
    const response = c.json({ ok: true, data: { registerId, stationId, saleType: getRegisterSaleType(settings, registerId) } });
    response.headers.set(
      'Set-Cookie',
      `preview_register_id=${registerId}; Path=/; HttpOnly; SameSite=Lax; Max-Age=43200${new URL(c.req.url).protocol === 'https:' ? '; Secure' : ''}`,
    );
    return response;
  }
  if (!c.env.SESSION_SECRET) {
    return c.json({ ok: false, error: { code: 'SERVER_MISCONFIGURED', message: '認証設定が不足しています。' } }, 500);
  }
  const token = await signSession(buildSessionPayload(session.role, session.username, { registerId }), c.env.SESSION_SECRET);
  const response = c.json({ ok: true, data: { registerId, stationId, saleType: getRegisterSaleType(settings, registerId) } });
  response.headers.set('Set-Cookie', buildSessionCookie(token, new URL(c.req.url).protocol === 'https:'));
  return response;
});

app.get('/api/staff/register/current', async (c) => {
  const session = await requireRole(c, ['staff', 'admin', 'owner']);
  if (!session) return c.json({ ok: false, error: { code: 'UNAUTHORIZED', message: '未ログインです。' } }, 401);
  const settings = await getSettings(c.env.DB);
  const registerId = session.registerId ?? null;
  return c.json({
    ok: true,
    data: {
      registerId,
      stationId: registerId ? getRegisterStationId(settings, registerId) : null,
      saleType: registerId ? getRegisterSaleType(settings, registerId) : null,
    },
  });
});

app.get('/api/staff/register/config', async (c) => {
  const session = await requireRole(c, ['staff', 'admin', 'owner']);
  if (!session) return c.json({ ok: false, error: { code: 'UNAUTHORIZED', message: '未ログインです。' } }, 401);
  return c.json({ ok: true, data: { registers: getRegisterConfiguration(await getSettings(c.env.DB)) } });
});

app.get('/api/staff/register/recent-sales', async (c) => {
  const session = await requireRole(c, ['staff', 'admin', 'owner']);
  if (!session) return c.json({ ok: false, error: { code: 'UNAUTHORIZED', message: '未ログインです。' } }, 401);
  const registerId = session.role === 'staff' ? session.registerId : parseId(c.req.query('registerId')) ?? session.registerId;
  if (!registerId) return c.json({ ok: false, error: { code: 'REGISTER_NOT_SELECTED', message: 'レジを選択してください。' } }, 409);
  const items = await listRecentSalesForRegister(c.env.DB, registerId, parseLimit(c.req.query('limit'), 20, 100));
  return c.json({ ok: true, data: { items } });
});

app.get('/api/pickup/orders', async (c) => {
  const session = await requireRole(c, ['pickup', 'admin', 'owner']);
  if (!session) return c.json({ ok: false, error: { code: 'UNAUTHORIZED', message: '未ログインです。' } }, 401);
  const stationId = session.role === 'pickup' ? session.stationId : parseId(c.req.query('stationId')) ?? undefined;
  const saleType = getPickupSaleType(stationId);
  const requestedDate = c.req.query('date');
  await expireAndNotify(c);
  const items = await listFulfillmentOrders(c.env.DB, {
    stationId,
    saleType,
    pickupDate: requestedDate ?? (stationId === 4 ? undefined : getTokyoDate()),
    includeDelivered: c.req.query('includeDelivered') === 'true',
    query: c.req.query('q'),
    limit: parseLimit(c.req.query('limit'), 100, 500),
  });
  const drafts = stationId && stationId !== 4 ? await listCheckoutDrafts(c.env.DB, stationId, c.req.query('q')) : [];
  const draftItems = drafts.map((draft) => ({
    id: draft.id, sale_id: '', pickup_code: draft.pickup_code, register_id: draft.register_id, station_id: draft.station_id,
    pickup_date: draft.business_date, status: draft.status === 'awaiting_payment' ? 'pending' : 'canceled',
    paymentStatus: draft.status === 'awaiting_payment' ? 'awaiting_payment' : 'canceled', cancelReason: draft.cancel_reason,
    created_at: draft.created_at, delivered_at: null, cancel_acknowledged_at: draft.cancel_acknowledged_at,
    items: draft.items.map((item) => ({ product_id: item.product_id, product_name: item.product_name, quantity: item.quantity })),
  }));
  return c.json({ ok: true, data: { items: [...draftItems, ...items.map((item) => ({ ...item, paymentStatus: 'paid' as const, cancelReason: item.status === 'canceled' ? '会計取消' : '' }))] } });
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
  const rows = await c.env.DB.prepare('SELECT station_id FROM fulfillment_orders WHERE id = ? UNION ALL SELECT station_id FROM checkout_drafts WHERE id = ?').bind(orderId, orderId).all<{ station_id: number }>();
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
  const draft = await getCheckoutDraft(c.env.DB, orderId);
  if (draft && draft.status !== 'completed') {
    const ok = await acknowledgeDraftCancellation(c.env.DB, orderId, session.username);
    if (!ok) return c.json({ ok: false, error: { code: 'STATUS_CONFLICT', message: '取消確認済み、または注文状態が不正です。' } }, 409);
    await scheduleRealtimeEvent(c, toDraftRealtimeEvent((await getCheckoutDraft(c.env.DB, orderId))!, 'order.cancel_acknowledged'));
    return c.json({ ok: true, data: { updatedAt: new Date().toISOString() } });
  }
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
    limit: parseLimit(c.req.query('limit'), 100, 500),
  });
  return c.json({ ok: true, data: { items } });
});

app.get('/api/admin/fulfillment/summary', async (c) => {
  const session = await requireAdminOrOwner(c);
  if (!session) return c.json({ ok: false, error: { code: 'UNAUTHORIZED', message: '未ログインです。' } }, 401);
  const [summary, connected] = await Promise.all([
    getFulfillmentSummary(c.env.DB),
    Promise.all([1, 2, 3, 4].map(async (stationId) => ({ stationId, connections: await getRealtimeConnectionCount(c.env.REALTIME_HUB, `station-${stationId}`) }))),
  ]);
  return c.json({ ok: true, data: { ...summary, connected } });
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
  await expireAndNotify(c);
  const products = await queryProducts(c.env.DB);
  return c.json({
    ok: true,
    data: {
      items: products.map(toRegisterProduct),
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
  await expireAndNotify(c);
  const products = await queryProducts(c.env.DB);
  return c.json({
    ok: true,
    data: {
      items: products.map(toRegisterProduct),
    },
  });
});

app.post('/api/staff/register/checkout', async (c) => {
  return handleSaleCheckout(c);
});

app.post('/api/staff/register/checkout-drafts', async (c) => {
  const session = await requireRole(c, ['staff', 'admin', 'owner']);
  if (!session) return c.json({ ok: false, error: { code: 'UNAUTHORIZED', message: '未ログインです。' } }, 401);
  if (!session.registerId) return c.json({ ok: false, error: { code: 'REGISTER_NOT_SELECTED', message: 'レジを選択してください。' } }, 409);
  const parsed = checkoutDraftSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ ok: false, error: { code: 'INVALID_REQUEST', message: '商品確定内容が不正です。' } }, 400);
  const settings = await getSettings(c.env.DB);
  if ((settings.sales_open ?? 'true') !== 'true') return c.json({ ok: false, error: { code: 'SALES_CLOSED', message: '現在は販売を停止しています。' } }, 409);
  if (getRegisterSaleType(settings, session.registerId) !== 'normal') return c.json({ ok: false, error: { code: 'REGISTER_MODE_MISMATCH', message: 'このレジは通常販売ではありません。' } }, 403);
  try {
    await expireAndNotify(c);
    const draft = await createCheckoutDraft(c.env.DB, { ...parsed.data, registerId: session.registerId, stationId: getRegisterStationId(settings, session.registerId), role: session.role as 'staff' | 'admin' | 'owner', username: session.username });
    await scheduleRealtimeEvent(c, toDraftRealtimeEvent(draft, 'order.awaiting_payment'));
    return c.json({ ok: true, data: { draftId: draft.id, pickupCode: draft.pickup_code, status: draft.status, expiresAt: draft.expires_at, registerId: draft.register_id, stationId: draft.station_id, totalAmount: draft.total_amount, items: draft.items } });
  } catch (error) {
    const text = String(error);
    if (/INSUFFICIENT_STOCK/.test(text)) return c.json({ ok: false, error: { code: 'INSUFFICIENT_STOCK', message: '在庫が不足しています。' } }, 409);
    if (/IDEMPOTENCY_KEY_REUSED/.test(text)) return c.json({ ok: false, error: { code: 'IDEMPOTENCY_KEY_REUSED', message: '同じ会計キーに別の商品内容を指定できません。' } }, 409);
    if (/NOT_FOUND/.test(text)) return c.json({ ok: false, error: { code: 'NOT_FOUND', message: '商品が見つかりません。' } }, 404);
    return c.json({ ok: false, error: { code: 'DRAFT_CREATE_FAILED', message: '注文番号を発行できませんでした。' } }, 500);
  }
});

app.post('/api/staff/register/checkout-drafts/:draftId/complete', async (c) => {
  const session = await requireRole(c, ['staff', 'admin', 'owner']);
  if (!session) return c.json({ ok: false, error: { code: 'UNAUTHORIZED', message: '未ログインです。' } }, 401);
  const parsed = completeDraftSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ ok: false, error: { code: 'INVALID_REQUEST', message: '支払内容が不正です。' } }, 400);
  const draft = await getCheckoutDraft(c.env.DB, c.req.param('draftId'));
  if (!draft || (session.role === 'staff' && draft.register_id !== session.registerId)) return c.json({ ok: false, error: { code: 'DRAFT_NOT_FOUND', message: '会計待ち注文が見つかりません。' } }, 404);
  const result = await completeCheckoutDraft(c.env.DB, { draftId: draft.id, ...parsed.data, role: session.role as 'staff' | 'admin' | 'owner' });
  if ('error' in result && result.error) return c.json({ ok: false, error: { code: result.error.code, message: result.error.message } }, { status: result.error.status });
  if (!result.reused) await scheduleRealtimeEvent(c, toDraftRealtimeEvent(result.draft, 'order.payment_completed'));
  return c.json({ ok: true, data: { saleId: result.saleId, draftId: result.draft.id, pickupCode: result.draft.pickup_code, registerId: result.draft.register_id, stationId: result.draft.station_id, totalAmount: result.totalAmount, paidAmount: result.paidAmount, changeAmount: result.changeAmount, fulfillmentStatus: 'pending', createdAt: result.createdAt } });
});

app.post('/api/staff/register/checkout-drafts/:draftId/cancel', async (c) => {
  const session = await requireRole(c, ['staff', 'admin', 'owner']);
  if (!session) return c.json({ ok: false, error: { code: 'UNAUTHORIZED', message: '未ログインです。' } }, 401);
  const existing = await getCheckoutDraft(c.env.DB, c.req.param('draftId'));
  if (!existing || (session.role === 'staff' && existing.register_id !== session.registerId)) return c.json({ ok: false, error: { code: 'DRAFT_NOT_FOUND', message: '会計待ち注文が見つかりません。' } }, 404);
  const draft = await cancelCheckoutDraft(c.env.DB, existing.id);
  if (!draft || draft.status !== 'canceled') return c.json({ ok: false, error: { code: 'STATUS_CONFLICT', message: 'この注文はすでに確定または取消されています。' } }, 409);
  await scheduleRealtimeEvent(c, toDraftRealtimeEvent(draft, 'order.canceled'));
  return c.json({ ok: true, data: { draftId: draft.id, status: draft.status } });
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
  const settings = await getSettings(c.env.DB);
  const salesOpen = settings.sales_open ?? 'true';
  if (salesOpen !== 'true') {
    return c.json({ ok: false, error: { code: 'SALES_CLOSED', message: '現在は販売を停止しています。' } }, 409);
  }
  if (!session.registerId) {
    return c.json({ ok: false, error: { code: 'REGISTER_NOT_SELECTED', message: 'レジを選択してください。' } }, 409);
  }
  const registerId = session.registerId;
  try {
    const requestBody = await c.req.json().catch(() => null);
    const requestIdempotencyKey = typeof requestBody === 'object' && requestBody !== null && 'idempotencyKey' in requestBody && typeof requestBody.idempotencyKey === 'string'
      ? requestBody.idempotencyKey
      : undefined;
    const salesDay = parseSalesDay(settings.sales_day);
    const registerSaleType = getRegisterSaleType(settings, registerId);
    const result = await processSale(c.env.DB, session.role as 'staff' | 'admin' | 'owner', registerId, requestBody, {
      salesDay,
      registerSaleType,
      stationId: getRegisterStationId(settings, registerId),
    });
    if ('error' in result) {
      return c.json(
        {
          ok: false,
          error: { code: result.error.code, message: result.error.message },
        },
        { status: result.error.status },
      );
    }
    if (!result.reused) await scheduleRealtimeEvent(c, toCreatedRealtimeEvent(result));
    return c.json({
      ok: true,
      data: {
        saleId: result.saleId,
        totalAmount: result.totalAmount,
        paidAmount: result.paidAmount,
        changeAmount: result.changeAmount,
        idempotencyKey: requestIdempotencyKey,
        registerId: result.registerId,
        stationId: result.stationId,
        pickupCode: result.pickupCode,
        fulfillmentStatus: 'pending',
        createdAt: result.createdAt,
      },
    });
  } catch (error) {
    console.error(JSON.stringify({ message: 'checkout failed', error: String(error) }));
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

app.get('/api/staff/stock/noon-restock', async (c) => {
  const session = await requireAdminOrOwner(c);
  if (!session) {
    return c.json({ ok: false, error: { code: 'UNAUTHORIZED', message: '未ログインです。' } }, 401);
  }
  return c.json({ ok: true, data: await getNoonRestockStatus(c.env.DB, getTokyoDate()) });
});

app.post('/api/staff/stock/noon-restock', async (c) => {
  const session = await requireAdminOrOwner(c);
  if (!session) {
    return c.json({ ok: false, error: { code: 'UNAUTHORIZED', message: '未ログインです。' } }, 401);
  }
  const parsed = noonRestockSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ ok: false, error: { code: 'INVALID_REQUEST', message: '12時分の一括補充を確認できませんでした。' } }, 400);
  }
  const result = await applyNoonRestock(
    c.env.DB,
    session.role as 'admin' | 'owner',
    session.username,
    getTokyoDate(),
  );
  if ('error' in result) {
    return c.json({
      ok: false,
      error: {
        code: result.error,
        message: `補充対象の商品を確認できませんでした（${result.missingProductIds.join(', ')}）。`,
      },
    }, 409);
  }
  return c.json({ ok: true, data: result });
});

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
  const parsed = stockEventSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ ok: false, error: { code: 'INVALID_REQUEST', message: parsed.error.issues[0]?.message ?? '在庫変更内容が不正です。' } }, 400);
  }
  try {
    const result = await recordStockEvent(c.env.DB, session.role as 'admin' | 'owner', parsed.data);
    return c.json({ ok: true, data: result });
  } catch (error) {
    if (error instanceof Error && error.message === 'PRODUCT_NOT_FOUND') {
      return c.json({ ok: false, error: { code: 'NOT_FOUND', message: '商品が見つかりません。' } }, 404);
    }
    if (error instanceof Error && /CHECK constraint failed:.*current_stock/i.test(error.message)) {
      return c.json({ ok: false, error: { code: 'INSUFFICIENT_STOCK', message: '在庫数を0未満にはできません。' } }, 409);
    }
    throw error;
  }
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
  const parsed = cancelSaleSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ ok: false, error: { code: 'INVALID_REQUEST', message: '取消内容が不正です。' } }, 400);
  const body = parsed.data;
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
  const limit = parseLimit(c.req.query('limit'), 20, 100);
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
  if (!session) return ownerAccessDenied(c);
  const products = await queryProducts(c.env.DB);
  return c.json({ ok: true, data: { items: products.map(toAdminProduct) } });
});

app.get('/api/admin/settings', async (c) => {
  const session = await requireOwner(c);
  if (!session) return ownerAccessDenied(c);
  const settings = (await getSettingsSnapshot(c.env.DB, EDITABLE_SETTING_NAMES)).values;
  const safeSettings = sanitizeSettings(settings);
  return c.json({
    ok: true,
    data: {
      settings: {
        ...safeSettings,
        staff_username: safeSettings.staff_username ?? c.env.STAFF_USERNAME ?? 'staff',
        admin_username: safeSettings.admin_username ?? c.env.ADMIN_USERNAME ?? 'admin',
        owner_username: safeSettings.owner_username ?? c.env.OWNER_USERNAME ?? 'owner',
        ...Object.fromEntries([1, 2, 3].map((registerId) => {
          const key = `register_${registerId}_presale_enabled` as keyof typeof safeSettings;
          return [key, safeSettings[key] ?? 'false'];
        })),
        ...Object.fromEntries([1, 2, 3, 4].map((stationId) => {
          const key = `pickup_${stationId}_username` as keyof typeof safeSettings;
          const envValue = c.env[`PICKUP_${stationId}_USERNAME` as keyof Env];
          return [key, safeSettings[key] ?? (typeof envValue === 'string' ? envValue : `pickup-${stationId}`)];
        })),
      },
    },
  });
});

app.post('/api/admin/products', async (c) => {
  const session = await requireOwner(c);
  if (!session) return ownerAccessDenied(c);
  const parsed = productCreateSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ ok: false, error: { code: 'INVALID_REQUEST', message: '商品情報が不正です。' } }, 400);
  }
  const body = parsed.data;
  const now = new Date().toISOString();
  try {
    await c.env.DB.batch([
      c.env.DB.prepare(
        `INSERT INTO products (id, name, display_name, category, price, initial_stock, is_public, is_active, sort_order, allergy_text, description, note, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(body.id, body.name, body.displayName, body.category ?? '', body.price, body.initialStock, body.isPublic ? 1 : 0, body.isActive ? 1 : 0, body.sortOrder, body.allergyText, body.description, body.note, now, now),
      c.env.DB.prepare(
        `INSERT INTO product_inventory (product_id, current_stock, updated_at)
         VALUES (?, ?, ?)`,
      ).bind(body.id, body.initialStock, now),
    ]);
  } catch (error) {
    if (error instanceof Error && /UNIQUE constraint failed:.*products\.id/i.test(error.message)) {
      return c.json({ ok: false, error: { code: 'PRODUCT_ALREADY_EXISTS', message: '同じ商品IDがすでに存在します。' } }, 409);
    }
    throw error;
  }
  return c.json({ ok: true, data: { updatedAt: now } });
});

app.put('/api/admin/products/:id', async (c) => {
  const session = await requireOwner(c);
  if (!session) return ownerAccessDenied(c);
  const id = c.req.param('id');
  const parsed = productFieldsSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ ok: false, error: { code: 'INVALID_REQUEST', message: '商品情報が不正です。' } }, 400);
  }
  const body = parsed.data;
  const now = new Date().toISOString();
  const results = await c.env.DB.batch([
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
  if ((results[0]?.meta.changes ?? 0) === 0) {
    return c.json({ ok: false, error: { code: 'NOT_FOUND', message: '商品が見つかりません。' } }, 404);
  }
  return c.json({ ok: true, data: { updatedAt: now } });
});

app.delete('/api/admin/products/:id', async (c) => {
  const session = await requireOwner(c);
  if (!session) return ownerAccessDenied(c);
  const id = c.req.param('id');
  const parsed = deleteConfirmationSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ ok: false, error: { code: 'INVALID_REQUEST', message: '確認内容が不正です。' } }, 400);
  const body = parsed.data;
  if (body.confirmation !== '消去') {
    return c.json({ ok: false, error: { code: 'CONFIRMATION_REQUIRED', message: '確認欄に「消去」と入力してください。' } }, 400);
  }
  const now = new Date().toISOString();
  const result = await c.env.DB.prepare(
    'UPDATE products SET is_public = 0, is_active = 0, deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL',
  ).bind(now, now, id).run();
  if ((result.meta.changes ?? 0) === 0) {
    return c.json({ ok: false, error: { code: 'NOT_FOUND', message: '商品が見つかりません。' } }, 404);
  }
  return c.json({ ok: true, data: { deleted: true, preservedHistory: true, updatedAt: now } });
});

app.post('/api/admin/settings', async (c) => {
  const session = await requireOwner(c);
  if (!session) return ownerAccessDenied(c);
  const parsed = settingEntrySchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ ok: false, error: { code: 'INVALID_REQUEST', message: '設定内容が不正です。' } }, 400);
  }
  const body = parsed.data;
  const update = editableSettingsSchema.safeParse({ [body.key]: body.value });
  if (!update.success) {
    return c.json({ ok: false, error: { code: 'INVALID_REQUEST', message: update.error.issues[0]?.message ?? '設定内容が不正です。' } }, 400);
  }
  const current = await getSettings(c.env.DB);
  const thresholds = validateThresholdOrder(update.data, current);
  if (!thresholds.ok) {
    return c.json({ ok: false, error: { code: 'INVALID_THRESHOLDS', message: thresholds.message } }, 400);
  }
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
  if (!session) return ownerAccessDenied(c);
  const parsed = editableSettingsSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ ok: false, error: { code: 'INVALID_REQUEST', message: parsed.error.issues[0]?.message ?? '設定内容が不正です。' } }, 400);
  }
  const body = parsed.data;
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
  const current = await getSettings(c.env.DB);
  const thresholds = validateThresholdOrder(body, current);
  if (!thresholds.ok) {
    return c.json({ ok: false, error: { code: 'INVALID_THRESHOLDS', message: thresholds.message } }, 400);
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
  const summary = await queryAdminSummary(c.env.DB);
  return c.json({
    ok: true,
    data: summary,
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
  const limit = parseLimit(c.req.query('limit'), 100, 500);
  const sales = await querySalesByFilter(c.env.DB, { query, limit });
  const saleIds = sales.map((sale) => sale.id);
  const items = await querySaleItemsForSales(c.env.DB, saleIds);
  const grouped = new Map<
    string,
    Array<{
      product_id: string;
      quantity: number;
      unit_price: number;
      subtotal: number;
    }>
  >();
  for (const row of items) {
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
  return createCsvResponse(
    'sales.csv',
    SALES_CSV_HEADER,
    (limit, offset) => listSalesCsvPage(c.env.DB, limit, offset),
    salesCsvLine,
  );
});

app.get('/api/admin/export/stock-events.csv', async (c) => {
  const session = await requireAdminOrOwner(c);
  if (!session) return c.text('unauthorized', 401);
  return createCsvResponse(
    'stock-events.csv',
    STOCK_EVENTS_CSV_HEADER,
    (limit, offset) => listStockEventsCsvPage(c.env.DB, limit, offset),
    stockEventCsvLine,
  );
});

export { app };
export default app;
