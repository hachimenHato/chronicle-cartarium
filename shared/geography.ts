import type { DivisionKind, MapPoint, TerrainBiome } from './cartography';
import type { AtlasMap } from './model';
import { globalWorldExtent } from './world-extent';

export type SketchShapeMode = 'randomized' | 'balanced' | 'strict';

/** Deterministic cartographic approximation, not a geological or weather simulator. */
export interface GeographicSettings {
  version: 1;
  source: 'random' | 'sketch';
  /** Color-block shape interpretation. Missing legacy values read as balanced. */
  sketchMode?: SketchShapeMode;
  plateCount: number;
  countryCount: number;
  cultureCount: number;
  religionCount: number;
  latitudeNorth: number;
  latitudeSouth: number;
  /** Optional legacy fields; west > east denotes an antimeridian-crossing extent. */
  longitudeWest?: number;
  longitudeEast?: number;
  /** Annual mean sea-level temperature at the equator, degrees Celsius. */
  meanSeaTemperature: number;
  /** Relative precipitation multiplier. */
  rainfall: number;
  /** Midlatitude prevailing direction, clockwise in map coordinates. Tropical/polar flow is weighted toward its reverse. */
  windAngle: number;
  roughness: number;
  /** Relative density of shared Voronoi regions. */
  regionDensity: number;
  ports: boolean;
}

export function defaultGeographicSettings(kind: AtlasMap['kind']): GeographicSettings {
  return {
    version: 1,
    source: 'random',
    sketchMode: 'balanced',
    plateCount: kind === 'world' ? 10 : kind === 'region' ? 6 : 3,
    countryCount: kind === 'world' ? 8 : kind === 'region' ? 4 : 2,
    cultureCount: kind === 'world' ? 6 : kind === 'region' ? 3 : 2,
    religionCount: kind === 'world' ? 5 : kind === 'region' ? 3 : 2,
    ...globalWorldExtent,
    meanSeaTemperature: 30,
    rainfall: 1,
    windAngle: 15,
    roughness: 0.75,
    regionDensity: 1,
    ports: true,
  };
}

/** Portable form guards mirror the authoritative server ranges. */
export function validGeographicSettings(value: GeographicSettings) {
  const inside = (n: number, min: number, max: number, integer = false) =>
    Number.isFinite(n) && n >= min && n <= max && (!integer || Number.isInteger(n));
  return (
    (value.sketchMode === undefined ||
      ['randomized', 'balanced', 'strict'].includes(value.sketchMode)) &&
    inside(value.plateCount, 3, 24, true) &&
    ['countryCount', 'cultureCount', 'religionCount'].every((key) =>
      inside(value[key as 'countryCount'], 0, 24, true),
    ) &&
    inside(value.latitudeNorth, -90, 90) &&
    inside(value.latitudeSouth, -90, 90) &&
    value.latitudeNorth >= value.latitudeSouth &&
    ((value.longitudeWest === undefined && value.longitudeEast === undefined) ||
      (inside(value.longitudeWest!, -180, 180) &&
        inside(value.longitudeEast!, -180, 180) &&
        value.longitudeWest !== value.longitudeEast &&
        value.longitudeEast! - value.longitudeWest! > -360)) &&
    inside(value.meanSeaTemperature, -20, 45) &&
    inside(value.rainfall, 0.2, 3) &&
    inside(value.windAngle, 0, 360) &&
    inside(value.roughness, 0, 1) &&
    inside(value.regionDensity, 0.5, 2)
  );
}

export const GEOGRAPHY_LIMITS = {
  cells: 2400,
  polygonPoints: 48,
  plates: 24,
  divisions: 72,
  areas: 160,
  borders: 8000,
  ports: 256,
  seaRoutes: 512,
  routePoints: 1600,
} as const;

export interface GeographicCell {
  id: number;
  center: MapPoint;
  /** Shared, identically sampled edges; no duplicated closing point. */
  polygon: MapPoint[];
  neighbors: number[];
  land: boolean;
  plate: number;
  elevation: number;
  temperature: number;
  /** Annual precipitation in millimetres. */
  precipitation: number;
  biome: TerrainBiome;
  shelf: boolean;
  country?: string;
  culture?: string;
  religion?: string;
}

export interface GeographicPlate {
  id: number;
  name: string;
  center: MapPoint;
  velocity: MapPoint;
  kind: 'continental' | 'oceanic';
  color: string;
}

export interface GeographicDivision {
  id: string;
  kind: DivisionKind;
  name: string;
  color: string;
  center: MapPoint;
  entityId?: string;
}

export interface GeographicArea {
  id: string;
  kind: 'continent' | 'island' | 'ocean' | 'lake' | 'province' | 'district';
  name: string;
  center: MapPoint;
  cells: number[];
  entityId?: string;
}

export interface GeographicBorder {
  id: string;
  kind: DivisionKind | 'plate' | 'cell';
  cells: [number, number];
  points: MapPoint[];
  /** Plate edges only; relative motion determines uplift/rifting. */
  motion?: 'convergent' | 'divergent' | 'transform';
}

export interface GeographicPort {
  id: string;
  /** Omitted for independent coastal docks, which do not consume settlement quotas. */
  settlementId?: string;
  /** Independent docks may link their own location page. */
  entityId?: string;
  name: string;
  center: MapPoint;
  /** Water-side dock, used by navigable shipping lanes. */
  harbor: MapPoint;
  cell: number;
}

export interface GeographicSeaRoute {
  id: string;
  name: string;
  from: string;
  to: string;
  points: MapPoint[];
}

/** Compact persistent layers. Fine hydrology samples are deliberately not serialized here. */
export interface GeneratedGeography {
  version: 1;
  seed: number;
  width: number;
  height: number;
  cells: GeographicCell[];
  plates: GeographicPlate[];
  divisions: GeographicDivision[];
  areas: GeographicArea[];
  borders: GeographicBorder[];
  ports: GeographicPort[];
  seaRoutes: GeographicSeaRoute[];
}
