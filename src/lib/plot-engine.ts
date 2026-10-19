import type { Condition, Plot, PlotNode, StateVariable } from '../../shared/model';
export function evaluateCondition(
  condition: Condition,
  variables: Record<string, string>,
): boolean {
  if (!Object.hasOwn(variables, condition.variable)) return false;
  const value = variables[condition.variable];
  if (typeof value !== 'string') return false;
  switch (condition.operator) {
    case 'eq':
      return value === condition.value;
    case 'neq':
      return value !== condition.value;
    case 'contains':
      return value.includes(condition.value);
    default: {
      if (!value.trim() || !condition.value.trim()) return false;
      const a = Number(value),
        b = Number(condition.value);
      if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
      switch (condition.operator) {
        case 'gt':
          return a > b;
        case 'gte':
          return a >= b;
        case 'lt':
          return a < b;
        case 'lte':
          return a <= b;
      }
    }
  }
  return false;
}
export function availability(
  node: PlotNode,
  plot: Plot,
  variables: StateVariable[],
): { ready: boolean; reasons: string[] } {
  if (node.status === 'completed') return { ready: false, reasons: ['此节点已经完成'] };
  const values = Object.fromEntries(variables.map((v) => [v.name, v.value]));
  const incoming = plot.edges.filter((e) => e.target === node.id);
  const predecessor =
    incoming.length === 0 ||
    incoming.some((e) => plot.nodes.find((n) => n.id === e.source)?.status === 'completed');
  const matches = node.conditions.map((c) => evaluateCondition(c, values));
  const passed =
    matches.length === 0 ||
    (node.conditionMode === 'all' ? matches.every(Boolean) : matches.some(Boolean));
  return {
    ready: predecessor && passed,
    reasons: [
      ...(!predecessor ? ['需要先完成至少一个前置节点'] : []),
      ...(!passed ? ['触发条件尚未满足'] : []),
    ],
  };
}
