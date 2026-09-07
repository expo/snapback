// Astra bounded synthetic projection probe. No database/native/server execution.
import { resolve } from 'node:path';
const root = resolve(process.argv[2]);
const { ProjectionCache, projectState, unprojectState } = await import(root + '/snapback2/packages/snapback2/src/store/projection.ts');
const { emptyState } = await import(root + '/snapback2/packages/snapback2/src/store/range-store.ts');
const scenarios = [
  { name: 'existing-object-child-to-undefined', initial: { a: 1, b: 2 }, next: { a: undefined, b: 2 } },
  { name: 'new-array-undefined-slot', initial: [], next: [undefined, 'b'] },
  { name: 'existing-array-slot-to-undefined', initial: ['a', 'b'], next: [undefined, 'b'] },
  { name: 'trailing-array-hole', initial: ['a'], next: new Array(3) },
];
const results = [];
for (const scenario of scenarios) {
  const state = { ...emptyState(), futureMetadata: scenario.initial };
  const baseline = projectState(state), cache = new ProjectionCache(); cache.reset(baseline);
  const next = { ...state, futureMetadata: scenario.next };
  const expected = unprojectState(projectState(next));
  try {
    const { delta, committed } = cache.prepare(next);
    const projected = Object.fromEntries(Object.entries(baseline).map(([category, entries]) => {
      const records = new Map((entries as any[]).map(e => [e.key, e.value]));
      for (const key of delta[category].remove) records.delete(key);
      for (const { key, value } of delta[category].put) records.set(key, value);
      return [category, [...records].map(([key, value]) => ({ key, value }))];
    }));
    committed(); const actual = unprojectState(projected);
    results.push({ name: scenario.name, expected: expected.futureMetadata, actual: actual.futureMetadata,
      expectedLength: expected.futureMetadata?.length, actualLength: actual.futureMetadata?.length,
      equal: JSON.stringify(actual) === JSON.stringify(expected) });
  } catch (error) { results.push({ name: scenario.name, expected: expected.futureMetadata,
    error: { name: error.name, message: error.message } }); }
}
console.log(JSON.stringify({ root, runtime: process.version, bun: Bun.version, attribution: 'synthetic direct projection; exact exported source', results }, null, 2));
