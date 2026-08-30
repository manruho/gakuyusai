/**
 * D1 limits LIKE/GLOB patterns to 50 bytes. The two wildcard characters we
 * add around a user query consume two of those bytes, so keep the actual
 * search term within the remaining budget.
 */
export const MAX_SEARCH_TERM_BYTES = 48;

export function normalizeSearchTerm(value: string | null | undefined): string {
  const normalized = value?.trim().toLowerCase() ?? '';
  if (!normalized) return '';

  const encoder = new TextEncoder();
  if (encoder.encode(normalized).byteLength <= MAX_SEARCH_TERM_BYTES) return normalized;

  let result = '';
  let bytes = 0;
  for (const character of normalized) {
    const characterBytes = encoder.encode(character).byteLength;
    if (bytes + characterBytes > MAX_SEARCH_TERM_BYTES) break;
    result += character;
    bytes += characterBytes;
  }
  return result;
}
