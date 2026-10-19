import { composeTerrainRegions } from './cartography';
import type { MapRegion, SketchGenerationSettings } from '../../shared/cartography';
import type { AtlasMap } from '../../shared/model';
import { generateSketchMap } from './sketch-generation';
import { buildElevationArtwork } from './sketch-generation-v2';
import { renameSettlementArtwork } from './settlement-names';
import type { ElevationField } from './elevation';
import type { GeneratedGeography } from '../../shared/geography';
let cached:
  | {
      key: string;
      objects: ReturnType<typeof generateSketchMap>['objects'];
      stats: ReturnType<typeof generateSketchMap>['stats'];
      sites: ReturnType<typeof generateSketchMap>['sites'];
      elevation?: ElevationField;
      geography?: GeneratedGeography;
    }
  | undefined;
const sources = new Map<string, { json: string; region: MapRegion }>();

self.onmessage = (
  event: MessageEvent<{
    id: number;
    regions: MapRegion[];
    width: number;
    height: number;
    scaleKm?: number;
    kind?: AtlasMap['kind'];
    generation?: SketchGenerationSettings;
    sourcePreview: boolean;
    terrainView: 'atlas' | 'elevation';
  }>,
) => {
  const { id, regions, width, height, generation, sourcePreview, terrainView } = event.data;
  const ids = new Set(regions.map((region) => region.id));
  for (const id of sources.keys()) if (!ids.has(id)) sources.delete(id);
  const stable = regions.map((region) => {
    const json = JSON.stringify(region),
      previous = sources.get(region.id);
    if (previous?.json === json) return previous.region;
    sources.set(region.id, { json, region });
    return region;
  });
  try {
    const shapeRecipe =
      generation?.version === 2
        ? { ...generation, settlementNames: undefined, settlementLinks: undefined }
        : generation;
    const key = JSON.stringify([
      stable.map(({ name: _name, locked: _locked, ...region }) => region),
      width,
      height,
      shapeRecipe,
      event.data.scaleKm,
      event.data.kind,
    ]);
    const generated =
      cached?.key === key
        ? cached
        : generation && !sourcePreview
          ? generateSketchMap(
              stable,
              width,
              height,
              generation,
              event.data.scaleKm,
              event.data.kind,
            )
          : undefined;
    const elevation = generated && 'elevation' in generated ? generated.elevation : undefined;
    if (generated)
      cached = {
        key,
        objects: generated.objects,
        stats: generated.stats,
        sites: generated.sites,
        elevation,
        geography: generated.geography,
      };
    const named =
      generation?.version === 2 && generated
        ? renameSettlementArtwork(generated.objects, generated.sites, generation)
        : undefined;
    self.postMessage({
      id,
      objects: sourcePreview
        ? []
        : (named?.objects ?? generated?.objects ?? composeTerrainRegions(stable, width, height)),
      stats: generated?.stats,
      sites: named?.sites ?? generated?.sites,
      elevation,
      geography: generated?.geography,
      elevationObjects:
        elevation && terrainView === 'elevation' ? buildElevationArtwork(elevation) : undefined,
      error: '',
    });
  } catch (error) {
    self.postMessage({ id, objects: [], error: (error as Error).message });
  }
};
