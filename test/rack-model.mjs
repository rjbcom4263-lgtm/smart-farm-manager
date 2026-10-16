import assert from 'node:assert/strict';
import { defaultTierCount, rackTierValues, stages, tierCountFor } from '../cultivation/stages.js';
import { createRackModel, displayTiersForRack } from '../src/farm3d.js';

for (const floor of ['1층', '2층']) {
  for (const side of ['L', 'R']) {
    for (let number = 1; number <= 11; number++) {
      const bed = { floor, side, number, rackType: '' };
      const expected = side === 'L' && number >= 10 ? 6 : 5;
      assert.equal(defaultTierCount(bed), expected, `${floor} ${side}${number}`);
      assert.equal(tierCountFor(bed), expected);
      assert.equal(displayTiersForRack(bed), expected);
    }
  }
}
assert.equal(tierCountFor({ floor: '1층', side: 'L', number: 2, rackType: 'nursery1' }), 6);
assert.equal(tierCountFor({ floor: '1층', side: 'L', number: 11, rackType: 'final' }), 5);
assert.equal(tierCountFor({ floor: '1층', side: 'L', number: 2, tierCount: 6, rackType: '' }), 6);
assert.equal(rackTierValues({ tier1: 10, tier2: '', tier3: '', tier4: '', tier5: '', tier6: '' }, { floor: '1층', side: 'L', number: 11, rackType: '' }).length, 6);

for (const stage of stages) {
  const { group, selectionMeshes } = createRackModel({
    tiers: stage.tiers,
    rackType: stage.rackType,
    color: '#73ac61',
    selected: false,
  });
  const count = name => group.getObjectByName(name)?.count ?? 0;
  assert.equal(count('grow-tray'), stage.tiers, `${stage.name}: one tray per level`);
  assert.equal(count('grow-light'), stage.tiers * 2, `${stage.name}: two LED bars per level`);
  assert.equal(count('irrigation-valve'), stage.tiers, `${stage.name}: irrigation at every level`);
  assert.equal(count('rack-upright'), 4, `${stage.name}: four metal posts`);
  assert.equal(selectionMeshes.length, 3, `${stage.name}: tray surfaces can highlight`);
  assert.ok(selectionMeshes.every(mesh => mesh.count >= stage.tiers));
  assert.equal(count('leaf-crowns'), stage.tiers * 30, `${stage.name}: planted crop rows`);
}

console.log('3D rack model tests passed');
