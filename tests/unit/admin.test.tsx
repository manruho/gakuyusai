import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AdminPage } from '../../src/app/routes/AdminPage';

function jsonResponse(body: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  }));
}

function mockAdminApi(role: 'admin' | 'owner') {
  return vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
    const path = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    if (path === '/api/auth/me') {
      return jsonResponse({ ok: true, data: { username: role, role } });
    }
    if (path === '/api/admin/summary') {
      return jsonResponse({ ok: true, data: { totalSales: 0, completedSales: 0, totalProducts: 1, totalQuantity: 0 } });
    }
    if (path.startsWith('/api/admin/sales')) {
      return jsonResponse({ ok: true, data: { items: [] } });
    }
    if (path === '/api/admin/products') {
      return jsonResponse({
        ok: true,
        data: {
          items: [{
            id: 'onigiri',
            name: 'onigiri',
            displayName: 'おにぎり',
            category: 'おにぎり',
            price: 200,
            initialStock: 10,
            currentStock: 8,
            isPublic: true,
            isActive: true,
            sortOrder: 1,
            allergyText: '',
            description: '',
            note: '',
          }],
        },
      });
    }
    if (path === '/api/admin/settings') {
      return jsonResponse({ ok: true, data: { settings: {} } });
    }
    return jsonResponse({ ok: false, error: { message: 'unexpected request' } }, 404);
  });
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('AdminPage permissions', () => {
  it('adminにはowner専用の商品・設定操作を表示しない', async () => {
    const fetchMock = mockAdminApi('admin');
    render(<AdminPage />);

    await screen.findByRole('heading', { name: '販売履歴' });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/auth/me'));
    expect(screen.queryByRole('link', { name: '商品マスタ' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'システム設定' })).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalledWith('/api/admin/products');
    expect(fetchMock).not.toHaveBeenCalledWith('/api/admin/settings');
  });

  it('ownerには商品DTOの表示名を編集欄へ表示する', async () => {
    mockAdminApi('owner');
    render(<AdminPage />);

    await screen.findByRole('heading', { name: '商品マスタ' });
    expect(screen.getAllByDisplayValue('おにぎり').some((element) => element.tagName === 'INPUT')).toBe(true);
    expect(screen.getByRole('heading', { name: 'システム設定' })).toBeInTheDocument();
    expect(screen.queryByText(/password hash/i)).not.toBeInTheDocument();
    expect(screen.getByText(/パスワードハッシュはブラウザへ返さず/)).toBeInTheDocument();
  });
});
