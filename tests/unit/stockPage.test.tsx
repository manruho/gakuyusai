import { cleanup, render, screen } from '@testing-library/react';
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
      return new Response(JSON.stringify({ ok: true, data: { items: [] } }), { status: 200 });
    });

    render(<StockPage />);

    expect(await screen.findByRole('heading', { name: '商品別 在庫一覧' })).toBeVisible();
    expect(await screen.findByRole('heading', { name: '鮭' })).toBeVisible();
    expect(screen.getByText('残り')).toBeVisible();
    expect(screen.getByText('／ 初期 30')).toBeVisible();
    expect(screen.getByText('販売済み 7')).toBeVisible();
    expect(screen.getByText('40% 残')).toBeVisible();
  });
});
