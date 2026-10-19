import type { TerrainBiome } from '../../shared/cartography';

/** Each land cover has eight structural families, with secondary engraved accents. */
export const TERRAIN_MOTIF_VARIANTS = 8;

const coordinate = (value: number) => String(Math.round(value * 100) / 100);

/** Transformed engraving pen. All detail is flattened into the caller's three SVG paths. */
export class TerrainPen {
  value = '';
  private readonly cosine: number;
  private readonly sine: number;

  constructor(
    private readonly x: number,
    private readonly y: number,
    private readonly scale: number,
    angle: number,
    private readonly stretch = 1,
  ) {
    this.cosine = Math.cos(angle);
    this.sine = Math.sin(angle);
  }

  private point(x: number, y: number) {
    return `${coordinate(this.x + (x * this.stretch * this.cosine - y * this.sine) * this.scale)},${coordinate(this.y + (x * this.stretch * this.sine + y * this.cosine) * this.scale)}`;
  }

  m(x: number, y: number) {
    this.value += `M${this.point(x, y)}`;
    return this;
  }

  l(x: number, y: number) {
    this.value += `L${this.point(x, y)}`;
    return this;
  }

  q(x: number, y: number, ex: number, ey: number) {
    this.value += `Q${this.point(x, y)} ${this.point(ex, ey)}`;
    return this;
  }

  c(x: number, y: number, bx: number, by: number, ex: number, ey: number) {
    this.value += `C${this.point(x, y)} ${this.point(bx, by)} ${this.point(ex, ey)}`;
    return this;
  }

  close() {
    this.value += 'Z';
    return this;
  }
}

type Pens = readonly [TerrainPen, TerrainPen, TerrainPen];

function crown([p, shade, light]: Pens, x: number, y: number, r: number, broad = false) {
  const width = broad ? 1.3 : 1;
  p.m(x - r * width, y + r * 0.2)
    .c(x - r * 1.25 * width, y - r * 0.35, x - r * 0.72, y - r * 0.8, x - r * 0.25, y - r * 0.62)
    .c(x - r * 0.05, y - r * 1.1, x + r * 0.65, y - r * 0.88, x + r * 0.62, y - r * 0.45)
    .c(
      x + r * 1.35 * width,
      y - r * 0.5,
      x + r * 1.2 * width,
      y + r * 0.4,
      x + r * 0.55,
      y + r * 0.48,
    )
    .c(x + r * 0.22, y + r * 0.95, x - r * 0.5, y + r * 0.8, x - r * width, y + r * 0.2)
    .close();
  shade
    .m(x - r * 0.55, y + r * 0.52)
    .q(x + r * 0.35, y + r * 0.92, x + r * 0.88, y)
    .q(x + r * 0.95, y + r * 0.78, x + r * 0.2, y + r * 0.92)
    .q(x - r * 0.42, y + r * 0.9, x - r * 0.55, y + r * 0.52)
    .close();
  light.m(x - r * 0.8, y - r * 0.15).q(x - r * 0.55, y - r * 0.58, x - r * 0.22, y - r * 0.4);
}

function conifer([p, shade, light]: Pens, x: number, y: number, r: number, lean = 0) {
  const top = x + lean;
  p.m(x - r * 0.74, y + r * 0.55)
    .l(x - r * 0.37, y)
    .l(x - r * 0.56, y + r * 0.04)
    .l(x - r * 0.16, y - r * 0.63)
    .l(x - r * 0.32, y - r * 0.56)
    .l(top, y - r * 1.3)
    .l(x + r * 0.38, y - r * 0.52)
    .l(x + r * 0.2, y - r * 0.58)
    .l(x + r * 0.65, y + r * 0.07)
    .l(x + r * 0.4, y + r * 0.02)
    .l(x + r * 0.82, y + r * 0.55)
    .m(x, y + r * 0.12)
    .l(x, y + r * 0.96);
  shade
    .m(top, y - r * 1.18)
    .l(x + r * 0.78, y + r * 0.53)
    .l(x + r * 0.12, y + r * 0.45)
    .close();
  light.m(x - r * 0.36, y - r * 0.38).l(top, y - r * 1.12);
}

function tuft(p: TerrainPen, x: number, y: number, size = 1, fan = false) {
  p.m(x - size, y)
    .q(x - size * 0.3, y - size, x - size * 0.65, y - size * 2)
    .m(x, y + size * 0.15)
    .q(x + size * 0.35, y - size * 0.8, x + size * 1.1, y - size * 1.2);
  if (fan) p.m(x - size * 0.25, y).q(x - size * 0.05, y - size, x + size * 0.15, y - size * 2.5);
}

function stone([p, shade, light]: Pens, x: number, y: number, r: number, flat = false) {
  const h = flat ? 0.48 : 0.85;
  p.m(x - r, y + r * 0.28)
    .l(x - r * 0.56, y - r * h)
    .l(x + r * 0.24, y - r * h * 1.12)
    .l(x + r, y + r * 0.18)
    .q(x + r * 0.2, y + r * 0.62, x - r, y + r * 0.28);
  shade
    .m(x + r * 0.24, y - r * h)
    .l(x + r, y + r * 0.18)
    .l(x + r * 0.08, y + r * 0.45)
    .close();
  light.m(x - r * 0.55, y - r * h).l(x + r * 0.1, y - r * h * 1.02);
}

function ripples(p: TerrainPen, x: number, y: number, width: number) {
  p.m(x - width, y)
    .q(x - width * 0.2, y - 0.55, x + width * 0.6, y)
    .m(x - width * 0.5, y + 1.6)
    .q(x + width * 0.3, y + 1.1, x + width, y + 1.6);
}

function acacia(pens: Pens, x: number, y: number, r: number) {
  const [p, shade, light] = pens;
  p.m(x - r * 0.12, y + r)
    .q(x + r * 0.1, y + r * 0.1, x - r * 0.18, y - r * 0.55)
    .m(x - r * 0.12, y + r * 0.15)
    .l(x + r * 0.65, y - r * 0.5)
    .m(x - r * 1.5, y - r * 0.65)
    .q(x - r * 1.1, y - r * 1.5, x - r * 0.25, y - r * 1.3)
    .q(x + r * 0.55, y - r * 1.65, x + r * 1.48, y - r * 0.72)
    .q(x + r * 0.25, y - r * 0.35, x - r * 1.5, y - r * 0.65);
  shade
    .m(x - r * 1.3, y - r * 0.58)
    .q(x + r * 0.15, y - r * 0.32, x + r * 1.35, y - r * 0.67)
    .q(x + r * 0.2, y - r * 0.12, x - r * 1.3, y - r * 0.58)
    .close();
  light.m(x - r * 1.1, y - r * 0.82).q(x - r * 0.55, y - r * 1.23, x - r * 0.1, y - r * 1.06);
}

