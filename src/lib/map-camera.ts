export interface MapCameraView {
  x: number;
  y: number;
  zoom: number;
}

export interface MapCameraPoint {
  x: number;
  y: number;
}

export interface MapCameraMatrix {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}

export function sameMapCameraView(a: MapCameraView, b: MapCameraView) {
  return a.x === b.x && a.y === b.y && a.zoom === b.zoom;
}

/** Keep the root-SVG point under the cursor stationary, including at zoom limits. */
export function zoomMapCamera(view: MapCameraView, zoom: number, anchor: MapCameraPoint) {
  const next = Math.max(0.5, Math.min(4, zoom));
  if (next === view.zoom) return view;
  const scale = next / view.zoom;
  return {
    zoom: next,
    x: anchor.x - (anchor.x - view.x) * scale,
    y: anchor.y - (anchor.y - view.y) * scale,
  };
}

/** A screen delta only uses the linear part; inverse-matrix translations cancel. */
export function panMapCamera(
  view: MapCameraView,
  inverseScreen: MapCameraMatrix,
  delta: MapCameraPoint,
) {
  return {
    ...view,
    x: view.x + inverseScreen.a * delta.x + inverseScreen.c * delta.y,
    y: view.y + inverseScreen.b * delta.x + inverseScreen.d * delta.y,
  };
}

/** M · V(next) · inverse(V(base)) · inverse(M).
 * M includes the SVG's letterboxing within the HTML surface. Uniform view zoom
 * commutes with M's linear part, leaving a scale and a CSS-pixel translation.
 */
export function mapCameraTransform(
  base: MapCameraView,
  next: MapCameraView,
  root: MapCameraMatrix,
) {
  const scale = next.zoom / base.zoom;
  const x = next.x - scale * base.x;
  const y = next.y - scale * base.y;
  return {
    scale,
    x: root.a * x + root.c * y + (1 - scale) * root.e,
    y: root.b * x + root.d * y + (1 - scale) * root.f,
  };
}
