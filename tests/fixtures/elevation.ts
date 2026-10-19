import type { ElevationSettings } from '../../shared/cartography';

/** Nonempty ordered edits, also safe for the 100×100 minimum map size. */
export function createElevationFixture(): ElevationSettings {
  return {
    version: 1,
    preset: 'continent',
    seed: 91827,
    relief: 1.25,
    seaLevel: -120,
    strokes: [
      {
        id: 'height_raise',
        operation: 'raise',
        points: [
          { x: 12, y: 15 },
          { x: 48, y: 60 },
        ],
        width: 120,
        strength: 0.7,
        target: 800,
      },
      {
        id: 'height_lower',
        operation: 'lower',
        points: [{ x: 35, y: 80 }],
        width: 90,
        strength: 0.4,
        target: 0,
      },
      {
        id: 'height_flatten',
        operation: 'flatten',
        points: [
          { x: 50, y: 60 },
          { x: 80, y: 60 },
        ],
        width: 100,
        strength: 0.65,
        target: 1500,
      },
      {
        id: 'height_smooth',
        operation: 'smooth',
        points: [
          { x: 60, y: 55 },
          { x: 80, y: 85 },
        ],
        width: 75,
        strength: 0.5,
        target: 0,
      },
    ],
  };
}
