import { describe, expect, it } from 'vitest';
import { getStockLevel, getStockLevelWithThresholds, getStockStatusText } from '../../src/lib/stockLevel';

describe('getStockLevel', () => {
  it('在庫が0以下の場合は売り切れとして扱う', () => {
    expect(getStockLevel(0, 10)).toBe(0);
    expect(getStockLevel(-1, 10)).toBe(0);
  });

  it('在庫率が15%以下ならあとちょっとだよを返す', () => {
    expect(getStockLevel(1, 10)).toBe(0);
  });

  it('在庫率が35%以下ならまだすこしのこってるよを返す', () => {
    expect(getStockLevel(3, 10)).toBe(1);
  });

  it('在庫率が65%以下ならけっこうのこってるよを返す', () => {
    expect(getStockLevel(6, 10)).toBe(2);
  });

  it('在庫率がそれ以上ならまだまだあるよを返す', () => {
    expect(getStockLevel(8, 10)).toBe(3);
  });
});

describe('getStockStatusText', () => {
  it('ステータス段階に対応する文言を返す', () => {
    expect(getStockStatusText(0)).toBe('あとちょっとだよ');
  });
});

describe('getStockLevelWithThresholds', () => {
  it('しきい値設定を変えると段階が変わる', () => {
    expect(
      getStockLevelWithThresholds(5, 10, {
        low: 0.4,
        mid: 0.6,
        high: 0.8,
      }),
    ).toBe(1);
    expect(
      getStockLevelWithThresholds(7, 10, {
        low: 0.4,
        mid: 0.6,
        high: 0.8,
      }),
    ).toBe(2);
  });
});
