import { describe, expect, it } from 'vitest';
import { stockEventSchema } from '../../worker/services/stockService';

describe('stockEventSchema', () => {
  it('補充は正数、廃棄は負数だけを受け付ける', () => {
    expect(stockEventSchema.safeParse({ productId: 'item', eventType: 'restock', quantityDelta: 5 }).success).toBe(true);
    expect(stockEventSchema.safeParse({ productId: 'item', eventType: 'restock', quantityDelta: -1 }).success).toBe(false);
    expect(stockEventSchema.safeParse({ productId: 'item', eventType: 'discard', quantityDelta: -1 }).success).toBe(true);
    expect(stockEventSchema.safeParse({ productId: 'item', eventType: 'discard', quantityDelta: 1 }).success).toBe(false);
  });

  it('棚卸し補正は正負と差分0を受け付ける', () => {
    for (const quantityDelta of [-10, 0, 10]) {
      expect(stockEventSchema.safeParse({ productId: 'item', eventType: 'adjust', quantityDelta }).success).toBe(true);
    }
  });

  it('小数や過大な差分を拒否する', () => {
    expect(stockEventSchema.safeParse({ productId: 'item', eventType: 'adjust', quantityDelta: 0.5 }).success).toBe(false);
    expect(stockEventSchema.safeParse({ productId: 'item', eventType: 'adjust', quantityDelta: 1_000_001 }).success).toBe(false);
  });
});
