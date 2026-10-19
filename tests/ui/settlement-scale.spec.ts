import { readFile } from 'node:fs/promises';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { createSeed } from '../../shared/seed';
import type { AtlasMap, WorkspaceEnvelope } from '../../shared/model';
import type { MapRegion, SettlementKind, SketchGenerationV2 } from '../../shared/cartography';

async function workspace(request: APIRequestContext) {
  const response = await request.get('/api/workspace');
  expect(new URL(response.url()).port).toBe('3311');
  expect(response.ok()).toBeTruthy();
  const envelope = (await response.json()) as WorkspaceEnvelope;
  expect(envelope.mode).toBe('demo');
  return envelope;
}

const grass: MapRegion = {
  id: 'settlement_scale_grass',
  name: '聚落试验平原',
  biome: 'grass',
  geometry: 'polygon',
  points: [
    { x: 60, y: 50 },
    { x: 940, y: 50 },
    { x: 940, y: 590 },
    { x: 60, y: 590 },
  ],
  width: 80,
  seed: 37,
  density: 0.6,
  roughness: 0.15,
  visible: true,
  locked: false,
};
const recipe: SketchGenerationV2 = {
  version: 2,
  seed: 618,
  climate: 'temperate',
  detail: 'standard',
  settlements: 5,
  rivers: false,
  routes: true,
  linework: 'organic',
  settlementCounts: { village: 1, town: 1, city: 1, castle: 1, camp: 1 },
};
const kinds = ['village', 'town', 'city', 'castle', 'camp'] as const;

async function geometry(page: Page) {
  return page.locator('.atlas-canvas [data-settlement-surrounding]').evaluateAll((groups) =>
    groups.map((group) => ({
      path: group.querySelector('path')!.getAttribute('d'),
      fill: group.getAttribute('fill'),
      stroke: group.getAttribute('stroke'),
      opacity: group.getAttribute('opacity'),
    })),
  );
}

test('five settlement types show dense world, sparse region and no town surroundings, retained by SVG and editable conversion', async ({
  page,
  request,
}) => {
  test.setTimeout(120000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const counts = {} as Record<AtlasMap['kind'], Record<SettlementKind, number>>;
  for (const kind of ['world', 'region', 'town'] as const) {
    // Close the preceding map before replacing this isolated demo fixture.
    await page.goto('about:blank');
    const current = await workspace(request),
      data = createSeed();
    Object.assign(data.maps[0], {
      kind,
      width: 1000,
      height: 640,
      scaleKm: { world: 6000, region: 400, town: 10 }[kind],
      seed: 0,
      pins: [],
      strokes: [],
      editor: {
        version: 1,
        mode: 'sculpt',
        baseVisible: false,
        regions: [grass],
        objects: [],
        generation: recipe,
      },
    });
    expect(
      (await request.put('/api/workspace', { data: { data, revision: current.revision } })).ok(),
    ).toBeTruthy();
    await page.goto('/');
    await page.getByRole('button', { name: '地图工坊', exact: true }).click();
    const canvas = page.locator('.atlas-canvas');
    const composite = canvas.locator('[data-terrain-composite]');
    await expect(composite).toHaveAttribute('data-terrain-pending', 'false', { timeout: 30000 });
    await expect(composite).toHaveAttribute('data-terrain-error', 'false');
    await expect(composite).toHaveAttribute('data-generation-settlements', '5');
    await expect(page.locator('.settlement-row')).toHaveCount(5);
    for (const settlement of kinds)
      await expect(canvas.locator(`[data-settlement-glyph="${settlement}"]`)).toHaveCount(1);

    counts[kind] = (await composite.evaluate((root) => {
      const result: Record<string, number> = {};
      let surfaces = 0;
      for (const child of root.children) {
        if (child.hasAttribute('data-settlement-surrounding')) surfaces++;
        const glyph = child.querySelector('[data-settlement-glyph]');
        if (glyph) {
          result[glyph.getAttribute('data-settlement-glyph')!] = surfaces / 2;
          surfaces = 0;
        }
      }
      return result;
    })) as Record<SettlementKind, number>;
    const before = await geometry(page);
    expect(before.length).toBe(Object.values(counts[kind]).reduce((sum, n) => sum + n * 2, 0));
    expect(before.every((surface) => !!surface.path && surface.path.endsWith('Z'))).toBe(true);
    await canvas.screenshot({ path: `.runtime/settlement-scale-${kind}.png` });

    if (kind !== 'world') continue;
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: '导出 SVG', exact: true }).click();
    const exportedPath = '.runtime/settlement-scale-world.svg';
    await (await download).saveAs(exportedPath);
    const exported = await readFile(exportedPath, 'utf8');
    const exportedGeometry = await page.evaluate((svg) => {
      const parsed = new DOMParser().parseFromString(svg, 'image/svg+xml');
      return [...parsed.querySelectorAll('[data-settlement-surrounding]')].map((group) => ({
        path: group.querySelector('path')!.getAttribute('d'),
        fill: group.getAttribute('fill'),
        stroke: group.getAttribute('stroke'),
        opacity: group.getAttribute('opacity'),
      }));
    }, exported);
    expect(exportedGeometry).toEqual(before);
    await page.getByRole('button', { name: /精细编辑/ }).click();
    await page.getByRole('button', { name: '将生成图转为可编辑组件', exact: true }).click();
    await page.getByRole('button', { name: '转换并精修', exact: true }).click();
    await expect
      .poll(async () => (await workspace(request)).data.maps[0].editor?.generation)
      .toBeUndefined();
    expect(await geometry(page)).toEqual(before);
    const frozen = (await workspace(request)).data.maps[0].editor!.objects;
    expect(frozen.filter((object) => object.name.includes(' · 周边建筑 '))).toHaveLength(
      before.length,
    );
    expect(frozen.length).toBeLessThanOrEqual(8000);
    await page.reload();
    await page.getByRole('button', { name: '地图工坊', exact: true }).click();
    await expect(canvas.locator('[data-settlement-surrounding]')).toHaveCount(before.length);
    expect(await geometry(page)).toEqual(before);
  }
  for (const kind of kinds) {
    expect(counts.region[kind]).toBeGreaterThan(0);
    expect(counts.world[kind]).toBeGreaterThan(counts.region[kind] * 2);
    expect(counts.town[kind]).toBe(0);
  }
  expect(errors).toEqual([]);
});
