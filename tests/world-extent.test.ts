import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  extentAround,
  extentCenter,
  globalWorldExtent,
  isGlobalExtent,
  longitudeSpan,
} from '../shared/world-extent';
import { projectGlobe } from '../src/lib/globe-projection';
import { defaultGeographicSettings, validGeographicSettings } from '../shared/geography';
import { geographicSettingsSchema } from '../server/geographic-validation';
import { generationSignature } from '../src/lib/generated-map';

test('globe selection supports poles and antimeridian and new maps default to the full planet', () => {
  for (const kind of ['world', 'region', 'town'] as const)
    assert(isGlobalExtent(defaultGeographicSettings(kind) as typeof globalWorldExtent));
  const crossing = extentAround(35, 179, 20, 12);
  assert(crossing.longitudeWest > crossing.longitudeEast);
  assert(Math.abs(longitudeSpan(crossing) - 20) < 1e-4);
  assert.deepEqual(extentCenter(crossing), { latitude: 35, longitude: 179 });
  assert.equal(extentAround(89, 0, 30, 20).latitudeNorth, 90);
  assert.equal(projectGlobe(35, 179, 35, 179).visible, true);
  assert.equal(projectGlobe(-35, -1, 35, 179).visible, false);
  const settings = { ...defaultGeographicSettings('region'), ...crossing };
  assert(validGeographicSettings(settings));
  assert.deepEqual(geographicSettingsSchema.parse(settings), settings);
  assert(!geographicSettingsSchema.safeParse({ ...settings, longitudeEast: undefined }).success);
  assert(!validGeographicSettings({ ...settings, longitudeEast: undefined }));
  assert(
    !geographicSettingsSchema.safeParse({ ...settings, longitudeWest: 180, longitudeEast: -180 })
      .success,
  );
  const a = {
    version: 2 as const,
    seed: 91,
    detail: 'standard' as const,
    linework: 'organic' as const,
    climate: 'temperate' as const,
    settlements: 0,
    rivers: false,
    routes: false,
    geography: settings,
  };
  assert.notEqual(
    generationSignature([], 1000, 650, a),
    generationSignature([], 1000, 650, { ...a, geography: { ...settings, ...globalWorldExtent } }),
  );
});
