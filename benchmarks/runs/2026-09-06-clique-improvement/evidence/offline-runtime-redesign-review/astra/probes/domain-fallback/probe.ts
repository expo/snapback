import { canonicalProgramJson as before } from './before/certificate-identity.ts';
import { canonicalProgramJson as current } from './source/certificate-identity.ts';
import { sha256 } from './source/hash.ts';

// Direct canonical-identity API probe. Synthetic malformed domains are not native programs.
const cases = [
  { name: 'one-character-string', domain: 'x' },
  { name: 'one-element-array', domain: [{ Literal: 'Null' }] },
  { name: 'unknown-object-control', domain: { FutureDomain: { z: 1, a: 2 } } },
  { name: 'known-domain-control', domain: { LiteralRange: { end_exclusive: 1, start: 0 } } },
  { name: 'empty-object-refusal-control', domain: {} },
];
const call = (fn: typeof before, input: unknown) => {
  try { const value = fn(input); return { value, sha256: sha256(value) }; }
  catch (error: any) { return { error: { name: error.name, code: error.code, message: error.message } }; }
};
const results = cases.map(({ name, domain }) => {
  const input = { name: 'q', kind: 'Query', args: {}, read_time_granularity_ms: null,
    body: [{ For: { binding: 'item', domain, body: [] } }, { Return: { Literal: 'Null' } }] };
  const parent = call(before, structuredClone(input)), candidate = call(current, structuredClone(input));
  return { name, input, parent, candidate, equal: JSON.stringify(parent) === JSON.stringify(candidate) };
});
console.log(JSON.stringify({ scope: 'canonicalProgramJson only; no engine, native owner, build, or product suite', results }, null, 2));
