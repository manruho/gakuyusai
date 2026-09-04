import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PublicPage } from '../../src/app/routes/PublicPage';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('PublicPage allergy information', () => {
  it('共通注意事項と商品別アレルギーを表示する', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      ok: true,
      data: {
        shopName: 'おむすび米米',
        updatedAt: '2026-09-05T03:00:00.000Z',
        isPublicEnabled: true,
        items: [{
          id: 'onigiri_okaka_official',
          displayName: 'おかか',
          category: 'おにぎり',
          price: 250,
          isSoldOut: false,
          statusLevel: 3,
          allergyText: '小麦、大豆、さば',
          note: '',
        }],
      },
    }), { headers: { 'Content-Type': 'application/json' } }));

    render(<PublicPage />);

    expect(screen.getByRole('heading', { name: 'アレルギーについて' })).toBeVisible();
    expect(screen.getByText(/すべての商品を同じ製造工程・同じ調理器具で調理しているため/)).toBeVisible();
    expect(screen.getByText('海苔には小麦・大豆が含まれます。')).toBeVisible();
    expect(screen.getByText(/マヨネーズ（卵・大豆）/)).toBeVisible();
    expect(await screen.findByText('アレルギー: 小麦・大豆・さば')).toBeVisible();
  });
});
