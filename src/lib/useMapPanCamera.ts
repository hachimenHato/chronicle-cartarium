import { useEffect, useLayoutEffect, useRef, type RefObject, type SetStateAction } from 'react';
import {
  mapCameraTransform,
  panMapCamera,
  sameMapCameraView,
  zoomMapCamera,
  type MapCameraMatrix,
  type MapCameraPoint,
  type MapCameraView,
} from './map-camera';

interface PointerPosition {
  clientX: number;
  clientY: number;
}

interface CameraPresentation {
  base: MapCameraView;
  next: MapCameraView;
  root: MapCameraMatrix;
  inverseScreen: DOMMatrix;
  screenOrigin: { left: number; top: number };
  commits: MapCameraView[];
  css?: string;
  pan?: { client: PointerPosition; view: MapCameraView; presented: boolean };
}

/** Present gestures on the existing composited HTML surface, then commit the
 * original vector view once. Coordinates and generated data are unchanged.
 */
export function useMapPanCamera(
  svg: RefObject<SVGSVGElement | null>,
  view: MapCameraView,
  mapId: string | undefined,
  setView: (view: MapCameraView) => void,
  latestView: () => MapCameraView,
  onInterrupt: () => void,
) {
  const frame = useRef<HTMLDivElement>(null);
  const surface = useRef<HTMLDivElement>(null);
  const zoomLabel = useRef<HTMLSpanElement>(null);
  const animation = useRef<number | undefined>(undefined);
  const idle = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const presentation = useRef<CameraPresentation | undefined>(undefined);
  const rendered = useRef(view);
  const interrupt = useRef(onInterrupt);
  interrupt.current = onInterrupt;

  function label(next: MapCameraView) {
    const text = `${Math.round(next.zoom * 100)}%`;
    if (zoomLabel.current && zoomLabel.current.textContent !== text)
      zoomLabel.current.textContent = text;
  }
  function cancelIdle() {
    if (idle.current !== undefined) clearTimeout(idle.current);
    idle.current = undefined;
  }
  function cancelAnimation() {
    if (animation.current !== undefined) cancelAnimationFrame(animation.current);
    animation.current = undefined;
  }
  function clear() {
    cancelIdle();
    cancelAnimation();
    presentation.current = undefined;
    if (surface.current) {
      surface.current.style.removeProperty('transform');
      surface.current.removeAttribute('data-map-panning');
      surface.current.removeAttribute('data-map-transforming');
    }
    label(rendered.current);
  }
  function draw(active: CameraPresentation) {
    if (!surface.current || presentation.current !== active) return;
    const transform = mapCameraTransform(active.base, active.next, active.root);
    const css = `translate3d(${transform.x}px,${transform.y}px,0)${transform.scale === 1 ? '' : ` scale(${transform.scale})`}`;
    // Inline CSS reads normalize spaces and zero units. Remember the authored
    // value instead, so an identical RAF sample really does skip the write.
    if (active.css !== css) {
      surface.current.style.transform = css;
      active.css = css;
    }
    label(active.next);
  }
  function requestDraw(active: CameraPresentation) {
    if (animation.current !== undefined) return;
    animation.current = requestAnimationFrame(() => {
      animation.current = undefined;
      draw(active);
    });
  }
  function ensurePresentation() {
    if (presentation.current) return presentation.current;
    const matrix = svg.current?.getScreenCTM();
    const element = surface.current;
    const bounds = element?.getBoundingClientRect();
    if (!matrix || !element || !bounds?.width || !bounds.height) return undefined;
    // getScreenCTM includes preserveAspectRatio's horizontal/vertical margins.
    // Convert its screen-pixel result to the HTML surface's own CSS pixels.
    const size = getComputedStyle(element);
    const origin = frame.current?.getBoundingClientRect() ?? bounds;
    const cssX = parseFloat(size.width) / bounds.width;
    const cssY = parseFloat(size.height) / bounds.height;
    const active: CameraPresentation = {
      base: rendered.current,
      next: latestView(),
      root: {
        a: matrix.a * cssX,
        b: matrix.b * cssY,
        c: matrix.c * cssX,
        d: matrix.d * cssY,
        e: (matrix.e - bounds.left) * cssX,
        f: (matrix.f - bounds.top) * cssY,
      },
      inverseScreen: matrix.inverse(),
      screenOrigin: { left: origin.left, top: origin.top },
      commits: [],
    };
    presentation.current = active;
    element.setAttribute('data-map-transforming', 'true');
    return active;
  }
  function finish() {
    const active = presentation.current;
    if (!active) return;
    cancelIdle();
    cancelAnimation();
    active.pan = undefined;
    surface.current?.removeAttribute('data-map-panning');
    if (!active.commits.length && sameMapCameraView(active.next, active.base)) {
      clear();
      return;
    }
    // A tool may start before React's next frame. Its getScreenCTM must already
    // see the final displayed view, so paint the CSS matrix synchronously here.
    draw(active);
    if (!active.commits.length || !sameMapCameraView(active.commits.at(-1)!, active.next)) {
      active.commits.push(active.next);
      setView(active.next);
    }
  }
  function finishWhenIdle() {
    cancelIdle();
    idle.current = setTimeout(() => {
      idle.current = undefined;
      finish();
      // A physical wheel often pauses 180–240 ms between detents. Keep those
      // inputs on the same compositor layer; tools still call finish immediately
      // before reading precise SVG coordinates.
    }, 400);
  }
  function zoom(active: CameraPresentation, nextZoom: number, anchor: MapCameraPoint) {
    if (active.pan) {
      active.pan = undefined;
      surface.current?.removeAttribute('data-map-panning');
      interrupt.current();
    }
    const next = zoomMapCamera(active.next, nextZoom, anchor);
    if (sameMapCameraView(next, active.next)) {
      // At a zoom limit there is no new work. A preceding pan/zoom must still
      // settle, but repeated wheel input must not keep rebuilding the map.
      if (sameMapCameraView(active.next, active.base) && !active.commits.length) clear();
      else if (idle.current === undefined) finishWhenIdle();
      return;
    }
    active.next = next;
    requestDraw(active);
    finishWhenIdle();
  }

  useLayoutEffect(() => {
    rendered.current = view;
    const active = presentation.current;
    if (!active) {
      label(view);
      return;
    }
    let acknowledged = -1;
    for (let i = active.commits.length - 1; i >= 0; i--)
      if (sameMapCameraView(view, active.commits[i])) {
        acknowledged = i;
        break;
      }
    if (acknowledged >= 0) {
      active.commits.splice(0, acknowledged + 1);
      active.base = view;
      if (
        !active.pan &&
        idle.current === undefined &&
        !active.commits.length &&
        sameMapCameraView(active.next, view)
      )
        clear();
      // A new wheel/pan can arrive while the previous commit is rendering.
      // Rebase its remaining CSS transform instead of dropping that input.
      else draw(active);
    } else if (!sameMapCameraView(view, active.base)) {
      clear();
      interrupt.current();
    }
  }, [view]);
  useLayoutEffect(() => {
    clear();
    return clear;
  }, [mapId]);
  useEffect(() => {
    const changed = () => {
      if (!presentation.current) return;
      finish();
      interrupt.current();
    };
    const scrolled = () => {
      const active = presentation.current;
      if (!active || !frame.current) return;
      const origin = frame.current.getBoundingClientRect();
      const dx = origin.left - active.screenOrigin.left;
      const dy = origin.top - active.screenOrigin.top;
      if (!dx && !dy) return;
      // Scrolling translates the screen origin, not the local SVG geometry.
      // Correct it before finishing: another wheel may arrive in the same
      // frame, before React acknowledges that final vector view.
      active.inverseScreen = active.inverseScreen.translate(-dx, -dy);
      active.screenOrigin = { left: origin.left, top: origin.top };
      changed();
    };
    let size = frame.current ? [frame.current.clientWidth, frame.current.clientHeight] : [0, 0];
    const observer = new ResizeObserver(() => {
      if (!frame.current) return;
      const next = [frame.current.clientWidth, frame.current.clientHeight];
      if (next[0] !== size[0] || next[1] !== size[1]) changed();
      size = next;
    });
    if (frame.current) observer.observe(frame.current);
    window.addEventListener('resize', changed);
    window.addEventListener('scroll', scrolled, true);
    document.addEventListener('fullscreenchange', changed);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', changed);
      window.removeEventListener('scroll', scrolled, true);
      document.removeEventListener('fullscreenchange', changed);
    };
  }, [mapId]);

  return {
    frame,
    surface,
    zoomLabel,
    begin(event: PointerPosition) {
      const active = ensurePresentation();
      if (!active) return false;
      cancelIdle();
      active.pan = {
        client: { clientX: event.clientX, clientY: event.clientY },
        view: active.next,
        presented: false,
      };
      surface.current?.setAttribute('data-map-panning', 'true');
      return true;
    },
    move(event: PointerPosition) {
      const active = presentation.current;
      if (!active?.pan) return false;
      active.next = panMapCamera(active.pan.view, active.inverseScreen, {
        x: event.clientX - active.pan.client.clientX,
        y: event.clientY - active.pan.client.clientY,
      });
      // Present the first pan sample without waiting another frame. Additional
      // samples are coalesced, and draw skips an unchanged final transform.
      if (!active.pan.presented) {
        active.pan.presented = true;
        draw(active);
      }
      requestDraw(active);
      return true;
    },
    zoomAt(event: PointerPosition, factor: number) {
      const active = ensurePresentation();
      if (!active) return false;
      const anchor = new DOMPoint(event.clientX, event.clientY).matrixTransform(
        active.inverseScreen,
      );
      zoom(active, active.next.zoom * factor, anchor);
      return true;
    },
    zoomBy(delta: number, anchor?: MapCameraPoint) {
      const active = ensurePresentation();
      const box = svg.current?.viewBox.baseVal;
      if (!active || !box) return false;
      zoom(
        active,
        active.next.zoom + delta,
        anchor ?? {
          x: box.x + box.width / 2,
          y: box.y + box.height / 2,
        },
      );
      return true;
    },
    replace(action: SetStateAction<MapCameraView>) {
      const active = presentation.current;
      const previous = active?.next ?? latestView();
      const next = typeof action === 'function' ? action(previous) : action;
      const wasPanning = Boolean(active?.pan);
      clear();
      if (wasPanning) interrupt.current();
      setView(next);
      label(next);
    },
    finish,
    clear,
  };
}
