import { stages, tierCountFor } from '../cultivation/stages.js';

const app = document.querySelector('#app');
const modalRoot = document.querySelector('#modal-root');
const breadcrumb = document.querySelector('#breadcrumb');
const today = new Date();
const todayKey = localDate(today);
document.querySelector('#today-date').textContent = `${today.getFullYear()}년 ${today.getMonth() + 1}월 ${today.getDate()}일`;

let db;
let page = 'dashboard';
let tab = 'seed';
let selectedBed = '';
let selectedFloor = 'all';
let selectedArchiveId = '';
let farmCleanup;
let renderVersion = 0;
let viewMonth = new Date(today.getFullYear(), today.getMonth(), 1);
let toastTimer;

function localDate(value) {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}

function number(value) { return Number(value || 0).toLocaleString('ko-KR'); }
function kg(value) { return `${Number(value || 0).toLocaleString('ko-KR', { maximumFractionDigits: 1 })} kg`; }
function shortDate(value) { return value ? `${Number(value.slice(5, 7))}월 ${Number(value.slice(8, 10))}일` : '-'; }
function monthStart() { return localDate(viewMonth); }
function monthEnd() { return localDate(new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 1, 0)); }
function nameFor(id) { return db.varieties.find(item => item.id === id)?.name || '미지정'; }
const rackTypes = Object.fromEntries(stages.map(({ rackType, name, tiers }) => [rackType, { name, tiers }]));
function bedFor(id) { const bed = db.beds.find(item => item.id === id); return bed ? `${bed.floor} ${bed.side}${bed.number}` : '-'; }
function sortRecent(items, field = 'date') { return [...items].sort((a, b) => String(b[field]).localeCompare(String(a[field]))); }
function total(items, field) { return items.reduce((sum, item) => sum + Number(item[field] || 0), 0); }
function inMonth(item) { return String(item.date || '').startsWith(todayKey.slice(0, 7)); }
function toast(message, isError = false) {
  const el = document.querySelector('#toast');
  el.textContent = message;
  el.className = `visible${isError ? ' error' : ''}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.className = '', 3300);
}

async function api(endpoint, options = {}) {
  const response = await fetch(`/api/${endpoint}`, { headers: { 'Content-Type': 'application/json' }, ...options });
  const data = await response.json();
  if (response.status === 401) {
    location.assign(`/login?next=${encodeURIComponent(location.pathname + location.search)}`);
    throw new Error('로그인이 필요합니다.');
  }
  if (!response.ok) throw new Error(data.error || '저장에 실패했습니다.');
  return data;
}

const logoutButton = document.querySelector('#logout-button');
fetch('/api/session').then(async response => {
  if (response.ok && response.headers.get('content-type')?.includes('application/json') && (await response.json()).authenticated) logoutButton.hidden = false;
}).catch(() => {});
logoutButton.addEventListener('click', async () => {
  logoutButton.disabled = true;
  try {
    const response = await fetch('/api/logout', { method: 'POST' });
    if (!response.ok) throw new Error('로그아웃에 실패했습니다.');
    location.assign('/login');
  } catch (error) {
    toast(error.message, true);
    logoutButton.disabled = false;
  }
});

async function refresh() {
  db = await api('state');
  render();
}

function pageHead(label, title, subtitle, buttons = '') {
  return `<div class="page-head"><div><div class="eyebrow">${label}</div><h1>${title}</h1><p>${subtitle}</p></div><div class="actions">${buttons}</div></div>`;
}

function metric(label, value, foot, icon, warn = false) {
  return `<div class="metric${warn ? ' warn' : ''}"><span class="metric-label">${label}</span><span class="metric-icon">${icon}</span><div class="metric-value">${value}</div><div class="metric-foot">${foot}</div></div>`;
}

function monthEvents() {
  const events = new Map();
  function addEvent(date, label, kind, id = '', memo = '') {
    if (!events.has(date)) events.set(date, []);
    events.get(date).push({ label, kind, id, memo });
  }
  for (const task of db.tasks.filter(item => Number(item.active))) {
    let due = String(task.dueDate);
    addEvent(due, task.title, due < todayKey ? 'overdue' : 'task', task.id, task.memo);
    const interval = Number(task.intervalDays || 0);
    if (interval && due >= todayKey) {
      let safety = 0;
      while (due < monthEnd() && safety++ < 100) {
        const next = new Date(`${due}T00:00:00`);
        next.setDate(next.getDate() + interval);
        due = localDate(next);
        if (due <= monthEnd()) addEvent(due, task.title, 'task', task.id, task.memo);
      }
    }
  }
  for (const plan of db.plans) addEvent(String(plan.date), `${nameFor(plan.varietyId)} ${plan.trays}판 파종`, 'sowing', plan.id);
  return events;
}

function calendar() {
  const start = new Date(viewMonth.getFullYear(), viewMonth.getMonth(), 1);
  const first = new Date(start);
  first.setDate(1 - start.getDay());
  const events = monthEvents();
  let cells = '';
  for (let i = 0; i < 42; i++) {
    const date = new Date(first);
    date.setDate(first.getDate() + i);
    const key = localDate(date);
    const dayEvents = events.get(key) || [];
    cells += `<button type="button" class="calendar-day${date.getMonth() !== viewMonth.getMonth() ? ' muted' : ''}${key === todayKey ? ' today' : ''}" data-calendar-date="${key}" aria-label="${date.getFullYear()}년 ${date.getMonth() + 1}월 ${date.getDate()}일 ${dayEvents.length ? `${dayEvents.length}개 일정, ` : ''}작업 추가"><span class="day-number">${date.getDate()}</span>${dayEvents.slice(0, 2).map(item => `<span class="calendar-event ${item.kind}" title="${escapeHtml(item.memo ? `${item.label} · ${item.memo}` : item.label)}">${escapeHtml(item.memo ? `${item.label} · ${item.memo}` : item.label)}</span>`).join('')}${dayEvents.length > 2 ? `<span class="calendar-event">+${dayEvents.length - 2}개 더보기</span>` : ''}</button>`;
  }
  return `<section class="panel"><div class="panel-head"><div><h2 class="panel-title">월간 일정표</h2><div class="panel-sub">날짜를 눌러 작업과 메모를 등록하세요</div></div><div class="panel-head-side"><button class="icon-btn" data-month="-1" aria-label="이전 달">‹</button><span class="month-name">${viewMonth.getFullYear()}년 ${viewMonth.getMonth() + 1}월</span><button class="icon-btn" data-month="1" aria-label="다음 달">›</button></div></div><div class="calendar"><div class="weekdays">${['일', '월', '화', '수', '목', '금', '토'].map(day => `<span>${day}</span>`).join('')}</div><div class="calendar-grid">${cells}</div></div></section>`;
}

function pendingTasks() {
  return db.tasks.filter(item => Number(item.active) && String(item.dueDate) <= todayKey).sort((a, b) => String(a.dueDate).localeCompare(String(b.dueDate)));
}

function todayPanel() {
  const tasks = pendingTasks();
  const planned = db.plans.filter(item => item.date <= todayKey);
  let content = tasks.map(item => `<div class="task-row"><button class="task-check" data-complete="${item.id}" aria-label="${escapeHtml(item.title)} 완료">✓</button><div class="task-copy"><strong>${escapeHtml(item.title)}</strong><small class="${item.dueDate < todayKey ? 'overdue-text' : ''}">${item.dueDate < todayKey ? `${shortDate(item.dueDate)} 예정 · 지연 중` : '오늘 예정'}${Number(item.intervalDays) ? ` · ${item.intervalDays}일마다` : ''}</small>${item.memo ? `<small class="task-memo">${escapeHtml(item.memo)}</small>` : ''}</div></div>`).join('');
  content += planned.map(item => `<div class="task-row"><span class="task-check" style="display:grid;place-items:center;border-color:#ead9af;color:#ae874d">◌</span><div class="task-copy"><strong>${escapeHtml(nameFor(item.varietyId))} 파종 예정</strong><small class="${item.date < todayKey ? 'overdue-text' : ''}">${item.date < todayKey ? `${shortDate(item.date)} 예정 · 지연 중 · ` : ''}육묘판 ${item.trays}개 · ${number(item.trays * 300)}립 필요</small></div><button class="btn tiny" data-act-plan="${item.id}">기록</button></div>`).join('');
  return `<section class="panel"><div class="panel-head"><div><h2 class="panel-title">오늘 할 일</h2><div class="panel-sub">완료하면 다음 일정이 자동 계산됩니다</div></div><button class="btn tiny soft" data-modal="task">+ 추가</button></div><div class="today-list">${content || `<div class="empty"><div class="empty-mark">☀</div>오늘 예정된 작업이 없습니다.</div>`}</div></section>`;
}

function alerts() {
  const missing = db.harvests.filter(item => item.weightKg === '' || item.weightKg == null);
  const low = db.varieties.filter(item => Number(item.stock) <= 1000);
  const futurePlans = db.plans.filter(item => item.date <= monthEnd());
  const shortage = db.varieties.map(variety => {
    const need = futurePlans.filter(item => item.varietyId === variety.id).reduce((sum, item) => sum + Number(item.trays) * 300, 0);
    return { name: variety.name, deficit: Math.max(0, need - Number(variety.stock)) };
  }).filter(item => item.deficit > 0);
  let content = '';
  if (missing.length) content += `<div class="alert-row"><span class="alert-mark">●</span><span><strong>미계량 수확 ${missing.length}건</strong><br>무게를 입력하지 않은 기록이 있습니다.</span></div>`;
  for (const item of shortage) content += `<div class="alert-row"><span class="alert-mark">●</span><span><strong>${escapeHtml(item.name)} 씨앗 ${number(item.deficit)}립 부족</strong><br>미완료 파종 예정 기준입니다.</span></div>`;
  for (const item of low) content += `<div class="alert-row soft-alert"><span class="alert-mark">●</span><span><strong>${escapeHtml(item.name)} 재고 ${number(item.stock)}립</strong><br>재고가 1,000립 이하입니다.</span></div>`;
  return `<section class="panel"><div class="panel-head"><div><h2 class="panel-title">확인할 항목</h2><div class="panel-sub">놓치기 쉬운 기록을 모았습니다</div></div><span class="status-badge ${missing.length || shortage.length ? 'red' : ''}">${missing.length + low.length + shortage.length}건</span></div><div class="alerts">${content || `<div class="empty"><div class="empty-mark">✓</div>지금 확인할 알림이 없습니다.</div>`}</div></section>`;
}

function stockPanel() {
  return `<section class="panel"><div class="panel-head"><div><h2 class="panel-title">품종별 씨앗 재고</h2><div class="panel-sub">파종하면 재고에서 자동 차감됩니다</div></div><button class="btn tiny" data-modal="stock">+ 입고</button></div><div class="stock-list">${db.varieties.map(item => `<div class="stock-row"><span class="stock-name"><i class="stock-dot"></i>${escapeHtml(item.name)}</span><span class="stock-number ${Number(item.stock) <= 1000 ? 'low' : ''}">${number(item.stock)} <small>립</small></span></div>`).join('')}</div></section>`;
}

function recentPanel() {
  const entries = [
    ...db.sowings.map(item => ({ date: item.date, title: `${nameFor(item.varietyId)} 파종`, detail: `${item.trays}판 · ${number(item.seedCount)}립` })),
    ...db.harvests.map(item => ({ date: item.date, title: `${nameFor(item.varietyId)} 수확`, detail: item.weightKg === '' ? '무게 미계량' : kg(item.weightKg), missing: item.weightKg === '' })),
    ...db.co2.map(item => ({ date: item.date, title: `CO₂ ${item.tankNumber}번 통 교체`, detail: '교체 기록' })),
    ...db.nutrients.map(item => ({ date: item.date, title: '양액 투입', detail: '온실 전체' })),
  ].sort((a, b) => String(b.date).localeCompare(String(a.date))).slice(0, 5);
  return `<section class="panel"><div class="panel-head"><div><h2 class="panel-title">최근 기록</h2><div class="panel-sub">가장 최근에 입력한 내용</div></div><button class="btn tiny" data-page="records">전체 보기 →</button></div><div class="record-list">${entries.length ? entries.map(item => `<div class="mini-record"><span><strong>${escapeHtml(item.title)}</strong><small>${shortDate(item.date)}</small></span><span class="value ${item.missing ? 'overdue-text' : ''}">${escapeHtml(item.detail)}</span></div>`).join('') : `<div class="empty">아직 등록된 기록이 없습니다.</div>`}</div></section>`;
}

function dashboard() {
  const monthlyHarvests = db.harvests.filter(inMonth);
  const monthlySowings = db.sowings.filter(inMonth);
  const monthlySales = db.sales.filter(inMonth);
  const latestClimate = sortRecent(db.climate)[0];
  return `<div class="content">${pageHead('OVERVIEW', '안녕하세요, 오늘의 온실', '일정과 재배 현황을 한눈에 확인하세요.', `<button class="btn" data-modal="harvest">+ 수확 기록</button><button class="btn primary" data-modal="task">+ 작업 등록</button>`)}<div class="metrics">${metric('이번 달 수확량', `${kg(total(monthlyHarvests, 'weightKg'))}`, `상자 ${number(total(monthlyHarvests, 'boxes'))}개`, '↗')}${metric('이번 달 판매량', `${kg(total(monthlySales, 'weightKg'))}`, `상자 ${number(total(monthlySales, 'boxes'))}개`, '◈')}${metric('이번 달 파기량', `${kg(total(monthlyHarvests, 'cullWeightKg'))}`, `상자 ${number(total(monthlyHarvests, 'cullBoxes'))}개`, '↘')}${metric('이번 달 파종', `${number(total(monthlySowings, 'trays'))}<small>판</small>`, `${number(total(monthlySowings, 'seedCount'))}립 사용`, '✳')}</div><div class="dashboard-grid">${calendar()}<div class="right-stack">${todayPanel()}${alerts()}</div></div><div class="lower-grid">${stockPanel()}<div class="right-stack">${`<section class="panel"><div class="panel-head"><div><h2 class="panel-title">최근 온실 환경</h2><div class="panel-sub">날짜별 온도·습도 입력 기록</div></div><button class="btn tiny" data-modal="climate">+ 입력</button></div><div class="record-list">${latestClimate ? `<div class="mini-record"><span><strong>${escapeHtml(latestClimate.temperature)}°C</strong><small>온도</small></span><span class="value">습도 ${escapeHtml(latestClimate.humidity)}%<br><small>${shortDate(latestClimate.date)} 기록</small></span></div>` : `<div class="empty">아직 기록이 없습니다.</div>`}</div></section>`}${recentPanel()}</div></div></div>`;
}

function table(headers, items, makeRow) {
  return `<div class="table-wrap">${items.length ? `<table class="data-table"><thead><tr>${headers.map(item => `<th>${item}</th>`).join('')}<th></th></tr></thead><tbody>${items.map(makeRow).join('')}</tbody></table>` : `<div class="empty">등록된 기록이 없습니다.</div>`}</div>`;
}

function deleteButton(type, id) { return `<button class="delete" data-delete="${type}" data-id="${id}" aria-label="기록 삭제">×</button>`; }

function recordPanel(title, subtitle, button, content, wide = false) {
  return `<section class="panel ${wide ? 'full-span' : ''}"><div class="panel-head"><div><h2 class="panel-title">${title}</h2><div class="panel-sub">${subtitle}</div></div>${button ? `<button class="btn tiny" data-modal="${button}">+ 등록</button>` : ''}</div>${content}</section>`;
}

function varietyPanel() {
  return `<section class="panel"><div class="panel-head"><div><h2 class="panel-title">품종 관리</h2><div class="panel-sub">품종을 추가하고 사용하지 않는 품종을 삭제합니다</div></div></div><form class="variety-add" data-endpoint="varieties"><label class="variety-name-field" for="new-variety-name">품종 이름<input id="new-variety-name" name="name" placeholder="예: 신품종" maxlength="60" required></label><label for="new-variety-stock">현재 씨앗 재고(립)<input id="new-variety-stock" name="openingStock" type="number" min="0" step="1" value="0" required></label><button class="btn primary" type="submit">+ 품종 추가</button></form><div class="stock-list">${db.varieties.map(item => `<div class="stock-row"><span class="stock-name"><i class="stock-dot"></i>${escapeHtml(item.name)}</span><span class="variety-actions"><span>${number(item.stock)}립</span><button class="btn tiny danger" data-delete="varieties" data-id="${item.id}" aria-label="${escapeHtml(item.name)} 품종 삭제">삭제</button></span></div>`).join('')}</div></section>`;
}

function recordContent() {
  if (tab === 'seed') return `<div class="records-grid">${recordPanel('씨앗 재고', '구매한 수량을 더하고 필요할 때 재고를 조정합니다', 'stock', `<div class="stock-list">${db.varieties.map(item => `<div class="stock-row"><span class="stock-name"><i class="stock-dot"></i>${escapeHtml(item.name)}</span><span class="stock-number ${Number(item.stock) <= 1000 ? 'low' : ''}">${number(item.stock)}립</span></div>`).join('')}</div>`)}${varietyPanel()}${recordPanel('파종 기록', '한 판 300칸 기준으로 씨앗 재고가 차감됩니다', 'sowing', table(['날짜', '품종', '육묘판', '씨앗'], sortRecent(db.sowings), item => `<tr><td>${escapeHtml(item.date)}</td><td><strong>${escapeHtml(nameFor(item.varietyId))}</strong></td><td>${item.trays}판</td><td>${number(item.seedCount)}립</td><td>${deleteButton('sowings', item.id)}</td></tr>`), true)}${recordPanel('파종 예정', '월간 달력에서 필요한 씨앗을 미리 계산합니다', 'plan', table(['날짜', '품종', '육묘판', '필요 씨앗'], sortRecent(db.plans), item => `<tr><td>${escapeHtml(item.date)}</td><td><strong>${escapeHtml(nameFor(item.varietyId))}</strong></td><td>${item.trays}판</td><td>${number(item.trays * 300)}립</td><td>${deleteButton('plans', item.id)}</td></tr>`), true)}</div>`;
  if (tab === 'harvest') return `<div class="records-grid">${recordPanel('수확 · 파기 기록', '무게가 없으면 미계량으로 빨간색 표시됩니다', 'harvest', table(['날짜', '베드', '품종', '수확', '파기', '계량'], sortRecent(db.harvests), item => `<tr><td>${escapeHtml(item.date)}</td><td>${escapeHtml(bedFor(item.bedKey))}</td><td><strong>${escapeHtml(nameFor(item.varietyId))}</strong></td><td>${item.boxes}상자 · ${item.weightKg === '' ? '-' : kg(item.weightKg)}</td><td>${item.cullBoxes}상자 · ${item.cullWeightKg === '' ? '-' : kg(item.cullWeightKg)}</td><td><span class="status-badge ${item.weightKg === '' ? 'red' : ''}">${item.weightKg === '' ? '미계량' : '계량 완료'}</span></td><td>${deleteButton('harvests', item.id)}</td></tr>`), true)}${recordPanel('판매 기록', '판매 날짜와 수량을 직접 입력합니다', 'sale', table(['판매일', '품종', '상자', '무게'], sortRecent(db.sales), item => `<tr><td>${escapeHtml(item.date)}</td><td><strong>${escapeHtml(nameFor(item.varietyId))}</strong></td><td>${item.boxes}상자</td><td>${item.weightKg === '' ? '-' : kg(item.weightKg)}</td><td>${deleteButton('sales', item.id)}</td></tr>`), true)}</div>`;
  if (tab === 'schedule') return `<div class="records-grid">${recordPanel('반복 작업', '미완료 작업은 지연 상태로 유지됩니다', 'task', table(['작업', '다음 예정일', '반복', '상태'], db.tasks.filter(item => Number(item.active)).sort((a, b) => String(a.dueDate).localeCompare(String(b.dueDate))), item => `<tr><td><strong>${escapeHtml(item.title)}</strong>${item.memo ? `<small class="table-memo">${escapeHtml(item.memo)}</small>` : ''}</td><td>${escapeHtml(item.dueDate)}</td><td>${Number(item.intervalDays) ? `${item.intervalDays}일마다` : '한 번'}</td><td><span class="status-badge ${item.dueDate < todayKey ? 'red' : ''}">${item.dueDate < todayKey ? '지연' : '예정'}</span></td><td>${deleteButton('tasks', item.id)}</td></tr>`), true)}${recordPanel('완료 이력', '완료한 날짜를 기준으로 다음 일정이 계산됩니다', '', table(['작업', '예정일', '완료일'], sortRecent(db.taskHistory, 'completedAt'), item => `<tr><td><strong>${escapeHtml(item.title)}</strong></td><td>${escapeHtml(item.dueDate)}</td><td>${escapeHtml(item.completedAt)}</td><td></td></tr>`), true)}</div>`;
  if (tab === 'climate') return `<div class="records-grid">${recordPanel('온도 · 습도', '날짜별 온실 환경을 직접 기록합니다', 'climate', table(['날짜', '온도', '습도'], sortRecent(db.climate), item => `<tr><td>${escapeHtml(item.date)}</td><td><strong>${escapeHtml(item.temperature)}°C</strong></td><td>${escapeHtml(item.humidity)}%</td><td>${deleteButton('climate', item.id)}</td></tr>`))}${recordPanel('양액 투입일', '온실 전체에 투입한 날짜만 남깁니다', 'nutrient', table(['투입 날짜'], sortRecent(db.nutrients), item => `<tr><td><strong>${escapeHtml(item.date)}</strong></td><td>${deleteButton('nutrients', item.id)}</td></tr>`))}</div>`;
  const sorted = sortRecent(db.co2);
  const next = sorted.length ? Number(sorted[0].tankNumber) % 5 + 1 : 1;
  const intervals = sorted.slice(0, 5).map((item, i) => i < sorted.length - 1 ? (new Date(item.date) - new Date(sorted[i + 1].date)) / 86400000 : null).filter(item => item > 0);
  const average = intervals.length ? Math.round(intervals.reduce((sum, value) => sum + value, 0) / intervals.length) : null;
  const estimated = average && sorted.length ? localDate(new Date(new Date(`${sorted[0].date}T00:00:00`).getTime() + average * 86400000)) : null;
  return `<div class="records-grid">${recordPanel('CO₂ 통 교체', '1→2→3→4→5→1 순서로 순환합니다', 'co2', `<div class="stock-list"><div class="stock-row"><span>다음 추천 통</span><span class="stock-number">${next}번</span></div><div class="stock-row"><span>최근 교체일</span><span class="stock-number">${sorted[0] ? shortDate(sorted[0].date) : '-'}</span></div><div class="stock-row"><span>예상 다음 교체일</span><span class="stock-number">${estimated ? `${shortDate(estimated)} · 참고` : '기록이 쌓이면 표시'}</span></div></div>`)}${recordPanel('교체 이력', '교체할 때 통 번호와 날짜를 입력합니다', '', table(['교체일', '통 번호'], sorted, item => `<tr><td>${escapeHtml(item.date)}</td><td><strong>${item.tankNumber}번 통</strong></td><td>${deleteButton('co2', item.id)}</td></tr>`))}</div>`;
}

function records() {
  const tabs = [['seed', '파종 · 씨앗'], ['harvest', '수확 · 판매'], ['schedule', '작업 일정'], ['climate', '온습도 · 양액'], ['co2', 'CO₂ 통']];
  return `<div class="content">${pageHead('RECORDS', '재배 기록', '현장에서 생긴 일을 기록하고 엑셀로 내려받을 수 있습니다.', `<button class="btn" data-export-excel>엑셀 내려받기</button><button class="btn primary" data-modal="${tab === 'seed' ? 'sowing' : tab === 'harvest' ? 'harvest' : tab === 'schedule' ? 'task' : tab === 'climate' ? 'climate' : 'co2'}">+ 새 기록</button>`)}<div class="tabs" role="tablist">${tabs.map(([key, label]) => `<button role="tab" data-tab="${key}" aria-selected="${tab === key}" class="${tab === key ? 'active' : ''}">${label}</button>`).join('')}</div>${recordContent()}</div>`;
}

function bedDetails() {
  const bed = db.beds.find(item => item.id === selectedBed);
  const picker = `<label for="bed-picker">베드 선택</label><select id="bed-picker"><option value="">베드를 선택하세요</option>${db.beds.filter(item => selectedFloor === 'all' || item.floor === selectedFloor).map(item => `<option value="${item.id}" ${item.id === selectedBed ? 'selected' : ''}>${item.floor} ${item.side}${item.number}</option>`).join('')}</select>`;
  if (!bed) return `<div class="bed-details"><div class="detail-overline">RACK DETAILS</div><h2>재배대를 선택하세요</h2><p>3D 배치도나 아래 목록에서 베드를 선택해 종류와 품종을 지정할 수 있습니다.</p>${picker}<div class="info-line"><span>재배실</span><strong>1층 · 2층</strong></div><div class="info-line"><span>층별 번호</span><strong>L1~L11 · R1~R11</strong></div></div>`;
  const recent = sortRecent(db.harvests.filter(item => item.bedKey === bed.id))[0];
  const stage = rackTypes[bed.rackType];
  const tierCount = tierCountFor(bed);
  const tierForm = `<form class="rack-tier-form" data-endpoint="rack-tiers"><input type="hidden" name="bedId" value="${bed.id}"><h3>단별 자리 수</h3><p>한 단 안의 자리 수를 알게 되면 입력하세요. 비워 둔 단은 미설정으로 남습니다.</p><div class="rack-tier-grid">${Array.from({ length: tierCount }, (_, index) => {
    const tier = index + 1;
    const count = db.rackTiers?.find(item => item.bedId === bed.id && Number(item.tier) === tier)?.slotCount ?? '';
    return `<label for="tier-${tier}">${tier}단<input id="tier-${tier}" name="tier${tier}" type="number" min="0" max="1000" step="1" value="${count}" placeholder="미설정"></label>`;
  }).join('')}</div><button class="btn" type="submit">자리 수 저장</button></form>`;
  return `<div class="bed-details"><div class="detail-overline">${escapeHtml(bed.floor)} · ${bed.side} SIDE</div><h2>${bed.side}${bed.number} 재배대</h2><p>단수와 재배 단계를 따로 기록합니다. 재배 단계를 지정하면 단수가 자동으로 맞춰집니다.</p>${picker}<div class="info-line"><span>현재 종류</span><strong>${stage?.name || '미지정'}</strong></div><div class="info-line"><span>단수</span><strong>${tierCount}단</strong></div><div class="info-line"><span>현재 품종</span><strong>${escapeHtml(nameFor(bed.varietyId))}</strong></div><div class="info-line"><span>최근 수확</span><strong>${recent ? shortDate(recent.date) : '기록 없음'}</strong></div><div class="info-line"><span>계량 상태</span><strong>${recent ? (recent.weightKg === '' ? '미계량' : '계량 완료') : '-'}</strong></div><label for="rack-type">재배대 종류</label><select id="rack-type"><option value="">종류 미지정</option>${Object.entries(rackTypes).map(([value, item]) => `<option value="${value}" ${value === bed.rackType ? 'selected' : ''}>${item.name} · ${item.tiers}단</option>`).join('')}</select><label for="rack-tier-count">재배대 단수</label><select id="rack-tier-count"><option value="5" ${tierCount === 5 ? 'selected' : ''}>5단</option><option value="6" ${tierCount === 6 ? 'selected' : ''}>6단</option></select><label for="bed-variety">재배 품종</label><select id="bed-variety"><option value="">미지정</option>${db.varieties.map(item => `<option value="${item.id}" ${item.id === bed.varietyId ? 'selected' : ''}>${escapeHtml(item.name)}</option>`).join('')}</select><button class="btn primary" data-action="save-bed">재배대 저장</button>${tierForm}</div>`;
}

function greenhouse() {
  const unset = db.beds.filter(item => !item.rackType).length;
  const fiveTiers = db.beds.filter(item => tierCountFor(item) === 5).length;
  const sixTiers = db.beds.filter(item => tierCountFor(item) === 6).length;
  const daysFor = stage => Number(db.stageSettings?.find(item => item.rackType === stage.rackType)?.days ?? stage.days);
  const totalDays = stages.reduce((sum, stage) => sum + daysFor(stage), 0);
  return `<div class="content">${pageHead('GREENHOUSE MAP', '재배실 3D 배치도', '1차 육묘대 6단 · 2차 육묘대 6단 · 3차 정식대 5단. 각 재배대의 종류를 지정할 수 있습니다.', '')}<div class="rack-summary">${stages.map(stage => `<div class="rack-summary-item ${stage.rackType}"><strong>${stage.name}</strong><span>${stage.tiers}단 · ${daysFor(stage)}일</span><small>지정 ${db.beds.filter(bed => bed.rackType === stage.rackType).length}개</small></div>`).join('')}<div class="rack-summary-item unset"><strong>재배대 구조</strong><span>5단 ${fiveTiers}개 · 6단 ${sixTiers}개</span><small>단계 미지정 ${unset}개 · 단수는 재배대별로 수정</small></div></div><form class="panel stage-settings" data-endpoint="stage-settings"><div><strong>재배 단계 기본 기간</strong><small>1차 시작부터 첫 수확까지 ${totalDays}일 기준</small></div>${stages.map(stage => `<label>${stage.name}<input name="${stage.rackType}" type="number" min="1" max="365" step="1" value="${daysFor(stage)}" required>일</label>`).join('')}<button class="btn primary" type="submit">기간 저장</button></form><div class="greenhouse-layout"><div class="scene-panel" id="farm-scene"><div class="scene-overlay"><strong>${selectedFloor === 'all' ? '재배실 전체 보기' : `${selectedFloor} 보기`}</strong><small>베드 클릭 · 드래그 회전 · 휠 확대</small><div class="floor-switch" aria-label="층 선택">${[['all', '전체'], ['1층', '1층'], ['2층', '2층']].map(([value, label]) => `<button data-floor="${value}" class="${selectedFloor === value ? 'active' : ''}" aria-pressed="${selectedFloor === value}">${label}</button>`).join('')}</div></div><div class="scene-hint">한 재배실 · 1층/2층 · 각 층 L1~L11, R1~R11 · 입구 왼쪽 L10·L11은 6단</div></div><section class="panel" id="bed-detail-panel">${bedDetails()}</section></div></div>`;
}

function archivePage() {
  const selected = db.archive.find(item => item.id === selectedArchiveId);
  const tiles = db.archive.map(item => `<button type="button" class="archive-tile ${item.id === selectedArchiveId ? 'active' : ''}" data-open-archive="${escapeHtml(item.id)}" aria-expanded="${item.id === selectedArchiveId}" aria-controls="archive-detail"><span class="archive-category">${escapeHtml(item.category)}</span><strong>${escapeHtml(item.title)}</strong><span class="archive-tile-foot">${item.id === selectedArchiveId ? '내용 접기' : '내용 보기'} <span aria-hidden="true">${item.id === selectedArchiveId ? '−' : '↗'}</span></span></button>`).join('');
  const detail = selected ? `<section class="panel archive-detail" id="archive-detail" aria-label="${escapeHtml(selected.title)} 상세 내용"><div class="archive-head"><div><span class="archive-category">${escapeHtml(selected.category)}</span><h2>${escapeHtml(selected.title)}</h2></div><div class="archive-actions"><button class="btn tiny" data-edit-archive="${escapeHtml(selected.id)}">수정</button><button class="btn tiny danger" data-delete="archive" data-id="${escapeHtml(selected.id)}">삭제</button></div></div><div class="archive-body">${selected.content ? escapeHtml(selected.content) : '아직 등록된 비율 수치가 없습니다. 현장 기준을 확인한 뒤 수정에서 입력해 주세요.'}</div></section>` : '';
  return `<div class="content">${pageHead('REFERENCE', '스마트팜 아카이브', '온실 운영에 필요한 기준과 절차를 기록해 두세요.', '<button class="btn primary" data-modal="archive">+ 자료 추가</button>')}<div class="archive-grid">${tiles}</div>${detail}</div>`;
}

function journalPage() {
  const entries = sortRecent(db.journal || []);
  const list = entries.length ? entries.map(item => `<article class="panel journal-entry"><div class="journal-entry-head"><div><time datetime="${escapeHtml(item.date)}">${escapeHtml(item.date)}</time><h2>${escapeHtml(item.title)}</h2></div><div class="archive-actions"><button class="btn tiny" data-edit-journal="${escapeHtml(item.id)}">수정</button><button class="btn tiny danger" data-delete="journal" data-id="${escapeHtml(item.id)}">삭제</button></div></div><div class="journal-content">${escapeHtml(item.content)}</div></article>`).join('') : '<div class="panel empty">아직 작성한 업무 일지가 없습니다. 오늘 한 일을 기록해 보세요.</div>';
  return `<div class="content">${pageHead('WORK JOURNAL', '업무 일지', '날짜별로 실제 진행한 작업과 현장 메모를 남겨두세요.', '<button class="btn" data-export-excel>엑셀 내려받기</button><button class="btn primary" data-modal="journal">+ 일지 작성</button>')}<div class="journal-list">${list}</div></div>`;
}

function render() {
  const version = ++renderVersion;
  if (farmCleanup) { farmCleanup(); farmCleanup = null; }
  if (!db) return;
  breadcrumb.textContent = page === 'dashboard' ? '대시보드' : page === 'records' ? '재배 기록' : page === 'journal' ? '업무 일지' : page === 'greenhouse' ? '온실 배치도' : '스마트팜 아카이브';
  document.querySelectorAll('.main-nav button').forEach(button => button.classList.toggle('active', button.dataset.page === page));
  app.innerHTML = page === 'dashboard' ? dashboard() : page === 'records' ? records() : page === 'journal' ? journalPage() : page === 'greenhouse' ? greenhouse() : archivePage();
  if (page === 'records' && tab === 'harvest') {
    const records = sortRecent(db.harvests);
    app.querySelectorAll('.records-grid > .panel:first-child tbody tr').forEach((row, index) => {
      const edit = document.createElement('button');
      edit.className = 'edit';
      edit.dataset.editHarvest = records[index].id;
      edit.textContent = records[index].weightKg === '' ? '무게 입력' : '수정';
      row.lastElementChild.prepend(edit);
    });
  }
  if (page === 'records' && tab === 'seed') {
    const plans = sortRecent(db.plans);
    app.querySelectorAll('.records-grid > .panel:nth-child(4) tbody tr').forEach((row, index) => {
      const action = document.createElement('button');
      action.className = 'edit';
      action.dataset.actPlan = plans[index].id;
      action.textContent = '파종 기록';
      row.lastElementChild.prepend(action);
    });
  }
  if (page === 'greenhouse') {
    import('./farm3d.js').then(({ mountFarmView }) => {
      if (version !== renderVersion || page !== 'greenhouse') return;
      farmCleanup = mountFarmView(document.querySelector('#farm-scene'), db.beds, id => {
        selectedBed = id;
        document.querySelector('#bed-detail-panel').innerHTML = bedDetails();
      }, selectedFloor, selectedBed);
    }).catch(error => toast(`3D 화면을 열지 못했습니다: ${error.message}`, true));
  }
}

function field(label, name, type = 'text', options = '') {
  return `<div class="field"><label for="f-${name}">${label}</label><input id="f-${name}" name="${name}" type="${type}" ${options}></div>`;
}
function selectField(label, name, options) {
  return `<div class="field"><label for="f-${name}">${label}</label><select id="f-${name}" name="${name}">${options}</select></div>`;
}
function varietyOptions() { return db.varieties.map(item => `<option value="${item.id}">${escapeHtml(item.name)}</option>`).join(''); }
function bedOptions() { return db.beds.map(item => `<option value="${item.id}">${item.floor} ${item.side}${item.number}</option>`).join(''); }
function dateField(value = todayKey) { return field('날짜', 'date', 'date', `value="${value}" required`); }
function numField(label, name, { step = 1, value = '', required = false } = {}) { return field(label, name, 'number', `min="0" step="${step}" value="${value}" ${required ? 'required' : ''}`); }

function modalConfig(kind, presetDate) {
  const date = presetDate || todayKey;
  const variety = () => selectField('품종', 'varietyId', varietyOptions());
  const memo = () => `<div class="field wide"><label for="f-memo">메모</label><input id="f-memo" name="memo" placeholder="필요할 때만 입력하세요"></div>`;
  switch (kind) {
    case 'journal': return ['업무 일지 작성', `${dateField(date)}<div class="field wide">${field('제목', 'title', 'text', 'required maxlength="100" placeholder="예: 육묘대 점검"')}</div><div class="field wide"><label for="f-content">진행 내용</label><textarea id="f-content" name="content" rows="8" maxlength="5000" required placeholder="오늘 진행한 작업과 특이 사항을 적어 주세요"></textarea></div>`,'journal'];
    case 'archive': return ['아카이브 자료 추가', `${field('분류', 'category', 'text', 'required list="archive-categories" maxlength="50"')}<datalist id="archive-categories"><option value="양액 비율"><option value="필터 청소"></datalist>${field('제목', 'title', 'text', 'required maxlength="100"')}<div class="field wide"><label for="f-content">내용</label><textarea id="f-content" name="content" rows="12" maxlength="5000" placeholder="현장에서 확인한 내용을 입력하세요"></textarea></div>`,'archive'];
    case 'stock': return ['씨앗 입고 · 재고 조정', `${dateField(date)}${variety()}${selectField('입력 방식', 'kind', '<option value="purchase">구매 수량 더하기</option><option value="adjust">현재 재고로 수정</option>')}${numField('씨앗 수량(립)', 'quantity', { required: true })}${memo()}`,'stock'];
    case 'sowing': return ['파종 기록', `${dateField(date)}${variety()}${numField('육묘판 수', 'trays', { required: true })}<div class="field"><label>자동 계산</label><input disabled value="1판 = 300립"></div>${memo()}`,'sowings'];
    case 'plan': return ['파종 예정 등록', `${dateField(date)}${variety()}${numField('예정 육묘판 수', 'trays', { required: true })}${memo()}`,'plans'];
    case 'task': return ['작업 일정 등록', `<div class="field wide">${field('작업 이름', 'title', 'text', 'required placeholder="예: 온실 청소"')}</div>${field('작업일', 'dueDate', 'date', `value="${date}" required`)}${numField('며칠마다 반복', 'intervalDays', { value: presetDate ? 0 : 7, required: true })}<div class="field wide"><label for="f-memo">메모 (선택)</label><textarea id="f-memo" name="memo" rows="3" maxlength="500" placeholder="예: 청소 도구 준비"></textarea></div><div class="field wide"><small>0일이면 한 번만 진행합니다. 완료하지 않으면 오늘 할 일에 계속 표시됩니다.</small></div>`,'tasks'];
    case 'harvest': return ['수확 · 파기 기록', `${dateField(date)}${selectField('베드', 'bedKey', bedOptions())}${variety()}${numField('수확 상자 수', 'boxes', { value: 0, required: true })}${numField('수확 실제 무게(kg)', 'weightKg', { step: .1 })}${numField('파기 상자 수', 'cullBoxes', { value: 0, required: true })}${numField('파기 무게(kg)', 'cullWeightKg', { step: .1 })}${memo()}<div class="field wide"><small>무게를 비워두고 저장하면 미계량으로 빨갛게 표시됩니다.</small></div>`,'harvests'];
    case 'sale': return ['판매 기록', `${dateField(date)}${variety()}${numField('판매 상자 수', 'boxes', { value: 0, required: true })}${numField('판매 무게(kg)', 'weightKg', { step: .1 })}${memo()}`,'sales'];
    case 'climate': return ['온도 · 습도 기록', `${dateField(date)}${field('온도(°C)', 'temperature', 'number', 'step="0.1" required')}${field('습도(%)', 'humidity', 'number', 'min="0" max="100" step="0.1" required')}`,'climate'];
    case 'nutrient': return ['양액 투입일 기록', `<div class="field wide">${dateField(date)}</div><div class="field wide"><small>온실 전체에 투입한 것으로 기록합니다.</small></div>`,'nutrients'];
    case 'co2': {
      const last = sortRecent(db.co2)[0];
      const next = last ? Number(last.tankNumber) % 5 + 1 : 1;
      return ['CO₂ 통 교체 기록', `${dateField(date)}${selectField('교체한 통', 'tankNumber', [1, 2, 3, 4, 5].map(i => `<option value="${i}" ${i === next ? 'selected' : ''}>${i}번 통</option>`).join(''))}<div class="field wide"><small>최근 기록을 기준으로 다음 순서의 통을 미리 선택했습니다.</small></div>`,'co2'];
    }
  }
}

function openModal(kind, date) {
  const config = modalConfig(kind, date);
  if (!config) return;
  const [title, fields, endpoint] = config;
  modalRoot.innerHTML = `<div class="modal-backdrop"><div class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title"><div class="modal-head"><h2 id="modal-title">${title}</h2><button class="close-btn" data-close aria-label="닫기">×</button></div><form data-endpoint="${endpoint}" class="modal-body"><div class="form-grid">${fields}</div><div class="form-actions"><button type="button" class="btn" data-close>취소</button><button type="submit" class="btn primary">저장하기</button></div></form></div></div>`;
  modalRoot.querySelector('input:not([type="date"]):not([disabled]), select')?.focus();
}

