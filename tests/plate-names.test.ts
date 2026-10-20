import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGeographicPlates } from '../src/lib/geography-fields';
import { generatedPlateName, plateDisplayName } from '../shared/plate-names';

test('plate names are deterministic, varied and unique without touching tectonic geometry', () => {
  const plates = createGeographicPlates(1600, 1000, 2741, 24);
  assert.equal(new Set(plates.map((p) => p.name)).size, 24);
  assert(plates.every((p) => !/\d/.test(p.name) && p.name.endsWith('板块')));
  assert.deepEqual(plates, createGeographicPlates(1600, 1000, 2741, 24));
  assert.notEqual(generatedPlateName(0, 2741), generatedPlateName(0, 2742));
  const { name: _name, ...shape } = plates[0];
  assert.equal(plateDisplayName({ ...shape, name: '第1板块' }, 2741), plates[0].name);
  assert.equal(plateDisplayName({ ...shape, name: '月汐板块' }, 2741), '月汐板块');
});
