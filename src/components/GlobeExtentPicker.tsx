import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Globe2,
  X,
  ArrowUp,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  Plus,
  Minus,
  Focus,
} from 'lucide-react';
import {
  globalWorldExtent,
  extentAround,
  extentCenter,
  extentSummary,
  isGlobalExtent,
  longitudeSpan,
  wrapLongitude,
  type WorldExtent,
} from '../../shared/world-extent';
import { createGlobePathRenderer } from '../lib/globe-projection';
import { globeExtentContour, globeLandPolygons } from '../lib/globe-geometry';
import {
  globeNavigationGrid,
  globeRotationStep,
  globeSelectionZoom,
  maximumGlobeZoom,
  nextGlobeZoom,
} from '../lib/globe-navigation';
import { GlobeClimatePreview } from './GlobeClimatePreview';
import type { ClimatePreviewOptions } from '../lib/world-climate-preview';
import './GlobeExtentPicker.css';

const presets = [
  ['全球', 360, 180],
  ['大洲', 120, 80],
  ['区域', 20, 14],
  ['地方', 2, 1.3],
  ['城镇', 0.12, 0.08],
] as const;
const logValue = (span: number, max: number) =>
  (Math.log(Math.max(0.01, span) / 0.01) / Math.log(max / 0.01)) * 100;
