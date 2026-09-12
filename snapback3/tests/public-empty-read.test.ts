import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { ClientStore as ProductionStore } from '../packages/evaluator/src/store';
import { CURRENT_EVALUATOR, CURRENT_VALUE_MODEL_VERSION } from '../packages/evaluator/src/runner';
import { canonicalProgramJson, canonicalSchemaJson } from '../packages/evaluator/src/certificate-identity';
import { sha256 } from '../packages/evaluator/src/hash';
import { canonicalValues, scopedRuleHash, wireJson } from '../packages/evaluator/src/value-runtime';
import type { Context } from '../packages/evaluator/src/types';

// Synthetic evaluator controls adapted from S2 2d847b7e9ef7. These bind fixture
// identities; native-issued certificates remain covered by the shared corpus.
const certificate = (schema: any, program: any) => ({
  value_model_version: CURRENT_VALUE_MODEL_VERSION, evaluator_version: CURRENT_EVALUATOR,
  schema_hash: sha256(canonicalSchemaJson(schema)), plan_hash: sha256(canonicalProgramJson(program)),
});
class ClientStore extends ProductionStore {
  override reexecute(program: any, context: Context) {
    return super.reexecute(program, context, certificate(this.schema, program));
  }
  override applyMutation(program: any, context: Context) {
    return super.applyMutation(program, context, false, certificate(this.schema, program));
  }
}

// @ref LLP 1012#6-reads-offline — readable group exhaustion proves a point result, not primary write authority.
test('exhausted public unique ranges prove read absence without granting negative write authority', () => {
  const index = (name: string) => ({ components: [{ Column: name }], unique: true });
  const table = { columns: { id: 'Id', target: 'Principal', value: 'Int' },
    indexes: { byId: index('id'), byTarget: index('target') },
    rules: { read: 'Allow', insert: 'Deny', update: 'Deny', delete: 'Deny' }, constraints: [], retain: 'until-revoked' };
  const schema: any = { tables: { counts: table }, maintains: [], channels: {}, schedules: [], effects: [], auth: { password: false, guests: false } };
  const schema_hash = sha256(canonicalSchemaJson(schema)), key = { Id: 'alice' };
  const program: any = { name: 'counts.point', kind: 'Query', args: {}, read_time_granularity_ms: null,
    body: [{ Return: { Get: { site: 'count', table: 'counts', index: 'byTarget', key: [{ Literal: key }] } } }] };
  const context: any = { viewer: 'alice', principal_kind: 'user', auth_epoch: 1, args: {}, now: 1, new_ids: [], read_time: null };
  const range: any = { site: 'count', table: 'counts', index: 'byTarget', prefix: [{ Scalar: key }],
    order: 'Asc', take: 1, after: null, before: null, gt: null, gte: null, lt: null, lte: null,
    rule_hash: scopedRuleHash(schema,table.rules.read), row_ids: [], stop: 'Exhausted', absence: true, halo: null, n2_suffix: null };
  const receipt = (ranges: any[], absences: any[] = []): any => ({ schema_hash, rows: [], ranges, absences, verdicts: [] });
  const replay = (ranges: any[], absences: any[] = []) => new ClientStore(schema,receipt(ranges,absences)).reexecute(program,context);
  const primary = ['counts','byId',[{ Id: canonicalValues([key]) }]];
  assert.equal(replay([range],[primary]).state,'fresh','the owner proof pair covers the missing public group');
  assert.equal(replay([range]).state,'fresh','readable group exhaustion does not need canonical-ID equivalence');
  assert.equal(replay([],[primary]).state,'partial','primary absence alone does not prove a group empty');
  for (const [name, change] of [
    ['truncated', { stop: 'Limit' }], ['another key', { prefix: [{ Scalar: { Id: 'bob' } }] }],
    ['another index', { index: 'byId' }], ['another rule', { rule_hash: 'f'.repeat(64) }],
    ['evicted', { evicted_ids: ['lost'] }],
    ...['after','before','gt','gte','lt','lte'].map(bound => [bound,{ prefix: [], [bound]: bound === 'after' || bound === 'before' ? { Array: [key] } : key }]),
  ] as [string,any][]) assert.equal(replay([{ ...range,...change }]).state,'partial',name);
  const store = new ClientStore(schema,receipt([range]));
  assert.equal(store.hasAbsence('counts','byTarget',[key]),false,'read coverage adds no rule/mutation negative fact');
  assert.equal(store.authorityAbsence('counts',canonicalValues([key])),false,'group exhaustion adds no primary write authority');
  store.setReceipt('seed');
  assert.equal(store.reexecute(program,context).state,'partial','removing the receipt removes its read coverage');
  const restricted = structuredClone(schema); restricted.tables.counts.rules.read = { Eq: [{ Field: 'target' },'Viewer'] };
  const restrictedReceipt = { ...receipt([{ ...range,rule_hash: scopedRuleHash(restricted,restricted.tables.counts.rules.read) }]),
    schema_hash: sha256(canonicalSchemaJson(restricted)) };
  assert.equal(new ClientStore(restricted,restrictedReceipt).reexecute(program,context).state,'partial','restricted empty range does not acquire absence authority');
  const guarded = structuredClone(schema);
  guarded.tables.counts.rules.insert = { Not: { Exists: { table: 'counts', index: 'byTarget', key: [{ Field: 'target' }] } } };
  const guardedRange = { ...range, rule_hash: scopedRuleHash(guarded, guarded.tables.counts.rules.read) };
  const guardedReceipt = { ...receipt([guardedRange],[['counts','byId',[{ Id: 'new-row' }]]]), schema_hash: sha256(canonicalSchemaJson(guarded)) };
  const guardedStore = new ClientStore(guarded,guardedReceipt);
  assert.equal(guardedStore.hasCompleteRange('counts','byTarget',[key]),true,'guarded schema retains valid empty read coverage');
  assert.equal(guardedStore.reexecute(program,context).state,'fresh','the same evidence must suffice for a public point read');
  const inserted = { Row: { id: { Id: 'new-row' }, target: key, value: { Int: 1 } } };
  const insert: any = { name: 'guarded.insert', kind: 'Mutation', args: {}, read_time_granularity_ms: null,
    body: [{ Insert: { table: 'counts', row: { Literal: inserted } } }, { Return: { Literal: 'Null' } }] };
  const blocked = guardedStore.applyMutation(insert,context);
  assert.equal(blocked.state,'partial','readable group exhaustion cannot authorize a negative write rule');
  assert(blocked.partialSites.length > 0,JSON.stringify(blocked));
  assert.equal(guardedStore.byId('counts','new-row'),null,'unknown write authority leaves no inserted row');
  const authorizedStore = new ClientStore(guarded, { ...guardedReceipt,
    absences: [...guardedReceipt.absences, ['counts','byTarget',[key]]] });
  assert.equal(authorizedStore.applyMutation(insert,context).state,'predicted','explicit negative rule authority permits the same write');
  assert.notEqual(authorizedStore.byId('counts','new-row'),null,'the positive control actually inserts its row');
  const surviving = { table: 'counts', id: 'legacy', row: { Row: { id: { Id: 'legacy' }, target: key, value: { Int: 3 } } } };
  const legacy = new ClientStore(schema,{ ...receipt([range],[primary]),rows: [surviving] }).reexecute(program,context);
  assert.equal((wireJson(legacy.execution.result) as any).value,3,'noncanonical surviving group row wins over canonical primary absence');
});
