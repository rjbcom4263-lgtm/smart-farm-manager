import { readSensors } from '../../cloud/sensors.js';
import { initialState, snapshot, mutateState } from '../../cloud/state.js';

function json(value, status = 200) {
  return Response.json(value, { status, headers: { 'Cache-Control': 'no-store' } });
}

async function loadRow(db) {
  let row = await db.prepare('SELECT version, data FROM farm_state WHERE id = 1').first();
  if (!row) {
    await db.prepare('INSERT OR IGNORE INTO farm_state (id, version, data) VALUES (1, 0, ?)').bind(JSON.stringify(initialState())).run();
    row = await db.prepare('SELECT version, data FROM farm_state WHERE id = 1').first();
  }
  return row;
}

export async function onRequest({ request, env }) {
  if (request.method === 'GET' && new URL(request.url).pathname === '/api/sensors') {
    return json(env.SENSOR_UPSTREAM_URL ? await readSensors(env.SENSOR_UPSTREAM_URL) : { available: false, devices: [], message: '온라인 센서 연결이 아직 설정되지 않았습니다. 수신 PC에서 실행한 웹에서는 현재값을 확인할 수 있습니다.' });
  }
  if (!env.DB) return json({ error: '데이터베이스 연결이 설정되지 않았습니다.' }, 503);
  const route = new URL(request.url).pathname.split('/').filter(Boolean).slice(1);
  try {
    if (request.method === 'GET' && route.length === 1 && route[0] === 'state') {
      return json(snapshot(JSON.parse((await loadRow(env.DB)).data)));
    }
    if (!['POST', 'PATCH', 'DELETE'].includes(request.method)) return json({ error: '지원하지 않는 요청입니다.' }, 405);
    if (Number(request.headers.get('Content-Length') || 0) > 100000) return json({ error: '입력 내용이 너무 깁니다.' }, 413);
    let body = {};
    if (request.method !== 'DELETE') {
      try { body = await request.json(); } catch { return json({ error: '입력 형식을 확인해 주세요.' }, 400); }
    }
    for (let attempt = 0; attempt < 5; attempt++) {
      const row = await loadRow(env.DB);
      const state = JSON.parse(row.data);
      let result;
      try { result = mutateState(state, request.method, route, body); }
      catch (error) { return json({ error: error.message }, 400); }
      const updated = await env.DB.prepare('UPDATE farm_state SET version = version + 1, data = ? WHERE id = 1 AND version = ?')
        .bind(JSON.stringify(state), row.version).run();
      if (updated.meta.changes === 1) return json(result);
    }
    return json({ error: '동시에 저장 중입니다. 다시 시도해 주세요.' }, 409);
  } catch (error) {
    console.error(error);
    return json({ error: '클라우드 저장소를 확인해 주세요.' }, 500);
  }
}
