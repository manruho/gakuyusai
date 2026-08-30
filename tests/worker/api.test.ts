import { env } from 'cloudflare:workers';
import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { app } from '../../worker/app';

async function request(path: string, init: RequestInit = {}): Promise<Response> {
  const context = createExecutionContext();
  const response = await app.request(`https://worker.test${path}`, init, env, context);
  await waitOnExecutionContext(context);
  return response;
}

async function login(role: 'admin' | 'owner'): Promise<string> {
  const response = await request('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': `192.0.2.${role === 'owner' ? 10 : 11}` },
    body: JSON.stringify({ loginTarget: role, password: `${role}-test-password` }),
  });
  expect(response.status).toBe(200);
  const cookie = response.headers.get('Set-Cookie');
  expect(cookie).toContain('session=');
  return cookie?.split(';')[0] ?? '';
}

function jsonRequest(method: string, body: unknown, cookie?: string, ip?: string): RequestInit {
  return {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(cookie ? { Cookie: cookie } : {}),
      ...(ip ? { 'CF-Connecting-IP': ip } : {}),
    },
    body: JSON.stringify(body),
  };
}

describe('Workers API with a real D1 binding', () => {
  it('protects private APIs and never exposes exact stock or credential hashes publicly', async () => {
    const unauthorized = await request('/api/register/products');
    expect(unauthorized.status).toBe(401);
    expect(unauthorized.headers.get('Cache-Control')).toBe('private, no-store');

    const response = await request('/api/public/status?case=redaction');
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('public, max-age=10, s-maxage=30');
    const text = await response.text();
    expect(text).not.toContain('currentStock');
    expect(text).not.toContain('current_stock');
    expect(text).not.toContain('password_hash');
  });

  it('serves repeated public status requests from the Cache API for the configured TTL', async () => {
    const path = '/api/public/status';
    const cache = await caches.open('gakuyusai-public-status-v1');
    await cache.delete(new Request('https://worker.test/api/public/status'));
    const before = await (await request(path)).text();
    await env.DB.prepare('UPDATE product_inventory SET current_stock = 0, updated_at = ? WHERE product_id = ?')
      .bind(new Date().toISOString(), 'drink_water').run();
    const cached = await (await request(path)).text();
    await cache.delete(new Request('https://worker.test/api/public/status'));
    const uncached = await (await request(path)).text();
    expect(cached).toBe(before);
    expect(uncached).not.toBe(before);
  });

  it('returns 403 for an authenticated admin calling owner-only APIs', async () => {
    const cookie = await login('admin');
    const response = await request('/api/admin/products', { headers: { Cookie: cookie } });
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
  });

  it('redacts hashes and validates setting names and threshold ordering', async () => {
    const cookie = await login('owner');
    const settingsResponse = await request('/api/admin/settings', { headers: { Cookie: cookie } });
    expect(await settingsResponse.text()).not.toContain('password_hash');

    const secretWrite = await request('/api/admin/settings', jsonRequest('PUT', {
      owner_password_hash: 'pbkdf2_sha256$100000$salt$hash',
    }, cookie));
    expect(secretWrite.status).toBe(400);

    const invalidOrder = await request('/api/admin/settings', jsonRequest('PUT', {
      threshold_low: '0.8', threshold_mid: '0.3', threshold_high: '0.6',
    }, cookie));
    expect(invalidOrder.status).toBe(400);
    await expect(invalidOrder.json()).resolves.toMatchObject({ error: { code: 'INVALID_THRESHOLDS' } });

    const valid = await request('/api/admin/settings', jsonRequest('PUT', {
      threshold_low: '0.1', threshold_mid: '0.4', threshold_high: '0.7',
    }, cookie));
    expect(valid.status).toBe(200);
  });

  it('rejects duplicate products, returns 404 on missing updates, and always soft-deletes', async () => {
    const cookie = await login('owner');
    const product = {
      id: 'integration-product',
      name: 'integration-product',
      displayName: '統合テスト商品',
      category: 'その他',
      price: 300,
      initialStock: 10,
      isPublic: true,
      isActive: true,
      sortOrder: 999,
      allergyText: '',
      description: '',
      note: '',
    };
    expect((await request('/api/admin/products', jsonRequest('POST', product, cookie))).status).toBe(200);
    expect((await request('/api/admin/products', jsonRequest('POST', product, cookie))).status).toBe(409);
    expect((await request('/api/stock/events', jsonRequest('POST', {
      productId: product.id, eventType: 'restock', quantityDelta: 2, reason: 'test',
    }, cookie))).status).toBe(200);
    expect((await request(`/api/admin/products/${product.id}`, jsonRequest('DELETE', { confirmation: '消去' }, cookie))).status).toBe(200);
    const archived = await env.DB.prepare('SELECT is_active, is_public, deleted_at FROM products WHERE id = ?')
      .bind(product.id).first<{ is_active: number; is_public: number; deleted_at: string | null }>();
    expect(archived).toMatchObject({ is_active: 0, is_public: 0 });
    expect(archived?.deleted_at).not.toBeNull();

    const missing = await request('/api/admin/products/missing-product', jsonRequest('PUT', {
      ...product,
      id: undefined,
    }, cookie));
    expect(missing.status).toBe(404);
  });

  it('counts completed sale quantities independently from restock events', async () => {
    let cookie = await login('owner');
    const select = await request('/api/staff/register/select', jsonRequest('POST', { registerId: 1 }, cookie));
    expect(select.status).toBe(200);
    cookie = select.headers.get('Set-Cookie')?.split(';')[0] ?? '';

    const sale = await request('/api/sales', jsonRequest('POST', {
      idempotencyKey: crypto.randomUUID(),
      saleType: 'normal',
      paymentMethod: 'cash',
      paidAmount: 1000,
      items: [{ productId: 'onigiri_shio', quantity: 2 }],
    }, cookie));
    expect(sale.status, await sale.clone().text()).toBe(200);
    expect((await request('/api/stock/events', jsonRequest('POST', {
      productId: 'onigiri_shio', eventType: 'restock', quantityDelta: 5, reason: 'test',
    }, cookie))).status).toBe(200);

    const stock = await request('/api/stock', { headers: { Cookie: cookie } });
    const body = await stock.json<{ data: { items: Array<{ id: string; sold_quantity: number }> } }>();
    expect(body.data.items.find((item) => item.id === 'onigiri_shio')?.sold_quantity).toBe(2);

    const csv = await request('/api/admin/export/sales.csv', { headers: { Cookie: cookie } });
    expect(csv.headers.get('Content-Disposition')).toBe('attachment; filename="sales.csv"');
    expect(await csv.text()).toContain('onigiri_shio');
  });

  it('commits a concurrent idempotent checkout only once', async () => {
    let cookie = await login('owner');
    const select = await request('/api/staff/register/select', jsonRequest('POST', { registerId: 1 }, cookie));
    cookie = select.headers.get('Set-Cookie')?.split(';')[0] ?? '';
    const before = await env.DB.prepare('SELECT current_stock FROM product_inventory WHERE product_id = ?')
      .bind('onigiri_shio').first<{ current_stock: number }>();
    const idempotencyKey = crypto.randomUUID();
    const saleRequest = jsonRequest('POST', {
      idempotencyKey,
      saleType: 'normal',
      paymentMethod: 'cash',
      paidAmount: 500,
      items: [{ productId: 'onigiri_shio', quantity: 1 }],
    }, cookie);
    const responses = await Promise.all([
      request('/api/sales', saleRequest),
      request('/api/sales', saleRequest),
    ]);
    expect(
      responses.map((response) => response.status),
      (await Promise.all(responses.map((response) => response.clone().text()))).join('\n'),
    ).toEqual([200, 200]);
    const bodies = await Promise.all(responses.map((response) => response.json<{ data: { saleId: string } }>()));
    expect(bodies[0].data.saleId).toBe(bodies[1].data.saleId);
    const after = await env.DB.prepare('SELECT current_stock FROM product_inventory WHERE product_id = ?')
      .bind('onigiri_shio').first<{ current_stock: number }>();
    expect(after?.current_stock).toBe((before?.current_stock ?? 0) - 1);
    const sales = await env.DB.prepare('SELECT COUNT(*) AS count FROM sales WHERE idempotency_key = ?')
      .bind(idempotencyKey).first<{ count: number }>();
    expect(sales?.count).toBe(1);
  });

  it('atomically locks concurrent failures and bounds unknown usernames to one subject per IP', async () => {
    const ip = '192.0.2.30';
    const failures = await Promise.all(Array.from({ length: 5 }, () => request(
      '/api/auth/login',
      jsonRequest('POST', { loginTarget: 'admin', password: 'wrong' }, undefined, ip),
    )));
    expect(failures.filter((response) => response.status === 429)).toHaveLength(1);
    const locked = await request('/api/auth/login', jsonRequest('POST', {
      loginTarget: 'admin', password: 'admin-test-password',
    }, undefined, ip));
    expect(locked.status).toBe(429);

    await Promise.all(['one', 'two', 'three'].map((username) => request(
      '/api/auth/login',
      jsonRequest('POST', { username, password: 'wrong' }, undefined, '192.0.2.31'),
    )));
    const count = await env.DB.prepare("SELECT COUNT(*) AS count FROM login_attempts WHERE throttle_key LIKE 'unknown:%'")
      .first<{ count: number }>();
    expect(count?.count).toBe(1);
  });
});