function broadleaf(pens: Pens, variant: number, detail: number, tropical: boolean) {
  const [p, shade, light] = pens;
  switch (variant) {
    case 0:
      crown(pens, -2.3, 0.5, 3.5, tropical);
      crown(pens, 2.9, -1.2, 2.6);
      p.m(-4.3, 4.3).q(-1.5, 5.4, 1, 4.2);
      break;
    case 1:
      crown(pens, -3.8, 0, 2.2);
      crown(pens, 0.2, -1.9, 3.15, tropical);
      crown(pens, 3.7, 1.3, 2.3);
      break;
    case 2:
      crown(pens, -3.8, -1.3, 2.5, tropical);
      crown(pens, 0.4, 1.5, 2.65);
      crown(pens, 4.3, -1.5, 2);
      tuft(p, -4.2, 4.9, 0.8);
      break;
    case 3:
      // An open copse surrounds a gap; the blank centre is part of the texture.
      crown(pens, -4.1, 0.1, 2.15);
      crown(pens, -0.8, -3.1, 2.4, tropical);
      crown(pens, 3.8, -0.7, 2.4);
      p.m(-2, 4.4).q(0, 3.5, 3.8, 4.2);
      break;
    case 4:
      crown(pens, -3.6, 0.1, 2.4);
      crown(pens, 0, -0.65, 3.3, tropical);
      crown(pens, 4.4, 0.3, 2.1);
      light.m(-5.2, 3.8).q(-2, 3, 0, 3.6);
      break;
    case 5:
      crown(pens, -2.8, -1.8, 3.3, tropical);
      crown(pens, 2.8, 1.3, 3.1);
      tuft(p, -3.8, 4.5, 0.65, true);
      tuft(p, 4.9, 4.8, 0.6);
      break;
    case 6:
      if (tropical) {
        // Fan-leaved understory, with irregular fronds rather than repeated palm icons.
        p.m(-3, 4)
          .q(-1.8, 0.5, -2.3, -2)
          .m(-2.4, -0.6)
          .q(-6, -3, -6.7, -0.8)
          .m(-2.4, -0.7)
          .q(-4.9, -5.5, -2.8, -4.3)
          .m(-2.2, -0.7)
          .q(1, -4.8, 1.7, -2.7)
          .m(-2.2, -0.5)
          .q(1.9, -1.7, 1.9, 0.1);
        crown(pens, 3.6, 0.6, 2.6, true);
        shade.m(-2.3, -0.5).q(-5.7, -2.5, -6.7, -0.8).q(-4.4, -1.4, -2.3, -0.5).close();
      } else {
        crown(pens, -3.2, 0.8, 2.7);
        conifer(pens, 2.5, -0.2, 2.7);
        crown(pens, 4.2, 2.4, 1.5);
      }
      break;
    default:
      crown(pens, -3.4, -1, 2.7, tropical);
      crown(pens, 1.1, -0.1, 3.1);
      p.m(-5, 4.1).q(-3.7, 1.5, -1.8, 3.2).q(-0.4, 1.6, 1.2, 3.4).q(3.4, 2.2, 5.8, 3.9);
      shade.m(-4.1, 3.5).q(-0.8, 2.6, 2.5, 3.6).q(-0.6, 4.2, -4.1, 3.5).close();
  }
  if (detail > 0.65) tuft(p, 0.7, 5.6, 0.45);
}

function needleForest(pens: Pens, variant: number, detail: number) {
  const [p, , light] = pens;
  switch (variant) {
    case 0:
      conifer(pens, -3.2, 1.1, 2.6);
      conifer(pens, 1.1, -0.5, 3.1);
      conifer(pens, 4.3, 2.1, 1.8);
      break;
    case 1:
      conifer(pens, -2.4, 1.8, 3.7);
      conifer(pens, 3.5, 0.1, 2.4);
      p.m(-5.8, 5).q(-1, 5.7, 2.2, 4.8);
      break;
    case 2:
      conifer(pens, -3.6, 0.2, 2.2, 0.8);
      conifer(pens, 0.1, 1.3, 3.3, 1.1);
      conifer(pens, 4, 0.5, 1.8, 0.6);
      break;
    case 3:
      conifer(pens, -4, 1.8, 1.7);
      conifer(pens, -0.4, 0.4, 2.4);
      conifer(pens, 3.3, 1.5, 2);
      tuft(p, -2, 4.2, 0.9, true);
      tuft(p, 4.2, 4.4, 0.65);
      break;
    case 4:
      conifer(pens, -3.5, 1.3, 2.8);
      crown(pens, 1.2, 0.2, 2.1);
      conifer(pens, 4.1, -0.4, 2.5);
      break;
    case 5:
      for (let i = 0; i < 4; i++)
        conifer(pens, -4.8 + i * 3.1, 0.6 + (i % 2) * 1.6, 1.7 + (i % 2) * 0.5);
      light.m(-4.7, 4.6).q(-0.5, 3.9, 3.1, 4.5);
      break;
    case 6:
      // Sparse, high larches have interrupted branches and visible trunks.
      for (const [x, y, s] of [
        [-2.8, 1.1, 1],
        [2.8, 0, 0.82],
      ]) {
        p.m(x, y + 3 * s)
          .l(x, y - 4.6 * s)
          .m(x - 2 * s, y - 0.6 * s)
          .q(x, y - 0.2 * s, x + 2.3 * s, y - s)
          .m(x - 1.6 * s, y - 2.1 * s)
          .q(x, y - 1.7 * s, x + 1.7 * s, y - 2.4 * s)
          .m(x - 0.8 * s, y - 3.5 * s)
          .l(x, y - 4.6 * s)
          .l(x + 0.8 * s, y - 3.7 * s);
      }
      break;
    default:
      conifer(pens, -4, -0.4, 2.4);
      conifer(pens, -0.1, 1.6, 2.7);
      stone(pens, 3.4, 2.8, 1.65, true);
      tuft(p, 4.5, -0.6, 0.8);
  }
  if (detail > 0.7) p.m(-5, 5.5).q(-3, 4.9, -1.1, 5.2);
}

