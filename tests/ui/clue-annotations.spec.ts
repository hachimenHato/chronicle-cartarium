import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { createSeed } from '../../shared/seed';
import type { Workspace, WorkspaceEnvelope } from '../../shared/model';

async function workspace(request: APIRequestContext): Promise<WorkspaceEnvelope> {
  const response = await request.get('/api/workspace');
  expect(new URL(response.url()).port).toBe('3311');
  const envelope: WorkspaceEnvelope = await response.json();
  expect(envelope.mode).toBe('demo');
  return envelope;
}

async function writeFixture(request: APIRequestContext, data: Workspace) {
  const old = await workspace(request);
  expect(
    (await request.put('/api/workspace', { data: { data, revision: old.revision } })).ok(),
  ).toBeTruthy();
}

/** Check real browser curve geometry against real label boxes, including zoom/portal transforms. */
async function expectClearAnnotations(page: Page, graph: string, count: number) {
  const root = page.locator(graph);
  await expect(root.locator('.clue-edge-label')).toHaveCount(count);
  await expect(root.locator('.clue-label-leader')).toHaveCount(count);
  await expect
    .poll(() =>
      root.evaluate((element) => {
        const labels = [...element.querySelectorAll<HTMLElement>('.clue-edge-label')];
        const paths = [...element.querySelectorAll<SVGPathElement>('.react-flow__edge-path')];
        const obstacles = paths.map((path) => {
          const matrix = path.getScreenCTM()!;
          const length = path.getTotalLength();
          const steps = Math.ceil(length / 2);
          return {
            id: path.id,
            points: Array.from({ length: steps + 1 }, (_, index) => {
              const point = path.getPointAtLength((length * index) / steps);
              return new DOMPoint(point.x, point.y).matrixTransform(matrix);
            }),
          };
        });
        const failures: string[] = [];
        for (const label of labels) {
          const bounds = label.getBoundingClientRect();
          if (getComputedStyle(label).visibility === 'hidden') failures.push('unplaced');
          // Clip each short curve segment against the label box, not just sample endpoints.
          for (const path of obstacles) {
            for (let i = 1; i < path.points.length; i++) {
              const a = path.points[i - 1],
                b = path.points[i];
              let from = 0,
                to = 1;
              let outside = false;
              for (const [start, delta, min, max] of [
                [a.x, b.x - a.x, bounds.left, bounds.right],
                [a.y, b.y - a.y, bounds.top, bounds.bottom],
              ]) {
                if (Math.abs(delta) < 1e-8) {
                  if (start < min || start > max) outside = true;
                } else {
                  const first = (min - start) / delta,
                    second = (max - start) / delta;
                  from = Math.max(from, Math.min(first, second));
                  to = Math.min(to, Math.max(first, second));
                }
              }
              if (!outside && from <= to) {
                failures.push(`${label.dataset.connectionId} covers ${path.id}`);
                break;
              }
            }
          }
          for (const node of element.querySelectorAll('.react-flow__node')) {
            const card = node.getBoundingClientRect();
            if (
              card.left < bounds.right &&
              bounds.left < card.right &&
              card.top < bounds.bottom &&
              bounds.top < card.bottom
            )
              failures.push(`${label.dataset.connectionId} covers a card`);
          }
          for (const other of labels) {
            if (other === label) continue;
            const note = other.getBoundingClientRect();
            if (
              note.left < bounds.right &&
              bounds.left < note.right &&
              note.top < bounds.bottom &&
              bounds.top < note.bottom
            )
              failures.push(`${label.dataset.connectionId} overlaps another note`);
          }
        }
        return failures;
      }),
    )
    .toEqual([]);
}

async function expectTrace(page: Page, graph: string, id: string) {
  const root = page.locator(graph);
  const label = root.locator(`.clue-edge-label[data-connection-id="${id}"]`);
  const path = root.locator(`.react-flow__edge-path[id="${id}"]`);
  await label.hover();
  await expect(path).toHaveCSS('stroke-width', '3px');
  await expect(path).toHaveCSS('stroke-opacity', '1');
  expect(
    await root
      .locator(`.react-flow__edge-path:not([id="${id}"])`)
      .evaluateAll((paths) =>
        paths.every((path) => Number(getComputedStyle(path).strokeOpacity) < 0.4),
      ),
  ).toBeTruthy();
  await page.mouse.move(10, 10);
  await expect(path).toHaveCSS('stroke-width', '1.7px');
  await label.focus();
  await expect(path).toHaveCSS('stroke-width', '3px');
  await label.evaluate((element) => element.blur());
  await expect(path).toHaveCSS('stroke-width', '1.7px');
}

