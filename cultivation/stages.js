export const stages = [
  { rackType: 'nursery1', name: '1차 육묘대', tiers: 6, days: 7 },
  { rackType: 'nursery2', name: '2차 육묘대', tiers: 6, days: 14 },
  { rackType: 'final', name: '3차 정식대', tiers: 5, days: 24 },
];

export function defaultTierCount(bed) {
  return ['1층', '2층'].includes(bed?.floor) && bed?.side === 'L' && [10, 11].includes(Number(bed?.number)) ? 6 : 5;
}

export function tierCountFor(bed) {
  const saved = Number(bed?.tierCount);
  if (saved === 5 || saved === 6) return saved;
  return stages.find(stage => stage.rackType === bed?.rackType)?.tiers ?? defaultTierCount(bed);
}

export function stageDays(body) {
  return stages.map(stage => {
    const days = Number(body[stage.rackType]);
    if (!Number.isInteger(days) || days < 1 || days > 365) throw new Error(`${stage.name} 기간은 1~365일로 입력해 주세요.`);
    return { rackType: stage.rackType, days };
  });
}

export function initialRackTiers(beds) {
  return beds.flatMap(bed => Array.from({ length: 6 }, (_, index) => ({
    id: `${bed.id}:${index + 1}`, bedId: bed.id, tier: index + 1, slotCount: '',
  })));
}

export function rackTierValues(body, bed) {
  if (!bed) throw new Error('재배대를 찾지 못했습니다.');
  return Array.from({ length: tierCountFor(bed) }, (_, index) => {
    const tier = index + 1;
    if (!Object.hasOwn(body, `tier${tier}`)) throw new Error(`${tier}단 자리 수를 확인해 주세요.`);
    const raw = body[`tier${tier}`];
    if (raw === '' || raw == null) return { tier, slotCount: '' };
    const slotCount = Number(raw);
    if (!Number.isInteger(slotCount) || slotCount < 0 || slotCount > 1000) throw new Error(`${tier}단 자리 수는 0~1000으로 입력해 주세요.`);
    return { tier, slotCount };
  });
}
