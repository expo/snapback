import assert from 'node:assert/strict';

import {
  createSnapbackProviderDiagnostic,
  createSnapbackProviderDiagnosticCollector,
  createSnapbackProviderDiagnosticError,
} from './diagnostics.mjs';

const source = {
  file: 'demos/partiful-matrix/surfaces/contract/event.contract',
  line: 30,
  column: 5,
  generatedFrom: 'snapback/generated/api.mjs#rsvp',
};
const diagnostic = createSnapbackProviderDiagnostic(
  'SNAPBACK_CONTRACT_MUTATION_FAILED',
  'the RSVP action was rejected',
  {
    provider: 'snapback-partitime',
    owner: 'provider',
    mutationName: 'rsvp',
    source,
    details: { rollbackReason: 'event_full' },
  },
);

assert.equal(diagnostic.provider, 'snapback-partitime');
assert.equal(diagnostic.owner, 'provider');
assert.equal(diagnostic.mutationName, 'rsvp');
assert.deepEqual(diagnostic.source, source);
assert.equal(diagnostic.details.target_surface, 'Contract/Exact');

const error = createSnapbackProviderDiagnosticError(
  diagnostic.code,
  diagnostic.message,
  {
    provider: diagnostic.provider,
    owner: diagnostic.owner,
    mutationName: diagnostic.mutationName,
    source: diagnostic.source,
  },
);
assert.equal(error.code, diagnostic.code);
assert.equal(error.diagnostic.source.line, 30);
assert.equal(error.source, error.diagnostic.source, 'query refusal can recover the source locus');

const collector = createSnapbackProviderDiagnosticCollector({ rootId: 'partitime-root' });
const first = collector.record(error, {
  instanceId: 'rsvp-binding-1',
  causeCode: 'event_full',
});
const repeated = collector.record(error, {
  instanceId: 'rsvp-binding-1',
  causeCode: 'event_full',
});
assert.equal(first, repeated);
assert.equal(collector.diagnostics().length, 1, 'one root report replaces per-tick repetition');
assert.equal(first.occurrences, 2);
assert(first.diagnosticDedupeKey.includes('rsvp-binding-1'));

collector.record(error, {
  instanceId: 'rsvp-binding-1',
  causeCode: 'network_timeout',
});
assert.equal(collector.diagnostics().length, 2, 'a distinct cause remains independently inspectable');

console.log('snapback Contract diagnostic handoff: source, ownership, and root dedupe pass');
