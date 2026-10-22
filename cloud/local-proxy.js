import { readFile } from 'node:fs/promises';

export function cloudApiProxy({ origin, passwordFile, fetcher = fetch }) {
  let cookie;
  let loginPending;

  async function signIn() {
    if (cookie) return cookie;
    if (!loginPending) {
      loginPending = (async () => {
        const password = (await readFile(passwordFile, 'utf8')).trim();
        const response = await fetcher(new URL('/api/login', origin), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: '천해마루', password }),
          signal: AbortSignal.timeout(15000),
        });
        const session = response.headers.get('set-cookie')?.split(';')[0];
        if (!response.ok || !session) throw new Error('클라우드 로그인에 실패했습니다.');
        cookie = session;
        return cookie;
      })().finally(() => { loginPending = undefined; });
    }
    return loginPending;
  }

  return async (req, res) => {
    if (req.path === '/session' && req.method === 'GET') return res.json({ authenticated: false });
    try {
      const target = new URL(req.originalUrl, origin);
      if (target.origin !== origin) throw new Error('클라우드 주소를 확인해 주세요.');
      const body = ['POST', 'PATCH', 'PUT'].includes(req.method) ? JSON.stringify(req.body ?? {}) : undefined;
      let response;
      for (let attempt = 0; attempt < 2; attempt++) {
        response = await fetcher(target, {
          method: req.method,
          headers: { Cookie: await signIn(), ...(body ? { 'Content-Type': 'application/json' } : {}) },
          body,
          signal: AbortSignal.timeout(15000),
        });
        if (response.status !== 401) break;
        cookie = undefined;
      }
      res.set('Cache-Control', 'no-store').status(response.status).json(await response.json());
    } catch (error) {
      console.error('클라우드 연결 오류:', error.message);
      res.status(502).json({ error: '클라우드 저장소에 연결하지 못했습니다. 인터넷 연결과 로그인 설정을 확인해 주세요.' });
    }
  };
}
