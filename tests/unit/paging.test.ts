import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PAGE_SIZE, paginate, parsePage } from '@/lib/paging';

test('page numbers from the URL: anything odd becomes page 1', () => {
  assert.equal(parsePage(undefined), 1);
  assert.equal(parsePage('3'), 3);
  assert.equal(parsePage(['4', '9']), 4);
  for (const bad of ['0', '-2', '1.5', 'abc', '', '99999999', 'Infinity']) assert.equal(parsePage(bad), 1, bad);
});

test('paginate: slices, counts pages, clamps past the end', () => {
  const all = Array.from({ length: 52 }, (_, i) => i);
  assert.deepEqual(paginate(all, 1).items, all.slice(0, PAGE_SIZE));
  assert.deepEqual({ ...paginate(all, 3), items: undefined }, { items: undefined, page: 3, pages: 3, total: 52 });
  assert.deepEqual(paginate(all, 3).items, [50, 51]);
  assert.equal(paginate(all, 9).page, 3, 'past the end shows the last page');
  assert.deepEqual(paginate([], 1), { items: [], page: 1, pages: 1, total: 0 });
  assert.deepEqual(paginate(all, 2, 10).items, all.slice(10, 20));
});