function hills([p, shade, light]: Pens, variant: number, detail: number) {
  switch (variant) {
    case 0:
      p.m(-7, 1.8)
        .c(-4, -3.7, -0.7, -4.1, 2, -0.6)
        .q(4.2, -2, 7, 1.9)
        .m(-5.3, 4.3)
        .q(-1, 2.2, 3.4, 3.7);
      shade.m(-0.6, -1.9).q(2.6, -0.8, 3.9, 2).q(1.4, 0.4, -0.6, -1.9).close();
      light.m(-5.4, 0).q(-3.6, -2.8, -1.7, -2.4);
      break;
    case 1:
      p.m(-7, 1)
        .q(-4.6, -3.6, -1.3, -0.3)
        .q(2.7, -4, 6.9, 0.9)
        .m(-6, 4)
        .q(-3.7, 0.9, -0.2, 2.5)
        .q(3.7, 0.7, 5.8, 3.9);
      light.m(-6, 0).q(-4.3, -2.1, -2.6, -1);
      break;
    case 2:
      p.m(-7, 3.5)
        .c(-4.8, -1.5, -3, -3, 0.4, -3.4)
        .q(3.8, -3.7, 6.7, -1.5)
        .m(-3.4, 2.6)
        .q(-1.3, -0.6, 1.3, -1.2)
        .q(3.4, -1.8, 6.2, -0.1)
        .m(1.4, -1.2)
        .q(2.3, 1, 5.2, 2.9);
      shade.m(1.1, -2.6).q(2.4, 0.5, 5.6, 2.8).q(1.8, 0.7, 1.1, -2.6).close();
      break;
    case 3:
      p.m(-6.7, 2)
        .q(-4, -3.5, -0.8, -2.9)
        .q(3.5, -3.7, 6.6, 1.3)
        .m(-1, -2.6)
        .q(-0.5, 0.1, -2.8, 3.6)
        .m(1.5, -2)
        .q(1.8, 0.4, 4.6, 3.7)
        .m(0.6, 0.4)
        .l(0.2, 3.5);
      light.m(-5.4, 0).q(-3.4, -2.8, -1.8, -2.2);
      break;
    case 4:
      p.m(-7, 0.9)
        .q(-5.9, -2.5, -3.6, -1.4)
        .q(-1.8, -4.1, 0.7, -1.4)
        .q(3.4, -3.5, 6.8, 1.2)
        .m(-5, 3.9)
        .q(-2.6, 1, -0.2, 2.6)
        .q(2.8, 1.6, 5.4, 3.7);
      shade.m(-1.7, -1.5).q(0.8, -1.5, 1.9, 1).q(0, 0.2, -1.7, -1.5).close();
      break;
    case 5:
      p.m(-6.7, 3)
        .q(-4.9, -1.8, -2.8, -3.5)
        .q(-0.9, -2.1, 0.4, 0.6)
        .m(-0.4, 3.5)
        .q(2, -2.7, 3.6, -2.8)
        .q(5.5, -1.4, 7, 2.8)
        .m(-2.7, -2.7)
        .q(-2.8, 0, -1.5, 2.5);
      shade.m(3.6, -2.1).q(4.7, 0.6, 6.5, 2.5).l(4.5, 2.3).close();
      break;
    case 6:
      p.m(-7, 0)
        .q(-2.8, -3.5, 1, -1.8)
        .q(3.8, -2.7, 6.8, -0.7)
        .m(-6, 1.8)
        .q(-2, -0.3, 1, 0.5)
        .q(3.4, -0.5, 6, 1)
        .m(-5.2, 2.1)
        .l(-4.5, 4.2)
        .m(-2, 1.4)
        .l(-1.4, 4.3)
        .m(1, 1)
        .l(2, 3.3)
        .m(4, 1)
        .l(5.2, 3.2);
      light.m(-4.9, -1).q(-2.4, -2.2, -0.4, -1.9);
      break;
    default:
      p.m(-7, 2)
        .q(-4, -1.8, -3.4, -3.6)
        .q(-2.3, -1.6, -0.2, -1.6)
        .q(2.1, -2, 4.1, -0.2)
        .l(7, 2.5)
        .m(-3.4, -2.8)
        .q(-2.3, 0.1, -4.8, 4.2)
        .m(-0.7, -0.9)
        .q(0.6, 1.2, 3.7, 3.6);
      shade.m(-0.2, -1).q(1.2, 1.4, 3.7, 3.6).l(1.8, 3.2).close();
  }
  if (detail > 0.7) tuft(p, -5.3, 5.1, 0.5);
}

function rocks(pens: Pens, variant: number, detail: number) {
  const [p, shade, light] = pens;
  switch (variant) {
    case 0:
      p.m(-7, 3.3)
        .q(-4.9, 0.5, -3.2, -0.6)
        .l(-1.1, -4)
        .l(1.1, -2.7)
        .q(3.3, 0.4, 7, 2.7)
        .m(-1, -3.1)
        .q(-0.9, 0.7, -3.4, 4.1)
        .m(1, -2.3)
        .q(1.7, 1.4, 4.4, 3.1);
      shade.m(-0.9, -3).q(1.4, -0.2, 4.8, 3.4).l(2.7, 3).q(0.2, 0.3, -0.9, -3).close();
      light.m(-5, 1.5).l(-3.2, -0.1).l(-1.3, -3.1);
      break;
    case 1:
      stone(pens, -3.3, 1.2, 2.9);
      stone(pens, 2.8, -1.2, 3.1, true);
      p.m(-0.3, 3.6).l(1.3, 2.1).l(3, 3.7).m(4.6, 3).l(5.9, 2.4);
      break;
    case 2:
      p.m(-6.8, 2.9)
        .l(-3.8, -1.3)
        .l(-0.4, -4)
        .l(2.5, -1.1)
        .l(6.9, 3)
        .m(-2.8, -1.6)
        .l(-4.3, 2.9)
        .m(-1.4, -2.7)
        .l(-2.2, 1.1)
        .m(0.3, -2.7)
        .l(1.5, 1.2)
        .m(1.5, -1.2)
        .l(3.5, 2.4)
        .m(3.3, 0.2)
        .l(5.3, 3.4);
      shade.m(0, -3.4).l(6, 2.9).l(3.6, 2.4).close();
      break;
    case 3:
      p.m(-7, 2.6)
        .l(-4.5, 0)
        .l(-3.2, -2.6)
        .l(-1.4, -1.4)
        .l(0, -4.3)
        .l(2.1, -1.8)
        .l(3.1, -2.5)
        .l(4.8, 0.5)
        .l(7, 2.1)
        .m(0.1, -3.4)
        .l(-0.2, -0.5)
        .l(1.3, 1.8)
        .m(3, -1.7)
        .l(2.7, 0.3)
        .l(4.9, 3.4);
      light.m(-4.3, -0.1).l(-3.2, -1.9).m(-1.2, -1.6).l(0, -3.5);
      break;
    case 4:
      p.m(-6.7, -2.1)
        .l(-3.6, -1.4)
        .l(-1.6, 0.2)
        .q(0, 1.9, 4.9, 4.1)
        .m(-1.7, -3.9)
        .l(-0.7, -1.6)
        .l(0.1, 1.2)
        .m(5.3, -3.8)
        .q(1.9, -1.9, 0.1, 1.2)
        .m(-5, 2.4)
        .l(-2.6, 1.1)
        .l(-0.5, 1.6)
        .m(3.2, -0.1)
        .l(5.9, -0.8);
      shade.m(0, 0).q(2.3, 2.5, 4.9, 4.1).l(2.3, 3.5).close();
      break;
    case 5:
      stone(pens, -2.6, 0.6, 3.2);
      stone(pens, 3.9, 2, 1.8);
      p.m(-5.9, 3.9).l(-4.4, 3.5).m(-0.2, -3).l(1.7, -2.3).m(1.7, 4.2).l(2.7, 3.6);
      break;
    case 6:
      stone(pens, -4.1, 0.1, 1.6, true);
      stone(pens, 0.9, -2.1, 2.3);
      stone(pens, 3.7, 2.8, 1.7, true);
      p.m(-5.5, 3.2)
        .l(-4.8, 2.7)
        .m(-2.3, 4.5)
        .l(-1.7, 4)
        .m(-0.7, 1)
        .l(0, 1.4)
        .m(4.1, -2.3)
        .l(4.8, -1.6)
        .m(6, 0.8)
        .l(6.5, 1.3);
      break;
    default:
      p.m(-7, -0.8)
        .l(-4.7, -2.6)
        .l(-0.4, -2.9)
        .l(2.1, -1.2)
        .l(6.8, -0.2)
        .m(-5.7, -1.5)
        .l(-4.8, 1.1)
        .l(-3.2, 2.5)
        .m(-2.7, -2)
        .l(-1.8, 1.7)
        .l(0.3, 3.7)
        .m(0.7, -1.6)
        .l(1.3, 0.9)
        .l(3.9, 2.9)
        .m(4.7, 0)
        .l(6, 2.5);
      shade.m(-1.9, -2.3).l(-0.8, 1.4).l(1.3, 3).l(-0.2, 2.4).close();
  }
  if (detail > 0.68) p.m(-5.8, 5).l(-4.9, 4.6).m(1.6, 5).l(2.3, 4.5);
}

