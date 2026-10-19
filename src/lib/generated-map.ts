import type { AtlasMap } from '../../shared/model';
import type { MapRegion, SketchGenerationSettings } from '../../shared/cartography';
import type { GeneratedMapSnapshot } from '../../shared/generated-map';
import type { ElevationField } from './elevation';
function generationSource(
  regions: MapRegion[],
  width: number,
  height: number,
  generation?: SketchGenerationSettings,
  scaleKm?: number,
  kind?: AtlasMap['kind'],
  canonical = true,
) {
  const recipe =
    generation?.version === 2
      ? { ...generation, settlementNames: undefined, settlementLinks: undefined }
      : generation;
  const physicalRegions = regions.map(({ name: _name, locked: _locked, ...region }) => region);
  // Validation rebuilds objects in schema order. Key insertion order must not
  // invalidate otherwise identical geographic input when accepting a save.
  // JSON's normal undefined handling and ordered arrays remain unchanged.
  return JSON.stringify(
    [physicalRegions, width, height, recipe, scaleKm, kind],
    canonical
      ? (_key, value: unknown) =>
          value && typeof value === 'object' && !Array.isArray(value)
            ? Object.fromEntries(
                Object.keys(value)
                  .sort()
                  .map((key) => [key, (value as Record<string, unknown>)[key]]),
              )
            : value
      : undefined,
  );
}
function hashGenerationSource(source: string) {
  let a = 2166136261,
    b = 5381;
  for (let i = 0; i < source.length; i++) {
    a = Math.imul(a ^ source.charCodeAt(i), 16777619);
    b = Math.imul(b, 33) ^ source.charCodeAt(i);
  }
  return `${(a >>> 0).toString(16).padStart(8, '0')}${(b >>> 0).toString(16).padStart(8, '0')}-${source.length.toString(16)}`;
}
/** Names are presentation edits; changing them never reruns the geographic simulation. */
export function generationSignature(
  regions: MapRegion[],
  width: number,
  height: number,
  generation?: SketchGenerationSettings,
  scaleKm?: number,
  kind?: AtlasMap['kind'],
) {
  return hashGenerationSource(generationSource(regions, width, height, generation, scaleKm, kind));
}
/** Read existing snapshots without rewriting or regenerating their geometry. */
export function legacyGenerationSignature(
  regions: MapRegion[],
  width: number,
  height: number,
  generation?: SketchGenerationSettings,
  scaleKm?: number,
  kind?: AtlasMap['kind'],
) {
  return hashGenerationSource(
    generationSource(regions, width, height, generation, scaleKm, kind, false),
  );
}
export function matchesGenerationSignature(
  savedSignature: string | undefined,
  regions: MapRegion[],
  width: number,
  height: number,
  generation?: SketchGenerationSettings,
  scaleKm?: number,
  kind?: AtlasMap['kind'],
) {
  return (
    savedSignature !== undefined &&
    (savedSignature === generationSignature(regions, width, height, generation, scaleKm, kind) ||
      savedSignature ===
        legacyGenerationSignature(regions, width, height, generation, scaleKm, kind))
  );
}
export function snapshotElevation(field: ElevationField): GeneratedMapSnapshot['elevation'] {
  const values = Array.from(field.values, (v) => Math.round(v));
  let min = Infinity,
    max = -Infinity;
  for (const value of values) {
    min = Math.min(min, value);
    max = Math.max(max, value);
  }
  return {
    columns: field.columns,
    rows: field.rows,
    width: field.width,
    height: field.height,
    values,
    min,
    max,
  };
}
export function restoreElevation(
  saved?: GeneratedMapSnapshot['elevation'],
): ElevationField | undefined {
  return saved && { ...saved, values: Float32Array.from(saved.values) };
}
