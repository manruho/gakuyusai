import { describe, expect, it } from 'vitest';
import { generatePickupCode, PICKUP_CODE_CHARS } from '../../worker/services/saleService';

describe('pickup code', () => {
  it('手書きで間違えやすい文字を含まない4文字コードを生成する', () => {
    const forbidden = /[0168BGILOS]/;
    for (let index = 0; index < 100; index += 1) {
      const code = generatePickupCode();
      expect(code).toHaveLength(4);
      expect(code).toMatch(/^[A-Z2-9]+$/);
      expect(code).not.toMatch(forbidden);
      expect([...code].every((char) => PICKUP_CODE_CHARS.includes(char))).toBe(true);
    }
  });
});
