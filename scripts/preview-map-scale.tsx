/** Offline art QA: no database, workspace API, credentials or author-data writes. */
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { writeFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';
import { generateSketchMapV2 } from '../src/lib/sketch-generation-v2';
import { MapObjectArtwork } from '../src/components/MapArtwork';
import { MapPaper } from '../src/components/MapPaper';
import type { AtlasMap } from '../shared/model';
import type { MapObject } from '../shared/cartography';

const cases = (['world', 'region', 'town'] as AtlasMap['kind'][]).map((kind) => {
  const result = generateSketchMapV2(
    [],
    1000,
    640,
    {
      version: 2,
      detail: 'high',
      linework: 'organic',
      seed: 392,
      climate: 'temperate',
      settlements: 8,
      rivers: true,
      routes: true,
      elevation: {
        version: 1,
        preset: 'highlands',
        seed: 392,
        relief: 1,
        seaLevel: 0,
        strokes: [],
      },
    },
    undefined,
    kind,
  );
  const peaks = result.objects.filter((o) => o.name.endsWith('峰谷轮廓'));
  const bounds = (o: MapObject, axis: 'x' | 'y') =>
    Math.max(...o.points.map((p) => p[axis])) - Math.min(...o.points.map((p) => p[axis]));
  const average = (values: number[]) =>
    values.reduce((a, b) => a + b, 0) / Math.max(1, values.length);
  console.log(
    JSON.stringify({
      kind,
      objects: result.objects.length,
      peaks: peaks.length,
      peakWidth: average(peaks.map((o) => bounds(o, 'x'))),
      rivers: result.stats.rivers,
      roads: result.stats.roads,
      settlements: result.stats.settlements,
      riverWidth: average(result.diagnostics.riverChannels.flatMap((c) => c.widths)),
      roadWidth: result.objects.find((o) => o.name === '道路 1')?.strokeWidth,
    }),
  );
  return { kind, objects: result.objects };
});
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: 1000, height: 640 },
    deviceScaleFactor: 1.5,
  });
  const panels: string[] = [];
  for (const { kind, objects } of cases) {
    const svg = renderToStaticMarkup(
      <svg xmlns="http://www.w3.org/2000/svg" width="1000" height="640" viewBox="0 0 1000 640">
        <rect width="1000" height="640" fill="#f4ecd8" />
        {objects.map((o) => (
          <MapObjectArtwork key={o.id} object={o} />
        ))}
        <MapPaper width={1000} height={640} />
      </svg>,
    );
    await writeFile(`.runtime/map-scale-${kind}.svg`, svg);
    await page.setContent(`<style>body{margin:0}</style>${svg}`);
    await page.screenshot({ path: `.runtime/map-scale-${kind}.png` });
    panels.push(
      `<section><h2>${{ world: '世界范围 · 12000 km', region: '区域范围 · 400 km', town: '局部范围 · 10 km' }[kind]}</h2>${svg}</section>`,
    );
  }
  await page.setViewportSize({ width: 1500, height: 364 });
  await page.setContent(
    `<style>body{margin:0;background:#f4ecd8;color:#55452f;display:grid;grid-template-columns:repeat(3,1fr)}section{border-right:1px solid #b8a98d}h2{font:600 18px/44px Georgia,SimSun,serif;margin:0;text-align:center}svg{display:block;width:100%;height:auto}</style>${panels.join('')}`,
  );
  await page.screenshot({ path: '.runtime/map-scale-comparison.png' });
} finally {
  await browser.close();
}
