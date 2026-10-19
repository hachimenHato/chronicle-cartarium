export interface WorldExtent {
  latitudeNorth: number;
  latitudeSouth: number;
  longitudeWest: number;
  longitudeEast: number;
}
export const globalWorldExtent: WorldExtent = {
  latitudeNorth: 90,
  latitudeSouth: -90,
  longitudeWest: -180,
  longitudeEast: 180,
};
export const wrapLongitude = (value: number) => ((((value + 180) % 360) + 360) % 360) - 180;
export function longitudeSpan(extent: Pick<WorldExtent, 'longitudeWest' | 'longitudeEast'>) {
  const span = extent.longitudeEast - extent.longitudeWest;
  return span > 0 ? span : span + 360;
}
export function isGlobalExtent(extent: WorldExtent) {
  return (
    extent.latitudeNorth >= 89.999 &&
    extent.latitudeSouth <= -89.999 &&
    longitudeSpan(extent) >= 359.999
  );
}
export function extentAround(
  latitude: number,
  longitude: number,
  width: number,
  height: number,
): WorldExtent {
  const h = Math.max(0.01, Math.min(180, height)),
    w = Math.max(0.01, Math.min(360, width));
  const center = Math.max(-90 + h / 2, Math.min(90 - h / 2, latitude));
  const round = (n: number) => Math.round(n * 10000) / 10000;
  return {
    latitudeNorth: round(center + h / 2),
    latitudeSouth: round(center - h / 2),
    longitudeWest: w >= 359.999 ? -180 : round(wrapLongitude(longitude - w / 2)),
    longitudeEast: w >= 359.999 ? 180 : round(wrapLongitude(longitude + w / 2)),
  };
}
export function extentCenter(extent: WorldExtent) {
  return {
    latitude: (extent.latitudeNorth + extent.latitudeSouth) / 2,
    longitude: wrapLongitude(extent.longitudeWest + longitudeSpan(extent) / 2),
  };
}
export function extentSummary(extent: WorldExtent) {
  if (isGlobalExtent(extent)) return '全球 · 从两极到赤道';
  const lat = extentCenter(extent).latitude;
  return `${lat >= 0 ? '北半球' : '南半球'} · ${Math.abs(lat) < 23.5 ? '低纬度' : Math.abs(lat) < 60 ? '中纬度' : '高纬度'} · 东西 ${longitudeSpan(extent).toFixed(1)}° / 南北 ${(extent.latitudeNorth - extent.latitudeSouth).toFixed(1)}°`;
}
