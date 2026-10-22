import assert from 'node:assert/strict';
import { sensorSnapshot, readSensors } from '../cloud/sensors.js';
const now = Date.parse('2026-10-17T06:00:00Z');
const payload = { devices: [{ device_id: 'environment', timestamp: new Date(now).toISOString(), received_at: new Date(now).toISOString(), values: [
  { category: 'SENSOR', seq: 1, key: 'temp_pv', value: '0' },
  { category: 'HVAC', seq: 1, key: 'temp_pv', value: '21.4' },
  { category: 'SENSOR', seq: 2, key: 'humi_pv', value: '' },
  { category: 'SENSOR', seq: 3, key: 'humi_pv', value: 'bad' },
  { category: 'SENSOR', seq: 1, key: 'co2_pv', value: '800' },
] }] };
const result = sensorSnapshot(payload, now);
assert.equal(result.devices[0].stale, false);
assert.deepEqual(result.devices[0].values.map(v => v.value), [0, 21.4, null, null]);
assert.deepEqual(result.devices[0].values.slice(0, 2).map(v => v.category), ['SENSOR', 'HVAC']);
assert.equal(sensorSnapshot(payload, now + 61000).devices[0].stale, true);
assert.throws(() => sensorSnapshot({}));
assert.equal((await readSensors('unused', async () => { throw Error('offline'); })).available, false);
assert.equal((await readSensors('unused', async () => Response.json({ devices: [] }))).available, true);
console.log('Sensor mapping, freshness and connection checks passed');
