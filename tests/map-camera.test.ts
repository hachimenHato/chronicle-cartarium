import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  mapCameraTransform,
  panMapCamera,
  sameMapCameraView,
  zoomMapCamera,
  type MapCameraMatrix,
  type MapCameraPoint,
  type MapCameraView,
} from '../src/lib/map-camera';

function project(matrix: MapCameraMatrix, point: MapCameraPoint) {
  return {
    x: matrix.a * point.x + matrix.c * point.y + matrix.e,
    y: matrix.b * point.x + matrix.d * point.y + matrix.f,
  };
}
function screen(matrix: MapCameraMatrix, view: MapCameraView, point: MapCameraPoint) {
  return project(matrix, { x: view.x + point.x * view.zoom, y: view.y + point.y * view.zoom });
}
function close(actual: MapCameraPoint, expected: MapCameraPoint) {
  assert.ok(Math.abs(actual.x - expected.x) < 1e-9, `${actual.x} != ${expected.x}`);
  assert.ok(Math.abs(actual.y - expected.y) < 1e-9, `${actual.y} != ${expected.y}`);
}

test('composited view matches the original SVG transform including both letterbox directions', () => {
  const base = { x: 119, y: -71, zoom: 1.6 };
  const next = { x: -300, y: 92, zoom: 2.7 };
  for (const root of [
    { a: 0.4, b: 0, c: 0, d: 0.4, e: 80, f: 0 },
    { a: 0.65, b: 0, c: 0, d: 0.65, e: 0, f: 120 },
    { a: 0.5, b: 0.2, c: -0.1, d: 0.7, e: 41, f: 18 },
  ]) {
    const transform = mapCameraTransform(base, next, root);
    for (const point of [
      { x: 0, y: 0 },
      { x: 1234, y: 876 },
      { x: -50, y: 350 },
    ]) {
      const original = screen(root, base, point);
      close(
        {
          x: original.x * transform.scale + transform.x,
          y: original.y * transform.scale + transform.y,
        },
        screen(root, next, point),
      );
    }
  }
});

test('zoom anchors stay fixed through a same-frame wheel burst and the hard zoom limits', () => {
  const anchor = { x: 804, y: 612 };
  let view = { x: 110, y: -80, zoom: 1 };
  const world = { x: (anchor.x - view.x) / view.zoom, y: (anchor.y - view.y) / view.zoom };
  for (let i = 0; i < 30; i++) {
    view = zoomMapCamera(view, view.zoom * 1.1, anchor);
    close({ x: world.x * view.zoom + view.x, y: world.y * view.zoom + view.y }, anchor);
  }
  assert.equal(view.zoom, 4);
  assert.strictEqual(zoomMapCamera(view, 20, anchor), view);
  for (let i = 0; i < 30; i++) view = zoomMapCamera(view, view.zoom * 0.9, anchor);
  assert.equal(view.zoom, 0.5);
  close({ x: world.x * view.zoom + view.x, y: world.y * view.zoom + view.y }, anchor);
});

test('pan composes with a pending zoom using root coordinates rather than scaled CSS coordinates', () => {
  const base = { x: 0, y: 0, zoom: 1 };
  const zoomed = zoomMapCamera(base, 2, { x: 800, y: 500 });
  const next = panMapCamera(
    zoomed,
    { a: 2, b: 0, c: 0, d: 2, e: -200, f: -400 },
    { x: 75, y: -20 },
  );
  assert.deepEqual(next, { x: -650, y: -540, zoom: 2 });
  const root = { a: 0.5, b: 0, c: 0, d: 0.5, e: 0, f: 100 };
  const transform = mapCameraTransform(base, next, root);
  const point = { x: 300, y: 240 };
  const old = screen(root, base, point);
  close(
    { x: old.x * transform.scale + transform.x, y: old.y * transform.scale + transform.y },
    screen(root, next, point),
  );
});

test('a completed SVG commit rebases the remaining gesture without moving any point', () => {
  const original = { x: 10, y: 30, zoom: 1.2 };
  const committed = zoomMapCamera(original, 1.5, { x: 450, y: 220 });
  const next = zoomMapCamera(committed, 1.9, { x: 900, y: 300 });
  const root = { a: 0.7, b: 0, c: 0, d: 0.7, e: 15, f: 80 };
  const before = mapCameraTransform(original, next, root);
  const after = mapCameraTransform(committed, next, root);
  for (const point of [
    { x: 20, y: 40 },
    { x: 1100, y: 700 },
  ]) {
    const p = screen(root, original, point);
    const q = screen(root, committed, point);
    close(
      { x: p.x * before.scale + before.x, y: p.y * before.scale + before.y },
      { x: q.x * after.scale + after.x, y: q.y * after.scale + after.y },
    );
  }
  assert.ok(sameMapCameraView(next, { ...next }));
  assert.ok(!sameMapCameraView(next, committed));
});
