import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { cloudApiProxy } from '../cloud/local-proxy.js';

const directory = await mkdtemp(path.join(os.tmpdir(), 'farm-proxy-'));
const passwordFile = path.join(directory, 'password.txt');
await writeFile(passwordFile, 'test-password');
let logins = 0;
let forwarded;
const fetcher = async (url, options) => {
  if (url.pathname === '/api/login') {
    logins++;
    assert.deepEqual(JSON.parse(options.body), { username: '천해마루', password: 'test-password' });
    return new Response('{}', { headers: { 'Set-Cookie': `farm_session=valid${logins}; HttpOnly` } });
  }
  forwarded = { path: url.pathname, method: options.method, cookie: options.headers.Cookie, body: options.body };
  if (logins === 1) return Response.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  return Response.json({ stored: true });
};
const app = express();
app.use(express.json());
app.use('/api', cloudApiProxy({ origin: 'https://farm.example', passwordFile, fetcher }));
const server = app.listen(0, '127.0.0.1');
await new Promise(resolve => server.once('listening', resolve));

try {
  const url = `http://127.0.0.1:${server.address().port}`;
  const response = await fetch(`${url}/api/solution`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ date: '2026-10-22', ph: 1.64, ec: 6.9 }),
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { stored: true });
  assert.equal(logins, 2);
  assert.equal(forwarded.path, '/api/solution');
  assert.equal(forwarded.method, 'POST');
  assert.equal(forwarded.cookie, 'farm_session=valid2');
  assert.deepEqual(JSON.parse(forwarded.body), { date: '2026-10-22', ph: 1.64, ec: 6.9 });
  assert.deepEqual(await (await fetch(`${url}/api/session`)).json(), { authenticated: false });
  assert.equal(logins, 2);
  console.log('Cloud proxy checks passed');
} finally {
  server.close();
  await rm(directory, { recursive: true, force: true });
}
