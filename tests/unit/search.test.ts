import { describe, expect, it } from 'vitest';
import { MAX_SEARCH_TERM_BYTES, normalizeSearchTerm } from '../../worker/services/searchService';

describe('search term normalization', () => {
  it('trims and lowercases the search term', () => {
    expect(normalizeSearchTerm('  ABC-123  ')).toBe('abc-123');
  });

  it('keeps the LIKE pattern within D1 byte limits without splitting UTF-8 characters', () => {
    const value = normalizeSearchTerm('あ'.repeat(100));
    expect(new TextEncoder().encode(value).byteLength).toBeLessThanOrEqual(MAX_SEARCH_TERM_BYTES);
    expect(value).toMatch(/^あ+$/);
  });
});
