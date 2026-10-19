import type { GeneratedGeography, GeographicPort } from '../../shared/geography';
import type { MapPoint, GeneratedSettlement } from '../../shared/cartography';
import type { ElevationField } from './elevation';
import { pointInPolygon } from './terrain';
import type { createWaterRouter } from './water-routing';
import { GEOGRAPHY_LIMITS } from '../../shared/geography';

/** Coverage is measured on the fine land surface, not on coarse region connectivity. */
export function ensureCoastalPorts(
  g: GeneratedGeography,
  surface: ElevationField,
  router: ReturnType<typeof createWaterRouter>,
  ports: GeographicPort[],
  sites: GeneratedSettlement[],
) {
  const { columns, rows, width, height, values } = surface,
    n = values.length,
    dx = width / columns,
    dy = height / rows;
  const component = new Int32Array(n).fill(-1),
    queue = new Int32Array(n);
  const point = (i: number) => ({
    x: ((i % columns) + 0.5) * dx,
    y: (Math.floor(i / columns) + 0.5) * dy,
  });
  const adjacent = (i: number) => {
    const x = i % columns,
      y = Math.floor(i / columns);
    return [
      x ? i - 1 : -1,
      x + 1 < columns ? i + 1 : -1,
      y ? i - columns : -1,
      y + 1 < rows ? i + columns : -1,
    ].filter((v) => v >= 0);
  };
  let components = 0;
  for (let start = 0; start < n; start++)
    if (values[start] > 0 && component[start] < 0) {
      let head = 0,
        tail = 1;
      queue[0] = start;
      component[start] = components;
      while (head < tail) {
        for (const next of adjacent(queue[head++]))
          if (values[next] > 0 && component[next] < 0) {
            component[next] = components;
            queue[tail++] = next;
          }
      }
      components++;
    }
  const at = (p: MapPoint) =>
    Math.max(0, Math.min(rows - 1, Math.floor(p.y / dy))) * columns +
    Math.max(0, Math.min(columns - 1, Math.floor(p.x / dx)));
  const bucketSize = Math.sqrt((width * height) / Math.max(1, g.cells.length)) * 1.8,
    bins = new Map<string, GeneratedGeography['cells']>();
  for (const cell of g.cells.filter((c) => c.land)) {
    const xs = cell.polygon.map((p) => p.x),
      ys = cell.polygon.map((p) => p.y);
    for (
      let y = Math.floor(Math.min(...ys) / bucketSize);
      y <= Math.floor(Math.max(...ys) / bucketSize);
      y++
    )
      for (
        let x = Math.floor(Math.min(...xs) / bucketSize);
        x <= Math.floor(Math.max(...xs) / bucketSize);
        x++
      ) {
        const key = `${x}:${y}`;
        if (!bins.has(key)) bins.set(key, []);
        bins.get(key)!.push(cell);
      }
  }
  const cellAt = (p: MapPoint) =>
    (bins.get(`${Math.floor(p.x / bucketSize)}:${Math.floor(p.y / bucketSize)}`) ?? []).find((c) =>
      pointInPolygon(p, c.polygon),
    );
  type Candidate = {
    point: MapPoint;
    harbor: MapPoint;
    cell: number;
    land: number;
    country?: string;
    score: number;
  };
  const candidates: Candidate[] = [];
  for (let i = 0; i < n; i++)
    if (values[i] > 0) {
      const waters = adjacent(i).filter((j) => values[j] <= -5 && router.isOcean(point(j)));
      if (!waters.length) continue;
      const p = point(i),
        cell = cellAt(p);
      if (!cell) continue;
      const harbor = point(waters.sort((a, b) => values[a] - values[b])[0]);
      const near = sites.length
        ? Math.min(...sites.map((s) => Math.hypot(s.x - p.x, s.y - p.y)))
        : 0;
      const rise = Math.max(...adjacent(i).map((j) => Math.abs(values[j] - values[i])));
      candidates.push({
        point: p,
        harbor,
        cell: cell.id,
        land: component[i],
        country: cell.country,
        score: values[i] * 0.35 + rise * 0.15 + near * 0.12 + Math.abs(waters.length - 2) * 10,
      });
    }
  const coveredLand = new Set(ports.map((p) => component[at(p.center)])),
    coveredCountries = new Set(ports.map((p) => g.cells[p.cell]?.country).filter(Boolean));
  const neededLand = new Set(candidates.map((c) => c.land)),
    neededCountries = new Set(candidates.map((c) => c.country).filter(Boolean));
  const priority = (candidate: Candidate) =>
    Number(!coveredLand.has(candidate.land)) +
    Number(Boolean(candidate.country && !coveredCountries.has(candidate.country)));
  while (
    [...neededLand].some((id) => !coveredLand.has(id)) ||
    [...neededCountries].some((id) => !coveredCountries.has(id))
  ) {
    // One dock may cover both an island and its country. Scan instead of
    // repeatedly sorting the complete coast on large archipelago maps.
    let candidate: Candidate | undefined,
      bestPriority = 0;
    for (const option of candidates) {
      const rank = priority(option);
      if (
        rank > bestPriority ||
        (rank === bestPriority && rank > 0 && (!candidate || option.score < candidate.score))
      ) {
        candidate = option;
        bestPriority = rank;
      }
    }
    if (!candidate) break;
    const chosen = candidate;
    if (ports.length >= GEOGRAPHY_LIMITS.ports)
      throw new Error('需保障的沿海地区过多，请减少群岛或区域密度。');
    const division = g.divisions.find((d) => d.kind === 'country' && d.id === chosen.country);
    const landArea = g.areas.find(
      (a) => (a.kind === 'continent' || a.kind === 'island') && a.cells.includes(chosen.cell),
    );
    const root = (division?.name ?? landArea?.name ?? '远岸').replace(
      /(?:共和国|王国|公国|领地|大陆|岛)$/,
      '',
    );
    let name = `${root}港`,
      suffix = 2;
    while (ports.some((p) => p.name === name)) name = `${root}${suffix++}港`;
    ports.push({
      id: `port_coast_${at(chosen.point)}`,
      name,
      center: chosen.point,
      harbor: chosen.harbor,
      cell: chosen.cell,
    });
    coveredLand.add(chosen.land);
    if (chosen.country) coveredCountries.add(chosen.country);
  }
  return { ports, landComponent: (p: MapPoint) => component[at(p)] };
}
