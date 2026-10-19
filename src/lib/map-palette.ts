import type { MapObject } from '../../shared/cartography';

// Engraved atlases use the paper as their lightest wash, rather than an amber
// filter over the whole illustration. Keep the ink legible on both surfaces.
export const parchmentSea = '#efe7d4';
export const parchmentPaper = '#f4ecd8';

/** Presentation adapter for pre-parchment procedural art, never author-selected colors.
 * Keep the v1 generator byte-for-byte reproducible; bake the same presentation when frozen.
 */
const inks: Record<string, string> = {
  '#abc8c9': parchmentSea,
  '#d9e3db': parchmentSea,
  '#e9e4d2': parchmentPaper,
  '#e8e2c9': parchmentPaper,
  '#e9dfb9': parchmentPaper,
  '#e3dfbd': '#eee8d2',
  '#96b8af': '#62776d',
  '#c2d6ca': '#b3bba1',
  '#578c99': '#526f71',
  '#5e817b': '#756447',
  '#7f9682': '#756447',
  '#92b4b7': '#9a8761',
  '#d1dfd6': '#e7d8b4',
  '#adc2b8': '#b09a6b',
  '#f4e9c9': '#f0e2bd',
};
export function parchmentPigment(color: string) {
  if (inks[color.toLowerCase()]) return inks[color.toLowerCase()];
  if (!/^#[0-9a-f]{6}$/i.test(color)) return color;
  const rgb = [1, 3, 5].map((offset) => Number.parseInt(color.slice(offset, offset + 2), 16));
  const light = rgb[0] * 0.3 + rgb[1] * 0.59 + rgb[2] * 0.11;
  return (
    '#' +
    rgb
      .map((channel, i) =>
        Math.max(0, Math.min(255, Math.round(channel * 0.56 + light * 0.44 + [14, 4, -15][i])))
          .toString(16)
          .padStart(2, '0'),
      )
      .join('')
  );
}

export function parchmentObject(object: MapObject): MapObject {
  return {
    ...object,
    color: parchmentPigment(object.color),
    stroke: parchmentPigment(object.stroke),
  };
}
