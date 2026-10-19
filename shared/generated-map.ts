import type { MapObject, MapPoint, GeneratedSettlement } from './cartography';
import type { GeneratedGeography } from './geography';

/** Persist the accepted generation, never renderer state or temporary brush previews. */
export interface GeneratedMapSnapshot {
  version: 1;
  signature: string;
  objects: MapObject[];
  stats?: { landCells: number; rivers: number; settlements: number; roads: number };
  sites?: GeneratedSettlement[];
  elevation?: {
    columns: number;
    rows: number;
    width: number;
    height: number;
    values: number[];
    min: number;
    max: number;
  };
  geography?: GeneratedGeography;
}

export type MilitaryLineKind = 'front' | 'advance' | 'retreat' | 'defense';
export interface MapMilitaryLine {
  id: string;
  name: string;
  kind: MilitaryLineKind;
  points: MapPoint[];
  color: string;
  width: number;
  visible: boolean;
}
export const militaryLineLabels: Record<MilitaryLineKind, string> = {
  front: '前线',
  advance: '进攻线',
  retreat: '撤退线',
  defense: '防御线',
};
