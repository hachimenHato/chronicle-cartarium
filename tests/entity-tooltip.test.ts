import assert from 'node:assert/strict';
import test from 'node:test';
import {
  tooltipPosition,
  tooltipReducer,
  type TooltipEntry,
} from '../src/lib/entity-tooltip-state';

const entry = (id: string, entityId = id, parentId?: string): TooltipEntry => ({
  id,
  entityId,
  parentId,
  locked: false,
  anchor: { left: 20, top: 30, right: 80, bottom: 50 },
});

test('hover previews disappear before locking, but locked cards survive pointer departure', () => {
  const opened = tooltipReducer([], { type: 'show', entry: entry('root') });
  assert.deepEqual(tooltipReducer(opened, { type: 'leave', id: 'root' }), []);
  const locked = tooltipReducer(opened, { type: 'lock', id: 'root' });
  assert.equal(locked[0].locked, true);
  assert.deepEqual(tooltipReducer(locked, { type: 'leave', id: 'root' }), locked);
});

test('nested previews require a locked parent and independently lock without closing ancestors', () => {
  let cards = tooltipReducer([], { type: 'show', entry: entry('root') });
  assert.equal(
    tooltipReducer(cards, { type: 'show', entry: entry('child', 'child', 'root') }).length,
    1,
  );
  cards = tooltipReducer(cards, { type: 'lock', id: 'root' });
  cards = tooltipReducer(cards, { type: 'show', entry: entry('child', 'child', 'root') });
  cards = tooltipReducer(cards, { type: 'lock', id: 'child' });
  cards = tooltipReducer(cards, {
    type: 'show',
    entry: entry('grandchild', 'grandchild', 'child'),
  });
  assert.equal(cards.length, 3);
  cards = tooltipReducer(cards, { type: 'leave', id: 'grandchild' });
  assert.deepEqual(
    cards.map((item) => item.id),
    ['root', 'child'],
  );
  assert.deepEqual(tooltipReducer(cards, { type: 'clear' }), []);
});

test('independent locked roots remain, repeated hover is idempotent, and Wiki cycles do not grow forever', () => {
  let cards = tooltipReducer([], { type: 'show', entry: entry('a') });
  cards = tooltipReducer(cards, { type: 'lock', id: 'a' });
  cards = tooltipReducer(cards, { type: 'show', entry: entry('b', 'b', 'a') });
  cards = tooltipReducer(cards, { type: 'lock', id: 'b' });
  assert.equal(tooltipReducer(cards, { type: 'show', entry: entry('cycle', 'a', 'b') }).length, 2);
  assert.equal(tooltipReducer(cards, { type: 'show', entry: entry('b') }).length, 2);
  cards = tooltipReducer(cards, { type: 'show', entry: entry('separate') });
  assert.deepEqual(
    cards.map((item) => item.id),
    ['a', 'b', 'separate'],
  );
  assert.equal(
    tooltipReducer(cards, { type: 'show', entry: entry('orphan', 'orphan', 'missing') }).length,
    3,
  );
});

test('viewport positioning flips near screen edges and clamps on narrow screens', () => {
  const anchor = { left: 950, top: 700, right: 990, bottom: 730 };
  assert.deepEqual(
    tooltipPosition(anchor, { width: 360, height: 400 }, { width: 1000, height: 800 }, false),
    { left: 630, top: 290 },
  );
  assert.deepEqual(
    tooltipPosition(anchor, { width: 360, height: 400 }, { width: 1000, height: 800 }, true),
    { left: 580, top: 390 },
  );
  assert.deepEqual(
    tooltipPosition(anchor, { width: 370, height: 400 }, { width: 390, height: 600 }, true),
    { left: 10, top: 190 },
  );
});
