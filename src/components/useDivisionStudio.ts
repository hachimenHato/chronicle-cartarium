import { useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent } from 'react';
import { makeId, type AtlasMap, type Entity } from '../../shared/model';
import {
  DIVISION_LIMITS,
  type DivisionKind,
  type DivisionPaint,
  type MapDivision,
  type MapPoint,
} from '../../shared/cartography';
import { createEditorData } from '../lib/cartography';
import { divisionAt } from '../lib/divisions';
import { snapDivisionToLand } from '../lib/land-snap';
import { useFrameState } from '../lib/useFrameState';

const empty: DivisionPaint[] = [];
export function useDivisionStudio(
  map: AtlasMap | undefined,
  update: (patch: Partial<AtlasMap>) => void,
  active: boolean,
  width: number,
) {
  const [kind, setKindState] = useState<DivisionKind>('country');
  const [selectedId, setSelectedId] = useState('');
  const [tool, setToolState] = useState<'paint' | 'erase' | 'lasso' | 'vertices' | 'pan'>('paint');
  const [roughness, setRoughness] = useState(0.3);
  const [strokeId, setStrokeId] = useState('');
  const [vertexIndex, setVertexIndex] = useState(0);
  const [draft, setDraft] = useFrameState<DivisionPaint | undefined>(undefined);
  const [notice, setNotice] = useState('');
  const drag = useRef<{ stroke: DivisionPaint; vertex?: number } | undefined>(undefined);
  const selected =
    map?.editor?.divisions?.find((d) => d.id === selectedId && d.kind === kind) ??
    map?.editor?.divisions?.find((d) => d.kind === kind);
  const paints = map?.editor?.divisionPaint ?? empty;
  const strokes = paints.filter((s) => s.divisionId === selected?.id);
  const stroke = strokes.find((s) => s.id === strokeId) ?? strokes.at(-1);
  const editor = map?.editor ?? createEditorData();
  function cancel() {
    drag.current = undefined;
    setDraft(undefined);
  }
  useEffect(() => {
    cancel();
    setStrokeId('');
    setSelectedId('');
  }, [map?.id]);
  useEffect(() => {
    if (!active) cancel();
  }, [active]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (active && e.key === 'Escape') cancel();
    };
    const blur = () => cancel();
    window.addEventListener('keydown', key);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', key);
      window.removeEventListener('blur', blur);
    };
  }, [active]);
  const previewMap = useMemo(
    () =>
      map && draft
        ? {
            ...map,
            editor: {
              ...(map.editor ?? createEditorData()),
              divisionPaint: paints.some((s) => s.id === draft.id)
                ? paints.map((s) => (s.id === draft.id ? draft : s))
                : [...paints, draft],
            },
          }
        : map,
    [map, draft, paints],
  );
  function commitPaint(value: DivisionPaint) {
    const next = paints.some((s) => s.id === value.id)
      ? paints.map((s) => (s.id === value.id ? value : s))
      : [...paints, value];
    if (
      next.length > DIVISION_LIMITS.strokes ||
      next.reduce((n, s) => n + s.points.length, 0) > DIVISION_LIMITS.totalPoints
    ) {
      setNotice('分区编辑达到容量上限，请删除不需要的边界笔迹后重试。');
      return;
    }
    update({ editor: { ...editor, divisionPaint: next } });
    setStrokeId(value.id);
    setNotice('边界已更新，可撤销；地图缩放后可继续细修。');
  }
  function setKind(value: DivisionKind) {
    cancel();
    setKindState(value);
    setSelectedId('');
    setStrokeId('');
    setVertexIndex(0);
  }
  function setTool(value: typeof tool) {
    cancel();
    setToolState(value);
  }
  function patchDivision(patch: Partial<MapDivision>) {
    if (selected)
      update({
        editor: {
          ...editor,
          divisions: editor.divisions?.map((d) => (d.id === selected.id ? { ...d, ...patch } : d)),
        },
      });
  }
  function add(entity: Entity, create?: (map: AtlasMap) => void) {
    if (!map) return false;
    if ((editor.divisions?.length ?? 0) >= DIVISION_LIMITS.divisions) {
      setNotice('每张地图最多 96 个分区。');
      return false;
    }
    const colors = ['#a36550', '#587b7f', '#82854d', '#886c97', '#b09143', '#49765c'];
    const division: MapDivision = {
      id: makeId('division'),
      kind,
      entityId: entity.id,
      name: entity.name,
      color: colors[(editor.divisions?.length ?? 0) % colors.length],
      visible: true,
    };
    const next = { ...editor, divisions: [...(editor.divisions ?? []), division] };
    if (create) create({ ...map, editor: next });
    else update({ editor: next });
    setSelectedId(division.id);
    setTool('paint');
    setNotice('已关联条目，拖动涂抹领地；悬停地图名称1秒可看摘要。');
    return true;
  }
  function snapToLand(coastlines: MapPoint[][], distance: number) {
    if (!map || !selected) return;
    cancel();
    try {
      const result = snapDivisionToLand(map, selected.id, coastlines, distance);
      if (!result.changed) {
        setNotice('范围边缘没有在设定距离内找到陆地边缘，无需修改。');
        return;
      }
      update({ editor: { ...editor, divisionPaint: result.paints } });
      setNotice(
        `已将 ${result.changed} 笔范围的边缘吸附到陆地；超出距离的边界保留。可撤销或继续精修。`,
      );
    } catch (error) {
      setNotice((error as Error).message);
    }
  }
  function remove() {
    if (!selected) return;
    update({
      editor: {
        ...editor,
        divisions: editor.divisions?.filter((d) => d.id !== selected.id),
        divisionPaint: paints.filter((s) => s.divisionId !== selected.id),
      },
    });
    cancel();
    setSelectedId('');
    setStrokeId('');
  }
  function pointerDown(event: PointerEvent, p: MapPoint) {
    if (!active || event.button !== 0 || tool === 'pan') return false;
    if (event.ctrlKey || event.metaKey) return true;
    if (tool === 'vertices') {
      const found = map && divisionAt(map, kind, p);
      if (found) {
        setSelectedId(found.id);
        setStrokeId('');
      }
      return true;
    }
    if (!selected) {
      setNotice('请先选择对应设定条目并添加分区。');
      return true;
    }
    if (!selected.visible) {
      setNotice('请先显示该分区，再修改边界。');
      return true;
    }
    const value: DivisionPaint = {
      id: makeId('border'),
      divisionId: selected.id,
      operation: tool === 'erase' ? 'erase' : 'paint',
      geometry: tool === 'lasso' ? 'polygon' : 'brush',
      points: [p],
      width,
      roughness,
      seed: Math.floor(Math.random() * 4294967295),
    };
    drag.current = { stroke: value };
    setDraft(value);
    return true;
  }
  function pointerMove(p: MapPoint) {
    if (!active || !drag.current) return false;
    const current = drag.current;
    if (current.vertex !== undefined)
      current.stroke = {
        ...current.stroke,
        points: current.stroke.points.map((point, i) => (i === current.vertex ? p : point)),
      };
    else {
      let points = current.stroke.points;
      if (Math.hypot(p.x - points.at(-1)!.x, p.y - points.at(-1)!.y) < 2) return true;
      if (points.length >= DIVISION_LIMITS.points)
        points = points.filter((_, i) => i % 2 === 0 || i === points.length - 1);
      current.stroke = { ...current.stroke, points: [...points, p] };
    }
    setDraft(current.stroke);
    return true;
  }
  function pointerUp() {
    if (!drag.current) return false;
    const value = drag.current.stroke;
    if (value.geometry !== 'polygon' || value.points.length >= 3) commitPaint(value);
    else setNotice('圈选需要至少三个点，请按住鼠标沿边界画一圈。');
    cancel();
    return true;
  }
  function startVertex(event: PointerEvent<SVGCircleElement>, index: number) {
    event.stopPropagation();
    if (event.button !== 0 || !stroke) return;
    event.currentTarget.ownerSVGElement?.setPointerCapture(event.pointerId);
    setVertexIndex(index);
    drag.current = { stroke, vertex: index };
    setDraft(stroke);
  }
  return {
    kind,
    setKind,
    selected,
    select: (id: string) => {
      cancel();
      setSelectedId(id);
      setStrokeId('');
    },
    tool,
    setTool,
    roughness,
    setRoughness,
    strokes,
    stroke,
    setStrokeId,
    vertexIndex,
    setVertexIndex,
    draft,
    previewMap,
    notice,
    add,
    snapToLand,
    remove,
    patchDivision,
    commitPaint,
    cancel,
    pointerDown,
    pointerMove,
    pointerUp,
    startVertex,
    deleteStroke: () => {
      if (stroke) {
        update({ editor: { ...editor, divisionPaint: paints.filter((s) => s.id !== stroke.id) } });
        cancel();
        setStrokeId('');
      }
    },
  };
}
export type DivisionStudio = ReturnType<typeof useDivisionStudio>;
