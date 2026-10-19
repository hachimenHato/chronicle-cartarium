import type { MapRegion, SketchGenerationSettings } from '../../shared/cartography';
import type { AtlasMap } from '../../shared/model';
import { generateSketchMap as generateLegacySketchMap } from './sketch-generation-v1';
import { generateSketchMapV2 } from './sketch-generation-v2';
import type { ElevationField } from './elevation';
import type { SketchMapResult } from './sketch-generation-v1';
import type { GeneratedGeography } from '../../shared/geography';
export type {
  SketchCell,
  SketchDiagnostics,
  SketchMapResult,
  SketchMapStats,
} from './sketch-generation-v1';
/** Keep saved recipes reproducible: upgrading is an explicit, undoable editor action. */
export function generateSketchMap(
  regions: MapRegion[],
  width: number,
  height: number,
  settings: SketchGenerationSettings,
  scaleKm?: number,
  kind?: AtlasMap['kind'],
): SketchMapResult & { elevation?: ElevationField; geography?: GeneratedGeography } {
  return settings.version === 1
    ? generateLegacySketchMap(regions, width, height, settings)
    : generateSketchMapV2(regions, width, height, settings, scaleKm, kind);
}
