export function solutionValues(body) {
  const date = String(body.date ?? '').trim();
  const parsed = new Date(`${date}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
    throw new Error('올바른 날짜를 입력해 주세요.');
  }
  const ph = Number(body.ph);
  const ec = Number(body.ec);
  if (body.ph === '' || body.ph == null || !Number.isFinite(ph) || ph < 0 || ph > 14) throw new Error('pH는 0~14 사이로 입력해 주세요.');
  if (body.ec === '' || body.ec == null || !Number.isFinite(ec) || ec < 0) throw new Error('EC 값을 확인해 주세요.');
  return { date, ph, ec };
}