function plateaus([p, shade, light]: Pens, variant: number, detail: number) {
  const shelf = (x: number, y: number, w: number, h: number) => {
    p.m(x - w, y + h)
      .l(x - w * 0.72, y - h * 0.55)
      .q(x - w * 0.5, y - h * 0.9, x - w * 0.24, y - h * 0.7)
      .l(x + w * 0.6, y - h * 0.58)
      .l(x + w, y + h * 0.86)
      .m(x - w * 0.65, y - h * 0.44)
      .q(x, y - h * 0.1, x + w * 0.66, y - h * 0.38);
    shade
      .m(x + w * 0.25, y - h * 0.46)
      .l(x + w * 0.6, y - h * 0.52)
      .l(x + w * 0.92, y + h * 0.8)
      .l(x + w * 0.53, y + h * 0.75)
      .close();
    light.m(x - w * 0.58, y - h * 0.6).l(x + w * 0.16, y - h * 0.55);
  };
  switch (variant) {
    case 0:
      shelf(0, -0.2, 6, 2.6);
      p.m(-3, 0.2).l(-3.6, 2.9).m(1, 0.3).l(1.6, 3.3).m(-4.1, 4.2).q(0.3, 3.5, 4.7, 4.2);
      break;
    case 1:
      shelf(-1.2, -0.9, 5.5, 1.7);
      p.m(-6.7, 3.1)
        .q(-3.2, 1.9, -0.7, 2.8)
        .l(4.4, 2.2)
        .l(6.3, 4)
        .m(-4, 2.8)
        .l(-4.4, 4.5)
        .m(1, 2.7)
        .l(1.4, 4.4);
      break;
    case 2:
      p.m(-7, 1.8)
        .l(-5.7, -0.1)
        .l(-2.5, 0)
        .l(-1.8, -2.1)
        .l(2.5, -2.6)
        .l(3.1, -0.3)
        .l(5.7, 0.3)
        .l(7, 3)
        .m(-4.8, 1.1)
        .l(-2, 1.2)
        .l(-1, -0.8)
        .l(2.2, -1)
        .m(-3.1, 2.9)
        .l(-0.4, 3.5)
        .l(3.5, 2.5);
      shade.m(2.2, -2).l(3.1, -0.3).l(5.7, 0.3).l(6.7, 2.6).l(4.9, 1.8).l(2.3, -0.1).close();
      break;
    case 3:
      p.m(-7, -1.6)
        .q(-4.5, -2.8, -1.7, -1.9)
        .q(1.5, -3.1, 6.8, -1.2)
        .m(-6.4, -0.2)
        .q(-2.9, -1.3, 0, -0.4)
        .q(3.5, -1.3, 6, 0)
        .m(-5.6, 0.1)
        .l(-6, 3.8)
        .m(-3, -0.3)
        .l(-2.8, 4.4)
        .m(-0.5, 0.2)
        .l(0.3, 3.5)
        .m(2.1, 0)
        .l(3, 3.3)
        .m(4.9, 0.4)
        .l(6.1, 3);
      light.m(-5, -1.8).q(-3.5, -2.3, -1.9, -1.8);
      break;
    case 4:
      shelf(-2.6, -1.4, 3.8, 2);
      shelf(3.1, 1.9, 3.1, 1.55);
      p.m(-4.2, 2.9).l(-1.4, 2.7);
      break;
    case 5:
      shelf(-3.1, 0.9, 2.7, 3.2);
      shelf(2.8, -0.7, 2.9, 2.3);
      p.m(-5.7, 4.7).q(-1.3, 4.1, 2.2, 4.6);
      break;
    case 6:
      p.m(-7, 0.6)
        .l(-5.4, -1.8)
        .l(-2.8, -2.5)
        .l(-1.1, -1.8)
        .l(1.5, -2.6)
        .l(5.1, -1.5)
        .l(6.9, 1.5)
        .m(-5.2, -0.6)
        .l(-4.1, -0.2)
        .l(-2.9, -1.1)
        .l(-1.2, -0.3)
        .l(1.5, -1.4)
        .l(4.9, -0.5)
        .m(-3.2, -0.7)
        .l(-3.9, 2.8)
        .m(0.7, -0.5)
        .l(0.1, 2.9)
        .l(1.7, 4)
        .m(3.9, 0.2)
        .l(5.3, 3.4);
      shade.m(1.6, -1.4).l(4.9, -0.5).l(6.2, 1.5).l(4.1, 0.9).close();
      break;
    default:
      shelf(-3.5, -0.2, 3.1, 2.6);
      shelf(3.1, 0.4, 2.8, 2.9);
      p.m(-0.4, -1.8).q(-1.8, 0.4, -0.6, 1.4).q(1, 3, -0.1, 4.4);
  }
  if (detail > 0.72) p.m(4.7, 4.6).l(5.5, 4.1);
}

