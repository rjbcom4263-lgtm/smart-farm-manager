import { readSensors } from './cloud/sensors.js';
import express from 'express';
import ExcelJS from 'exceljs';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
import { rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initialArchive, archiveValues } from './archive/defaults.js';
import { defaultTierCount, stages, stageDays, initialRackTiers, rackTierValues, tierCountFor } from './cultivation/stages.js';

const root = path.dirname(fileURLToPath(import.meta.url));
const dataFile = process.env.SMART_FARM_DATA_FILE
  ? path.resolve(process.env.SMART_FARM_DATA_FILE)
  : path.join(root, 'data', 'smart-farm.xlsx');
const dataDir = path.dirname(dataFile);
const schemas = {
  varieties: { sheet: '품종', columns: ['id', 'name', 'openingStock', 'currentStock'] },
  stock: { sheet: '씨앗입출고', columns: ['id', 'date', 'varietyId', 'kind', 'quantity', 'memo', 'refId'] },
  sowings: { sheet: '파종', columns: ['id', 'date', 'varietyId', 'trays', 'seedCount', 'memo'] },
  plans: { sheet: '파종예정', columns: ['id', 'date', 'varietyId', 'trays', 'memo'] },
  tasks: { sheet: '작업일정', columns: ['id', 'title', 'dueDate', 'intervalDays', 'active', 'memo'] },
  taskHistory: { sheet: '작업완료', columns: ['id', 'taskId', 'title', 'dueDate', 'completedAt'] },
  harvests: { sheet: '수확', columns: ['id', 'date', 'bedKey', 'varietyId', 'boxes', 'weightKg', 'cullBoxes', 'cullWeightKg', 'memo'] },
  sales: { sheet: '판매', columns: ['id', 'date', 'varietyId', 'boxes', 'weightKg', 'memo'] },
  climate: { sheet: '온습도', columns: ['id', 'date', 'temperature', 'humidity'] },
  nutrients: { sheet: '양액', columns: ['id', 'date'] },
  co2: { sheet: 'CO2교체', columns: ['id', 'date', 'tankNumber'] },
  beds: { sheet: '베드', columns: ['id', 'floor', 'side', 'number', 'varietyId', 'rackType', 'tierCount'] },
  stageSettings: { sheet: '재배단계', columns: ['rackType', 'days'] },
  rackTiers: { sheet: '재배대단', columns: ['id', 'bedId', 'tier', 'slotCount'] },
  archive: { sheet: '아카이브', columns: ['id', 'category', 'title', 'content'] },
};

const initialVarieties = ['프릴아이스', '이자벨', '로메인', '버터헤드', '알사시아', '오비레드'];
const app = express();
app.use(express.json({ limit: '100kb' }));

function sheet(book, type) {
  return book.getWorksheet(schemas[type].sheet);
}

function rows(book, type) {
  const cols = schemas[type].columns;
  const result = [];
  sheet(book, type).eachRow((row, number) => {
    if (number === 1 || !row.getCell(1).value) return;
    result.push(Object.fromEntries(cols.map((col, i) => [col, row.getCell(i + 1).value ?? ''])));
  });
  return result;
}

function add(book, type, item) {
  const entry = { id: randomUUID(), ...item };
  sheet(book, type).addRow(schemas[type].columns.map(col => entry[col] ?? ''));
  return entry;
}

function locate(book, type, id) {
  const ws = sheet(book, type);
  let found;
  ws.eachRow((row, number) => {
    if (number > 1 && row.getCell(1).value === id) found = row;
  });
  return found;
}

function remove(book, type, id) {
  const row = locate(book, type, id);
  if (!row) throw new Error('기록을 찾지 못했습니다.');
  sheet(book, type).spliceRows(row.number, 1);
}

function text(value, label) {
  const result = String(value ?? '').trim();
  if (!result) throw new Error(`${label}을(를) 입력해 주세요.`);
  return result;
}

