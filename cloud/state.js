import { initialArchive, archiveValues } from '../archive/defaults.js';
import { journalValues } from '../journal/values.js';
import { solutionValues } from '../solution/values.js';
import { defaultTierCount, stages, stageDays, initialRackTiers, rackTierValues, tierCountFor } from '../cultivation/stages.js';

const types = ['varieties', 'stock', 'sowings', 'plans', 'tasks', 'taskHistory', 'harvests', 'sales', 'climate', 'nutrients', 'solution', 'co2', 'beds', 'archive', 'journal', 'stageSettings', 'rackTiers'];
const initialVarieties = ['프릴아이스', '이자벨', '로메인', '버터헤드', '알사시아', '오비레드'];

export function initialState() {
  const state = Object.fromEntries(types.map(type => [type, []]));
  state.varieties = initialVarieties.map(name => ({ id: crypto.randomUUID(), name, openingStock: 0, currentStock: 0 }));
  state.archive = initialArchive.map(item => ({ ...item }));
  state.stageSettings = stages.map(({ rackType, days }) => ({ rackType, days }));
  for (const floor of ['1층', '2층']) {
    for (const side of ['L', 'R']) {
      for (let number = 1; number <= 11; number++) {
        state.beds.push({ id: crypto.randomUUID(), floor, side, number, varietyId: '', rackType: '', tierCount: defaultTierCount({ floor, side, number }) });
      }
    }
  }
  state.rackTiers = initialRackTiers(state.beds);
  return state;
}

function add(state, type, values) {
  const item = { id: crypto.randomUUID(), ...values };
  state[type].push(item);
  return item;
}

function find(state, type, id) {
  return state[type].find(item => item.id === id);
}

function remove(state, type, id) {
  const index = state[type].findIndex(item => item.id === id);
  if (index < 0) throw new Error('기록을 찾지 못했습니다.');
  state[type].splice(index, 1);
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

function variety(state, id) {
  if (!state.varieties.some(item => item.id === id)) throw new Error('품종을 선택해 주세요.');
  return id;
}

function stockFor(state, varietyId) {
  const selected = find(state, 'varieties', varietyId);
  if (!selected) throw new Error('품종을 찾지 못했습니다.');
  return Number(selected.openingStock || 0) + state.stock
    .filter(item => item.varietyId === varietyId)
    .reduce((total, item) => total + Number(item.quantity || 0), 0);
}

export function snapshot(state) {
  if (!Array.isArray(state.archive)) state.archive = initialArchive.map(item => ({ ...item }));
  if (!Array.isArray(state.journal)) state.journal = [];
  if (!Array.isArray(state.solution)) state.solution = [];
  if (!Array.isArray(state.stageSettings)) state.stageSettings = stages.map(({ rackType, days }) => ({ rackType, days }));
  if (!Array.isArray(state.rackTiers)) state.rackTiers = initialRackTiers(state.beds);
  return { ...state, beds: state.beds.map(bed => ({ ...bed, tierCount: tierCountFor(bed) })), varieties: state.varieties.map(item => ({ ...item, stock: stockFor(state, item.id) })) };
}

function nextDay(date, interval) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + interval);
  return value.toISOString().slice(0, 10);
}

function harvestValues(state, body) {
  const bedKey = text(body.bedKey, '베드');
  if (!find(state, 'beds', bedKey)) throw new Error('베드를 선택해 주세요.');
  const values = {
    date: day(body.date), bedKey, varietyId: variety(state, body.varietyId),
    boxes: count(body.boxes ?? 0, '수확 상자 수'), weightKg: optionalNumber(body.weightKg, '수확 무게'),
    cullBoxes: count(body.cullBoxes ?? 0, '파기 상자 수'), cullWeightKg: optionalNumber(body.cullWeightKg, '파기 무게'),
    memo: String(body.memo ?? '').trim(),
  };
  if (!values.boxes && !values.weightKg && !values.cullBoxes && !values.cullWeightKg) throw new Error('수확 또는 파기 수량을 입력해 주세요.');
  return values;
}

