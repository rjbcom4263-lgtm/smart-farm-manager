import { sha256, createSession, verifySession, cookieToken, sessionHeader, clearSessionHeader } from '../auth/session.js';

function json(value, status = 200, headers = {}) {
  return Response.json(value, { status, headers: { 'Cache-Control': 'no-store', ...headers } });
}

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const path = url.pathname;
  const expectedHash = env.APP_PASSWORD_SHA256;
  const sessionSecret = env.SESSION_SECRET;
  if (!expectedHash || !sessionSecret) return json({ error: '로그인 설정을 확인해 주세요.' }, 503);

  if (path === '/api/login' && request.method === 'POST') {
    if (request.headers.get('Origin') && request.headers.get('Origin') !== url.origin) return json({ error: '접속 주소를 확인해 주세요.' }, 403);
    let body;
    try { body = await request.json(); } catch { return json({ error: '입력 형식을 확인해 주세요.' }, 400); }
    if (body?.username !== '천해마루' || await sha256(String(body?.password ?? '')) !== expectedHash) {
      return json({ error: '아이디 또는 비밀번호가 맞지 않습니다.' }, 401);
    }
    const token = await createSession(sessionSecret);
    return json({ ok: true }, 200, { 'Set-Cookie': sessionHeader(token) });
  }

  if (path === '/api/logout' && request.method === 'POST') {
    return json({ ok: true }, 200, { 'Set-Cookie': clearSessionHeader() });
  }

  const signedIn = await verifySession(sessionSecret, cookieToken(request.headers.get('Cookie')));
  if (path === '/api/session' && request.method === 'GET') {
    return signedIn ? json({ authenticated: true }) : json({ error: '로그인이 필요합니다.' }, 401);
  }
  if (path === '/login' || path === '/login.html') {
    if (signedIn) return Response.redirect(new URL('/', url), 302);
    const response = await context.next();
    response.headers.set('Cache-Control', 'no-store');
    return response;
  }

  if (!signedIn) {
    if (path.startsWith('/api/')) return json({ error: '로그인이 필요합니다.' }, 401);
    const login = new URL('/login', url);
    if (path !== '/login') login.searchParams.set('next', path + url.search);
    return new Response(null, { status: 302, headers: { Location: login.toString(), 'Cache-Control': 'no-store' } });
  }

  const response = await context.next();
  response.headers.set('Cache-Control', 'private, no-store');
  return response;
}
