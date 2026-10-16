import ExcelJS from 'exceljs';
import { existsSync, mkdirSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { initialArchive } from '../archive/defaults.js';
import { stages, initialRackTiers } from '../cultivation/stages.js';

const root = path.resolve('.');
const source = process.argv[2] ? path.resolve(process.argv[2]) : path.join(root, 'data', 'smart-farm.xlsx');
const output = process.argv[3] ? path.resolve(process.argv[3]) : path.join(root, 'data', 'cloudflare-import.sql');
if (!existsSync(source)) throw new Error(`엑셀 파일을 찾지 못했습니다: ${source}`);

const schemas = {
  varieties: ['품종', ['id', 'name', 'openingStock', 'currentStock']],
  stock: ['씨앗입출고', ['id', 'date', 'varietyId', 'kind', 'quantity', 'memo', 'refId']],
  sowings: ['파종', ['id', 'date', 'varietyId', 'trays', 'seedCount', 'memo']],
  plans: ['파종예정', ['id', 'date', 'varietyId', 'trays', 'memo']],
  tasks: ['작업일정', ['id', 'title', 'dueDate', 'intervalDays', 'active', 'memo']],
  taskHistory: ['작업완료', ['id', 'taskId', 'title', 'dueDate', 'completedAt']],
  harvests: ['수확', ['id', 'date', 'bedKey', 'varietyId', 'boxes', 'weightKg', 'cullBoxes', 'cullWeightKg', 'memo']],
  sales: ['판매', ['id', 'date', 'varietyId', 'boxes', 'weightKg', 'memo']],
  climate: ['온습도', ['id', 'date', 'temperature', 'humidity']],
  nutrients: ['양액', ['id', 'date']],
  co2: ['CO2교체', ['id', 'date', 'tankNumber']],
  beds: ['베드', ['id', 'floor', 'side', 'number', 'varietyId', 'rackType']],
  stageSettings: ['재배단계', ['rackType', 'days']],
  rackTiers: ['재배대단', ['id', 'bedId', 'tier', 'slotCount']],
  archive: ['아카이브', ['id', 'category', 'title', 'content']],
};

const workbook = new ExcelJS.Workbook();
await workbook.xlsx.readFile(source);
const state = {};
for (const [type, [sheetName, columns]] of Object.entries(schemas)) {
  const sheet = workbook.getWorksheet(sheetName);
  if (type === 'archive' && !sheet) {
    state.archive = initialArchive.map(item => ({ ...item }));
    continue;
  }
  if (type === 'stageSettings' && !sheet) {
    state.stageSettings = stages.map(({ rackType, days }) => ({ rackType, days }));
    continue;
  }
  if (type === 'rackTiers' && !sheet) {
    state.rackTiers = initialRackTiers(state.beds);
    continue;
  }
  if (!sheet) throw new Error(`시트가 없습니다: ${sheetName}`);
  state[type] = [];
  sheet.eachRow((row, number) => {
    if (number === 1 || !row.getCell(1).value) return;
    state[type].push(Object.fromEntries(columns.map((column, index) => [column, row.getCell(index + 1).value ?? ''])));
  });
}
if (state.beds.length !== 44) throw new Error(`베드 수를 확인해 주세요: ${state.beds.length}개`);
const serialized = JSON.stringify(state).replaceAll("'", "''");
mkdirSync(path.dirname(output), { recursive: true });
await writeFile(output, `INSERT OR IGNORE INTO farm_state (id, version, data) VALUES (1, 0, '${serialized}');\n`, 'utf8');
console.log(`D1 가져오기 파일 준비 완료: ${output}`);
