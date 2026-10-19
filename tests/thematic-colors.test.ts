import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  terrainLayerColors,
  thematicBlendRadius,
  climateValueColor,
  climateColorScales,
  climateLegendItems,
} from '../src/lib/thematic-colors';
import { biomeCatalog } from '../shared/cartography';
test('every terrain wash is distinct from water and the blend band stays smaller than a region', () => {
  const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const water = rgb(terrainLayerColors.water);
  for (const biome of biomeCatalog.filter((b) => b.id !== 'water')) {
    const land = rgb(terrainLayerColors[biome.id]);
    assert(Math.hypot(...land.map((v, i) => v - water[i])) > 65, biome.id);
    assert(
      land[2] < land[0] || land[2] < land[1],
      'land uses earth/vegetation pigment rather than water blue',
    );
  }
  const blur = thematicBlendRadius(1600, 1000, 1200);
  assert(blur > 1 && blur < Math.sqrt((1600 * 1000) / 1200) * 0.3);
});

test('fixed climate thresholds distinguish cool, mild and wet conditions without remapping data', () => {
  assert.notEqual(climateValueColor(0, 'temperature'), climateValueColor(10, 'temperature'));
  assert.notEqual(climateValueColor(10, 'temperature'), climateValueColor(30, 'temperature'));
  assert.equal(climateValueColor(-100, 'temperature'), climateColorScales.temperature[0].color);
  assert.equal(climateValueColor(90, 'temperature'), climateColorScales.temperature.at(-1)!.color);
  assert.equal(
    climateValueColor(9000, 'precipitation'),
    climateColorScales.precipitation.at(-1)!.color,
  );
  const mild = climateValueColor(10, 'temperature').match(/\d+/g)!.map(Number);
  assert(
    mild[0] > 220 && mild[1] > 210 && mild[2] > 180,
    'mild climate is a pale neutral, not hot red',
  );
  assert.notEqual(
    climateValueColor(250, 'precipitation'),
    climateValueColor(1000, 'precipitation'),
  );
  for (const layer of ['temperature', 'precipitation'] as const) {
    const legend = climateLegendItems(layer);
    assert(legend.every((item, i) => item.color === climateColorScales[layer][i].color));
    assert.equal(legend.length, climateColorScales[layer].length);
  }
});
