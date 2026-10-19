import type { MapObject } from '../../shared/cartography';

/** Political pigment belongs on ground, below every ink mark and miniature. */
export function cartographicObjectLayers(objects: MapObject[]) {
  const ground: MapObject[] = [],
    detail: MapObject[] = [];
  for (const object of objects) {
    const surface =
      object.layer === 'base' ||
      (object.kind === 'polygon' &&
        (['海面', '大陆', '地表过渡', '高程地形', '背光坡面', '迎光坡面'].includes(object.name) ||
          /^(陆地 ·|地貌覆盖 ·|地貌纹理 ·)/.test(object.name) ||
          object.name.endsWith('· 融合地表')));
    (surface ? ground : detail).push(object);
  }
  return { ground, detail };
}
