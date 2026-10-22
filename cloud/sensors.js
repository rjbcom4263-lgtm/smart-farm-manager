export const sensorKeys = ['temp_pv', 'humi_pv', 'ec_pv', 'ph_pv'];

// Keep channel identity: HVAC #1 and SENSOR #1 are different instruments.
export function sensorSnapshot(payload, now = Date.now()) {
  if (!Array.isArray(payload?.devices)) throw new Error('Invalid sensor payload');
  return {
    available: true,
    checkedAt: new Date(now).toISOString(),
    devices: payload.devices.filter(d => ['environment', 'nutrient'].includes(d.device_id)).map(d => {
      const measured = Date.parse(d.timestamp);
      const received = Date.parse(d.received_at);
      return {
        device: d.device_id, source: String(d.source_id || ''),
        measuredAt: Number.isFinite(measured) ? new Date(measured).toISOString() : null,
        receivedAt: Number.isFinite(received) ? new Date(received).toISOString() : null,
        stale: !Number.isFinite(measured) || !Number.isFinite(received) || now - Math.min(measured, received) > 60000 || measured > now + 60000,
        values: (Array.isArray(d.values) ? d.values : []).filter(v => sensorKeys.includes(v.key)).map(v => ({
          key: v.key, category: String(v.category || ''), channel: String(v.seq ?? ''),
          value: typeof v.value === 'number' || (typeof v.value === 'string' && v.value.trim() !== '')
            ? (Number.isFinite(Number(v.value)) ? Number(v.value) : null) : null,
        })),
      };
    }),
  };
}

export async function readSensors(url, fetcher = fetch) {
  try {
    const response = await fetcher(url, { signal: AbortSignal.timeout(3000), headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error('Receiver unavailable');
    return sensorSnapshot(await response.json());
  } catch {
    return { available: false, checkedAt: new Date().toISOString(), devices: [], message: '수신기에 연결할 수 없습니다. 수신 PC의 실행 상태를 확인해 주세요.' };
  }
}
