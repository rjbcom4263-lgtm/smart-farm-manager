import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, rmdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import ExcelJS from 'exceljs';
import { initialState, mutateState, snapshot } from '../cloud/state.js';
import { onRequest as authenticate } from '../functions/_middleware.js';
import { sha256 } from '../auth/session.js';

const directory = await mkdtemp(path.join(os.tmpdir(), 'smart-farm-test-'));
const file = path.join(directory, 'records.xlsx');
const port = 43000 + Math.floor(Math.random() * 1000);
const base = `http://localhost:${port}/api`;
let child;

async function start() {
  child = spawn(process.execPath, ['server.js', '--production'], {
    cwd: path.resolve('.'),
    env: { ...process.env, PORT: String(port), SMART_FARM_DATA_FILE: file },
    stdio: 'ignore',
  });
  for (let i = 0; i < 60; i++) {
    try {
      const response = await fetch(`${base}/state`);
      if (response.ok) return;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  throw new Error('테스트 서버가 시작되지 않았습니다.');
}

async function stop() {
  if (!child) return;
  const processToStop = child;
  child = null;
  await new Promise(resolve => {
    processToStop.once('exit', resolve);
    processToStop.kill();
  });
}

async function request(route, body, method = 'POST') {
  const response = await fetch(`${base}/${route}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const result = await response.json();
  assert.equal(response.ok, true, `${route}: ${result.error || response.status}`);
  return result;
}

try {
  const authEnv = { APP_PASSWORD_SHA256: await sha256('test-secret'), SESSION_SECRET: 'a separate long session signing secret for tests' };
  const authRequest = (route, options = {}) => authenticate({ request: new Request(`https://farm.example${route}`, options), env: authEnv, next: () => new Response('protected') });
  const blockedPage = await authRequest('/');
  assert.equal(blockedPage.status, 302);
  assert.match(blockedPage.headers.get('location'), /\/login/);
  const blockedApi = await authRequest('/api/state');
  assert.equal(blockedApi.status, 401);
  assert.equal(blockedApi.headers.get('www-authenticate'), null);
  assert.equal((await authRequest('/login')).status, 200);
  const wrongLogin = await authRequest('/api/login', { method: 'POST', body: JSON.stringify({ username: '천해마루', password: 'wrong' }) });
  assert.equal(wrongLogin.status, 401);
  const login = await authRequest('/api/login', { method: 'POST', body: JSON.stringify({ username: '천해마루', password: 'test-secret' }) });
  assert.equal(login.status, 200);
  assert.match(login.headers.get('set-cookie'), /HttpOnly; Secure; SameSite=Strict/);
  const cookie = login.headers.get('set-cookie').split(';')[0];
  assert.equal((await authRequest('/', { headers: { Cookie: cookie } })).status, 200);
  assert.equal((await authRequest('/api/session', { headers: { Cookie: cookie } })).status, 200);
  assert.equal((await authRequest('/', { headers: { Cookie: `${cookie}x` } })).status, 302);
  const logout = await authRequest('/api/logout', { method: 'POST', headers: { Cookie: cookie } });
  assert.match(logout.headers.get('set-cookie'), /Max-Age=0/);

  await start();
  let state = await request('state', undefined, 'GET');
  assert.equal(state.varieties.length, 6);
  assert.equal(state.beds.length, 44);
  assert.equal(state.beds.filter(bed => Number(bed.tierCount) === 6).length, 4);
  assert.equal(state.beds.filter(bed => Number(bed.tierCount) === 5).length, 40);
  assert.deepEqual(state.beds.filter(bed => Number(bed.tierCount) === 6).map(bed => `${bed.floor} ${bed.side}${bed.number}`), ['1층 L10', '1층 L11', '2층 L10', '2층 L11']);
  assert.ok(state.beds.every(bed => !bed.rackType));
  assert.deepEqual(state.stageSettings.map(item => Number(item.days)), [7, 14, 24]);
  assert.equal(state.rackTiers.length, 44 * 6);
  assert.equal(state.rackTiers[0].slotCount, '');
  assert.equal(state.archive.length, 2);
  assert.deepEqual(state.journal, []);
  const entry = await request('journal', { date: '2026-10-14', title: '육묘대 점검', content: '1층 점검\n이상 없음' });
  await request(`journal/${entry.id}`, { date: '2026-10-15', title: '육묘대 점검', content: '2층도 점검' }, 'PATCH');
  state = await request('state', undefined, 'GET');
  assert.equal(state.journal.find(item => item.id === entry.id).content, '2층도 점검');
  assert.equal(state.journal.find(item => item.id === entry.id).date, '2026-10-15');
  const invalidJournal = await fetch(`${base}/journal`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ date: '2026-10-15', title: '빈 일지', content: '' }) });
  assert.equal(invalidJournal.status, 400);
  await request(`journal/${entry.id}`, undefined, 'DELETE');
  assert.deepEqual((await request('state', undefined, 'GET')).journal, []);
  assert.equal(state.archive.find(item => item.id === 'nutrient-ratio').content, '');
  assert.match(state.archive.find(item => item.id === 'filter-cleaning').content, /리턴펌프/);
  const archiveEntry = await request('archive', { category: '설비', title: '확인 사항', content: '첫 기록' });
  await request(`archive/${archiveEntry.id}`, { category: '설비', title: '확인 사항', content: '수정한 기록' }, 'PATCH');
  state = await request('state', undefined, 'GET');
  assert.equal(state.archive.find(item => item.id === archiveEntry.id).content, '수정한 기록');
  await request(`archive/${archiveEntry.id}`, undefined, 'DELETE');
  state = await request('state', undefined, 'GET');
  assert.equal(state.archive.length, 2);
  assert.deepEqual(state.beds.reduce((counts, bed) => ({ ...counts, [bed.floor]: (counts[bed.floor] || 0) + 1 }), {}), { '1층': 22, '2층': 22 });
  for (const floor of ['1층', '2층']) {
    for (const side of ['L', 'R']) {
      assert.deepEqual(state.beds.filter(bed => bed.floor === floor && bed.side === side).map(bed => Number(bed.number)), Array.from({ length: 11 }, (_, i) => i + 1));
    }
  }
  const adjustableBed = state.beds.find(bed => bed.floor === '1층' && bed.side === 'L' && Number(bed.number) === 2);
  await request('beds', { id: adjustableBed.id, tierCount: 6 });
  state = await request('state', undefined, 'GET');
  assert.equal(Number(state.beds.find(bed => bed.id === adjustableBed.id).tierCount), 6);
  assert.equal(state.beds.find(bed => bed.id === adjustableBed.id).rackType, '');
  await request('rack-tiers', { bedId: adjustableBed.id, tier1: '', tier2: '', tier3: '', tier4: '', tier5: '', tier6: 3 });
  await request('beds', { id: adjustableBed.id, tierCount: 5 });
  const varietyId = state.varieties[0].id;
  const bedId = state.beds[0].id;
  await request('beds', { id: bedId, varietyId, rackType: 'nursery1' });
  await request('rack-tiers', { bedId, tier1: 4, tier2: '', tier3: 6, tier4: '', tier5: '', tier6: '' });
  await request('stage-settings', { nursery1: 6, nursery2: 15, final: 24 });
  state = await request('state', undefined, 'GET');
  assert.equal(state.rackTiers.find(item => item.bedId === bedId && Number(item.tier) === 1).slotCount, 4);
  assert.equal(state.rackTiers.find(item => item.bedId === bedId && Number(item.tier) === 2).slotCount, '');
  assert.deepEqual(state.stageSettings.map(item => Number(item.days)), [6, 15, 24]);
  const addedVariety = await request('varieties', { name: '시험 품종', openingStock: 20 });
  state = await request('state', undefined, 'GET');
  assert.equal(state.varieties.find(item => item.id === addedVariety.id).stock, 20);
  await request(`varieties/${addedVariety.id}`, undefined, 'DELETE');
  const blockedDelete = await fetch(`${base}/varieties/${varietyId}`, { method: 'DELETE' });
  assert.equal(blockedDelete.status, 400);
  assert.match((await blockedDelete.json()).error, /사용 중인 품종/);
  state = await request('state', undefined, 'GET');
  assert.equal(state.varieties.length, 6);

  const cloudState = initialState();
  assert.equal(cloudState.beds.filter(bed => bed.tierCount === 6).length, 4);
  assert.equal(cloudState.beds.filter(bed => bed.tierCount === 5).length, 40);
  assert.ok(cloudState.beds.every(bed => !bed.rackType));
  assert.deepEqual(cloudState.beds.filter(bed => bed.tierCount === 6).map(bed => `${bed.floor} ${bed.side}${bed.number}`), ['1층 L10', '1층 L11', '2층 L10', '2층 L11']);
  assert.deepEqual(cloudState.stageSettings.map(item => item.days), [7, 14, 24]);
  assert.equal(cloudState.rackTiers.length, 44 * 6);
  assert.deepEqual(cloudState.journal, []);
  const cloudJournal = mutateState(cloudState, 'POST', ['journal'], { date: '2026-10-14', title: '작업', content: '필터 확인' });
  mutateState(cloudState, 'PATCH', ['journal', cloudJournal.id], { date: '2026-10-15', title: '작업', content: '필터 청소' });
  assert.equal(cloudState.journal[0].content, '필터 청소');
  assert.throws(() => mutateState(cloudState, 'POST', ['journal'], { date: '2026-10-15', title: '빈 일지', content: '' }), /제목과 내용/);
  mutateState(cloudState, 'DELETE', ['journal', cloudJournal.id]);
  assert.deepEqual(cloudState.journal, []);
  delete cloudState.journal;
  assert.deepEqual(snapshot(cloudState).journal, []);
  mutateState(cloudState, 'POST', ['rack-tiers'], { bedId: cloudState.beds[0].id, tier1: 4, tier2: '', tier3: '', tier4: '', tier5: '', tier6: '' });
  mutateState(cloudState, 'POST', ['beds'], { id: cloudState.beds[1].id, tierCount: 6 });
  assert.equal(cloudState.beds[1].tierCount, 6);
  mutateState(cloudState, 'POST', ['beds'], { id: cloudState.beds[0].id, rackType: 'final' });
  mutateState(cloudState, 'POST', ['rack-tiers'], { bedId: cloudState.beds[0].id, tier1: 80, tier2: '', tier3: '', tier4: '', tier5: '' });
  assert.equal(cloudState.rackTiers.find(item => item.bedId === cloudState.beds[0].id && item.tier === 1).slotCount, 80);
  mutateState(cloudState, 'POST', ['stage-settings'], { nursery1: 6, nursery2: 15, final: 24 });
  assert.deepEqual(cloudState.stageSettings.map(item => item.days), [6, 15, 24]);
  assert.throws(() => mutateState(cloudState, 'POST', ['stage-settings'], { nursery1: 0, nursery2: 15, final: 24 }), /1~365일/);
  delete cloudState.archive;
  assert.equal(snapshot(cloudState).archive.length, 2);
  const cloudEntry = mutateState(cloudState, 'POST', ['archive'], { category: '설비', title: '확인 사항', content: '첫 기록' });
  mutateState(cloudState, 'PATCH', ['archive', cloudEntry.id], { category: '설비', title: '확인 사항', content: '수정한 기록' });
  assert.equal(cloudState.archive.find(item => item.id === cloudEntry.id).content, '수정한 기록');
  mutateState(cloudState, 'DELETE', ['archive', cloudEntry.id]);
  assert.equal(cloudState.archive.length, 2);
  const cloudVariety = mutateState(cloudState, 'POST', ['varieties'], { name: '시험 품종', openingStock: 20 });
  mutateState(cloudState, 'DELETE', ['varieties', cloudVariety.id]);
  assert.equal(cloudState.varieties.length, 6);
  cloudState.beds[0].varietyId = cloudState.varieties[0].id;
  assert.throws(() => mutateState(cloudState, 'DELETE', ['varieties', cloudState.varieties[0].id]), /사용 중인 품종/);

  await request('stock', { date: '2026-09-30', varietyId, kind: 'adjust', quantity: 100 });
  await request('stock', { date: '2026-10-01', varietyId, kind: 'purchase', quantity: 3000 });
  state = await request('state', undefined, 'GET');
  assert.equal(state.varieties[0].stock, 3100);
  const plan = await request('plans', { date: '2026-10-02', varietyId, trays: 2 });
  const sowing = await request('sowings', { date: '2026-10-02', varietyId, trays: 2, planId: plan.id });
  state = await request('state', undefined, 'GET');
  assert.equal(state.varieties[0].stock, 2500);
  assert.equal(state.sowings[0].seedCount, 600);
  assert.equal(state.plans.length, 0);

  const task = await request('tasks', { title: '청소', dueDate: '2026-10-01', intervalDays: 7, memo: '도구 준비' });
  const oneOff = await request('tasks', { title: '양액통 확인', dueDate: '2026-10-14', intervalDays: 0, memo: '잔량 기록' });
  await request(`tasks/${task.id}/complete`, { date: '2026-10-04' });
  state = await request('state', undefined, 'GET');
  assert.equal(state.tasks[0].dueDate, '2026-10-11');
  assert.equal(state.tasks.find(item => item.id === oneOff.id).memo, '잔량 기록');
  assert.equal(state.taskHistory[0].completedAt, '2026-10-04');

  const harvest = await request('harvests', { date: '2026-10-03', bedKey: state.beds[0].id, varietyId, boxes: 3, weightKg: '', cullBoxes: 1, cullWeightKg: '' });
  assert.equal(harvest.weightKg, '');
  await request(`harvests/${harvest.id}`, { date: '2026-10-03', bedKey: state.beds[0].id, varietyId, boxes: 3, weightKg: 12.5, cullBoxes: 1, cullWeightKg: 1.2 }, 'PATCH');
  await request(`sowings/${sowing.id}`, undefined, 'DELETE');
  const savedJournal = await request('journal', { date: '2026-10-16', title: '현장 점검', content: '양액통 점검 완료' });
  state = await request('state', undefined, 'GET');
  assert.equal(state.varieties[0].stock, 3100);

  await stop();
  await start();
  state = await request('state', undefined, 'GET');
  assert.equal(state.varieties[0].stock, 3100);
  assert.equal(state.harvests.length, 1);
  assert.equal(state.harvests[0].weightKg, 12.5);
  assert.equal(state.journal.find(item => item.id === savedJournal.id).content, '양액통 점검 완료');
  assert.equal(state.beds.find(bed => bed.id === bedId).varietyId, varietyId);
  assert.equal(state.beds.find(bed => bed.id === bedId).rackType, 'nursery1');
  assert.deepEqual(state.stageSettings.map(item => Number(item.days)), [6, 15, 24]);
  assert.equal(state.rackTiers.find(item => item.bedId === bedId && Number(item.tier) === 1).slotCount, 4);
  assert.equal(state.tasks.find(item => item.id === task.id).memo, '도구 준비');
  assert.equal(state.tasks.find(item => item.id === oneOff.id).memo, '잔량 기록');
  const book = new ExcelJS.Workbook();
  await book.xlsx.readFile(file);
  assert.equal(book.getWorksheet('품종').getRow(2).getCell(4).value, 3100);
  assert.equal(book.getWorksheet('업무일지').getRow(2).getCell(3).value, '현장 점검');
  await stop();
  const bedsSheet = book.getWorksheet('베드');
  bedsSheet.getRow(1).getCell(2).value = 'house';
  bedsSheet.getRow(1).getCell(6).value = null;
  bedsSheet.getRow(1).getCell(7).value = null;
  bedsSheet.eachRow((row, number) => {
    if (number > 1) {
      row.getCell(2).value = row.getCell(2).value === '1층' ? '1동' : '2동';
      row.getCell(6).value = null;
      row.getCell(7).value = null;
    }
  });
  const tasksSheet = book.getWorksheet('작업일정');
  tasksSheet.getRow(1).getCell(6).value = null;
  tasksSheet.eachRow((row, number) => { if (number > 1) row.getCell(6).value = null; });
  book.removeWorksheet('아카이브');
  book.removeWorksheet('업무일지');
  book.removeWorksheet('재배단계');
  book.removeWorksheet('재배대단');
  await book.xlsx.writeFile(file);
  await start();
  state = await request('state', undefined, 'GET');
  assert.equal(state.beds.find(bed => bed.id === bedId).floor, '1층');
  assert.equal(state.beds.find(bed => bed.id === bedId).varietyId, varietyId);
  assert.equal(state.beds.find(bed => bed.id === bedId).rackType, '');
  assert.equal(Number(state.beds.find(bed => bed.id === bedId).tierCount), 5);
  assert.equal(state.harvests[0].bedKey, bedId);
  assert.equal(state.tasks.find(item => item.id === task.id).memo, '');
  assert.equal(state.archive.length, 2);
  assert.deepEqual(state.journal, []);
  assert.deepEqual(state.stageSettings.map(item => Number(item.days)), [7, 14, 24]);
  assert.equal(state.rackTiers.length, 44 * 6);
  assert.equal(state.tasks.find(item => item.id === oneOff.id).dueDate, '2026-10-14');
  await request('beds', { id: bedId, rackType: 'final' });
  state = await request('state', undefined, 'GET');
  assert.equal(state.beds.find(bed => bed.id === bedId).rackType, 'final');
  assert.equal(state.beds.find(bed => bed.id === bedId).varietyId, varietyId);
  const migrated = new ExcelJS.Workbook();
  await migrated.xlsx.readFile(file);
  assert.equal(migrated.getWorksheet('베드').getRow(1).getCell(2).value, 'floor');
  assert.equal(migrated.getWorksheet('베드').getRow(1).getCell(6).value, 'rackType');
  assert.equal(migrated.getWorksheet('베드').getRow(1).getCell(7).value, 'tierCount');
  assert.equal(migrated.getWorksheet('작업일정').getRow(1).getCell(6).value, 'memo');
  assert.equal(migrated.getWorksheet('업무일지').getRow(1).getCell(2).value, 'date');
  console.log('달력 작업 메모·엑셀 이관, 2층 구조·재배대 종류, 씨앗 재고, 반복 일정, 미계량 수확 확인 완료');
} finally {
  await stop();
  await rm(file, { force: true });
  await rmdir(directory);
}
