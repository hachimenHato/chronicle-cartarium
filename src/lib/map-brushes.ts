import type { AtlasMap } from '../../shared/model';
import type { MapPoint, MapObject, MapSymbolKind, TerrainBiome } from '../../shared/cartography';
import { symbolCatalog } from '../../shared/cartography';
import { createMapObject, pointInRegion } from './cartography';
import { seededRandom } from './terrain';
const rounded = (n: number) => Math.round(n * 100) / 100;
export const brushPresets: Record<
  TerrainBiome,
  { width: number; density: number; roughness: number; hint: string }
> = {
  grass: {
    width: 180,
    density: 0.24,
    roughness: 0.35,
    hint: '铺开陆地与草甸，再叠加森林、山脉和水域。',
  },
  forest: { width: 110, density: 0.85, roughness: 0.4, hint: '沿林地轮廓涂抹，边缘疏、内部密。' },
  mountain: {
    width: 85,
    density: 0.72,
    roughness: 0.6,
    hint: '沿山脊方向拉出长笔迹，生成连续的山地。',
  },
  water: {
    width: 75,
    density: 0.15,
    roughness: 0.23,
    hint: '在陆地上刻出湖泊与海湾；细笔刷适合狭长水域。',
  },
  desert: { width: 160, density: 0.48, roughness: 0.32, hint: '宽笔刷铺出沙地，边缘逐渐过渡。' },
  swamp: { width: 120, density: 0.65, roughness: 0.45, hint: '沿湖岸或河口铺开湿地与芦苇。' },
  snow: { width: 140, density: 0.3, roughness: 0.27, hint: '为高地和北部区域覆盖冰雪。' },
  hill: { width: 125, density: 0.45, roughness: 0.4, hint: '在山脚或平原边缘铺出起伏舒缓的丘陵。' },
  plateau: {
    width: 165,
    density: 0.26,
    roughness: 0.5,
    hint: '用宽笔刷划出高原范围，边缘形成抬升的台地。',
  },
  taiga: {
    width: 115,
    density: 0.72,
    roughness: 0.4,
    hint: '沿寒冷山麓铺开针叶林，留下河谷和林间空地。',
  },
  rainforest: {
    width: 130,
    density: 0.95,
    roughness: 0.38,
    hint: '覆盖温暖湿润的区域，形成茂密的雨林林冠。',
  },
  savanna: {
    width: 170,
    density: 0.28,
    roughness: 0.3,
    hint: '铺开暖色草地，以稀疏树丛表现干湿过渡。',
  },
  tundra: {
    width: 155,
    density: 0.18,
    roughness: 0.33,
    hint: '在雪原与林地之间铺出低矮、稀疏的寒地植被。',
  },
  badlands: {
    width: 115,
    density: 0.48,
    roughness: 0.72,
    hint: '画出干旱裸岩地带，适合荒地、峡谷与破碎山麓。',
  },
};

