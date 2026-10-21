import { useLayoutEffect, useRef, type RefObject } from 'react';
import type { MapCameraView } from './map-camera';
import { embedMapImages } from './map-image';
import { planMapRasterCache, cacheTransform } from './map-raster-cache';

/** Cache only the expensive paper/terrain. Labels, tools and hits stay in SVG.
 * The backing bitmap covers the entire artwork at maximum zoom and device DPR;
 * exceeding the memory budget falls back to the original vector renderer.
 */
export function useMapRasterCache(
  svg: RefObject<SVGSVGElement | null>,
  surface: RefObject<HTMLDivElement | null>,
  view: MapCameraView,
  mapId: string | undefined,
) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const active = useRef<ReturnType<typeof planMapRasterCache>>(undefined);
  const currentView = useRef(view);
  currentView.current = view;

  function position() {
    if (canvas.current && active.current) {
      const m = cacheTransform(active.current, currentView.current);
      canvas.current.style.transform = `matrix(${m.a},${m.b},${m.c},${m.d},${m.e},${m.f})`;
    }
  }
  useLayoutEffect(position, [view]);

  useLayoutEffect(() => {
    const root = svg.current,
      host = surface.current,
      bitmap = canvas.current;
    const source = root?.querySelector<SVGGElement>('[data-map-cache-source]');
    if (!root || !host || !bitmap || !source) return;
    let version = 0,
      disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let idle: number | undefined;
    let image: HTMLImageElement | undefined;
    let blobUrl: string | undefined;

    function release() {
      version++;
      host!.removeAttribute('data-map-cache-ready');
      active.current = undefined;
      bitmap!.width = bitmap!.height = 1;
      if (timer !== undefined) clearTimeout(timer);
      if (idle !== undefined) window.cancelIdleCallback(idle);
      timer = idle = undefined;
      if (image) image.src = '';
      image = undefined;
      if (blobUrl) URL.revokeObjectURL(blobUrl);
      blobUrl = undefined;
    }
    async function build(ticket: number) {
      if (disposed || ticket !== version) return;
      // Do not compete with input or photograph a partially generated preview.
      if (
        host!.hasAttribute('data-map-transforming') ||
        source!.querySelector('[data-terrain-pending="true"],[data-terrain-error="true"]')
      ) {
        schedule();
        return;
      }
      try {
        await document.fonts.ready;
        if (disposed || ticket !== version) return;
        const box = root!.viewBox.baseVal;
        const bounds = source!.getBBox();
        const blur = Math.max(
          0,
          ...[...source!.querySelectorAll('feGaussianBlur')].map((node) =>
            Number.parseFloat(node.getAttribute('stdDeviation') ?? '0'),
          ),
        );
        // getBBox excludes strokes in several supported browsers. Convert each
        // explicit stroke's local radius to world units, including glyph scale.
        const rootMatrix = source!.getCTM();
        let strokePadding = 2;
        if (rootMatrix) {
          const inverse = rootMatrix.inverse();
          for (const node of source!.querySelectorAll<SVGGraphicsElement>('[stroke-width]')) {
            const width = Number.parseFloat(node.getAttribute('stroke-width') ?? '0');
            const local = node.getCTM();
            if (!Number.isFinite(width) || !local) continue;
            const m = inverse.multiply(local);
            // Frobenius norm bounds the maximum stretch, including shear.
            strokePadding = Math.max(
              strokePadding,
              (width * Math.hypot(m.a, m.b, m.c, m.d)) / 2 + 2,
            );
          }
        }
        const padding = Math.max(strokePadding, blur * 4);
        const x = Math.min(0, bounds.x) - padding,
          y = Math.min(0, bounds.y) - padding;
        const extent = {
          x,
          y,
          width: Math.max(box.width, bounds.x + bounds.width) - x + padding,
          height: Math.max(box.height, bounds.y + bounds.height) - y + padding,
        };
        const plan = planMapRasterCache(
          box.width,
          box.height,
          host!.clientWidth,
          host!.clientHeight,
          window.devicePixelRatio,
          4,
          extent,
        );
        if (!plan) return;
        const snapshot = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        snapshot.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
        snapshot.setAttribute('width', String(plan.pixelWidth));
        snapshot.setAttribute('height', String(plan.pixelHeight));
        snapshot.setAttribute(
          'viewBox',
          `${extent.x} ${extent.y} ${extent.width} ${extent.height}`,
        );
        snapshot.setAttribute('preserveAspectRatio', 'none');
        const style = getComputedStyle(root!);
        for (const property of [
          'font-family',
          'font-size',
          'font-weight',
          'font-style',
          'font-stretch',
          'letter-spacing',
          'word-spacing',
          'color',
        ])
          snapshot.style.setProperty(property, style.getPropertyValue(property));
        for (const node of root!.children)
          if (node.tagName.toLowerCase() === 'defs') snapshot.append(node.cloneNode(true));
        const copy = source!.cloneNode(true) as SVGGElement;
        copy.removeAttribute('data-map-cache-source');
        // Fullscreen intentionally suppresses editor annotations. They must not
        // reappear as baked pixels underneath the otherwise clean vector view.
        if (document.fullscreenElement?.contains(root!))
          copy.querySelectorAll('[data-editor-overlay]').forEach((node) => node.remove());
        snapshot.append(copy);
        await embedMapImages(snapshot);
        if (disposed || ticket !== version) return;
        const url = URL.createObjectURL(
          new Blob([new XMLSerializer().serializeToString(snapshot)], {
            type: 'image/svg+xml;charset=utf-8',
          }),
        );
        blobUrl = url;
        const decoded = new Image();
        image = decoded;
        decoded.src = url;
        await decoded.decode();
        if (disposed || ticket !== version) return;
        // Input may have started while fonts/uploads/image decoding awaited.
        // Keep the current renderer throughout that gesture, then try at idle.
        if (host!.hasAttribute('data-map-transforming')) {
          schedule();
          return;
        }
        const context = bitmap!.getContext('2d');
        if (!context) return;
        bitmap!.width = plan.pixelWidth;
        bitmap!.height = plan.pixelHeight;
        context.drawImage(decoded, 0, 0);
        // Async upload/decode can outlive a content edit or map switch.
        if (disposed || ticket !== version) return;
        bitmap!.style.width = `${extent.width}px`;
        bitmap!.style.height = `${extent.height}px`;
        active.current = plan;
        position();
        host!.setAttribute('data-map-cache-ready', 'true');
      } catch {
        // Unsupported/failed image decoding leaves the original vectors usable.
        if (ticket === version) {
          host!.removeAttribute('data-map-cache-ready');
          active.current = undefined;
          bitmap!.width = bitmap!.height = 1;
        }
      } finally {
        if (ticket === version) {
          if (blobUrl) URL.revokeObjectURL(blobUrl);
          blobUrl = undefined;
          image = undefined;
        }
      }
    }
    function schedule() {
      if (timer !== undefined) clearTimeout(timer);
      if (idle !== undefined) window.cancelIdleCallback(idle);
      timer = setTimeout(() => {
        timer = undefined;
        const ticket = version;
        if ('requestIdleCallback' in window)
          idle = window.requestIdleCallback(() => {
            idle = undefined;
            void build(ticket);
          });
        else void build(ticket);
      }, 350);
    }
    const changed = () => {
      release();
      schedule();
    };
    const mutations = new MutationObserver(changed);
    mutations.observe(source, {
      subtree: true,
      childList: true,
      attributes: true,
      characterData: true,
    });
    let width = host.clientWidth,
      height = host.clientHeight,
      dpr = window.devicePixelRatio;
    const resized = () => {
      const nextDpr = window.devicePixelRatio;
      if (width === host.clientWidth && height === host.clientHeight && dpr === nextDpr) return;
      width = host.clientWidth;
      height = host.clientHeight;
      dpr = nextDpr;
      changed();
    };
    const sizes = new ResizeObserver(resized);
    sizes.observe(host);
    window.addEventListener('resize', resized);
    document.fonts.addEventListener('loadingdone', changed);
    document.addEventListener('fullscreenchange', changed);
    schedule();
    return () => {
      disposed = true;
      mutations.disconnect();
      sizes.disconnect();
      window.removeEventListener('resize', resized);
      document.fonts.removeEventListener('loadingdone', changed);
      document.removeEventListener('fullscreenchange', changed);
      release();
    };
  }, [mapId]);
  return canvas;
}
