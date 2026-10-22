let snapshot;
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const time = value => value ? new Date(value).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }) : '수신 기록 없음';

function devicePanel(id, title, content) {
  const device = snapshot?.devices?.find(d => d.device === id);
  const stale = device?.stale || !snapshot?.available || !device;
  return `<section class="sensor-device ${stale ? 'sensor-stale' : ''}"><div class="sensor-device-head"><h3>${title}</h3><span class="sensor-status ${stale ? 'waiting' : ''}">${device ? stale ? '마지막 측정값' : '수신 중' : '수신 대기'}</span></div>${content(device)}<p class="sensor-time">측정 ${escape(time(device?.measuredAt))}</p></section>`;
}

function cell(label, value, unit, key = '', featured = false) {
  return `<div class="sensor-cell ${featured ? 'sensor-featured' : ''}"><span>${escape(label)}</span><strong>${value === null || value === undefined ? '—' : Number(value).toFixed(key === 'ec_pv' ? 2 : 1)}<small>${unit}</small></strong>${key ? `<code>${key}</code>` : ''}</div>`;
}

function environmentRow(device, key, label, unit) {
  const values = device?.values || [];
  const channels = [1, 2, 3, 4].map(n => values.find(v => v.key === key && v.category === 'SENSOR' && v.channel === String(n))?.value ?? null);
  // Require all four channels to avoid disguising a partial reading as a full average.
  const mean = channels.every(v => v !== null) ? channels.reduce((a, b) => a + b, 0) / 4 : null;
  const hvac = values.find(v => v.key === key && v.category === 'HVAC' && v.channel === '1')?.value ?? null;
  return `<div class="sensor-row-label">${label} <code>${key}</code></div><div class="sensor-environment-grid">${channels.map((v, i) => cell(`SENSOR #${i + 1}`, v, unit)).join('')}${cell('항온항습기', hvac, unit)}${cell('센서 4개 평균', mean, unit, '', true)}</div>`;
}

export function sensorPanel() {
  return `<section class="panel sensor-panel" aria-label="실시간 센서 현황"><div class="panel-head"><div><div class="eyebrow">LIVE MONITOR</div><h2 class="panel-title">온실 · 양액 현재값</h2><div class="panel-sub">10초마다 자동 확인 · 일평균과 구분된 현재 측정값</div></div></div>${snapshot && !snapshot.available ? `<p class="sensor-notice" role="status">${escape(snapshot.message || '연결을 확인하고 있습니다.')}</p>` : ''}<div class="sensor-layout">${devicePanel('environment', '복합환경', d => environmentRow(d, 'temp_pv', '온도', '°C') + environmentRow(d, 'humi_pv', '습도', '%'))}${devicePanel('nutrient', '양액기', d => `<div class="sensor-nutrient-grid">${cell('EC · 전기전도도', d?.values.find(v => v.key === 'ec_pv' && v.category === 'EC CONTROLL' && v.channel === '1')?.value, 'mS/cm', 'ec_pv', true)}${cell('pH · 산도', d?.values.find(v => v.key === 'ph_pv' && v.category === 'PH CONTROLL' && v.channel === '1')?.value, '', 'ph_pv', true)}</div>`)}</div></section>`;
}

export function startSensorUpdates() {
  async function update() {
    try {
      const response = await fetch('/api/sensors', { cache: 'no-store', signal: AbortSignal.timeout(5000) });
      if (!response.ok) throw new Error('Sensor request failed');
      const next = await response.json();
      if (!Array.isArray(next.devices)) throw new Error('Invalid sensor response');
      // Retain the last measurement on temporary connection failure.
      snapshot = next.available ? next : { ...next, devices: snapshot?.devices || [] };
    } catch {
      snapshot = { ...snapshot, available: false, message: '현재 연결을 확인할 수 없습니다. 마지막 측정값을 표시합니다.' };
    }
    const monitor = document.querySelector('#sensor-monitor');
    if (monitor) monitor.innerHTML = sensorPanel();
    setTimeout(update, 10000);
  }
  update();
}