export function mutateState(state, method, route, body = {}) {
  if (!Array.isArray(state.archive)) state.archive = initialArchive.map(item => ({ ...item }));
  if (!Array.isArray(state.journal)) state.journal = [];
  if (!Array.isArray(state.solution)) state.solution = [];
  if (!Array.isArray(state.stageSettings)) state.stageSettings = stages.map(({ rackType, days }) => ({ rackType, days }));
  if (!Array.isArray(state.rackTiers)) state.rackTiers = initialRackTiers(state.beds);
  const [type, id, action] = route;
  if (method === 'POST' && type === 'tasks' && id && action === 'complete') {
    const task = find(state, 'tasks', id);
    if (!task || !Number(task.active)) throw new Error('진행 중인 작업을 찾지 못했습니다.');
    const completedAt = day(body.date);
    add(state, 'taskHistory', { taskId: id, title: task.title, dueDate: task.dueDate, completedAt });
    if (Number(task.intervalDays)) task.dueDate = nextDay(completedAt, Number(task.intervalDays));
    else task.active = 0;
    return { dueDate: Number(task.intervalDays) ? task.dueDate : null };
  }
  if (method === 'PATCH' && type === 'harvests' && id && !action) {
    const record = find(state, 'harvests', id);
    if (!record) throw new Error('수확 기록을 찾지 못했습니다.');
    Object.assign(record, harvestValues(state, body));
    return record;
  }
  if (method === 'PATCH' && type === 'archive' && id && !action) {
    const record = find(state, 'archive', id);
    if (!record) throw new Error('아카이브 자료를 찾지 못했습니다.');
    Object.assign(record, archiveValues(body));
    return record;
  }
  if (method === 'PATCH' && type === 'journal' && id && !action) {
    const record = find(state, 'journal', id);
    if (!record) throw new Error('업무 일지를 찾지 못했습니다.');
    Object.assign(record, journalValues(body));
    return record;
  }
  if (method === 'DELETE' && id && !action) {
    if (!['varieties', 'plans', 'harvests', 'sales', 'climate', 'nutrients', 'solution', 'co2', 'sowings', 'tasks', 'archive', 'journal'].includes(type)) throw new Error('삭제할 수 없는 기록입니다.');
    if (type === 'varieties') {
      if (!find(state, 'varieties', id)) throw new Error('품종을 찾지 못했습니다.');
      if (['stock', 'sowings', 'plans', 'harvests', 'sales', 'beds'].some(collection => state[collection].some(item => item.varietyId === id))) {
        throw new Error('재배대나 기록에 사용 중인 품종은 삭제할 수 없습니다.');
      }
    }
    if (type === 'sowings') {
      const movement = state.stock.find(item => item.refId === id);
      if (movement) remove(state, 'stock', movement.id);
    }
    remove(state, type, id);
    return { ok: true };
  }
  if (method !== 'POST' || id || !type) throw new Error('지원하지 않는 요청입니다.');

  switch (type) {
    case 'stage-settings': {
      const values = stageDays(body);
      state.stageSettings = values;
      return values;
    }
    case 'rack-tiers': {
      const bed = find(state, 'beds', body.bedId);
      if (!bed) throw new Error('재배대를 찾지 못했습니다.');
      const values = rackTierValues(body, bed);
      for (const value of values) {
        const row = state.rackTiers.find(item => item.bedId === bed.id && Number(item.tier) === value.tier);
        if (!row) throw new Error('재배대 단 정보를 찾지 못했습니다.');
        row.slotCount = value.slotCount;
      }
      return values;
    }
    case 'archive':
      return add(state, type, archiveValues(body));
    case 'journal':
      return add(state, type, journalValues(body));
    case 'varieties': {
      const name = text(body.name, '품종 이름');
      if (state.varieties.some(item => item.name === name)) throw new Error('이미 등록된 품종입니다.');
      return add(state, type, { name, openingStock: count(body.openingStock ?? 0, '초기 재고'), currentStock: 0 });
    }
    case 'stock': {
      const varietyId = variety(state, body.varietyId);
      const kind = body.kind === 'adjust' ? 'adjust' : 'purchase';
      const quantity = kind === 'adjust'
        ? count(body.quantity, '새 재고') - stockFor(state, varietyId)
        : count(body.quantity, '구매 수량', { allowZero: false });
      return add(state, type, { date: day(body.date), varietyId, kind, quantity, memo: String(body.memo ?? '').trim(), refId: '' });
    }
    case 'sowings': {
      const varietyId = variety(state, body.varietyId);
      const trays = count(body.trays, '육묘판 수', { allowZero: false });
      const plan = body.planId ? find(state, 'plans', body.planId) : null;
      if (body.planId && !plan) throw new Error('파종 예정 기록을 찾지 못했습니다.');
      const record = add(state, type, { date: day(body.date), varietyId, trays, seedCount: trays * 300, memo: String(body.memo ?? '').trim() });
      add(state, 'stock', { date: record.date, varietyId, kind: 'sowing', quantity: -record.seedCount, memo: '', refId: record.id });
      if (plan) remove(state, 'plans', plan.id);
      return record;
    }
    case 'plans':
      return add(state, type, { date: day(body.date), varietyId: variety(state, body.varietyId), trays: count(body.trays, '예정 육묘판 수', { allowZero: false }), memo: String(body.memo ?? '').trim() });
    case 'tasks':
      return add(state, type, { title: text(body.title, '작업 이름'), dueDate: day(body.dueDate), intervalDays: count(body.intervalDays ?? 0, '반복 일수'), active: 1, memo: String(body.memo ?? '').trim() });
    case 'harvests':
      return add(state, type, harvestValues(state, body));
    case 'sales': {
      const values = { date: day(body.date), varietyId: variety(state, body.varietyId), boxes: count(body.boxes ?? 0, '판매 상자 수'), weightKg: optionalNumber(body.weightKg, '판매 무게'), memo: String(body.memo ?? '').trim() };
      if (!values.boxes && !values.weightKg) throw new Error('판매 수량을 입력해 주세요.');
      return add(state, type, values);
    }
    case 'climate': {
      const temperature = Number(body.temperature);
      const humidity = Number(body.humidity);
      if (body.temperature == null || body.temperature === '' || body.humidity == null || body.humidity === '' || !Number.isFinite(temperature) || humidity < 0 || humidity > 100 || !Number.isFinite(humidity)) throw new Error('온도·습도 값을 확인해 주세요.');
      return add(state, type, { date: day(body.date), temperature, humidity });
    }
    case 'nutrients':
      return add(state, type, { date: day(body.date) });
    case 'solution':
      return add(state, type, solutionValues(body));
    case 'co2': {
      const tankNumber = count(body.tankNumber, '통 번호', { allowZero: false });
      if (tankNumber > 5) throw new Error('CO₂ 통 번호는 1~5 중 선택해 주세요.');
      return add(state, type, { date: day(body.date), tankNumber });
    }
    case 'beds': {
      const bed = find(state, 'beds', body.id || body.bedKey);
      if (!bed) throw new Error('베드를 찾지 못했습니다.');
      if (body.varietyId !== undefined) bed.varietyId = body.varietyId ? variety(state, body.varietyId) : '';
      if (body.rackType !== undefined) {
        if (!['', 'nursery1', 'nursery2', 'final'].includes(body.rackType)) throw new Error('재배대 종류를 확인해 주세요.');
        bed.rackType = body.rackType;
        if (body.rackType) bed.tierCount = stages.find(stage => stage.rackType === body.rackType).tiers;
      }
      if (body.tierCount !== undefined) {
        const tierCount = Number(body.tierCount);
        if (![5, 6].includes(tierCount)) throw new Error('재배대 단수는 5단 또는 6단으로 입력해 주세요.');
        if (bed.rackType && tierCount !== tierCountFor(bed)) throw new Error('재배 단계와 단수가 맞지 않습니다.');
        bed.tierCount = tierCount;
      }
      return { id: bed.id, varietyId: bed.varietyId, rackType: bed.rackType || '', tierCount: tierCountFor(bed) };
    }
    default:
      throw new Error('지원하지 않는 요청입니다.');
  }
}
