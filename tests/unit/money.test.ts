import { describe, expect, it } from 'vitest';
import { formatYen } from '../../src/lib/money';

describe('formatYen', () => {
  it('円表記で整形する', () => {
    expect(formatYen(750)).toMatch(/750/);
  });
});

