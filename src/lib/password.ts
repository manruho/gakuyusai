function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export async function hashPassword(password: string, salt = crypto.randomUUID()): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  const saltBytes = encoder.encode(salt);
  const derivedBits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: saltBytes, iterations: 100000 },
    key,
    256,
  );
  return `pbkdf2_sha256$100000$${salt}$${bytesToBase64(new Uint8Array(derivedBits))}`;
}

export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const parts = encoded.split('$');
  if (parts.length !== 4) return password === encoded;
  const [, iterationsText, salt, hash] = parts;
  const iterations = Number(iterationsText);
  if (!Number.isFinite(iterations) || iterations <= 0) return false;
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  const saltBytes = encoder.encode(salt);
  const derivedBits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: saltBytes, iterations },
    key,
    256,
  );
  return bytesToBase64(new Uint8Array(derivedBits)) === hash;
}
