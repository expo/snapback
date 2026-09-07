// Synthetic bounded probes against frozen packet source. Not native emission.
import { pathToFileURL } from 'node:url';
const src = '/Users/ccheever/clique-improvement/reviews/search-twin-image-dedup-r1/packet/source/snapback2/packages';
const vr = await import(pathToFileURL(src + '/evaluator/src/value-runtime.ts').href);
const ri = await import(pathToFileURL(src + '/evaluator/src/row-image.ts').href);
const fail = (path, detail) => { const e = new Error(`${path}: ${detail}`); e.path = path; throw e; };
const schema = { tables: { t: { columns: {
  id: 'Id',
  body: { Text: { max: 20 } },
  note: { Optional: { Text: { max: 20 } } },
}, indexes: {} } } };

const results = {};
const catcher = (fn) => { try { return { ok: true, value: fn() }; } catch (e) { return { ok: false, name: e.constructor.name, code: e.code, path: e.path, message: e.message }; } };

// Extra own __proto__ on a row whose schema has no such column.
const extra = { id: 'a', body: 'x' };
Object.defineProperty(extra, '__proto__', { value: 'pollute', enumerable: true, configurable: true, writable: true });
results.extraProtoOwn = Object.hasOwn(extra, '__proto__');
results.extraProtoEntries = Object.entries(extra).map(([k]) => k);
results.extraProtoDecode = catcher(() => vr.rowFromWire(schema, 't', extra, fail));

// Extra constructor own field.
const extraCtor = { id: 'a', body: 'x', constructor: 'nope' };
results.extraCtorDecode = catcher(() => vr.rowFromWire(schema, 't', extraCtor, fail));

// Legal omitted optional vs explicit null equality.
const omitted = ri.RowImage.fromWire(schema, 't', { id: 'a', body: 'x' }, fail);
const explicit = ri.RowImage.fromWire(schema, 't', { id: 'a', body: 'x', note: null }, fail);
results.omittedVsNull = {
  equal: ri.RowImage.equal(omitted, explicit),
  digestEqual: ri.RowImage.digest(omitted) === ri.RowImage.digest(explicit),
  canonicalEqual: ri.imageCanonical(omitted) === ri.imageCanonical(explicit),
};

// Frozen external tagged input isolation.
const tagged = Object.freeze({ Row: Object.freeze({ id: { Id: 'a' }, body: { String: 'x' } }) });
const prepared = ri.RowImage.prepare(schema, 't', tagged);
results.frozenIsolation = {
  isRowImage: ri.RowImage.is(prepared),
  sameRef: prepared === tagged,
  taggedUnchanged: tagged.Row.body.String === 'x',
};

try { tagged.Row.body.String = 'mut'; results.frozenIsolation.mutateThrew = false; }
catch { results.frozenIsolation.mutateThrew = true; }
results.frozenIsolation.inputAfter = tagged.Row.body.String;
results.frozenIsolation.preparedAfter = ri.RowImage.wire(prepared).body;
results.frozenIsolation.preparedStillX = ri.imageCanonical(prepared).includes('"x"') && !ri.imageCanonical(prepared).includes('mut');

// Argument format:null vs column format:null.
const argDesc = { Text: { max: 20, format: null } };
results.argFormatNull = catcher(() => vr.validateTypedValue(argDesc, { String: 'ok' }, 'arg x', true));
results.colFormatNull = catcher(() => vr.validateTypedValue(argDesc, { String: 'ok' }, 't.body', false));

// Present undefined metadata-like put through JSON.stringify.
results.jsonUndefinedNew = JSON.stringify(undefined);
results.jsonUndefinedParseThrows = catcher(() => JSON.parse(JSON.stringify(undefined)));

console.log(JSON.stringify(results, null, 2));
