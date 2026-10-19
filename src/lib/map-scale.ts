import type { AtlasMap } from '../../shared/model';
import type { MapPoint } from '../../shared/cartography';

export const mapSizePresets = {
  world: { width: 1600, height: 1000, scaleKm: 12000 },
  region: { width: 1200, height: 800, scaleKm: 400 },
  town: { width: 1000, height: 640, scaleKm: 10 },
};
export function mapCoverageKm(map: AtlasMap) {
  return map.scaleKm ?? mapSizePresets[map.kind].scaleKm;
}
export function formatDistance(km: number) {
  return km < 1 ? `${Number((km * 1000).toFixed(1))} m` : `${Number(km.toFixed(2))} km`;
}
export function generationFeatureScale(scaleKm?: number) {
  return scaleKm === undefined || !Number.isFinite(scaleKm) || scaleKm <= 0
    ? 1
    : Math.max(0.65, Math.min(1.6, (400 / scaleKm) ** 0.18));
}
/** Geographic coverage, rather than canvas pixels, controls cartographic detail.
 * Explicit coverage takes precedence; older maps use their type's preset. */
export function mapDetailProfile(scaleKm?: number, kind?: AtlasMap['kind']) {
  const coverageKm =
    scaleKm !== undefined && Number.isFinite(scaleKm) && scaleKm > 0
      ? scaleKm
      : kind
        ? mapSizePresets[kind].scaleKm
        : 400;
  const featureScale = generationFeatureScale(coverageKm);
  return {
    coverageKm,
    featureScale,
    mountainScale: Math.max(0.55, Math.min(1.6, (400 / coverageKm) ** 0.17)),
    riverLimit: Math.round(Math.max(32, Math.min(192, 96 / featureScale ** 1.5))),
    extraRoadRatio: Math.max(0, Math.min(1.2, (1 / featureScale - 1) * 2)),
  };
}
export function mapScaleBar(map: AtlasMap) {
  const desired = mapCoverageKm(map) / 5;
  const magnitude = 10 ** Math.floor(Math.log10(desired));
  const km = [1, 2, 5, 10]
    .map((n) => n * magnitude)
    .filter((n) => n <= desired)
    .at(-1)!;
  return { km, width: (km / mapCoverageKm(map)) * map.width, label: formatDistance(km) };
}
/** Rescale all authored geometry in one undoable change, without cropping it. */
export function resizeMap(map: AtlasMap, width: number, height: number, scaleKm: number): AtlasMap {
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 100 ||
    height < 100 ||
    width > 10000 ||
    height > 10000 ||
    !Number.isFinite(scaleKm) ||
    scaleKm < 0.01 ||
    scaleKm > 1000000
  )
    throw new Error('画布宽高应为 100～10000，横向范围应为 0.01～1000000 km。');
  const sx = width / map.width,
    sy = height / map.height,
    size = Math.sqrt(sx * sy);
  const point = (p: MapPoint) => ({
    x: Math.max(0, Math.min(width, p.x * sx)),
    y: Math.max(0, Math.min(height, p.y * sy)),
  });
  const bounded = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n * size));
  const editor = map.editor;
  return {
    ...map,
    width,
    height,
    scaleKm,
    pins: map.pins.map((p) => ({ ...p, ...point(p) })),
    strokes: map.strokes.map((s) => ({
      ...s,
      points: s.points.map(point),
      width: bounded(s.width, 0.1, 200),
    })),
    ...(editor
      ? {
          editor: {
            ...editor,
            regions: editor.regions.map((r) => ({
              ...r,
              points: r.points.map(point),
              width: bounded(r.width, 1, 2000),
            })),
            objects: editor.objects.map((o) => ({
              ...o,
              points: o.points.map(point),
              size: bounded(o.size, 1, 2000),
              strokeWidth: bounded(o.strokeWidth, 0, 200),
              ...(o.blur === undefined ? {} : { blur: bounded(o.blur, 0, 40) }),
            })),
            military: editor.military?.map((l) => ({
              ...l,
              points: l.points.map(point),
              width: bounded(l.width, 0.5, 20),
            })),
            ...(editor.generated
              ? {
                  generated: {
                    ...editor.generated,
                    objects: editor.generated.objects.map((o) => ({
                      ...o,
                      points: o.points.map(point),
                      size: bounded(o.size, 1, 2000),
                      strokeWidth: bounded(o.strokeWidth, 0, 200),
                      ...(o.blur === undefined ? {} : { blur: bounded(o.blur, 0, 40) }),
                    })),
                    sites: editor.generated.sites?.map((s) => ({ ...s, ...point(s) })),
                    elevation: editor.generated.elevation && {
                      ...editor.generated.elevation,
                      width,
                      height,
                    },
                    geography: editor.generated.geography && {
                      ...editor.generated.geography,
                      width,
                      height,
                      cells: editor.generated.geography.cells.map((c) => ({
                        ...c,
                        center: point(c.center),
                        polygon: c.polygon.map(point),
                      })),
                      plates: editor.generated.geography.plates.map((p) => ({
                        ...p,
                        center: point(p.center),
                      })),
                      divisions: editor.generated.geography.divisions.map((d) => ({
                        ...d,
                        center: point(d.center),
                      })),
                      areas: editor.generated.geography.areas.map((a) => ({
                        ...a,
                        center: point(a.center),
                      })),
                      borders: editor.generated.geography.borders.map((b) => ({
                        ...b,
                        points: b.points.map(point),
                      })),
                      ports: editor.generated.geography.ports.map((p) => ({
                        ...p,
                        center: point(p.center),
                        harbor: point(p.harbor),
                      })),
                      seaRoutes: editor.generated.geography.seaRoutes.map((r) => ({
                        ...r,
                        points: r.points.map(point),
                      })),
                    },
                  },
                }
              : {}),
            ...(editor.divisionPaint
              ? {
                  divisionPaint: editor.divisionPaint.map((s) => ({
                    ...s,
                    points: s.points.map(point),
                    width: bounded(s.width, 1, 2000),
                  })),
                }
              : {}),
            ...(editor.generation?.version === 2 && editor.generation.elevation
              ? {
                  generation: {
                    ...editor.generation,
                    elevation: {
                      ...editor.generation.elevation,
                      strokes: editor.generation.elevation.strokes.map((s) => ({
                        ...s,
                        points: s.points.map(point),
                        width: bounded(s.width, 5, 500),
                      })),
                    },
                  },
                }
              : {}),
          },
        }
      : {}),
  };
}