function desert(pens: Pens, variant: number, detail: number) {
  const [p, shade, light] = pens;
  const dune = (x: number, y: number, w: number, h: number) => {
    p.m(x - w, y + h * 0.55)
      .c(x - w * 0.25, y + h * 0.15, x - w * 0.25, y - h, x + w * 0.2, y - h * 0.85)
      .q(x + w * 0.65, y - h * 0.65, x + w, y - h * 0.05);
    shade
      .m(x - w * 0.12, y - h * 0.2)
      .q(x + w * 0.2, y - h, x + w * 0.72, y - h * 0.3)
      .q(x + w * 0.24, y - h * 0.55, x - w * 0.12, y - h * 0.2)
      .close();
    light.m(x - w * 0.76, y + h * 0.25).q(x - w * 0.3, y - h * 0.08, x - w * 0.12, y - h * 0.55);
  };
  switch (variant) {
    case 0:
      dune(0, 0.2, 7, 3);
      dune(1.4, 4.8, 4.3, 1.3);
      break;
    case 1:
      p.m(-6.8, 2.1)
        .c(-4.8, 2, -2.2, -3.8, 2, -3.1)
        .q(4.6, -2.5, 6.8, -2.8)
        .m(-6.4, 4.8)
        .c(-3.1, 4, -1.4, -0.3, 2.8, -0.2)
        .q(5, 0.1, 7, -0.6)
        .m(-3, 5.8)
        .q(0.9, 2.5, 4.2, 2.5);
      light.m(-4.9, 1).q(-2.4, -1.8, -0.5, -2.4);
      break;
    case 2:
      dune(-0.8, -1.4, 6, 1.9);
      dune(0.6, 2.3, 6.2, 1.7);
      p.m(-5.4, 5.1).q(-0.1, 3.8, 5.7, 4.3);
      break;
    case 3:
      p.m(-6.5, 2.7)
        .q(-1.7, -0.8, -0.2, -3.4)
        .q(1.9, -0.8, 6.5, 1.5)
        .m(-0.2, -3)
        .q(-0.6, -0.1, -2.5, 4.1)
        .m(0, -0.6)
        .q(2.3, 1, 4.1, 4.5)
        .m(-5.3, -1.4)
        .q(-2.7, -0.6, -0.3, -2.6);
      shade.m(0.1, -2.8).q(1.2, -0.1, 5.9, 1.5).q(2.2, 0.2, 0.1, -2.8).close();
      break;
    case 4:
      stone(pens, -3, 0.7, 1.25, true);
      stone(pens, 3.8, -1.6, 0.9, true);
      p.m(-6.2, 3.3)
        .l(-5.2, 3.2)
        .m(-1.7, 4.9)
        .l(-0.6, 4.7)
        .m(1.7, 1.7)
        .l(2.4, 1.5)
        .m(5.1, 3.4)
        .l(6.2, 3.2)
        .m(-5, -2.4)
        .l(-4.5, -2.5)
        .m(0.1, -2.2)
        .l(0.9, -2.3);
      break;
    case 5:
      dune(-2.9, 1.9, 3.6, 2.1);
      dune(2.6, -0.7, 3.7, 2.5);
      p.m(-1.1, 4.7).q(2.1, 2.9, 6.6, 3.9);
      break;
    case 6:
      p.m(-6.9, 0.8)
        .q(-5.1, -3.9, -1.9, -2.7)
        .q(-3.9, -1.3, -3.6, 1.2)
        .q(-3.4, 3.3, -1.2, 4.3)
        .m(0.9, -1.2)
        .q(3.1, -4.3, 6.2, -2.2)
        .q(3.5, -1.6, 3.8, 1)
        .q(4.1, 2.5, 6.7, 3.5);
      shade.m(-2.3, -2.4).q(-4, -0.6, -3.4, 1.5).q(-4.9, -0.4, -2.3, -2.4).close();
      light.m(1.3, -1.1).q(2.8, -3.2, 4.3, -2.7);
      break;
    default:
      p.m(-6.9, -2.1)
        .q(-3.3, -1.9, -1.2, 0.5)
        .q(1.4, 2.4, 6.8, 3.6)
        .m(-6, -0.4)
        .q(-3.2, -0.1, -1.7, 1.6)
        .q(1.4, 3.8, 5.8, 4.6)
        .m(-1.8, -4)
        .q(-1.8, -1.1, -1.2, 0.5)
        .m(4.8, -2.6)
        .q(0.9, -0.9, -0.1, 1.3);
      light.m(-5.4, -2.4).q(-3.3, -2.3, -1.7, -0.9);
  }
  if (detail > 0.75) p.m(-5.6, 5.6).l(-4.9, 5.5);
}

function wetlands(pens: Pens, variant: number, detail: number) {
  const [p, shade, light] = pens;
  switch (variant) {
    case 0:
      ripples(p, -1.4, 3, 5.4);
      tuft(p, -2.3, 2.3, 1.6, true);
      tuft(p, 3.1, 3.3, 1.2, true);
      light.m(-1, 6.1).q(2.3, 5.6, 5.3, 6);
      break;
    case 1:
      crown(pens, -2.1, -1.2, 3.1, true);
      p.m(-3.1, 0.8)
        .q(-3.5, 3, -5.4, 3.9)
        .m(-2.2, 1.1)
        .l(-1.8, 3.4)
        .l(-0.6, 4)
        .m(-1.1, 1)
        .q(-0.4, 3.1, 1.5, 3.7);
      ripples(p, 2.7, 4.3, 3.2);
      break;
    case 2:
      p.m(-6.6, 0.8)
        .c(-4, -1.7, -1, -0.9, 0.2, 0.6)
        .c(1.9, 2.9, -4.9, 3.7, -6.6, 0.8)
        .m(1.1, -1.5)
        .q(3.8, -2.7, 6.3, -0.6)
        .m(1.6, 4.5)
        .q(3.8, 3.3, 6.7, 4.5);
      tuft(p, 3.8, 2.8, 1.1, true);
      shade.m(-4.8, 2.1).q(-1.8, 2.9, -0.2, 1.5).q(-1.8, 3.5, -4.8, 2.1).close();
      break;
    case 3:
      tuft(p, -4.2, 2.2, 1.15, true);
      tuft(p, -0.3, 0.8, 1.6, true);
      tuft(p, 4.3, 3.2, 1.35, true);
      ripples(p, -0.5, 4.3, 5.3);
      break;
    case 4:
      ripples(p, -2.6, -1.4, 3.6);
      ripples(p, 2.4, 1.5, 3.6);
      p.m(-5.6, 3.4).q(-3, 2.3, -0.4, 3.5).m(0.9, 5.3).q(3.3, 4.2, 5.7, 5.1);
      light.m(-4.8, 0.2).q(-3.5, -0.1, -2.4, 0.2);
      break;
    case 5:
      p.m(-5.7, 1.4)
        .q(-2.7, -0.7, 1.2, 1)
        .q(3.7, 2.2, 5.4, 1.7)
        .m(-6.8, 3.2)
        .q(-3.1, 5.1, 1.4, 3.5)
        .q(3.6, 3.3, 6.4, 4.2);
      tuft(p, -1.2, 1, 1.8, true);
      tuft(p, 3.4, 1.2, 0.9);
      shade.m(-4.9, 1.9).q(-1.1, 3.2, 3.1, 2).q(0.2, 3.8, -4.9, 1.9).close();
      break;
    case 6:
      p.m(-2.8, 3.4)
        .l(-2.6, -3.2)
        .m(-2.7, -0.3)
        .l(-5, -2)
        .m(-2.7, 1)
        .l(-0.1, -1)
        .l(0.4, -2.5)
        .m(3.8, 3.3)
        .l(3.4, -1.4)
        .m(3.6, 1)
        .l(5.4, -0.5);
      ripples(p, -1.5, 4.8, 5.1);
      break;
    default:
      for (const [x, y] of [
        [-4, 1.8],
        [-0.3, 0],
        [3.3, 2.9],
      ]) {
        p.m(x, y)
          .q(x - 0.4, y - 1.7, x - 0.2, y - 3.8)
          .m(x - 1.4, y - 0.2)
          .q(x - 1.2, y - 1.8, x - 2.1, y - 2.6)
          .m(x + 0.6, y + 0.1)
          .q(x + 0.5, y - 1.7, x + 1.6, y - 2.1)
          .m(x - 0.2, y - 3.2)
          .l(x - 0.2, y - 4.1);
      }
      ripples(p, 0.8, 5, 5.3);
  }
  if (detail > 0.6) p.m(-5.7, 6.2).q(-3.7, 5.8, -2, 6.2);
}

