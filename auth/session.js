const encoder = new TextEncoder();
export const sessionCookie = 'smart_farm_session';
const sessionSeconds = 7 * 24 * 60 * 60;

export async function sha256(value) {
  const bytes = await crypto.subtle.digest('SHA-256', encoder.encode(value));
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
}

async function keyFor(secret) {
  return crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

function base64url(bytes) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes))).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

export async function createSession(secret) {
  const expires = Date.now() + sessionSeconds * 1000;
  const payload = `${expires}.${crypto.randomUUID()}`;
  const signature = await crypto.subtle.sign('HMAC', await keyFor(secret), encoder.encode(payload));
  return `${payload}.${base64url(signature)}`;
}

export async function verifySession(secret, token) {
  try {
    const [expires, nonce, signature, extra] = String(token || '').split('.');
    if (extra || !/^\d{13}$/.test(expires) || !/^[0-9a-f-]{36}$/.test(nonce) || Number(expires) <= Date.now()) return false;
    const encoded = signature.replaceAll('-', '+').replaceAll('_', '/');
    const bytes = Uint8Array.from(atob(encoded), character => character.charCodeAt(0));
    return crypto.subtle.verify('HMAC', await keyFor(secret), bytes, encoder.encode(`${expires}.${nonce}`));
  } catch { return false; }
}

export function cookieToken(header) {
  const cookie = String(header || '').split(';').map(value => value.trim()).find(value => value.startsWith(`${sessionCookie}=`));
  return cookie ? cookie.slice(sessionCookie.length + 1) : '';
}

export function sessionHeader(token) {
  return `${sessionCookie}=${token}; Path=/; Max-Age=${sessionSeconds}; HttpOnly; Secure; SameSite=Strict`;
}

export function clearSessionHeader() {
  return `${sessionCookie}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict`;
}
