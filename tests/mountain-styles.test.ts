import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  MOUNTAIN_STYLES,
  mountainTiers,
  assignMountainStyles,
  type MountainStyle,
} from '../src/lib/mountain-styles';
import { drawMountainPeak, projectMountainStyle } from '../src/lib/mountain-artwork';
import { createSeed } from '../shared/seed';
import { validateWorkspace } from '../server/validation';

function skyline(style: MountainStyle) {
  return Array.from({ length: 81 }, (_, i) => {
    const x = -1 + i / 40;
    const edge = style.outline.findIndex((p, j) => j > 0 && p.x >= x);
    if (edge < 1) return 0;
    const a = style.outline[edge - 1],
      b = style.outline[edge];
    return a.y + ((b.y - a.y) * (x - a.x)) / (b.x - a.x);
  });
}

test('catalog contains 128 actual silhouettes across all four heights, rather than scaled or mirrored aliases', () => {
  assert.equal(MOUNTAIN_STYLES.length, 128);
  assert.equal(new Set(MOUNTAIN_STYLES.map((style) => style.id)).size, 128);
  const fingerprints = MOUNTAIN_STYLES.map((style) => {
    const values = skyline(style).map((y) => y.toFixed(3));
    return [values.join(','), [...values].reverse().join(',')].sort()[0];
  });
  assert.equal(
    new Set(fingerprints).size,
    128,
    'normalizing size and orientation must retain 128 different contours',
  );
  for (const tier of mountainTiers) {
    const styles = MOUNTAIN_STYLES.filter((style) => style.tier === tier.id);
    assert.equal(styles.length, 32);
    assert.equal(new Set(styles.map((style) => style.family)).size, 8);
    for (const style of styles) {
      assert.equal(style.outline[0].x, -1);
      assert.equal(style.outline.at(-1)!.x, 1);
      assert.equal(Math.min(...style.outline.map((p) => p.y)), -1);
      assert(
        style.outline.every(
          (p, i) => p.y >= -1 && p.y <= 0 && (i === 0 || p.x > style.outline[i - 1].x),
        ),
      );
    }
  }
  const peakCounts = MOUNTAIN_STYLES.map(
    (style) =>
      style.outline.filter(
        (p, i, points) =>
          i > 0 && i < points.length - 1 && p.y < points[i - 1].y && p.y < points[i + 1].y,
      ).length,
  );
  assert(
    peakCounts.includes(1) && Math.max(...peakCounts) >= 4,
    'single, compound and serrated ridges all need structural representation',
  );
  assert(
    MOUNTAIN_STYLES.some((style) => style.outline.length > 50),
    'rounded hills need smooth contours',
  );
});

test('every catalog style renders as bounded persistent vector art at its declared height', () => {
  const workspace = createSeed();
  const objects = MOUNTAIN_STYLES.flatMap((style, index) => {
    const anchor = { x: 65 + (index % 16) * 60, y: 100 + Math.floor(index / 16) * 65 };
    const peak = projectMountainStyle(style, anchor, style.width, style.rise);
    assert(Math.abs(anchor.y - Math.min(...peak.outline.map((p) => p.y)) - style.rise) < 0.0001);
    const objects = drawMountainPeak(peak, 1, 527, index);
    assert(objects.length <= 14 && objects.length >= 10);
    assert(objects.some((o) => o.name.endsWith('峰谷轮廓')));
    for (const object of objects) {
      assert(object.name.includes(style.id));
      assert(['path', 'polygon'].includes(object.kind));
      assert(object.points.length <= 2000);
      assert(
        object.points.every(
          (p) =>
            Number.isFinite(p.x) &&
            Number.isFinite(p.y) &&
            p.x >= 0 &&
            p.x <= 1100 &&
            p.y >= 0 &&
            p.y <= 640,
        ),
      );
    }
    return objects;
  });
  workspace.maps[0] = {
    ...workspace.maps[0],
    width: 1100,
    height: 640,
    pins: [],
    strokes: [],
    editor: { version: 1, mode: 'detail', baseVisible: false, regions: [], objects },
  };
  assert.doesNotThrow(() => validateWorkspace(workspace));
  const heights = mountainTiers.map((tier) => tier.rise);
  assert(heights[0] > heights[1] && heights[1] > heights[2] && heights[2] > heights[3]);
  assert(heights[0] / heights[3] > 4, 'very low hills must visibly differ from tall mountains');
});

test('deterministic style bags provide 32 distinct styles per tier and avoid nearby identical contours', () => {
  const nodes = Array.from({ length: 128 }, (_, i) => ({
    x: (i % 16) * 36,
    y: Math.floor(i / 16) * 36,
    elevation: 0.82,
  }));
  const styles = assignMountainStyles(nodes, 527, 1);
  assert.deepEqual(assignMountainStyles(nodes, 527, 1), styles);
  assert.notDeepEqual(
    assignMountainStyles(nodes, 619, 1).map((s) => s.id),
    styles.map((s) => s.id),
  );
  for (let start = 0; start < nodes.length; start += 32)
    assert.equal(new Set(styles.slice(start, start + 32).map((style) => style.id)).size, 32);
  for (let i = 0; i < nodes.length; i++)
    for (let j = 0; j < i; j++)
      if (Math.hypot(nodes[i].x - nodes[j].x, nodes[i].y - nodes[j].y) < 70)
        assert.notEqual(
          styles[i].id,
          styles[j].id,
          'neighboring summits must not use identical catalog contours',
        );
  const mixed = [0.85, 0.56, 0.39, 0.24].map((elevation, i) => ({ x: i * 40, y: 0, elevation }));
  assert.deepEqual(
    assignMountainStyles(mixed, 527, 1).map((s) => s.tier),
    mountainTiers.map((t) => t.id),
  );
});
