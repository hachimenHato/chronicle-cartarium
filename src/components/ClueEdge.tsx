import {
  BaseEdge,
  EdgeLabelRenderer,
  getSmoothStepPath,
  Position,
  type EdgeProps,
} from '@xyflow/react';
import { roundedCluePath, type GraphPoint, type ConnectionLane } from '../lib/graph-layout';
import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { useClueLabels } from './ClueLabels';
export function ClueEdge(props: EdgeProps) {
  const route = props.data?.route as GraphPoint[] | undefined;
  const lane = props.data?.lane as ConnectionLane | undefined;
  const horizontalSource =
    props.sourcePosition === Position.Left || props.sourcePosition === Position.Right;
  const horizontalTarget =
    props.targetPosition === Position.Left || props.targetPosition === Position.Right;
  const start = {
      x: props.sourceX + (horizontalSource ? 0 : (lane?.sourceOffset ?? 0)),
      y: props.sourceY + (horizontalSource ? (lane?.sourceOffset ?? 0) : 0),
    },
    end = {
      x: props.targetX + (horizontalTarget ? 0 : (lane?.targetOffset ?? 0)),
      y: props.targetY + (horizontalTarget ? (lane?.targetOffset ?? 0) : 0),
    };
  const usesRoute =
    route &&
    route.length > 1 &&
    Math.hypot(props.sourceX - route[0].x, props.sourceY - route[0].y) < 22 &&
    Math.hypot(props.targetX - route.at(-1)!.x, props.targetY - route.at(-1)!.y) < 22;
  const [fallback, labelX, labelY] = getSmoothStepPath({
    sourceX: start.x,
    sourceY: start.y,
    targetX: end.x,
    targetY: end.y,
    sourcePosition: props.sourcePosition,
    targetPosition: props.targetPosition,
    borderRadius: 20,
    offset: 40,
    centerX: (start.x + end.x) / 2 + (lane?.corridor ?? 0),
  });
  const returnLane =
    !usesRoute &&
    props.sourcePosition === Position.Right &&
    props.targetPosition === Position.Left &&
    end.x < start.x + 60;
  const returnY =
    Math.min(start.y, end.y) - (lane?.clearance ?? 96) - Math.abs(lane?.corridor ?? 0) * 0.4;
  const returnPoints = [
    start,
    { x: start.x + 40, y: start.y },
    { x: start.x + 40, y: returnY },
    { x: end.x - 40, y: returnY },
    { x: end.x - 40, y: end.y },
    end,
  ];
  const middle = usesRoute
    ? route[Math.floor(route.length / 2)]
    : returnLane
      ? { x: (start.x + end.x) / 2, y: returnY }
      : { x: labelX, y: labelY };
  const path = usesRoute
    ? roundedCluePath([start, ...route.slice(1, -1), end])
    : returnLane
      ? roundedCluePath(returnPoints)
      : fallback;
  const labels = useClueLabels();
  const register = labels?.register;
  const labelElement = useRef<HTMLButtonElement | null>(null);
  const [labelSize, setLabelSize] = useState({ width: 0, height: 0 });
  const measureLabel = useCallback((element: HTMLButtonElement | null) => {
    labelElement.current = element;
    if (!element) return;
    const width = element.offsetWidth,
      height = element.offsetHeight;
    setLabelSize((old) => (old.width === width && old.height === height ? old : { width, height }));
  }, []);
  useLayoutEffect(() => {
    const element = labelElement.current;
    if (!element) return;
    // Text edits and late-loading fonts can change the unscaled label box in the portal.
    const observer = new ResizeObserver(() => measureLabel(element));
    observer.observe(element);
    measureLabel(element);
    return () => observer.disconnect();
  }, [props.label, measureLabel]);
  // Keep the previous measured route while a drag updates its geometry. Removing
  // it on every path change can briefly hide the annotation between frames.
  useLayoutEffect(() => () => register?.(props.id), [props.id, register]);
  useLayoutEffect(() => {
    if (!register) return;
    const element = document.getElementById(props.id);
    if (!(element instanceof SVGPathElement)) return;
    const length = element.getTotalLength();
    if (!Number.isFinite(length) || length < 1) return;
    const count = Math.max(16, Math.min(128, Math.ceil(length / 12)));
    const points = Array.from({ length: count + 1 }, (_, index) => {
      const point = element.getPointAtLength((length * index) / count);
      return { x: point.x, y: point.y };
    });
    register(props.id, {
      id: props.id,
      points,
      preferred: middle,
      width: props.label
        ? labelSize.width || Math.min(180, String(props.label).length * 11 + 16)
        : 0,
      height: props.label ? labelSize.height || 26 : 0,
    });
  }, [
    props.id,
    props.label,
    path,
    middle.x,
    middle.y,
    labelSize.width,
    labelSize.height,
    register,
  ]);
  const placement = labels?.placements[props.id];
  const active = labels?.active === props.id;
  return (
    <>
      <g
        onMouseEnter={() => labels?.setActive(props.id)}
        onMouseLeave={() => labels?.setActive(undefined)}
      >
        <BaseEdge
          id={props.id}
          path={path}
          markerEnd={props.markerEnd}
          style={{
            ...props.style,
            strokeWidth: active
              ? Math.max(3, Number(props.style?.strokeWidth) || 1.7)
              : props.style?.strokeWidth,
            strokeOpacity: labels?.active && !active ? 0.28 : 1,
          }}
          interactionWidth={24}
        />
        {placement && props.label && (
          <>
            <path
              className="clue-label-leader"
              d={`M${placement.anchor.x},${placement.anchor.y}L${placement.leaderEnd.x},${placement.leaderEnd.y}`}
              fill="none"
              stroke={props.style?.stroke ?? '#82998c'}
              strokeWidth={active ? 1.5 : 1}
              strokeDasharray="2 3"
              opacity={labels?.active && !active ? 0.2 : 0.7}
              pointerEvents="none"
            />
            <circle
              cx={placement.anchor.x}
              cy={placement.anchor.y}
              r={active ? 3 : 1.9}
              fill={props.style?.stroke ?? '#82998c'}
              stroke="var(--paper)"
              strokeWidth="1"
              pointerEvents="none"
            />
          </>
        )}
      </g>
      {props.label && (
        <EdgeLabelRenderer>
          <button
            type="button"
            ref={measureLabel}
            className={`clue-edge-label nodrag nopan ${active ? 'active' : ''} ${placement && !placement.clear ? 'is-crowded' : ''}`}
            data-connection-id={props.id}
            data-label-clear={placement?.clear}
            aria-label={`连接：${String(props.label)}`}
            title={typeof props.label === 'string' ? props.label : undefined}
            onMouseEnter={() => labels?.setActive(props.id)}
            onMouseLeave={() => labels?.setActive(undefined)}
            onFocus={() => labels?.setActive(props.id)}
            onBlur={() => labels?.setActive(undefined)}
            onClick={() => labels?.open(props.id)}
            style={{
              transform: `translate(-50%, -50%) translate(${placement?.x ?? middle.x}px,${placement?.y ?? middle.y - 28}px)`,
              visibility: labels && !placement ? 'hidden' : undefined,
              opacity: labels?.active && !active ? 0.5 : 1,
            }}
          >
            {props.label}
          </button>
        </EdgeLabelRenderer>
      )}
    </>
  );
}
export const clueEdgeTypes = { clue: ClueEdge };
