import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const root = process.argv[2], output = process.argv[3];
const { PersistentRangeStore, ClientStore, tagWireRow } = await import(pathToFileURL(root + '/snapback2/packages/snapback2/dist/sqlite-test.mjs'));
const { RowImage, preparedDeliveryRows, imageCanonical } = await import(pathToFileURL(root + '/snapback2/packages/snapback2/dist/image-runtime.mjs'));
const { nativeR8: { halo } } = JSON.parse(readFileSync(root + '/snapback2/packages/evaluator/src/test-search-v5-fixtures.json', 'utf8'));
const schema = structuredClone(halo.program.schema);
Object.defineProperty(schema.tables.events.columns, '__proto__', { value: { Optional: { Text: { max: 20 } } }, enumerable: true });
schema.tables.events.indexes.byOptionalProto = { unique: false, components: [{ Column: '__proto__' }, { Column: 'id' }] };
const row = structuredClone(halo.first.rows.find(row => row.id === 'r0'));
const image = RowImage.prepare(schema, 'events', tagWireRow(schema, 'events', row.row));
const evaluator = new ClientStore(schema);
evaluator.put('events', image);
let saved;
const factory = () => new PersistentRangeStore({ carrier: 'json', open: async () => saved, replace: async state => { saved = structuredClone(state); }, close() {}, wipe: async () => {} });
let store = factory(); await store.open('dev:alice');
const delivery = { op: 'synthetic.read', args: {}, state: 'complete', seq: 1, data: { $row: { table: 'events', id: row.id } }, rows: [row], receipt: { ranges: [], absences: [], verdicts: [] } };
let rawError;
try { await store.commit({ schema, deliveries: [delivery] }); }
catch (error) { rawError = { name: error.name, message: error.message, code: error.code }; }
const refusedBeforePersistence = saved === undefined;
await store.commit({ schema, facts: { generation: 'synthetic', schemaHash: 'synthetic', authEpoch: 0 },
  programs: { synthetic: { generation: 'synthetic', schemaHash: 'synthetic', schema, programs: {} } },
  deliveries: [{ ...delivery, [preparedDeliveryRows]: [{ ...row, row: image }] }] });
const sparsePersisted = !Object.hasOwn(saved.rows['events\0r0'].row, '__proto__');
await store.close(); store = factory(); await store.open('dev:alice');
let coldError;
try { await store.coverage(); }
catch (error) { coldError = { name: error.name, message: error.message, code: error.code }; }
// coverage() does not construct CarrierIndex. answer() is the public cold boundary that does.
let coldAnswerError;
try { await store.answer('synthetic.read', {}); }
catch (error) { coldAnswerError = { name: error.name, message: error.message, code: error.code }; }
await store.close();
const result = { attribution: 'synthetic schema adding one optional ordinary indexed __proto__ column to the native fixture schema; direct public PersistentRangeStore boundary, no native emission or certification claim', rowCount: 1, inputMissingOwnProto: !Object.hasOwn(row.row, '__proto__'), evaluatorAdmitted: evaluator.byId('events', row.id) === image, exactSparseRoundtrip: imageCanonical(image) === imageCanonical(row.row), rawError, refusedBeforePersistence, sparsePersisted, coldError, coldAnswerError };
writeFileSync(output, JSON.stringify(result, null, 2) + '\n'); console.log(JSON.stringify(result));
