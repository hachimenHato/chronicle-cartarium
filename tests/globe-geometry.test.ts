import { test } from 'node:test';
import assert from 'node:assert/strict';
import { geoArea, geoContains } from 'd3-geo';
import { globeExtentContour, globeLandContours } from '../src/lib/globe-geometry';
import {
  createGlobePathRenderer,
  globePolygon,
  globePolygonPath,
  visibleGlobePath,
} from '../src/lib/globe-projection';
import { extentAround, extentCenter, longitudeSpan, wrapLongitude } from '../shared/world-extent';

/** D3's SVG output contains only M/L/Z; include implicit closing segments in the regression. */
function segments(path: string) {
  const result: { from: number[]; to: number[] }[] = [];
  let previous: number[] | undefined, start: number[] | undefined;
  for (const match of path.matchAll(/([MLZ])([^MLZ]*)/g)) {
    const next = match[1] === 'Z' ? start : match[2].split(',').map(Number);
    if (match[1] === 'M') start = next;
    else if (previous && next) result.push({ from: previous, to: next });
    previous = next;
  }
  return result;
}

test('all actual globe silhouettes close along the limb across full rotations without diagonal cuts', () => {
  let visible = 0,
    empty = 0;
  for (const latitude of [-90, -89, -80, -60, -30, 0, 30, 60, 80, 89, 90])
    for (let longitude = -180; longitude <= 180; longitude += 10) {
      const renderer = createGlobePathRenderer(latitude, longitude);
      for (const contour of globeLandContours) {
        const path = renderer.polygon(contour);
        if (path) visible++;
        else empty++;
        assert(!/NaN|Infinity|undefined/.test(path));
        for (const { from, to } of segments(path)) {
          for (const point of [from, to])
            assert(Math.hypot(point[0] - 180, point[1] - 180) <= 156.002);
          // Adjacent coastline samples span <18px; a hidden-side shortcut is much longer.
          assert(Math.hypot(to[0] - from[0], to[1] - from[1]) < 25);
        }
      }
    }
  assert(visible > 500 && empty > 500);
});

test('graticules intersect the exact horizon instead of stopping at the last visible vertex', () => {
  const path = visibleGlobePath(
    [
      { latitude: 0, longitude: -100 },
      { latitude: 0, longitude: -80 },
      { latitude: 0, longitude: 0 },
      { latitude: 0, longitude: 80 },
      { latitude: 0, longitude: 100 },
    ],
    0,
    0,
  );
  const runs = segments(path);
  assert(runs.length >= 2);
  assert.deepEqual(runs[0].from, [24, 180]);
  assert.deepEqual(runs[runs.length - 1].to, [336, 180]);
  const hidden = visibleGlobePath(
    [
      { latitude: 0, longitude: 150 },
      { latitude: 20, longitude: 170 },
    ],
    0,
    0,
  );
  assert.equal(hidden, '');
});

test('rings normalize equivalent meridians and repeated closure without changing visible land', () => {
  const ring = globeLandContours[0];
  const normalized = globePolygonPath(ring, 20, -100);
  const shifted = ring.map((point) => ({ ...point, longitude: point.longitude + 720 }));
  shifted.push({ ...shifted[0] }, { ...shifted[0] });
  assert.equal(globePolygonPath(shifted, 20, -100), normalized);
  assert.equal(globePolygonPath([], 0, 0), '');
  assert.equal(globePolygonPath([{ latitude: 0, longitude: 0 }], 0, 0), '');
  assert.equal(globePolygonPath([{ latitude: NaN, longitude: 0 }, ...ring], 0, 0), '');
});

test('regional selections retain the intended side at the date line, poles and hemisphere sizes', () => {
  const extents = [
    extentAround(0, 180, 20, 14),
    extentAround(0, 90, 180, 180),
    extentAround(0, -90, 180, 180),
    extentAround(0, 20, 270, 160),
    extentAround(75, 0, 360, 30),
    extentAround(-75, 170, 360, 30),
    extentAround(0, 180, 0.12, 0.08),
  ];
  for (const extent of extents) {
    const center = extentCenter(extent),
      expectedArea =
        ((longitudeSpan(extent) * Math.PI) / 180) *
        (Math.sin((extent.latitudeNorth * Math.PI) / 180) -
          Math.sin((extent.latitudeSouth * Math.PI) / 180)),
      polygon = globePolygon(globeExtentContour(extent), expectedArea, center)!;
    assert(polygon);
    assert(geoContains(polygon, [center.longitude, center.latitude]));
    // Area verifies the selected band/cap rather than its complement, including >half a sphere.
    assert(Math.abs(geoArea(polygon) - expectedArea) < 0.006);
    for (const longitude of [-180, -90, 0, 90, 180]) {
      const path = globePolygonPath(
        globeExtentContour(extent),
        30,
        longitude,
        expectedArea,
        center,
      );
      assert(!/NaN|Infinity|undefined/.test(path));
      for (const { from, to } of segments(path))
        for (const point of [from, to])
          assert(Math.hypot(point[0] - 180, point[1] - 180) <= 156.002);
    }
  }
});

test('thin wide selections follow parallels instead of bending outside their own latitude band', () => {
  for (const latitude of [-89.995, -75, -45, 0, 45, 75, 89.995])
    for (const longitude of [-180, -30, 90, 179])
      for (const width of [270, 359.998, 360]) {
        const extent = extentAround(latitude, longitude, width, 0.01),
          center = extentCenter(extent),
          span = longitudeSpan(extent),
          height = extent.latitudeNorth - extent.latitudeSouth,
          expectedArea =
            ((span * Math.PI) / 180) *
            (Math.sin((extent.latitudeNorth * Math.PI) / 180) -
              Math.sin((extent.latitudeSouth * Math.PI) / 180)),
          contour = globeExtentContour(extent),
          polygon = globePolygon(contour, expectedArea, center)!;
        assert(polygon);
        assert(contour.length < 1200, 'fine band sampling stays bounded during rotation');
        for (const longitudeFraction of [0.05, 0.35, 0.65, 0.95]) {
          const pointLongitude = wrapLongitude(extent.longitudeWest + span * longitudeFraction);
          for (const latitudeFraction of [0.15, 0.5, 0.85])
            assert(
              geoContains(polygon, [
                pointLongitude,
                extent.latitudeSouth + height * latitudeFraction,
              ]),
              `expected selected interior at ${latitude}, ${longitude}, ${width}`,
            );
          for (const pointLatitude of [
            extent.latitudeSouth - height * 0.25,
            extent.latitudeNorth + height * 0.25,
          ])
            if (Math.abs(pointLatitude) < 90)
              assert(!geoContains(polygon, [pointLongitude, pointLatitude]));
        }
      }
});