const logSpan = (value: number, max: number) => 0.01 * (max / 0.01) ** (value / 100);
export function GlobeExtentPicker({
  value = globalWorldExtent,
  onChange,
  disabled = false,
  climate = {},
}: {
  value?: WorldExtent;
  onChange: (value: WorldExtent) => void;
  disabled?: boolean;
  climate?: ClimatePreviewOptions;
}) {
  const [open, setOpen] = useState(false),
    [draft, setDraft] = useState(value);
  const initialCenter = extentCenter(value);
  const [view, setView] = useState(initialCenter);
  const [zoom, setZoom] = useState(1);
  const dialog = useRef<HTMLDivElement>(null),
    trigger = useRef<HTMLButtonElement>(null),
    sphere = useRef<SVGSVGElement>(null);
  const drag = useRef<{ x: number; y: number; latitude: number; longitude: number } | undefined>(
    undefined,
  );
  const uid = useId().replaceAll(':', '');
  useEffect(() => {
    if (open) dialog.current?.querySelector<HTMLElement>('button')?.focus();
  }, [open]);
  useEffect(() => {
    const node = sphere.current;
    if (!open || !node) return;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      if (event.deltaY)
        setZoom((z) =>
          Math.min(maximumGlobeZoom, Math.max(1, z * Math.exp(-event.deltaY * 0.002))),
        );
    };
    node.addEventListener('wheel', wheel, { passive: false });
    return () => node.removeEventListener('wheel', wheel);
  }, [open]);
  function close() {
    setOpen(false);
    trigger.current?.focus();
  }
  function move(latitude: number, longitude: number) {
    const position = {
      latitude: Math.max(-90, Math.min(90, latitude)),
      longitude: wrapLongitude(longitude),
    };
    if (isGlobalExtent(draft)) setView(position);
    else {
      const next = extentAround(
        position.latitude,
        position.longitude,
        longitudeSpan(draft),
        draft.latitudeNorth - draft.latitudeSouth,
      );
      setDraft(next);
      setView(extentCenter(next));
    }
  }
  function resize(width: number, height: number, focus = false) {
    const next = extentAround(view.latitude, view.longitude, width, height);
    setDraft(next);
    setView(extentCenter(next));
    if (focus) setZoom(globeSelectionZoom(next));
  }
  function focusSelection() {
    setView(extentCenter(draft));
    setZoom(globeSelectionZoom(draft));
  }
  const span = longitudeSpan(draft),
    height = draft.latitudeNorth - draft.latitudeSouth;
  const overviewRenderer = useMemo(
    () => createGlobePathRenderer(view.latitude, view.longitude),
    [view.latitude, view.longitude],
  );
  const renderer = useMemo(
    () =>
      zoom > 4
        ? createGlobePathRenderer(view.latitude, view.longitude, { zoom, clipToViewport: true })
        : overviewRenderer,
    [view.latitude, view.longitude, zoom, overviewRenderer],
  );
  const selectionRenderer = useMemo(
    () =>
      zoom > 4
        ? createGlobePathRenderer(view.latitude, view.longitude, { zoom })
        : overviewRenderer,
    [view.latitude, view.longitude, zoom, overviewRenderer],
  );
  const landPaths = useMemo(() => globeLandPolygons.map((p) => renderer.geometry(p)), [renderer]);
  const overviewLandPaths = useMemo(
    () => globeLandPolygons.map((p) => overviewRenderer.geometry(p)),
    [overviewRenderer],
  );
  const grid = useMemo(() => globeNavigationGrid(view, zoom), [view, zoom]);
  const graticulePaths = useMemo(
    () => grid.lines.map((p) => renderer.geometry(p)),
    [renderer, grid],
  );
  const borderPath = useMemo(
    () =>
      isGlobalExtent(draft)
        ? ''
        : selectionRenderer.polygon(
            globeExtentContour(draft),
            ((span * Math.PI) / 180) *
              (Math.sin((draft.latitudeNorth * Math.PI) / 180) -
                Math.sin((draft.latitudeSouth * Math.PI) / 180)),
            extentCenter(draft),
          ),
    [selectionRenderer, draft, span],
  );
  return (
    <div className="globe-extent-field">
      <button
        type="button"
        className="btn globe-extent-trigger"
        ref={trigger}
        disabled={disabled}
        onClick={() => {
          setDraft(value);
          setView(extentCenter(value));
          setZoom(globeSelectionZoom(value) > 4 ? globeSelectionZoom(value) : 1);
          setOpen(true);
        }}
      >
        <Globe2 size={19} />
        <span>
          <strong>选择星球方位与范围</strong>
          <small>{extentSummary(value)}</small>
        </span>
      </button>
      {open &&
        createPortal(
          <div
            className="globe-dialog-overlay"
            onMouseDown={(e) => {
              if (e.target === e.currentTarget) close();
            }}
          >
            <div
              className="globe-dialog"
              role="dialog"
              aria-modal="true"
              aria-label="选择地图在星球上的范围"
              ref={dialog}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === 'Escape') {
                  e.preventDefault();
                  close();
                }
                if (e.key === 'Enter' && !(e.target instanceof HTMLButtonElement))
                  e.preventDefault();
                if (e.key === 'Tab') {
                  const nodes = dialog.current!.querySelectorAll<HTMLElement>(
                    'button:not(:disabled),input:not(:disabled),[tabindex="0"]',
                  );
                  const first = nodes[0],
                    last = nodes[nodes.length - 1];
                  if (e.shiftKey && document.activeElement === first) {
                    e.preventDefault();
                    last.focus();
                  } else if (!e.shiftKey && document.activeElement === last) {
                    e.preventDefault();
                    first.focus();
                  }
                }
              }}
            >
              <header>
                <div>
                  <span className="eyebrow">星球定位</span>
                  <h2>这张地图位于世界的哪里？</h2>
                </div>
                <button
                  type="button"
                  className="icon-btn"
                  aria-label="关闭星球选择"
                  onClick={close}
                >
                  <X size={20} />
                </button>
              </header>
              <p>
                拖动星球选择方位，金框代表地图范围。选择地方或城镇会自动放大，也可滚轮缩放或聚焦选区。示意陆地仅供定位。
              </p>
              <div className="globe-dialog-content">
                <div className="globe-stage">
                  <div className="globe-viewport">
                    <svg
                      ref={sphere}
                      viewBox={`${180 - 180 / zoom} ${180 - 180 / zoom} ${360 / zoom} ${360 / zoom}`}
                      data-globe-zoom={zoom}
                      data-globe-latitude={view.latitude}
                      data-globe-longitude={view.longitude}
                      role="img"
                      aria-label="可旋转的三维星球"
                      tabIndex={0}
                      onKeyDown={(e) => {
                        const keys: Record<string, [number, number]> = {
                          ArrowUp: [globeRotationStep(zoom).latitude, 0],
                          ArrowDown: [-globeRotationStep(zoom).latitude, 0],
                          ArrowLeft: [0, -globeRotationStep(zoom).longitude],
                          ArrowRight: [0, globeRotationStep(zoom).longitude],
                        };
                        if (keys[e.key]) {
                          e.preventDefault();
                          const [lat, lon] = keys[e.key];
                          move(view.latitude + lat, view.longitude + lon);
                        }
                      }}
                      onPointerDown={(e) => {
                        e.preventDefault();
                        drag.current = { x: e.clientX, y: e.clientY, ...view };
                        e.currentTarget.setPointerCapture(e.pointerId);
                      }}
                      onPointerMove={(e) => {
                        if (drag.current) {
                          const scale = 360 / e.currentTarget.getBoundingClientRect().width / zoom;
                          move(
                            drag.current.latitude + (e.clientY - drag.current.y) * scale * 0.4,
                            drag.current.longitude - (e.clientX - drag.current.x) * scale * 0.55,
                          );
                        }
                      }}
                      onPointerUp={() => {
                        drag.current = undefined;
                      }}
                      onPointerCancel={() => {
                        drag.current = undefined;
                      }}
                    >
                      <defs>
                        <radialGradient id={`${uid}-ocean`} cx="32%" cy="25%" r="78%">
                          <stop stopColor="#83b1b5" />
                          <stop offset=".6" stopColor="#3c6a80" />
                          <stop offset="1" stopColor="#142e47" />
                        </radialGradient>
                        <radialGradient id={`${uid}-shade`} cx="26%" cy="22%" r="80%">
                          <stop stopColor="#fff9d9" stopOpacity=".25" />
                          <stop offset=".65" stopColor="#082136" stopOpacity="0" />
                          <stop offset="1" stopColor="#041522" stopOpacity=".7" />
                        </radialGradient>
                        <clipPath id={`${uid}-sphere`}>
                          <circle cx="180" cy="180" r="156" />
                        </clipPath>
                      </defs>
                      <ellipse cx="185" cy="345" rx="115" ry="9" fill="#17282c" opacity=".18" />
                      <circle
                        cx="180"
                        cy="180"
                        r="159"
                        fill="none"
                        stroke="#9ebbb3"
                        strokeOpacity=".35"
                        strokeWidth="2"
                      />
                      <circle cx="180" cy="180" r="156" fill={`url(#${uid}-ocean)`} />
                      <g clipPath={`url(#${uid}-sphere)`}>
                        {landPaths.map((path, i) => (
                          <path
                            key={i}
                            data-globe-land={i}
                            d={path}
                            fill="#9da77c"
                            stroke="#c3c6a2"
                            strokeWidth=".7"
                            vectorEffect="non-scaling-stroke"
                          />
                        ))}
                        <g fill="none" stroke="#d2e1cf" strokeOpacity=".22" strokeWidth=".6">
                          {graticulePaths.map((path, i) => (
                            <path
                              key={i}
                              data-globe-graticule={i}
                              d={path}
                              vectorEffect="non-scaling-stroke"
                            />
                          ))}
                        </g>
                        <circle cx="180" cy="180" r="156" fill={`url(#${uid}-shade)`} />
                        {isGlobalExtent(draft) ? (
                          <circle
                            data-globe-selection="global"
                            cx="180"
                            cy="180"
                            r="154"
                            fill="#f3c875"
                            fillOpacity=".07"
                            stroke="#f8da95"
                            strokeWidth="2.5"
                            vectorEffect="non-scaling-stroke"
                          />
                        ) : (
                          <path
                            data-globe-selection="regional"
                            d={borderPath}
                            fill="#f5ca76"
                            fillOpacity=".2"
                            stroke="#ffe0a0"
                            strokeWidth="2.5"
                            strokeLinejoin="round"
                            vectorEffect="non-scaling-stroke"
                          />
                        )}
                        <path
                          d={`M${180 - 7 / zoom} 180h${14 / zoom}M180 ${180 - 7 / zoom}v${14 / zoom}`}
                          stroke="#ffefd0"
                          strokeWidth="1.5"
                          vectorEffect="non-scaling-stroke"
                        />
                      </g>
                      <text x="180" y="17" textAnchor="middle" fill="currentColor" fontSize="11">
                        北
                      </text>
                      <text x="180" y="359" textAnchor="middle" fill="currentColor" fontSize="11">
                        南
                      </text>
                    </svg>
                    {zoom > 4 && (
                      <>
                        <div className="globe-local-caption">
                          <strong>局部定位</strong>
                          <span>
                            网格 {grid.step.toLocaleString('zh-CN', { maximumFractionDigits: 5 })}°
                          </span>
                        </div>
                        <div className="globe-locator">
                          <svg viewBox="0 0 360 360" role="img" aria-label="星球整体定位示意">
                            <circle cx="180" cy="180" r="156" fill={`url(#${uid}-ocean)`} />
                            {overviewLandPaths.map((path, i) => (
                              <path
                                key={i}
                                d={path}
                                fill="#9da77c"
                                stroke="#c3c6a2"
                                strokeWidth="2"
                              />
                            ))}
                            <circle cx="180" cy="180" r="156" fill={`url(#${uid}-shade)`} />
                            <circle
                              cx="180"
                              cy="180"
                              r="12"
                              fill="#f5ca76"
                              stroke="#fff1c8"
                              strokeWidth="4"
                            />
                          </svg>
                          <small>当前方位</small>
                        </div>
                      </>
                    )}
                  </div>
                  <div className="globe-zoom" role="group" aria-label="星球缩放">
                    <button
                      type="button"
                      className="icon-btn"
                      aria-label="缩小星球"
                      disabled={zoom <= 1}
                      onClick={() => setZoom((z) => nextGlobeZoom(z, -1))}
                    >
                      <Minus size={17} />
                    </button>
                    <output>
                      {zoom < 10
                        ? `${Math.round(zoom * 100)}%`
                        : `${zoom.toLocaleString('zh-CN', { maximumFractionDigits: 1 })}×`}
                    </output>
                    <button
                      type="button"
                      className="icon-btn"
                      aria-label="放大星球"
                      disabled={zoom >= maximumGlobeZoom}
                      onClick={() => setZoom((z) => nextGlobeZoom(z, 1))}
                    >
                      <Plus size={17} />
                    </button>
                  </div>
                  <div className="globe-view-actions">
                    <button
                      type="button"
                      className="btn"
                      disabled={isGlobalExtent(draft)}
                      onClick={focusSelection}
                    >
                      <Focus size={15} />
                      聚焦选区
                    </button>
                    <button type="button" className="text-btn" onClick={() => setZoom(1)}>
                      适合窗口
                    </button>
                  </div>
                  <div className="globe-directions">
                    {[
                      [ArrowLeft, '向西旋转', 0, -10],
                      [ArrowUp, '向北旋转', 5, 0],
                      [ArrowDown, '向南旋转', -5, 0],
                      [ArrowRight, '向东旋转', 0, 10],
                    ].map(([Icon, label, lat, lon]) => {
                      const Symbol = Icon as typeof ArrowLeft;
                      return (
                        <button
                          type="button"
                          className="icon-btn"
                          key={String(label)}
                          aria-label={String(label)}
                          onClick={() =>
                            move(
                              view.latitude + Number(lat) / zoom,
                              view.longitude + Number(lon) / zoom,
                            )
                          }
                        >
                          <Symbol size={17} />
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div className="globe-controls">
                  <div className="globe-presets" role="group" aria-label="星球范围预设">
                    {presets.map(([name, w, h]) => (
                      <button
                        type="button"
                        key={name}
                        className={`btn ${Math.abs(span - w) < 0.01 && Math.abs(height - h) < 0.01 ? 'primary' : ''}`}
                        onClick={() => {
                          if (name === '全球') {
                            setDraft({ ...globalWorldExtent });
                            setZoom(1);
                          } else {
                            resize(w, h, w <= 2);
                            if (w > 2) setZoom(1);
                          }
                        }}
                      >
                        {name}
                      </button>
                    ))}
                  </div>
                  <label>
                    东西覆盖范围
                    <input
                      type="range"
                      aria-label="东西覆盖范围"
                      min="0"
                      max="100"
                      step=".1"
                      value={logValue(span, 360)}
                      onChange={(e) => resize(logSpan(Number(e.target.value), 360), height)}
                    />
                    <small>更局部 ← → 更广阔</small>
                  </label>
                  <label>
                    南北覆盖范围
                    <input
                      type="range"
                      aria-label="南北覆盖范围"
                      min="0"
                      max="100"
                      step=".1"
                      value={logValue(height, 180)}
                      onChange={(e) => resize(span, logSpan(Number(e.target.value), 180))}
                    />
                    <small>更局部 ← → 更广阔</small>
                  </label>
                  <output aria-live="polite">{extentSummary(draft)}</output>
                  <p>
                    纬度影响冷热分布；高山仍会更冷。不选或选择“全球”时涵盖整个星球。实际距离沿用地图的地理范围设置。
                  </p>
                  <details>
                    <summary>查看换算后的经纬度</summary>
                    <p>
                      北缘 {draft.latitudeNorth.toFixed(2)}°，南缘 {draft.latitudeSouth.toFixed(2)}°
                      <br />
                      西缘 {draft.longitudeWest.toFixed(2)}°，东缘 {draft.longitudeEast.toFixed(2)}°
                      {draft.longitudeWest > draft.longitudeEast ? '（跨日期变更线）' : ''}
                    </p>
                  </details>
                </div>
              </div>
              <GlobeClimatePreview extent={draft} options={climate} />
              <footer>
                <button type="button" className="btn" onClick={close}>
                  取消
                </button>
                <button
                  type="button"
                  className="btn primary"
                  onClick={() => {
                    onChange(draft);
                    close();
                  }}
                >
                  使用这个范围
                </button>
              </footer>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
