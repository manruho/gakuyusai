import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StockPage } from '../../src/app/routes/StockPage';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('StockPage inventory overview', () => {
  it('商品ごとの初期数、残数、販売済み数、残り割合を一覧表示する', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const path = String(input);
      if (path === '/api/staff/stock') {
        return new Response(JSON.stringify({ ok: true, data: { items: [
          { id: 'salmon', display_name: '鮭', category: 'おにぎり', price: 300, initial_stock: 30, current_stock: 12, sold_quantity: 7 },
        ] } }), { status: 200 });
      }
      if (path === '/api/staff/stock/noon-restock') {
        return new Response(JSON.stringify({ ok: true, data: {
          businessDate: '2026-09-05', applied: false, alreadyApplied: false,
          itemCount: 17, totalQuantity: 665, appliedAt: null, appliedByUsername: null, items: [],
        } }), { status: 200 });
      }
      return new Response(JSON.stringify({ ok: true, data: { items: [] } }), { status: 200 });
    });

    render(<StockPage />);

    expect(await screen.findByRole('heading', { name: '商品別 在庫一覧' })).toBeVisible();
    expect(await screen.findByRole('heading', { name: '鮭' })).toBeVisible();
    expect(screen.getByText('残り')).toBeVisible();
    expect(screen.getByText('／ 初期 30')).toBeVisible();
    expect(screen.getByText('販売済み 7')).toBeVisible();
    expect(screen.getByText('40% 残')).toBeVisible();
    expect(await screen.findByRole('button', { name: '12時分を一括補充' })).toBeEnabled();
    expect(screen.getByText('本日分は未実施です。')).toBeVisible();
  });

  it('確認後に12時分を手動で一括補充し、実施済み表示へ切り替える', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const path = String(input);
      if (path === '/api/staff/stock') {
        return new Response(JSON.stringify({ ok: true, data: { items: [] } }), { status: 200 });
      }
      if (path.startsWith('/api/staff/stock/history')) {
        return new Response(JSON.stringify({ ok: true, data: { items: [] } }), { status: 200 });
      }
      if (path === '/api/staff/stock/noon-restock' && init?.method === 'POST') {
        return new Response(JSON.stringify({ ok: true, data: {
          businessDate: '2026-09-05', applied: true, alreadyApplied: false,
          itemCount: 17, totalQuantity: 665, appliedAt: '2026-09-05T03:00:00.000Z', appliedByUsername: 'admin', items: [],
        } }), { status: 200 });
      }
      if (path === '/api/staff/stock/noon-restock') {
        return new Response(JSON.stringify({ ok: true, data: {
          businessDate: '2026-09-05', applied: false, alreadyApplied: false,
          itemCount: 17, totalQuantity: 665, appliedAt: null, appliedByUsername: null, items: [],
        } }), { status: 200 });
      }
      return new Response(JSON.stringify({ ok: false, error: { message: 'unexpected request' } }), { status: 404 });
    });

    render(<StockPage />);
    fireEvent.click(await screen.findByRole('button', { name: '12時分を一括補充' }));

    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('17商品・合計665個'));
    await screen.findByRole('button', { name: '本日分は実施済み' });
    expect(screen.getByText('12時分の在庫を一括補充しました。')).toBeVisible();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      '/api/staff/stock/noon-restock',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ confirmation: 'APPLY_NOON_RESTOCK' }),
      }),
    ));
  });
});