function day(value) {
  const result = text(value, '날짜');
  const parsed = new Date(`${result}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(result) || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== result) {
    throw new Error('올바른 날짜를 입력해 주세요.');
  }
  return result;
}

function count(value, label, { allowZero = true, integer = true } = {}) {
  const result = Number(value);
  if (!Number.isFinite(result) || result < (allowZero ? 0 : 1) || (integer && !Number.isInteger(result))) {
    throw new Error(`${label} 값을 확인해 주세요.`);
  }
  return result;
}

function optionalNumber(value, label) {
  return value === '' || value == null ? '' : count(value, label, { integer: false });
}

function variety(book, id) {
  if (!rows(book, 'varieties').some(item => item.id === id)) throw new Error('품종을 선택해 주세요.');
  return id;
}

function stockFor(book, varietyId) {
  const selected = rows(book, 'varieties').find(item => item.id === varietyId);
  if (!selected) throw new Error('품종을 찾지 못했습니다.');
  return Number(selected.openingStock || 0) + rows(book, 'stock')
    .filter(item => item.varietyId === varietyId)
    .reduce((total, item) => total + Number(item.quantity || 0), 0);
}

function syncStockCells(book) {
  const ws = sheet(book, 'varieties');
  ws.getRow(1).getCell(4).value = 'currentStock';
  ws.eachRow((row, number) => {
    if (number > 1 && row.getCell(1).value) row.getCell(4).value = stockFor(book, row.getCell(1).value);
  });
}

function snapshot(book) {
  const result = Object.fromEntries(Object.keys(schemas).map(type => [type, rows(book, type)]));
  result.varieties = result.varieties.map(item => ({ ...item, stock: stockFor(book, item.id) }));
  return result;
}

async function loadBook() {
  const book = new ExcelJS.Workbook();
  if (existsSync(dataFile)) {
    await book.xlsx.readFile(dataFile);
    let migrated = false;
    if (sheet(book, 'varieties').getRow(1).getCell(4).value !== 'currentStock') {
      syncStockCells(book);
      migrated = true;
    }
    const bedSheet = sheet(book, 'beds');
    if (bedSheet.getRow(1).getCell(2).value === 'house') {
      bedSheet.getRow(1).getCell(2).value = 'floor';
      bedSheet.eachRow((row, number) => {
        if (number > 1) {
          if (row.getCell(2).value === '1동') row.getCell(2).value = '1층';
          if (row.getCell(2).value === '2동') row.getCell(2).value = '2층';
        }
      });
      migrated = true;
    }
    if (bedSheet.getRow(1).getCell(6).value !== 'rackType') {
      bedSheet.getRow(1).getCell(6).value = 'rackType';
      migrated = true;
    }
    if (bedSheet.getRow(1).getCell(7).value !== 'tierCount') {
      bedSheet.getRow(1).getCell(7).value = 'tierCount';
      migrated = true;
    }
    bedSheet.eachRow((row, number) => {
      if (number === 1 || !row.getCell(1).value || [5, 6].includes(Number(row.getCell(7).value))) return;
      row.getCell(7).value = tierCountFor({
        floor: row.getCell(2).value, side: row.getCell(3).value,
        number: row.getCell(4).value, rackType: row.getCell(6).value,
      });
      migrated = true;
    });
    if (sheet(book, 'tasks').getRow(1).getCell(6).value !== 'memo') {
      sheet(book, 'tasks').getRow(1).getCell(6).value = 'memo';
      migrated = true;
    }
    if (!sheet(book, 'archive')) {
      book.addWorksheet(schemas.archive.sheet).addRow(schemas.archive.columns);
      for (const item of initialArchive) add(book, 'archive', item);
      migrated = true;
    }
    if (!sheet(book, 'stageSettings')) {
      const settings = book.addWorksheet(schemas.stageSettings.sheet);
      settings.addRow(schemas.stageSettings.columns);
      for (const stage of stages) settings.addRow([stage.rackType, stage.days]);
      migrated = true;
    }
    if (!sheet(book, 'rackTiers')) {
      book.addWorksheet(schemas.rackTiers.sheet).addRow(schemas.rackTiers.columns);
      for (const item of initialRackTiers(rows(book, 'beds'))) sheet(book, 'rackTiers').addRow(schemas.rackTiers.columns.map(col => item[col]));
      migrated = true;
    }
    if (migrated) await saveBook(book);
  }
  else {
    for (const { sheet: name, columns } of Object.values(schemas)) {
      book.addWorksheet(name).addRow(columns);
    }
    for (const name of initialVarieties) add(book, 'varieties', { name, openingStock: 0, currentStock: 0 });
    for (const stage of stages) sheet(book, 'stageSettings').addRow([stage.rackType, stage.days]);
    for (const item of initialArchive) add(book, 'archive', item);
    for (const floor of ['1층', '2층']) {
      for (const side of ['L', 'R']) {
        for (let number = 1; number <= 11; number++) {
          add(book, 'beds', { floor, side, number, varietyId: '', rackType: '', tierCount: defaultTierCount({ floor, side, number }) });
        }
      }
    }
    for (const item of initialRackTiers(rows(book, 'beds'))) sheet(book, 'rackTiers').addRow(schemas.rackTiers.columns.map(col => item[col]));
    await saveBook(book);
  }
  return book;
}

async function saveBook(book) {
  mkdirSync(dataDir, { recursive: true });
  const temp = path.join(dataDir, `${randomUUID()}.tmp.xlsx`);
  try {
    await book.xlsx.writeFile(temp);
    await rename(temp, dataFile);
  } finally {
    await rm(temp, { force: true }).catch(() => {});
  }
}

let pending = Promise.resolve();
function mutate(operation) {
  const work = pending.then(async () => {
    const book = await loadBook();
    const result = operation(book);
    syncStockCells(book);
    await saveBook(book);
    return result;
  });
  pending = work.then(() => undefined, () => undefined);
  return work;
}

function nextDay(date, interval) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + interval);
  return value.toISOString().slice(0, 10);
}

app.get('/api/sensors', async (req, res) => {
  res.set('Cache-Control', 'no-store').json(await readSensors(process.env.SMART_FARM_SENSOR_URL || 'http://127.0.0.1:8091/api/latest'));
});

app.get('/api/state', async (req, res, next) => {
  try { res.json(snapshot(await loadBook())); } catch (error) { next(error); }
});

function post(route, operation) {
  app.post(`/api/${route}`, async (req, res, next) => {
    try { res.json(await mutate(book => operation(book, req.body ?? {}))); }
    catch (error) { next(error); }
  });
}

post('varieties', (book, body) => {
  const name = text(body.name, '품종 이름');
  if (rows(book, 'varieties').some(item => item.name === name)) throw new Error('이미 등록된 품종입니다.');
  return add(book, 'varieties', { name, openingStock: count(body.openingStock ?? 0, '초기 재고') });
});

post('stock', (book, body) => {
  const varietyId = variety(book, body.varietyId);
  const kind = body.kind === 'adjust' ? 'adjust' : 'purchase';
  const quantity = kind === 'adjust'
    ? count(body.quantity, '새 재고') - stockFor(book, varietyId)
    : count(body.quantity, '구매 수량', { allowZero: false });
  return add(book, 'stock', { date: day(body.date), varietyId, kind, quantity, memo: String(body.memo ?? '').trim(), refId: '' });
});

post('sowings', (book, body) => {
  const varietyId = variety(book, body.varietyId);
  const trays = count(body.trays, '육묘판 수', { allowZero: false });
  const plan = body.planId ? rows(book, 'plans').find(item => item.id === body.planId) : null;
  if (body.planId && !plan) throw new Error('파종 예정 기록을 찾지 못했습니다.');
  const record = add(book, 'sowings', { date: day(body.date), varietyId, trays, seedCount: trays * 300, memo: String(body.memo ?? '').trim() });
  add(book, 'stock', { date: record.date, varietyId, kind: 'sowing', quantity: -record.seedCount, memo: '', refId: record.id });
  if (plan) remove(book, 'plans', plan.id);
  return record;
});

post('plans', (book, body) => add(book, 'plans', {
  date: day(body.date), varietyId: variety(book, body.varietyId), trays: count(body.trays, '예정 육묘판 수', { allowZero: false }), memo: String(body.memo ?? '').trim(),
}));

post('tasks', (book, body) => add(book, 'tasks', {
  title: text(body.title, '작업 이름'), dueDate: day(body.dueDate), intervalDays: count(body.intervalDays ?? 0, '반복 일수'), active: 1,
  memo: String(body.memo ?? '').trim(),
}));

app.post('/api/tasks/:id/complete', async (req, res, next) => {
  try {
    res.json(await mutate(book => {
      const row = locate(book, 'tasks', req.params.id);
      if (!row || !Number(row.getCell(5).value)) throw new Error('진행 중인 작업을 찾지 못했습니다.');
      const title = row.getCell(2).value;
      const dueDate = row.getCell(3).value;
      const interval = Number(row.getCell(4).value || 0);
      const completedAt = day(req.body?.date);
      add(book, 'taskHistory', { taskId: req.params.id, title, dueDate, completedAt });
      if (interval) row.getCell(3).value = nextDay(completedAt, interval);
      else row.getCell(5).value = 0;
      return { dueDate: interval ? row.getCell(3).value : null };
    }));
  } catch (error) { next(error); }
});

function harvestValues(book, body) {
  const bedKey = text(body.bedKey, '베드');
  if (!rows(book, 'beds').some(item => item.id === bedKey)) throw new Error('베드를 선택해 주세요.');
  const values = {
    date: day(body.date), bedKey, varietyId: variety(book, body.varietyId),
    boxes: count(body.boxes ?? 0, '수확 상자 수'), weightKg: optionalNumber(body.weightKg, '수확 무게'),
    cullBoxes: count(body.cullBoxes ?? 0, '파기 상자 수'), cullWeightKg: optionalNumber(body.cullWeightKg, '파기 무게'),
    memo: String(body.memo ?? '').trim(),
  };
  if (!values.boxes && !values.weightKg && !values.cullBoxes && !values.cullWeightKg) throw new Error('수확 또는 파기 수량을 입력해 주세요.');
  return values;
}

post('harvests', (book, body) => add(book, 'harvests', harvestValues(book, body)));

app.patch('/api/harvests/:id', async (req, res, next) => {
  try {
    res.json(await mutate(book => {
      const row = locate(book, 'harvests', req.params.id);
      if (!row) throw new Error('수확 기록을 찾지 못했습니다.');
      const values = harvestValues(book, req.body ?? {});
      schemas.harvests.columns.forEach((column, index) => {
        if (column !== 'id') row.getCell(index + 1).value = values[column];
      });
      return { id: req.params.id, ...values };
    }));
  } catch (error) { next(error); }
});

post('sales', (book, body) => {
  const values = {
    date: day(body.date), varietyId: variety(book, body.varietyId), boxes: count(body.boxes ?? 0, '판매 상자 수'),
    weightKg: optionalNumber(body.weightKg, '판매 무게'), memo: String(body.memo ?? '').trim(),
  };
  if (!values.boxes && !values.weightKg) throw new Error('판매 수량을 입력해 주세요.');
  return add(book, 'sales', values);
});

post('climate', (book, body) => {
  const temperature = Number(body.temperature);
  const humidity = Number(body.humidity);
  if (body.temperature == null || body.temperature === '' || body.humidity == null || body.humidity === '' || !Number.isFinite(temperature) || humidity < 0 || humidity > 100 || !Number.isFinite(humidity)) throw new Error('온도·습도 값을 확인해 주세요.');
  return add(book, 'climate', { date: day(body.date), temperature, humidity });
});

post('nutrients', (book, body) => add(book, 'nutrients', { date: day(body.date) }));

post('co2', (book, body) => {
  const tankNumber = count(body.tankNumber, '통 번호', { allowZero: false });
  if (tankNumber > 5) throw new Error('CO₂ 통 번호는 1~5 중 선택해 주세요.');
  return add(book, 'co2', { date: day(body.date), tankNumber });
});

post('archive', (book, body) => add(book, 'archive', archiveValues(body)));

app.patch('/api/archive/:id', async (req, res, next) => {
  try {
    res.json(await mutate(book => {
      const row = locate(book, 'archive', req.params.id);
      if (!row) throw new Error('아카이브 자료를 찾지 못했습니다.');
      const values = archiveValues(req.body ?? {});
      row.getCell(2).value = values.category;
      row.getCell(3).value = values.title;
      row.getCell(4).value = values.content;
      return { id: req.params.id, ...values };
    }));
  } catch (error) { next(error); }
});

post('beds', (book, body) => {
  const row = locate(book, 'beds', body.id || body.bedKey);
  if (!row) throw new Error('베드를 찾지 못했습니다.');
  if (body.varietyId !== undefined) row.getCell(5).value = body.varietyId ? variety(book, body.varietyId) : '';
  if (body.rackType !== undefined) {
    if (!['', 'nursery1', 'nursery2', 'final'].includes(body.rackType)) throw new Error('재배대 종류를 확인해 주세요.');
    row.getCell(6).value = body.rackType;
    if (body.rackType) row.getCell(7).value = stages.find(stage => stage.rackType === body.rackType).tiers;
  }
  if (body.tierCount !== undefined) {
    const tierCount = Number(body.tierCount);
    if (![5, 6].includes(tierCount)) throw new Error('재배대 단수는 5단 또는 6단으로 입력해 주세요.');
    if (row.getCell(6).value && tierCount !== Number(row.getCell(7).value)) throw new Error('재배 단계와 단수가 맞지 않습니다.');
    row.getCell(7).value = tierCount;
  }
  return { id: row.getCell(1).value, varietyId: row.getCell(5).value, rackType: row.getCell(6).value || '', tierCount: Number(row.getCell(7).value) };
});

post('stage-settings', (book, body) => {
  const values = stageDays(body);
  for (const value of values) {
    const row = locate(book, 'stageSettings', value.rackType);
    if (!row) throw new Error('재배 단계 설정을 찾지 못했습니다.');
    row.getCell(2).value = value.days;
  }
  return values;
});

post('rack-tiers', (book, body) => {
  const bed = rows(book, 'beds').find(item => item.id === body.bedId);
  if (!bed) throw new Error('재배대를 찾지 못했습니다.');
  const values = rackTierValues(body, bed);
  for (const value of values) {
    const row = locate(book, 'rackTiers', `${bed.id}:${value.tier}`);
    if (!row) throw new Error('재배대 단 정보를 찾지 못했습니다.');
    row.getCell(4).value = value.slotCount;
  }
  return values;
});

app.delete('/api/:type/:id', async (req, res, next) => {
  try {
    const allowed = ['varieties', 'plans', 'harvests', 'sales', 'climate', 'nutrients', 'co2', 'sowings', 'tasks', 'archive'];
    if (!allowed.includes(req.params.type)) throw new Error('삭제할 수 없는 기록입니다.');
    res.json(await mutate(book => {
      if (req.params.type === 'varieties') {
        if (!locate(book, 'varieties', req.params.id)) throw new Error('품종을 찾지 못했습니다.');
        if (['stock', 'sowings', 'plans', 'harvests', 'sales', 'beds'].some(type => rows(book, type).some(item => item.varietyId === req.params.id))) {
          throw new Error('재배대나 기록에 사용 중인 품종은 삭제할 수 없습니다.');
        }
      }
      if (req.params.type === 'sowings') {
        const movement = rows(book, 'stock').find(item => item.refId === req.params.id);
        if (movement) remove(book, 'stock', movement.id);
      }
      remove(book, req.params.type, req.params.id);
      return { ok: true };
    }));
  } catch (error) { next(error); }
});

app.use((error, req, res, next) => {
  const message = error?.message || '저장 중 문제가 생겼습니다.';
  console.error(error);
  res.status(400).json({ error: message.includes('EPERM') || message.includes('EACCES') ? '엑셀 파일이 열려 있는지 확인하고 다시 저장해 주세요.' : message });
});

if (process.argv.includes('--production')) {
  app.use(express.static(path.join(root, 'dist')));
  app.get('*', (req, res) => res.sendFile(path.join(root, 'dist', 'index.html')));
} else {
  const { createServer } = await import('vite');
  const vite = await createServer({ server: { middlewareMode: true }, appType: 'spa' });
  app.use(vite.middlewares);
}

await loadBook();
const port = Number(process.env.PORT || 4173);
app.listen(port, '127.0.0.1', () => console.log(`스마트팜 실행: http://localhost:${port}`));