function snowfields(pens: Pens, variant: number, detail: number) {
  const [p, shade, light] = pens;
  switch (variant) {
    case 0:
      p.m(-6.8, 1.8)
        .q(-2.1, 0.9, 0.9, -1.7)
        .q(3, -2.8, 6.6, -1.3)
        .m(-4.8, 4.8)
        .q(-0.9, 4.2, 2.8, 2.2)
        .q(4.3, 1.5, 6.9, 2.2);
      light.m(-5.5, 0.7).q(-2.7, 0.3, -0.6, -1.5);
      break;
    case 1:
      p.m(-6.6, 2.1)
        .q(-2.9, -2.7, 0.8, -1.4)
        .q(3.7, -0.6, 6.6, -1.9)
        .m(-4.5, 4.5)
        .q(-1.9, 2.9, 1, 3.5);
      shade.m(0.6, -0.9).q(3, 0.3, 6.3, -1).q(3.8, 1.3, 0.6, -0.9).close();
      light.m(-5.4, 0.7).q(-2.6, -1.9, -0.1, -1.1);
      break;
    case 2:
      p.m(-6.2, -1.7)
        .l(-3.7, -0.2)
        .l(-2.2, -0.9)
        .l(-0.7, 1.5)
        .l(1.2, 1.6)
        .l(3.9, 4.1)
        .m(-1.1, 1)
        .l(-0.1, -1.9)
        .l(1.3, -3.4)
        .m(1.2, 1.6)
        .l(4.1, 0.4)
        .l(6.4, 1.1)
        .m(-3.8, 4.5)
        .l(-2.2, 2.8);
      light.m(-5.8, -2.2).l(-3.4, -0.7).m(2.2, 1.6).l(4.4, 0.9);
      break;
    case 3:
      p.m(-6.7, 1)
        .q(-4, -3.9, -0.3, -3)
        .l(2.2, -1.9)
        .l(4.5, -2.4)
        .l(6.8, 0.1)
        .m(-3.7, 0)
        .l(-2.1, -0.8)
        .l(-0.9, 0.2)
        .m(0.2, -2.4)
        .l(-0.8, 1.6)
        .m(2.5, -1.5)
        .l(3.5, 2.9);
      shade.m(0.2, -2.4).l(3.5, 2.9).l(1.7, 2).close();
      break;
    case 4:
      p.m(-6.7, -0.3)
        .q(-3.7, -2.7, -0.1, -1.3)
        .q(3.1, 0, 6.8, -1.5)
        .m(-5.2, 1.4)
        .q(-1.1, 0, 2.4, 1.2)
        .m(-3.5, 4.3)
        .q(0.7, 2, 4.8, 3.5);
      shade.m(-1.5, -0.8).q(2.7, 0.7, 5.6, -0.7).q(2.5, 1.5, -1.5, -0.8).close();
      light.m(-5.9, -0.8).q(-3.6, -2.3, -1.7, -1.7);
      break;
    case 5:
      p.m(-6.5, -2.2)
        .q(-4.4, -1.6, -3.6, 0)
        .q(-2.2, 2.4, 0.4, 4)
        .m(6.4, -2.7)
        .q(2.6, -1.6, 1.8, 0.9)
        .q(1.7, 2.2, 0.4, 4)
        .m(-1.9, -2.5)
        .q(-0.4, -0.3, -0.5, 1.6);
      light.m(-5.8, -2.8).q(-3.4, -2, -2.6, -0.1).m(3.5, -2.3).q(2.1, -1.4, 1.5, -0.2);
      break;
    case 6:
      for (let i = 0; i < 3; i++) {
        const x = -4.8 + i * 4.2,
          y = 1 + (i % 2) * 1.7;
        p.m(x - 1.4, y + 1.3)
          .q(x + 0.2, y - 2.8, x + 2.8, y - 3)
          .m(x - 0.4, y + 2.3)
          .q(x + 1.2, y - 1, x + 2.7, y - 1.2);
      }
      light.m(-5.7, 1).q(-4.4, -1.4, -3, -1.6);
      break;
    default:
      stone(pens, -3.6, 1.8, 1.8, true);
      stone(pens, 3.5, -1.2, 1.4, true);
      p.m(-6.6, 3.1)
        .q(-2.1, 3.7, 0.7, 1.2)
        .q(3.5, 0.9, 6.5, 1.5)
        .m(-1.4, -2.9)
        .l(-0.3, -1.2)
        .l(-1.1, 0.6);
  }
  if (detail > 0.7) light.m(-5.6, 5.5).q(-2, 4.7, 1.2, 5.1);
}