/** Each click makes a small, editable composition. It does not rewrite existing objects. */
export function makeSmartGroup(
  map: AtlasMap,
  center: MapPoint,
  symbol: MapSymbolKind,
  diameter: number,
  size: number,
  density: number,
  seed: number,
) {
  const random = seededRandom(seed);
  const radius = Math.max(diameter / 2, size * 1.5);
  const objects: MapObject[] = [];
  const waterAt = (p: MapPoint) =>
    [...(map.editor?.regions || [])].reverse().find((r) => r.visible && pointInRegion(p, r))
      ?.biome === 'water';
  const inBounds = (p: MapPoint) => p.x >= 0 && p.x <= map.width && p.y >= 0 && p.y <= map.height;
  const add = (kind: MapSymbolKind, dx: number, dy: number, scale = 1, rotation = 0) => {
    const p = { x: rounded(center.x + dx), y: rounded(center.y + dy) };
    const actualSize = Math.max(8, size * scale);
    if (!inBounds(p) || (kind !== 'port' && kind !== 'bridge' && waterAt(p))) return;
    if (
      objects.some(
        (o) =>
          o.kind === 'symbol' &&
          Math.hypot(o.points[0].x - p.x, o.points[0].y - p.y) < (o.size + actualSize) * 0.3,
      )
    )
      return;
    const entry = symbolCatalog.find((s) => s.id === kind)!;
    objects.push(
      createMapObject('symbol', p, {
        symbol: kind,
        name: entry.label,
        size: rounded(actualSize),
        color: entry.color,
        stroke: '#536650',
        rotation,
      }),
    );
  };
  const road = (points: MapPoint[]) => {
    if (points.every(inBounds) && !points.some(waterAt))
      objects.push(
        createMapObject('path', points[0], {
          name: '聚落小径',
          points,
          color: 'none',
          stroke: '#b1a080',
          strokeWidth: 3,
          opacity: 0.85,
        }),
      );
  };
  const count = Math.round(8 + density * 20);
  if (symbol === 'port' || symbol === 'bridge') {
    let waterDirection: number | undefined;
    for (let i = 0; i < 24; i++) {
      const angle = (i * Math.PI) / 12;
      if (
        waterAt({
          x: center.x + Math.cos(angle) * radius * 0.6,
          y: center.y + Math.sin(angle) * radius * 0.6,
        })
      ) {
        waterDirection = angle;
        break;
      }
    }
    if (waterDirection == null)
      return { objects, description: '请在已绘制水域的岸边放置此群组；也可改用单个组件自由放置。' };
    const angle = waterDirection;
    for (let i = -2; i <= 2; i++)
      add(
        'house',
        -Math.cos(angle) * radius * 0.45 + Math.cos(angle + Math.PI / 2) * i * size * 0.65,
        -Math.sin(angle) * radius * 0.45 + Math.sin(angle + Math.PI / 2) * i * size * 0.65,
        0.5,
      );
    add(symbol, 0, 0, 1, rounded((angle * 180) / Math.PI));
    return { objects, description: '已沿岸布置码头 / 桥梁与岸上房屋。' };
  }
  if (['city', 'village', 'castle', 'tower', 'temple', 'house'].includes(symbol)) {
    if (waterAt(center))
      return { objects, description: '聚落中心位于已绘制的水域，请改在岸上放置。' };
    const spacing = Math.max(size * 0.7, radius * 0.28);
    road([
      { x: center.x - radius * 0.8, y: center.y + spacing * 0.4 },
      { x: center.x + radius * 0.8, y: center.y + spacing * 0.4 },
    ]);
    add(symbol, 0, -size * 0.35, 1.15);
    const homes = Math.round(3 + density * 5);
    for (let i = 0; i < homes; i++) {
      const side = i % 2 ? -1 : 1;
      add(
        'house',
        side * (spacing + Math.floor(i / 4) * spacing),
        (Math.floor(i / 2) % 2 ? 1.35 : -0.75) * spacing,
        0.48 + random() * 0.13,
      );
    }
    for (let i = 0; i < 3; i++) add('farmland', (i - 1) * spacing, radius * 0.78, 0.68, 0);
    add('tree', -radius * 0.8, -radius * 0.55, 0.55);
    return { objects, description: '已布置一个中心地标、街旁房屋、农田和小径。可逐个调整。' };
  }
  if (symbol === 'mountain' || symbol === 'hill') {
    const angle = (random() - 0.5) * 1.1;
    const n = Math.max(4, Math.round(4 + density * 6));
    for (let i = 0; i < n; i++) {
      const along = (i / (n - 1) - 0.5) * radius * 1.7;
      const across = Math.sin(i * 0.9) * radius * 0.15;
      add(
        symbol,
        along * Math.cos(angle) - across * Math.sin(angle),
        along * Math.sin(angle) + across * Math.cos(angle),
        0.55 + Math.sin(((i + 1) / (n + 1)) * Math.PI) * 0.55,
      );
    }
    for (let i = -2; i <= 2; i++)
      add(
        symbol === 'mountain' ? 'hill' : 'rock',
        i * radius * 0.34,
        radius * 0.5 + random() * radius * 0.12,
        0.4 + random() * 0.2,
      );
    return { objects, description: '已沿山脊布置高峰，并在山脚补充丘陵 / 岩石。' };
  }
  if (['tree', 'pine', 'reeds', 'dune', 'rock', 'farmland'].includes(symbol)) {
    // Rejection spacing produces clustered woodland without overlapping stamps.
    for (let attempt = 0; attempt < count * 14 && objects.length < count; attempt++) {
      const a = random() * Math.PI * 2,
        r = Math.pow(random(), 0.7) * radius;
      const variation = 0.43 + random() * 0.3;
      add(
        symbol === 'tree' && random() < 0.18 ? 'pine' : symbol,
        Math.cos(a) * r,
        Math.sin(a) * r * 0.78,
        variation,
        symbol === 'farmland' ? 0 : 0,
      );
    }
    objects.sort((a, b) => a.points[0].y - b.points[0].y);
    return { objects, description: '已按疏密和间距布置自然群组，可逐个调整。' };
  }
  add(symbol, 0, 0, 1.2);
  for (let i = 0; i < 7; i++) {
    const a = (i * Math.PI * 2) / 7,
      r = radius * (0.5 + random() * 0.3);
    add(
      i % 3 === 0 ? 'tree' : 'rock',
      Math.cos(a) * r,
      Math.sin(a) * r * 0.7,
      0.4 + random() * 0.2,
    );
  }
  return { objects, description: '已围绕地标布置植被与岩石，可逐个调整。' };
}
