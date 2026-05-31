import type { SessionPayload } from './types';

function base64UrlEncode(input: ArrayBufferLike): string {
  const bytes = new Uint8Array(input);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlDecode(input: string): Uint8Array {
  const base64 = input.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(input.length / 4) * 4, '=');
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export async function signSession(payload: SessionPayload, secret: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(JSON.stringify(payload));
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
  ]);
  const signature = await crypto.subtle.sign('HMAC', key, data);
  return `${base64UrlEncode(data.buffer)}.${base64UrlEncode(signature)}`;
}

export async function verifySession(token: string, secret: string): Promise<SessionPayload | null> {
  const [payloadPart, signaturePart] = token.split('.');
  if (!payloadPart || !signaturePart) return null;
  const encoder = new TextEncoder();
  const payloadBytes = base64UrlDecode(payloadPart);
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
  ]);
  const expected = await crypto.subtle.sign('HMAC', key, payloadBytes as unknown as BufferSource);
  const actual = base64UrlDecode(signaturePart);
  if (expected.byteLength !== actual.byteLength) return null;
  const expectedBytes = new Uint8Array(expected);
  for (let i = 0; i < expectedBytes.length; i += 1) {
    if (expectedBytes[i] !== actual[i]) return null;
  }
  const payload = JSON.parse(new TextDecoder().decode(payloadBytes)) as SessionPayload;
  if (payload.exp < Date.now()) return null;
  return payload;
}