function badlands(pens: Pens, variant: number, detail: number) {
  const [p, shade, light] = pens;
  switch (variant) {
    case 0:
      p.m(-5.8, -3.6)
        .q(-2.6, -2, -1.4, 0.3)
        .q(0.5, 2.7, 5.8, 4.5)
        .m(4.7, -3.7)
        .q(1.3, -2.2, -0.4, 1.4)
        .m(-6, 1.8)
        .q(-3.2, 0.9, -1.4, 1.2)
        .m(2.3, 0)
        .l(5.6, -1.6)
        .m(-1.2, -3.7)
        .l(-0.2, -1.5);
      shade.m(-1.3, 0).q(1.2, 2.6, 5.3, 4.3).l(2.7, 3.8).close();
      break;
    case 1:
      p.m(-6, 3.4)
        .l(-4.3, -2.7)
        .l(-1.2, -3.2)
        .l(0.6, 2.2)
        .m(1.5, 3.6)
        .l(3.4, -0.9)
        .l(5.1, -1.3)
        .l(6.8, 3.3)
        .m(-4.1, -1.3)
        .l(-1.1, -1.8)
        .m(-4.5, 0.5)
        .l(-0.5, -0.1)
        .m(3.3, 1.1)
        .l(5.7, 0.6);
      shade.m(-1.5, -2.6).l(0.4, 2.2).l(-1.2, 2.8).close();
      break;
    case 2:
      p.m(-7, -1.4)
        .l(-4.7, -2.3)
        .l(-2.5, -1.5)
        .l(-0.4, -2.8)
        .l(2.1, -1.2)
        .l(4.2, -1.7)
        .l(6.8, -0.5)
        .m(-6.4, 0.6)
        .l(-4.2, -0.1)
        .l(-1.7, 0.8)
        .l(0.8, -0.4)
        .l(3.4, 1.1)
        .l(6, 0.6)
        .m(-5.2, 2.7)
        .l(-2.1, 2)
        .l(0.4, 3.2)
        .l(3.6, 2.3)
        .l(6.7, 3.7);
      light.m(-4.7, -2.6).l(-2.6, -1.9).m(-0.4, -3.1).l(1.6, -1.7);
      break;
    case 3:
      p.m(-6.8, -2)
        .q(-3.3, -3.3, -0.4, -2)
        .q(2.3, -3.1, 6.7, -1.4)
        .m(-5.5, -1.3)
        .l(-5.9, 2.5)
        .l(-4, 4.2)
        .m(-2.7, -1.4)
        .l(-1.8, 2.2)
        .l(-0.3, 3.9)
        .m(0.6, -1.5)
        .l(1.2, 1.5)
        .l(3.2, 3.5)
        .m(4.1, -0.9)
        .l(4.5, 1.3)
        .l(6.4, 3.6);
      shade.m(0.4, -1.8).l(1.2, 1.5).l(3.2, 3.5).l(1.3, 2.8).close();
      break;
    case 4:
      p.m(-6.5, -1.2)
        .l(-3.7, -2.5)
        .l(-1.3, -1.3)
        .l(-1.8, 1.6)
        .l(-5.2, 2.4)
        .l(-6.5, -1.2)
        .m(-1.3, -1.3)
        .l(1.1, -3.5)
        .l(4.1, -2.4)
        .l(5, 0.4)
        .l(1.7, 1.6)
        .l(-1.8, 1.6)
        .m(1.7, 1.6)
        .l(3, 4.5)
        .m(5, 0.4)
        .l(7, 2.3)
        .m(-5.2, 2.4)
        .l(-4.2, 4.5);
      break;
    case 5:
      for (const [x, y, w] of [
        [-3.5, 1, 1.45],
        [0.7, -1.1, 1.1],
        [4.1, 1.8, 1.2],
      ]) {
        p.m(x - w, y + 2.5)
          .l(x - w * 0.5, y - 1.4)
          .l(x - w, y - 2.1)
          .l(x + w, y - 2.4)
          .l(x + w * 0.6, y - 1.2)
          .l(x + w * 1.15, y + 2.4)
          .m(x - w * 0.4, y + 0.6)
          .l(x + w * 0.6, y + 0.2);
        shade
          .m(x + w * 0.15, y - 1.2)
          .l(x + w * 0.6, y - 1.2)
          .l(x + w * 1.1, y + 2.4)
          .l(x + w * 0.45, y + 2.4)
          .close();
      }
      break;
    case 6:
      p.m(-6.9, -2.2)
        .q(-4.8, -2.3, -3.6, -0.7)
        .q(-1.2, 1.8, 2.2, 2.9)
        .q(4.5, 3.7, 6.5, 4.2)
        .m(-6.8, -0.1)
        .q(-4.7, -0.5, -3, 1)
        .q(0.3, 3.8, 5.7, 5.2)
        .m(-1.7, -3.6)
        .l(-0.8, -1.1)
        .l(0.7, 0.8)
        .m(5.7, -2.3)
        .q(2.5, -1.4, 1.4, 2.6);
      light.m(-5.5, -2.6).q(-4.3, -2.5, -3.3, -1.4);
      break;
    default:
      stone(pens, -3.6, 1.2, 2.1);
      stone(pens, 1.8, -1.5, 2.5, true);
      p.m(-5.5, 3.8)
        .l(-4.2, 3.5)
        .m(-1.1, 3.8)
        .l(0.2, 2.6)
        .l(1.5, 3.7)
        .m(3.3, 2.3)
        .l(5, 1.8)
        .l(6.4, 3.6)
        .m(5, -2.3)
        .l(6.3, -1.8);
  }
  if (detail > 0.7) p.m(-5.7, 5.3).l(-4.7, 4.9);
}

function tundra(pens: Pens, variant: number, detail: number) {
  const [p, shade, light] = pens;
  switch (variant) {
    case 0:
      stone(pens, -3.1, 0.9, 2, true);
      stone(pens, 3.4, 2.7, 1.3, true);
      tuft(p, -0.1, 3.8, 0.65);
      p.m(-5.9, 3).q(-3.4, 2.1, -1.8, 3.1);
      break;
    case 1:
      tuft(p, -4.4, 1.8, 0.8);
      tuft(p, 0, 0.8, 0.65);
      tuft(p, 3.7, 3.2, 0.9);
      p.m(-5, 4.4).q(-1.2, 3.2, 1.6, 4.1).m(2.4, -1.2).l(3.4, -1.4);
      break;
    case 2:
      p.m(-6.4, 1.6)
        .q(-5.5, -1.4, -3.9, -0.5)
        .q(-2.6, -2, -1.4, 1)
        .m(0.2, 2.6)
        .q(1.1, -0.4, 2.9, 0.2)
        .q(4.4, -1.8, 6.2, 1.6)
        .m(-4.2, -0.2)
        .l(-3.8, 2.4)
        .m(2.9, 0.6)
        .l(3, 3.5);
      shade.m(-5.2, 1.4).q(-3.3, 0.6, -1.6, 1.3).q(-3.6, 2.5, -5.2, 1.4).close();
      break;
    case 3:
      stone(pens, -4.1, 1, 1.3, true);
      stone(pens, 0.2, -1.4, 1.7, true);
      stone(pens, 3.8, 2.4, 1.6);
      p.m(-2.6, 3.9).l(-1.8, 3.5).m(1.3, 4.7).l(2.1, 4.5).m(5.2, -1).l(5.9, -0.8);
      break;
    case 4:
      p.m(-6.5, 2)
        .q(-4.4, -0.9, -2.4, 1.3)
        .m(-1.8, -0.8)
        .q(0.4, -3.2, 2.6, -0.5)
        .m(1.2, 3.8)
        .q(3.7, 0.5, 6.2, 3.3)
        .m(-4.9, 4.1)
        .q(-3.4, 2.9, -1.6, 3.9);
      light.m(-5.3, 1).q(-4.4, 0.1, -3.4, 0.8);
      break;
    case 5:
      p.m(-6.8, 0)
        .l(-3.8, -1.7)
        .l(-1.3, -0.5)
        .l(-0.4, 2.3)
        .l(-3.2, 3.7)
        .m(-1.3, -0.5)
        .l(1, -2.3)
        .l(4.1, -1.2)
        .l(5.4, 1.7)
        .l(2.5, 3.7)
        .l(-0.4, 2.3)
        .m(5.4, 1.7)
        .l(7, 2.1)
        .m(-3.8, -1.7)
        .l(-3.8, -3.7);
      break;
    case 6:
      stone(pens, -2.9, 0.5, 2.8, true);
      stone(pens, 3.5, 1.9, 1.75, true);
      p.m(-4.6, 2.9).q(-2.2, 2, -0.8, 2.6).m(-0.3, -2.1).l(0.8, -2.5).m(4.4, 4.4).l(5.4, 4.1);
      break;
    default:
      ripples(p, -1.6, 3.4, 4.5);
      tuft(p, -3.8, 2.6, 0.8, true);
      tuft(p, 1.6, 2.6, 1.1, true);
      stone(pens, 4.2, -0.5, 1.25, true);
  }
  if (detail > 0.7) tuft(p, -0.4, 5, 0.4);
}