document.addEventListener('click', async event => {
  if (event.target.closest('.brand')) { event.preventDefault(); page = 'dashboard'; render(); return; }
  const button = event.target.closest('button');
  if (!button) {
    if (event.target.classList.contains('modal-backdrop')) modalRoot.innerHTML = '';
    return;
  }
  if (button.dataset.page) { page = button.dataset.page; render(); return; }
  if (button.dataset.openArchive) {
    selectedArchiveId = selectedArchiveId === button.dataset.openArchive ? '' : button.dataset.openArchive;
    render();
    app.querySelectorAll('[data-open-archive]').forEach(tile => { if (tile.dataset.openArchive === button.dataset.openArchive) tile.focus({ preventScroll: true }); });
    return;
  }
  if (button.hasAttribute('data-export-excel')) {
    button.disabled = true;
    try { const { exportExcel } = await import('./exportExcel.js'); await exportExcel(db); toast('엑셀 파일을 만들었습니다.'); }
    catch (error) { toast(`엑셀 파일을 만들지 못했습니다: ${error.message}`, true); }
    finally { button.disabled = false; }
    return;
  }
  if (button.dataset.calendarDate) { openModal('task', button.dataset.calendarDate); return; }
  if (button.dataset.floor) { selectedFloor = button.dataset.floor; if (selectedFloor !== 'all' && db.beds.find(item => item.id === selectedBed)?.floor !== selectedFloor) selectedBed = ''; render(); return; }
  if (button.dataset.tab) { tab = button.dataset.tab; render(); return; }
  if (button.dataset.month) { viewMonth = new Date(viewMonth.getFullYear(), viewMonth.getMonth() + Number(button.dataset.month), 1); render(); return; }
  if (button.dataset.modal) { openModal(button.dataset.modal, button.dataset.date); return; }
  if (button.dataset.actPlan) {
    const item = db.plans.find(plan => plan.id === button.dataset.actPlan);
    if (!item) return;
    openModal('sowing', item.date);
    const form = modalRoot.querySelector('form');
    form.dataset.planId = item.id;
    form.elements.namedItem('varietyId').value = item.varietyId;
    form.elements.namedItem('trays').value = item.trays;
    return;
  }
  if (button.dataset.editHarvest) {
    const item = db.harvests.find(record => record.id === button.dataset.editHarvest);
    if (!item) return;
    openModal('harvest', item.date);
    const form = modalRoot.querySelector('form');
    form.dataset.endpoint = `harvests/${item.id}`;
    form.dataset.method = 'PATCH';
    modalRoot.querySelector('#modal-title').textContent = '수확 · 파기 기록 수정';
    for (const key of ['date', 'bedKey', 'varietyId', 'boxes', 'weightKg', 'cullBoxes', 'cullWeightKg', 'memo']) {
      form.elements.namedItem(key).value = item[key] ?? '';
    }
    return;
  }
  if (button.dataset.editArchive) {
    const item = db.archive.find(record => record.id === button.dataset.editArchive);
    if (!item) return;
    openModal('archive');
    const form = modalRoot.querySelector('form');
    form.dataset.endpoint = `archive/${item.id}`;
    form.dataset.method = 'PATCH';
    modalRoot.querySelector('#modal-title').textContent = '아카이브 자료 수정';
    for (const key of ['category', 'title', 'content']) form.elements.namedItem(key).value = item[key] || '';
    return;
  }
  if (button.dataset.editJournal) {
    const item = db.journal.find(record => record.id === button.dataset.editJournal);
    if (!item) return;
    openModal('journal', item.date);
    const form = modalRoot.querySelector('form');
    form.dataset.endpoint = `journal/${item.id}`;
    form.dataset.method = 'PATCH';
    modalRoot.querySelector('#modal-title').textContent = '업무 일지 수정';
    for (const key of ['date', 'title', 'content']) form.elements.namedItem(key).value = item[key];
    return;
  }
  if (button.hasAttribute('data-close')) { modalRoot.innerHTML = ''; return; }
  if (button.dataset.complete) {
    try { await api(`tasks/${button.dataset.complete}/complete`, { method: 'POST', body: JSON.stringify({ date: todayKey }) }); await refresh(); toast('작업을 완료했습니다. 다음 일정이 갱신됐습니다.'); }
    catch (error) { toast(error.message, true); }
    return;
  }
  if (button.dataset.delete) {
    const isVariety = button.dataset.delete === 'varieties';
    const isArchive = button.dataset.delete === 'archive';
    const name = isVariety ? db.varieties.find(item => item.id === button.dataset.id)?.name : '';
    if (!confirm(isVariety ? `${name} 품종을 삭제할까요? 씨앗 재고도 함께 삭제됩니다.` : isArchive ? '이 아카이브 자료를 삭제할까요?' : '이 기록을 삭제할까요?')) return;
    try { await api(`${button.dataset.delete}/${button.dataset.id}`, { method: 'DELETE' }); if (isArchive) selectedArchiveId = ''; await refresh(); toast(isVariety ? '품종을 삭제했습니다.' : isArchive ? '자료를 삭제했습니다.' : '기록을 삭제했습니다.'); }
    catch (error) { toast(error.message, true); }
    return;
  }
  if (button.dataset.action === 'save-bed') {
    const rackType = document.querySelector('#rack-type').value;
    const tierCount = rackType ? rackTypes[rackType].tiers : Number(document.querySelector('#rack-tier-count').value);
    try { await api('beds', { method: 'POST', body: JSON.stringify({ id: selectedBed, varietyId: document.querySelector('#bed-variety').value, rackType, tierCount }) }); await refresh(); toast('재배대 정보를 저장했습니다.'); }
    catch (error) { toast(error.message, true); }
  }
});

document.addEventListener('submit', async event => {
  const form = event.target.closest('form[data-endpoint]');
  if (!form) return;
  event.preventDefault();
  const submit = form.querySelector('[type="submit"]');
  submit.disabled = true;
  const payload = Object.fromEntries(new FormData(form));
  if (form.dataset.planId) payload.planId = form.dataset.planId;
  try {
    const saved = await api(form.dataset.endpoint, { method: form.dataset.method || 'POST', body: JSON.stringify(payload) });
    if (form.dataset.endpoint.startsWith('archive') && saved?.id) selectedArchiveId = saved.id;
    modalRoot.innerHTML = '';
    await refresh();
    toast('기록을 저장했습니다.');
  } catch (error) {
    toast(error.message, true);
    submit.disabled = false;
  }
});

document.addEventListener('change', event => {
  if (event.target.id === 'bed-picker') { selectedBed = event.target.value; render(); }
});

document.addEventListener('keydown', event => { if (event.key === 'Escape') modalRoot.innerHTML = ''; });

refresh().catch(error => { app.innerHTML = `<div class="loading">기록을 불러오지 못했습니다.<br>${escapeHtml(error.message)}</div>`; });
