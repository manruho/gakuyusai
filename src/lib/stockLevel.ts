import type { StockLevel } from './types';

const STATUS_TEXTS: Record<StockLevel, string> = {
  0: 'あとちょっとだよ',
  1: 'まだすこしのこってるよ',
  2: 'けっこうのこってるよ',
  3: 'まだまだあるよ',
};

/**
 * 在庫率から公開ページ用の4段階ステータスを計算する。
 *
 * 正確な在庫数は一般客に返さず、段階表示だけを返す。
 */
export function getStockLevel(currentStock: number, initialStock: number): StockLevel {
  return getStockLevelWithThresholds(currentStock, initialStock);
}

/**
 * 在庫率としきい値設定から公開ページ用の4段階ステータスを計算する。
 *
 * 正確な在庫数は一般客に返さず、段階表示だけを返す。
 */
export function getStockLevelWithThresholds(
  currentStock: number,
  initialStock: number,
  thresholds = { low: 0.15, mid: 0.35, high: 0.65 },
): StockLevel {
  if (currentStock <= 0 || initialStock <= 0) {
    return 0;
  }
  const ratio = currentStock / initialStock;
  if (ratio <= thresholds.low) return 0;
  if (ratio <= thresholds.mid) return 1;
  if (ratio <= thresholds.high) return 2;
  return 3;
}

export function getStockStatusText(level: StockLevel): string {
  return STATUS_TEXTS[level];
}
