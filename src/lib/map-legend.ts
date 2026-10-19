import type { AtlasMap } from '../../shared/model';
import { biomeCatalog, symbolCatalog, type MapObject } from '../../shared/cartography';
import { parchmentPigment } from './map-palette';
import { featureHidden, hiddenFeatureObjects } from '../../shared/map-features';
export interface LegendItem {
  id: string;
  label: string;
  color: string;
  line?: boolean;
  symbol?: MapObject['symbol'];
}
/** Classifies the actual visible derived geometry, not generation switches or guessed content. */
export function objectLegend(objects: MapObject[]): LegendItem[] {
  const items = new Map<string, LegendItem>();
  for (const o of objects) {
    if (!o.visible || o.opacity === 0) continue;
    const biome = biomeCatalog.find(
      (b) => o.name.startsWith(b.label + ' ·') || o.name.startsWith(b.label + ' '),
    );
    if (biome)
      items.set(biome.id, {
        id: biome.id,
        label: biome.label,
        color: parchmentPigment(biome.color),
      });
    if (o.name === '海面') items.set('water', { id: 'water', label: '海域', color: o.color });
    if (o.name.startsWith('古典山脉 ·') && !items.has('mountain'))
      items.set('mountain', {
        id: 'mountain',
        label: '山脉',
        color: '#b8a486',
        symbol: 'mountain',
      });
    if (/河流|河道/.test(o.name) && !o.name.includes('岸'))
      items.set('river', {
        id: 'river',
        label: '河流',
        color: o.kind === 'path' ? o.stroke : o.color,
        line: true,
      });
    if (/道路/.test(o.name) && !/[边缘栏基]/.test(o.name))
      items.set('road', { id: 'road', label: '道路', color: o.stroke, line: true });
    if (o.kind === 'symbol' && o.symbol) {
      const spec = symbolCatalog.find((s) => s.id === o.symbol)!;
      const id = ['tree', 'pine'].includes(o.symbol) ? 'forest' : o.symbol;
      if (!items.has(id))
        items.set(id, {
          id,
          label: id === 'forest' ? '林木' : spec.label,
          color: o.color,
          symbol: o.symbol,
        });
    }
  }
  return [...items.values()];
}
export function authoredLegend(map: AtlasMap, source: boolean, showStrokes: boolean): LegendItem[] {
  const hiddenObjects = hiddenFeatureObjects(map, 'object');
  const items: LegendItem[] = source
    ? map.editor?.regions
        .filter((r) => r.visible)
        .map((r) => {
          const b = biomeCatalog.find((b) => b.id === r.biome)!;
          return { id: b.id, label: b.label, color: b.color };
        }) || []
    : objectLegend((map.editor?.objects || []).filter((o) => !hiddenObjects.has(o.id)));
  if (showStrokes)
    for (const stroke of map.strokes)
      if (stroke.tool !== 'brush' && !featureHidden(map, 'roads', stroke.id))
        items.push({
          id: stroke.tool,
          label: stroke.tool === 'river' ? '河流' : '道路',
          color: stroke.color,
          line: true,
        });
  return [...new Map(items.map((i) => [i.id, i])).values()];
}
