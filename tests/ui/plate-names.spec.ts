import { test, expect } from '@playwright/test';
import { createSeed } from '../../shared/seed';
import { addGeographicFixture } from '../fixtures/geographic';
import { generationSignature } from '../../src/lib/generated-map';
import { plateDisplayName } from '../../shared/plate-names';

test('numbered legacy plate names display naturally and edits persist without generation or changed geometry', async ({
  page,
  request,
}) => {
  const envelope = await (await request.get('/api/workspace')).json();
  const data = addGeographicFixture(createSeed());
  const map = data.maps[0],
    editor = map.editor!,
    g = editor.generated!.geography!;
  g.plates[0].name = '第1板块';
  editor.generated!.signature = generationSignature(
    editor.regions,
    map.width,
    map.height,
    editor.generation!,
    map.scaleKm,
    map.kind,
  );
  expect(
    (await request.put('/api/workspace', { data: { data, revision: envelope.revision } })).ok(),
  ).toBeTruthy();
  await page.goto('/');
  await page.getByRole('button', { name: '地图工坊', exact: true }).click();
  await page.getByRole('button', { name: '板块与大陆架', exact: true }).click();
  const expected = plateDisplayName(g.plates[0], g.seed);
  await expect(page.locator('[data-geographic-name="plate-0"]')).toContainText(expected);
  await page.getByRole('button', { name: '疆域分区', exact: true }).click();
  await page.getByText('板块名称 · 3', { exact: true }).click();
  await page.getByLabel('板块名称 1', { exact: true }).fill('月汐板块');
  await page.getByLabel('板块名称 1', { exact: true }).blur();
  await expect
    .poll(async () => {
      const current = await (await request.get('/api/workspace')).json();
      return current.data.maps[0].editor.generated.geography.plates[0].name;
    })
    .toBe('月汐板块');
  await page.reload();
  await page.getByRole('button', { name: '地图工坊', exact: true }).click();
  await page.getByRole('button', { name: '板块与大陆架', exact: true }).click();
  await expect(page.locator('[data-geographic-name="plate-0"]')).toContainText('月汐板块');
  const after = (await (await request.get('/api/workspace')).json()).data.maps[0].editor.generated;
  expect(after.signature).toBe(editor.generated!.signature);
  expect(after.objects).toEqual(editor.generated!.objects);
  expect(after.geography.cells).toEqual(g.cells);
});