async function dragWithoutFlicker(page: Page, graph: string, id: string) {
  const root = page.locator(graph);
  const node = root.locator(`.react-flow__node[data-id="${id}"]`);
  const before = await node.boundingBox();
  const viewport = root.locator('.react-flow__viewport');
  const view = await viewport.getAttribute('style');
  const grab = { x: before!.x + before!.width * 0.55, y: before!.y + before!.height * 0.8 };
  await page.mouse.move(grab.x, grab.y);
  await page.mouse.down();
  for (let step = 1; step <= 10; step++) {
    await page.mouse.move(grab.x + step * 3, grab.y + step * 4);
    await expect(viewport).toHaveAttribute('style', view!);
    expect(
      await root.locator('.react-flow__node, .clue-edge-label').evaluateAll((elements) =>
        elements.every((element) => {
          const style = getComputedStyle(element);
          return style.visibility !== 'hidden' && style.opacity !== '0';
        }),
      ),
    ).toBeTruthy();
  }
  await page.mouse.up();
  await page.mouse.move(10, 10);
}

const positions = [
  { x: 60, y: 140 },
  { x: 60, y: 460 },
  { x: 850, y: 140 },
  { x: 850, y: 460 },
];
const routes = [
  { id: 'cross_1', from: 0, to: 3, label: '盟约' },
  { id: 'cross_2', from: 1, to: 2, label: '秘密追踪' },
  { id: 'cross_3', from: 0, to: 2, label: '血缘与家族' },
  { id: 'cross_4', from: 1, to: 3, label: '共同调查' },
];

test('relationship callouts avoid actual crossing curves, trace the full route and survive label edits and dragging', async ({
  page,
  request,
}) => {
  const data = createSeed();
  const actors = data.entities.filter((entity) => entity.type === 'character');
  actors.push({ ...actors[0], id: 'e_fourth', name: '银灯使者' });
  data.entities.push(actors.at(-1)!);
  actors.forEach((actor, index) => {
    actor.graphPosition = positions[index];
  });
  data.relations = routes.map((route) => ({
    id: route.id,
    worldId: actors[0].worldId,
    sourceId: actors[route.from].id,
    targetId: actors[route.to].id,
    label: route.label,
    description: '交叉线路与注释验证',
    kind: 'ally',
  }));
  await writeFixture(request, data);
  await page.goto('/');
  await page.getByRole('button', { name: '人物关系', exact: true }).click();
  const graph = '.relation-graph';
  await expectClearAnnotations(page, graph, 4);
  await expectTrace(page, graph, 'cross_1');
  await page.getByRole('button', { name: '连接：盟约', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '编辑人物关系' });
  await dialog.getByLabel('关系名称').fill('共同守护银灯与北境的古老盟约');
  await dialog.getByRole('button', { name: '保存关系' }).click();
  await expectClearAnnotations(page, graph, 4);
  await dragWithoutFlicker(page, graph, actors[0].id);
  await expect
    .poll(
      async () =>
        (await workspace(request)).data.entities.find((e) => e.id === actors[0].id)!.graphPosition!
          .y,
    )
    .toBeGreaterThan(positions[0].y);
  await expectClearAnnotations(page, graph, 4);
  const saved = (await workspace(request)).data.entities.find(
    (e) => e.id === actors[0].id,
  )!.graphPosition;
  await page.screenshot({ path: '.runtime/clue-relationship-annotations.png' });
  await page.reload();
  await page.getByRole('button', { name: '人物关系', exact: true }).click();
  await expectClearAnnotations(page, graph, 4);
  expect(
    (await workspace(request)).data.entities.find((e) => e.id === actors[0].id)!.graphPosition,
  ).toEqual(saved);
});

test('plot callouts avoid actual crossing curves and remain editable, traceable and stable while dragging', async ({
  page,
  request,
}) => {
  const data = createSeed();
  const plot = data.plots[0];
  plot.layoutVersion = 1;
  plot.nodes.forEach((node, index) => Object.assign(node, positions[index]));
  plot.edges = routes.map((route) => ({
    id: route.id,
    source: plot.nodes[route.from].id,
    target: plot.nodes[route.to].id,
    label: route.label,
  }));
  await writeFixture(request, data);
  await page.goto('/');
  await page.getByRole('button', { name: '剧情编织', exact: true }).click();
  const graph = '.plot-graph';
  await expectClearAnnotations(page, graph, 4);
  await expectTrace(page, graph, 'cross_1');
  await page.getByRole('button', { name: '连接：盟约', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '编辑剧情路线' });
  await dialog.getByLabel('路线说明').fill('带着北境银灯抵达约定的古老遗迹');
  await dialog.getByRole('button', { name: '关闭', exact: true }).click();
  await expect
    .poll(async () => (await workspace(request)).data.plots[0].edges[0].label)
    .toBe('带着北境银灯抵达约定的古老遗迹');
  await expectClearAnnotations(page, graph, 4);
  await dragWithoutFlicker(page, graph, plot.nodes[0].id);
  await expect
    .poll(async () => (await workspace(request)).data.plots[0].nodes[0].y)
    .toBeGreaterThan(positions[0].y);
  await expectClearAnnotations(page, graph, 4);
  const saved = (await workspace(request)).data.plots[0].nodes[0];
  await page.screenshot({ path: '.runtime/clue-plot-annotations.png' });
  await page.reload();
  await page.getByRole('button', { name: '剧情编织', exact: true }).click();
  await expectClearAnnotations(page, graph, 4);
  const reloaded = (await workspace(request)).data.plots[0].nodes[0];
  expect({ x: reloaded.x, y: reloaded.y }).toEqual({ x: saved.x, y: saved.y });
});
