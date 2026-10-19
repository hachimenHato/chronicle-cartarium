import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extentAround, extentCenter, globalWorldExtent } from '../shared/world-extent';
import { globeExtentContour, globeLandPolygons } from '../src/lib/globe-geometry';
import {
  globeNavigationGrid,
  globeRotationStep,
  globeSelectionZoom,
  maximumGlobeZoom,
  nextGlobeZoom,
} from '../src/lib/globe-navigation';
import { createGlobePathRenderer, projectGlobe } from '../src/lib/globe-projection';

test('town and smallest selections fit as visible areas at equator, date line and poles', () => {
  assert.equal(globeSelectionZoom(globalWorldExtent), 1);
  for (const latitude of [-89.995, -80, 0, 40, 80, 89.995])
    for (const longitude of [-180, 45, 179.99])
      for (const [width, height] of [
        [0.12, 0.08],
        [0.01, 0.01],
      ]) {
        const extent = extentAround(latitude, longitude, width, height),
          before = JSON.stringify(extent),
          zoom = globeSelectionZoom(extent),
          center = extentCenter(extent),
          points = globeExtentContour(extent).map((point) =>
            projectGlobe(point.latitude, point.longitude, center.latitude, center.longitude),
          ),
          projectedWidth =
            Math.max(...points.map((p) => p.x)) - Math.min(...points.map((p) => p.x)),
          projectedHeight =
            Math.max(...points.map((p) => p.y)) - Math.min(...points.map((p) => p.y)),
          fraction = (Math.max(projectedWidth, projectedHeight) * zoom) / 360;
        assert(zoom > 500 && zoom <= maximumGlobeZoom);
        assert(Math.abs(fraction - 0.64) < 1e-8, `${latitude}, ${longitude}, ${width}`);
        assert.equal(JSON.stringify(extent), before, 'focusing must not resize the saved range');
      }
});

test('zoom steps reach town scales promptly and navigation stays proportional to visible range', () => {
  let zoom = 1;
  assert.equal(nextGlobeZoom(nextGlobeZoom(zoom, 1), 1), 2);
  for (let i = 0; i < 32; i++) zoom = nextGlobeZoom(zoom, 1);
  assert(zoom >= 8000 && zoom <= maximumGlobeZoom);
  assert.equal(nextGlobeZoom(maximumGlobeZoom, 1), maximumGlobeZoom);
  assert.equal(nextGlobeZoom(1, -1), 1);
  const step = globeRotationStep(1000);
  assert.equal(step.latitude, 0.005);
  assert.equal(step.longitude, 0.01);
});

test('local graticules and sub-pixel paths remain bounded and precise at town zoom', () => {
  for (const latitude of [-89.995, -80, 0, 70, 89.995]) {
    const extent = extentAround(latitude, 179.99, 0.01, 0.01),
      center = extentCenter(extent),
      zoom = globeSelectionZoom(extent),
      renderer = createGlobePathRenderer(center.latitude, center.longitude, {
        zoom,
        clipToViewport: true,
      }),
      grid = globeNavigationGrid(center, zoom),
      radius = 180 / zoom,
      selection = renderer.polygon(globeExtentContour(extent), undefined, center);
    assert(selection);
    assert(!/NaN|Infinity/.test(selection));
    assert(grid.step < 0.01);
    assert(grid.lines.length > 2 && grid.lines.length < 32);
    for (const path of [
      selection,
      ...grid.lines.map((line) => renderer.geometry(line)),
      ...globeLandPolygons.map((polygon) => renderer.geometry(polygon)),
    ]) {
      assert(!/NaN|Infinity|undefined/.test(path));
      assert(path.length < 200000, 'viewport clipping bounds output, including polar land');
      for (const match of path.matchAll(/([ML])(-?[\d.]+),(-?[\d.]+)/g)) {
        const [x, y] = [Number(match[2]), Number(match[3])];
        assert(Math.abs(x - 180) <= radius + 1e-7);
        assert(Math.abs(y - 180) <= radius + 1e-7);
      }
    }
    const numbers = [...selection.matchAll(/-?\d+\.(\d+)/g)];
    assert(
      numbers.some((match) => match[1].length > 3),
      'no three-decimal quantization locally',
    );
  }
});
