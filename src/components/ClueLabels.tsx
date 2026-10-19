import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { Node } from '@xyflow/react';
import {
  placeClueLabels,
  type ClueLabelGeometry,
  type ClueLabelPlacement,
} from '../lib/clue-label-layout';

interface LabelContext {
  placements: Record<string, ClueLabelPlacement>;
  active?: string;
  setActive: (id?: string) => void;
  register: (id: string, geometry?: ClueLabelGeometry) => void;
  open: (id: string) => void;
}
const Context = createContext<LabelContext | undefined>(undefined);
export const useClueLabels = () => useContext(Context);

/** One frame batches measurements, without resetting ReactFlow nodes or the viewport. */
export function ClueLabelProvider({
  nodes,
  onOpen,
  children,
}: {
  nodes: Node[];
  onOpen: (id: string) => void;
  children: ReactNode;
}) {
  const geometry = useRef(new Map<string, ClueLabelGeometry>());
  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;
  const frame = useRef<number | undefined>(undefined);
  const alive = useRef(true);
  const [placements, setPlacements] = useState<Record<string, ClueLabelPlacement>>({});
  const [active, setActive] = useState<string>();
  const queue = useCallback(() => {
    if (!alive.current || frame.current !== undefined) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = undefined;
      const bounds = nodesRef.current.map((node) => ({
        x: node.position.x,
        y: node.position.y,
        width: node.measured?.width ?? (Number(node.style?.width) || 240),
        height: node.measured?.height ?? (Number(node.style?.height) || 120),
      }));
      setPlacements(placeClueLabels([...geometry.current.values()], bounds));
    });
  }, []);
  const register = useCallback(
    (id: string, edge?: ClueLabelGeometry) => {
      if (edge) geometry.current.set(id, edge);
      else geometry.current.delete(id);
      queue();
    },
    [queue],
  );
  useEffect(() => {
    queue();
  }, [nodes, queue]);
  useEffect(() => {
    alive.current = true;
    queue();
    return () => {
      alive.current = false;
      if (frame.current !== undefined) cancelAnimationFrame(frame.current);
      frame.current = undefined;
    };
  }, [queue]);
  return (
    <Context.Provider value={{ placements, active, setActive, register, open: onOpen }}>
      {children}
    </Context.Provider>
  );
}
