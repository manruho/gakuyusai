import { describe, expect, it } from 'vitest';
import { generatePickupCode, getPresaleLimit, getPresalePickupStartDate, PICKUP_CODE_CHARS } from '../../worker/services/saleService';
import { getPickupSaleType, getTokyoDate, isPickupAvailable, resolvePickupOrderScope } from '../../worker/services/fulfillmentService';

describe('pickup code', () => {
  it('手書きで間違えやすい文字を含まない4文字コードを生成する', () => {
    const forbidden = /[012568BGILOSZ]/;
    for (let index = 0; index < 100; index += 1) {
      const code = generatePickupCode();
      expect(code).toHaveLength(4);
      expect(code).toMatch(/^[A-Z2-9]+$/);
      expect(code).not.toMatch(forbidden);
      expect([...code].every((char) => PICKUP_CODE_CHARS.includes(char))).toBe(true);
    }
  });

  it('前売り券用の6文字コードを生成できる', () => {
    const code = generatePickupCode(6);
    expect(code).toHaveLength(6);
    expect([...code].every((char) => PICKUP_CODE_CHARS.includes(char))).toBe(true);
    expect(code).not.toMatch(/[2Z]/);
  });
});

describe('pickup station routing', () => {
  it('受取1〜3は通常注文、受取4は前売り注文を表示する', () => {
    expect(getPickupSaleType(1)).toBe('normal');
    expect(getPickupSaleType(2)).toBe('normal');
    expect(getPickupSaleType(3)).toBe('normal');
    expect(getPickupSaleType(4)).toBe('presale_pickup');
    expect(getPickupSaleType(undefined)).toBeUndefined();
  });

  it('受取場所に対応する販売種別と受取日を一覧条件へ反映する', () => {
    expect(resolvePickupOrderScope({ stationId: 1, saleType: 'presale_pickup', pickupDate: '2026-08-26' })).toEqual({
      saleType: 'normal',
      pickupDate: '2026-08-26',
      pickupDateFrom: undefined,
    });
    expect(resolvePickupOrderScope({ stationId: 4, saleType: 'normal', pickupDate: '2026-08-26' })).toEqual({
      saleType: 'presale_pickup',
      pickupDate: '2026-08-26',
      pickupDateFrom: undefined,
    });
  });

  it('受取4では本日以降の予約を一覧条件へ反映できる', () => {
    expect(resolvePickupOrderScope({ stationId: 4, pickupDateFrom: '2026-08-26' })).toEqual({
      saleType: 'presale_pickup',
      pickupDate: undefined,
      pickupDateFrom: '2026-08-26',
    });
  });
});

describe('pickup date in Japan', () => {
  it('UTC日付ではなく日本時間の日付で受取可否を判定する', () => {
    const justBeforeMidnightUtc = new Date('2026-08-26T15:30:00.000Z');
    expect(getTokyoDate(justBeforeMidnightUtc)).toBe('2026-08-27');
    expect(isPickupAvailable('2026-08-27', justBeforeMidnightUtc)).toBe(true);
    expect(isPickupAvailable('2026-08-28', justBeforeMidnightUtc)).toBe(false);
  });

  it('前売り券は受取開始日当日から期限なく受け取れる', () => {
    const now = new Date('2026-08-26T03:00:00.000Z');
    const startDate = getPresalePickupStartDate(now);
    expect(startDate).toBe('2026-08-27');
    expect(isPickupAvailable(startDate, now)).toBe(false);
    expect(isPickupAvailable(startDate, new Date('2026-08-27T03:00:00.000Z'))).toBe(true);
    expect(isPickupAvailable('2026-08-28', new Date('2026-08-28T03:00:00.000Z'))).toBe(true);
    expect(isPickupAvailable('2026-08-29', new Date('2026-08-30T03:00:00.000Z'))).toBe(true);
    expect(isPickupAvailable('2026-08-27', new Date('2026-08-26T03:00:00.000Z'))).toBe(false);
  });
});

describe('presale product limit', () => {
  it('初期在庫の30%を切り捨てる', () => {
    expect(getPresaleLimit(35)).toBe(10);
    expect(getPresaleLimit(54)).toBe(16);
    expect(getPresaleLimit(10)).toBe(3);
    expect(getPresaleLimit(0)).toBe(0);
  });
});
