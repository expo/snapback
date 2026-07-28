import assert from 'node:assert/strict';
import { parseSearchQueryV1, search } from './search.mjs';

assert.deepEqual(parseSearchQueryV1('checkout "api latency" -resolved'), {
  all: [
    { Term: { value: 'checkout' } },
    { Phrase: { values: ['api latency'] } },
    { Not: { Term: { value: 'resolved' } } },
  ],
});
assert.deepEqual(parseSearchQueryV1('title:check*', { fields: ['title'] }), {
  all: [{ Prefix: { value: 'check', field: 'title' } }],
});
assert.deepEqual(parseSearchQueryV1('title:"api latency"', { fields: ['title'] }), {
  all: [{ Phrase: { values: ['api latency'], field: 'title' } }],
});
assert.deepEqual(parseSearchQueryV1('checkout OR payment OR latency'), {
  all: [{
    Any: [
      { Term: { value: 'checkout' } },
      { Term: { value: 'payment' } },
      { Term: { value: 'latency' } },
    ],
  }],
});
assert.deepEqual(search.all(search.term('one'), search.filter('status', 'open')), {
  all: [
    { Term: { value: 'one' } },
    { Filter: { field: 'status', op: 'eq', value: 'open' } },
  ],
});
assert.throws(() => parseSearchQueryV1('"unfinished'), /SNAPBACK_SEARCH_QUERY_INVALID/u);
assert.throws(() => parseSearchQueryV1('-hidden'), /positive atom/u);
assert.throws(() => parseSearchQueryV1('aa* bb'), /last positive/u);
assert.throws(() => parseSearchQueryV1('-aa* bb'), /last positive/u);
assert.throws(() => parseSearchQueryV1('aa OR bb cc OR dd'), /independent OR groups/u);
assert.throws(
  () => parseSearchQueryV1(`alpha${String.fromCharCode(0xd800)}beta`),
  /unpaired UTF-16 surrogate/u,
);
assert.throws(
  () => parseSearchQueryV1(`alpha${String.fromCharCode(0xdc00)}beta`),
  /unpaired UTF-16 surrogate/u,
);
assert.deepEqual(parseSearchQueryV1('emoji 😀'), {
  all: [
    { Term: { value: 'emoji' } },
    { Term: { value: '😀' } },
  ],
});

process.stdout.write('snapback-client search parser: pass\n');