function grasslands(pens: Pens, variant: number, detail: number, dry: boolean) {
  const [p, shade, light] = pens;
  const s = dry ? 1.16 : 0.88;
  switch (variant) {
    case 0:
      tuft(p, -4.4, 2.2, s, dry);
      tuft(p, -0.2, 0.6, s * 1.12, true);
      tuft(p, 3.8, 3.7, s * 0.86);
      if (dry) acacia(pens, 3.4, -1.4, 1.2);
      break;
    case 1:
      p.m(-6.1, 1.8)
        .q(-5.6, -0.6, -3.9, 0.1)
        .q(-2.3, -1.9, -0.6, 1.9)
        .m(1.2, 3)
        .q(2.3, 0.1, 3.8, 1.3)
        .q(5.4, -0.2, 6.4, 2.8);
      tuft(p, 0.1, -0.7, s * 0.7);
      shade.m(-5, 1.4).q(-2.7, 0.6, -1.2, 1.7).q(-3.6, 2.5, -5, 1.4).close();
      break;
    case 2:
      tuft(p, -4.4, -0.1, s * 0.85);
      tuft(p, -1.7, 3.1, s, true);
      tuft(p, 2.3, 0.8, s * 0.88, true);
      tuft(p, 4.8, 4.6, s * 0.72);
      light.m(-5.6, 4).q(-3.9, 3.4, -2.6, 3.8);
      break;
    case 3:
      if (dry) {
        acacia(pens, -2.5, 0, 1.9);
        acacia(pens, 3.9, 2.6, 1.3);
        tuft(p, -3.9, 4.8, 0.75);
      } else {
        tuft(p, -3.6, 2.8, 0.9);
        tuft(p, 2.8, 3.5, 0.8);
        for (const [x, y] of [
          [-0.9, 0.5],
          [3.3, -0.5],
          [-4.2, -1.1],
        ]) {
          p.m(x, y + 1)
            .q(x + 0.5, y - 0.3, x, y - 1.6)
            .m(x - 0.65, y - 1.1)
            .q(x, y - 2, x + 0.65, y - 1.1)
            .q(x, y - 0.5, x - 0.65, y - 1.1);
        }
      }
      break;
    case 4:
      p.m(-6.8, 2.4)
        .q(-3.9, -0.9, -0.6, 0.1)
        .q(3.2, -1.4, 6.5, 1)
        .m(-4.8, 4.5)
        .q(-1.3, 2.7, 2.1, 3.7);
      tuft(p, -3.9, 1.2, s * 0.7);
      tuft(p, 2.3, 1.6, s * 0.85);
      light.m(-5.3, 1.6).q(-3.7, 0, -2.1, 0.3);
      break;
    case 5:
      stone(pens, -3.1, 1.5, dry ? 1.9 : 1.4, true);
      tuft(p, -5, 2.9, s * 0.7);
      tuft(p, 0.5, 2.7, s * 0.82, true);
      tuft(p, 4.2, 0.6, s * 0.95);
      p.m(2.9, 4.5).q(4.5, 4, 6.1, 4.5);
      break;
    case 6:
      tuft(p, -4.7, 1.3, s * 0.82);
      tuft(p, -3, 3.7, s * 0.8, true);
      tuft(p, 2.8, 0.2, s * 0.9);
      tuft(p, 4.4, 3.3, s * 0.74, true);
      p.m(-1.6, 5).q(-0.2, 4.6, 1.7, 4.8);
      break;
    default:
      if (dry) {
        p.m(-5.8, 2.4)
          .l(-4.3, 0.4)
          .l(-3.8, -1.1)
          .m(-4.4, 0.7)
          .l(-5.6, -0.4)
          .m(-4.2, 0.8)
          .l(-2.9, 0)
          .m(1.6, 2.9)
          .l(2.4, 1)
          .l(2.1, -1.6)
          .m(2.4, 0.6)
          .l(4.1, -0.5)
          .m(2.7, 1.3)
          .l(4.8, 1.1);
        tuft(p, -0.3, 4.2, 0.8);
      } else {
        p.m(-5.6, 1.9).q(-5.2, -0.6, -3.2, 0.3).q(-2.2, -0.7, -0.4, 1.5);
        tuft(p, -3.6, 3.9, 0.75);
        tuft(p, 3.1, 1.4, 0.95, true);
        stone(pens, 4.7, 4.1, 0.95, true);
      }
  }
  if (detail > 0.6) p.m(-5.1, 5.6).q(-3, 4.8, -1.1, 5.3);
}

/**
 * Original, bounded engraving families. These suggest vegetation and surface structure;
 * they are not extra peaks, settlements or generated data, and never use frame-time randomness.
 * Callers provide location, coherent scale/orientation and ecological density.
 */
export function drawTerrainMotif(
  biome: TerrainBiome,
  line: TerrainPen,
  shade: TerrainPen,
  light: TerrainPen,
  variation: number,
  secondary = 0.5,
) {
  const variant = Math.min(
      TERRAIN_MOTIF_VARIANTS - 1,
      Math.max(0, Math.floor(variation * TERRAIN_MOTIF_VARIANTS)),
    ),
    detail = Math.max(0, Math.min(1, secondary)),
    pens = [line, shade, light] as const;
  switch (biome) {
    case 'forest':
    case 'rainforest':
      broadleaf(pens, variant, detail, biome === 'rainforest');
      break;
    case 'taiga':
      needleForest(pens, variant, detail);
      break;
    case 'mountain':
      rocks(pens, variant, detail);
      break;
    case 'hill':
      hills(pens, variant, detail);
      break;
    case 'plateau':
      plateaus(pens, variant, detail);
      break;
    case 'desert':
      desert(pens, variant, detail);
      break;
    case 'swamp':
      wetlands(pens, variant, detail);
      break;
    case 'snow':
      snowfields(pens, variant, detail);
      break;
    case 'badlands':
      badlands(pens, variant, detail);
      break;
    case 'tundra':
      tundra(pens, variant, detail);
      break;
    case 'savanna':
    case 'grass':
      grasslands(pens, variant, detail, biome === 'savanna');
      break;
  }
}
