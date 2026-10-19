import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  MapObject,
  MapRegion,
  SketchGenerationSettings,
  GeneratedSettlement,
} from '../../shared/cartography';
import type { AtlasMap } from '../../shared/model';
import type { GeneratedMapSnapshot } from '../../shared/generated-map';
import type { GeneratedGeography } from '../../shared/geography';
import { composeTerrainRegions } from './cartography';
import { generateSketchMap, type SketchMapStats } from './sketch-generation';
import { buildElevationArtwork } from './sketch-generation-v2';
import type { ElevationField } from './elevation';
import {
  generationSignature,
  matchesGenerationSignature,
  restoreElevation,
  snapshotElevation,
} from './generated-map';
import { renameSettlementArtwork } from './settlement-names';
interface Request {
  id: number;
  signature: string;
  regions: MapRegion[];
  width: number;
  height: number;
  scaleKm?: number;
  kind?: AtlasMap['kind'];
  generation?: SketchGenerationSettings;
  sourcePreview: boolean;
  terrainView: 'atlas' | 'elevation';
}
interface Result {
  signature: string;
  objects: MapObject[];
  error: string;
  stats?: SketchMapStats;
  elevation?: ElevationField;
  sites?: GeneratedSettlement[];
  geography?: GeneratedGeography;
  snapshot?: GeneratedMapSnapshot;
}
/** One running job, one latest draft. Accepted geometry survives remounts and server restarts. */
export function useComposedTerrain(
  regions: MapRegion[],
  width: number,
  height: number,
  generation?: SketchGenerationSettings,
  sourcePreview = false,
  terrainView: 'atlas' | 'elevation' = 'atlas',
  scaleKm?: number,
  kind?: AtlasMap['kind'],
  saved?: GeneratedMapSnapshot,
) {
  const signature = useMemo(
    () => generationSignature(regions, width, height, generation, scaleKm, kind),
    [regions, width, height, generation, scaleKm, kind],
  );
  const restored = useMemo<Result | undefined>(
    () =>
      saved &&
      matchesGenerationSignature(saved.signature, regions, width, height, generation, scaleKm, kind)
        ? {
            signature,
            objects: saved.objects,
            error: '',
            stats: saved.stats,
            sites: saved.sites,
            geography: saved.geography,
            elevation: restoreElevation(saved.elevation),
          }
        : undefined,
    [saved, signature, regions, width, height, generation, scaleKm, kind],
  );
  const [result, setResult] = useState<Result>({ signature: '', objects: [], error: '' });
  const worker = useRef<Worker | null>(null),
    running = useRef<Request | null>(null);
  const latest = useRef<Request | null>(null),
    serial = useRef(0),
    flush = useRef<() => void>(() => {});
  useEffect(() => {
    let disposed = false;
    const complete = (request: Request, output: Omit<Result, 'signature' | 'snapshot'>) => {
      if (disposed) return;
      running.current = null;
      if (latest.current === request) {
        const snapshot: GeneratedMapSnapshot | undefined =
          !output.error && request.generation
            ? {
                version: 1,
                signature: request.signature,
                objects: output.objects,
                stats: output.stats,
                sites: output.sites,
                geography: output.geography,
                elevation: output.elevation && snapshotElevation(output.elevation),
              }
            : undefined;
        // Saved heights use whole metres. Display the same field immediately so
        // accepting a save, undoing or reopening cannot subtly shift contours.
        // The simulation's objects and geography remain the original output.
        setResult({
          ...output,
          elevation: snapshot?.elevation ? restoreElevation(snapshot.elevation) : output.elevation,
          signature: request.signature,
          snapshot,
        });
      }
      if (latest.current !== request) flush.current();
    };
    const fallback = (request: Request) => {
      try {
        if (request.generation) {
          const g = generateSketchMap(
            request.regions,
            request.width,
            request.height,
            request.generation,
            request.scaleKm,
            request.kind,
          );
          complete(request, {
            objects: g.objects,
            stats: g.stats,
            elevation: g.elevation,
            sites: g.sites,
            geography: g.geography,
            error: '',
          });
        } else
          complete(request, {
            objects: composeTerrainRegions(request.regions, request.width, request.height),
            error: '',
          });
      } catch (e) {
        complete(request, { objects: [], error: (e as Error).message });
      }
    };
    flush.current = () => {
      const request = latest.current;
      if (disposed || running.current || !request) return;
      running.current = request;
      if ((!request.regions.length && !request.generation) || request.sourcePreview) {
        complete(request, { objects: [], error: '' });
        return;
      }
      if (worker.current) worker.current.postMessage(request);
      else fallback(request);
    };
    try {
      const active = new Worker(new URL('./terrain.worker.ts', import.meta.url), {
        type: 'module',
      });
      worker.current = active;
      active.onmessage = (event: MessageEvent<Omit<Result, 'signature'> & { id: number }>) => {
        const request = running.current;
        if (request?.id === event.data.id) complete(request, event.data);
      };
      active.onerror = (event) => {
        if (disposed) return;
        event.preventDefault();
        active.terminate();
        worker.current = null;
        if (running.current) fallback(running.current);
      };
    } catch {
      worker.current = null;
    }
    return () => {
      disposed = true;
      worker.current?.terminate();
      worker.current = null;
      running.current = null;
    };
  }, []);
  useEffect(() => {
    // No worker message on opening an accepted map or changing its display layer.
    if (restored) {
      latest.current = null;
      return;
    }
    latest.current = {
      id: ++serial.current,
      signature,
      regions,
      width,
      height,
      generation,
      sourcePreview,
      terrainView: 'atlas',
      scaleKm,
      kind,
    };
    flush.current();
  }, [signature, restored, sourcePreview]);
  const active = restored ?? result;
  const named = useMemo(
    () =>
      generation?.version === 2
        ? renameSettlementArtwork(active.objects, active.sites, generation)
        : undefined,
    [active.objects, active.sites, generation],
  );
  const elevationObjects = useMemo(
    () =>
      active.elevation && terrainView === 'elevation'
        ? buildElevationArtwork(active.elevation)
        : undefined,
    [active.elevation, terrainView],
  );
  return {
    ...active,
    objects: named?.objects ?? active.objects,
    sites: named?.sites ?? active.sites,
    elevationObjects,
    pending: !sourcePreview && active.signature !== signature,
  };
}
