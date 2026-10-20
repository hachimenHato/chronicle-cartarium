import type { GeographicPlate } from './geography';

const roots = [
  '苍岚',
  '银脊',
  '暮岩',
  '青穹',
  '霜冠',
  '赤曜',
  '玄潮',
  '白垩',
  '翠岭',
  '远岬',
  '云根',
  '星陨',
  '琥珀',
  '碧环',
  '雾隐',
  '月轮',
  '灰烬',
  '金曜',
  '幽蓝',
  '长风',
  '雪幕',
  '辰砂',
  '紫岚',
  '晨曦',
];
const qualifiers = ['', '北', '南', '东', '西', '外', '内', '上', '下'];
/** Independent of the terrain random stream: names cannot move plates or change the climate. */
export function generatedPlateName(id: number, seed: number) {
  const n = Math.abs(Math.trunc(seed)) >>> 0;
  return `${qualifiers[(n >>> 8) % qualifiers.length]}${roots[(id + (n % roots.length)) % roots.length]}板块`;
}
/** Legacy numbered labels are displayed by name without rewriting or regenerating saved maps. */
export function plateDisplayName(plate: Pick<GeographicPlate, 'id' | 'name'>, seed: number) {
  return /^(?:第\s*)?\d+\s*(?:号|个)?\s*板块$|^\d+$/.test(plate.name.trim())
    ? generatedPlateName(plate.id, seed)
    : plate.name;
}
