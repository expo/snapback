import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { validateManifest } from '../packages/snapback3/src/resource/facts.js';
import { sha256 } from '../packages/evaluator/src/hash.js';
import { schemaDigest } from '../packages/evaluator/src/value-runtime.js';

const fixture = JSON.parse(readFileSync(new URL('../corpus/conditional-range-page-1.json', import.meta.url), 'utf8'));

const input = () => ({
  generation: sha256('manifest-custody'),
  schemaHash: schemaDigest(fixture.schema),
  schema: structuredClone(fixture.schema),
  programs: { [fixture.program.name]: { kind: 'query' as const, ir: structuredClone(fixture.program),
    certificate: structuredClone(fixture.certificate), planHash: fixture.certificate.plan_hash } },
  seq: 5,
});

test('manifest admission isolates caller mutation and retains validated immutable schema custody', () => {
  const supplied = input();
  const manifest = validateManifest(supplied);
  const admitted = JSON.stringify(manifest);
  expect(manifest).not.toBe(supplied);
  expect(manifest.schema).not.toBe(supplied.schema);
  expect(Object.isFrozen(manifest.schema)).toBe(true);
  expect(Object.isFrozen(manifest.schema.tables)).toBe(true);
  expect(schemaDigest(manifest.schema)).toBe(manifest.schemaHash);

  supplied.seq = 99;
  supplied.schema.tables = {};
  supplied.programs = {} as typeof supplied.programs;
  expect(JSON.stringify(manifest)).toBe(admitted);
  expect(schemaDigest(manifest.schema)).toBe(manifest.schemaHash);

  const corrupted = input();
  corrupted.schema.tables = {};
  expect(() => validateManifest(corrupted)).toThrow('invalid identity');
});
