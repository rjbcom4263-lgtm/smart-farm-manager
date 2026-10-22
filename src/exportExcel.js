import ExcelJS from 'exceljs/dist/exceljs.min.js';

const sheets = {
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
  solution: ['양액측정', ['id', 'date', 'ph', 'ec']],
  co2: ['CO2교체', ['id', 'date', 'tankNumber']],
  beds: ['베드', ['id', 'floor', 'side', 'number', 'varietyId', 'rackType', 'tierCount']],
  stageSettings: ['재배단계', ['rackType', 'days']],
  rackTiers: ['재배대단', ['id', 'bedId', 'tier', 'slotCount']],
  archive: ['아카이브', ['id', 'category', 'title', 'content']],
  journal: ['업무일지', ['id', 'date', 'title', 'content']],
};

export async function exportExcel(state) {
  const book = new ExcelJS.Workbook();
  for (const [type, [name, columns]] of Object.entries(sheets)) {
    const sheet = book.addWorksheet(name);
    sheet.addRow(columns);
    for (const item of state[type]) {
      sheet.addRow(columns.map(column => column === 'currentStock' ? item.stock ?? item.currentStock ?? 0 : item[column] ?? ''));
    }
    sheet.getRow(1).font = { bold: true };
    sheet.views = [{ state: 'frozen', ySplit: 1 }];
  }
  const buffer = await book.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `스마트팜-${new Date().toISOString().slice(0, 10)}.xlsx`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
