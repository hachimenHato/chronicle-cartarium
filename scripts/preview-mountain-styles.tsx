import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';
import { MOUNTAIN_STYLES, mountainTiers } from '../src/lib/mountain-styles';
import { drawMountainPeak, projectMountainStyle } from '../src/lib/mountain-artwork';
import { MapObjectArtwork } from '../src/components/MapArtwork';

// Standalone art review; no workspace, server, environment secrets or database.
const width = 2144,
  height = 1180,
  cell = 134,
  rowHeight = 132;
const svg = renderToStaticMarkup(
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={width}
    height={height}
    viewBox={`0 0 ${width} ${height}`}
  >
    <rect width={width} height={height} fill="#f3ead6" />
    <text x={32} y={36} fontSize="24" fontFamily="serif" fill="#71583c">
      编年图志 · 128 种山峰样式
    </text>
    <text x={32} y={60} fontSize="13" fill="#9a8260">
      四档高度，各 8 类山体 × 4 种肩部与岩脊结构 · 全部采用地图实际绘制函数
    </text>
    {mountainTiers.map((tier, tierIndex) => {
      const styles = MOUNTAIN_STYLES.filter((style) => style.tier === tier.id);
      const families = [...new Set(styles.map((style) => style.family))];
      return (
        <g key={tier.id}>
          <rect
            x={tierIndex * cell * 4 + 10}
            y={77}
            width={cell * 4 - 20}
            height={29}
            rx="4"
            fill="#e4d6b9"
          />
          <text
            x={tierIndex * cell * 4 + cell * 2}
            y={98}
            textAnchor="middle"
            fontSize="15"
            fill="#75593d"
          >
            {tier.label} · 32 种
          </text>
          {families.map((family, row) => {
            const group = styles.filter((style) => style.family === family),
              y = 116 + row * rowHeight;
            return (
              <g key={family}>
                <text
                  x={tierIndex * cell * 4 + cell * 2}
                  y={y + 15}
                  fontSize="12"
                  textAnchor="middle"
                  fill="#8c7251"
                >
                  {group[0].label.split('·')[0]}
                </text>
                {group.map((style, variant) => {
                  const x = (tierIndex * 4 + variant) * cell;
                  const peak = projectMountainStyle(
                    style,
                    { x: x + cell / 2, y: y + 98 },
                    style.width * 1.65,
                    style.rise * 1.65,
                  );
                  return (
                    <g key={style.id}>
                      <path
                        d={`M${x + 9} ${y + 105}H${x + cell - 9}`}
                        stroke="#bca986"
                        opacity=".16"
                      />
                      {drawMountainPeak(peak, 1.65, 527, variant).map((object) => (
                        <MapObjectArtwork key={object.id} object={object} />
                      ))}
                      <text
                        x={x + cell / 2}
                        y={y + 122}
                        fontSize="10"
                        textAnchor="middle"
                        fill="#a08460"
                      >
                        {style.label.split('·')[1]}
                      </text>
                    </g>
                  );
                })}
              </g>
            );
          })}
        </g>
      );
    })}
  </svg>,
);
await mkdir('.runtime', { recursive: true });
await writeFile('.runtime/mountain-styles-catalog.svg', svg);
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  await page.setContent(`<style>body{margin:0}</style>${svg}`);
  await page.screenshot({ path: '.runtime/mountain-styles-catalog.png' });
  console.log(
    JSON.stringify({
      styles: MOUNTAIN_STYLES.length,
      svg: '.runtime/mountain-styles-catalog.svg',
      png: '.runtime/mountain-styles-catalog.png',
    }),
  );
} finally {
  await browser.close();
}
