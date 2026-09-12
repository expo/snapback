import assert from 'node:assert/strict';
import { canonicalProgramJson, canonicalSchemaJson } from './certificate-identity';
import { sha256 } from './hash';
import { CURRENT_EVALUATOR, CURRENT_VALUE_MODEL_VERSION, Runner, validateCertificate } from './runner';
import { ClientStore } from './store';
import { canonicalJson, prepareSchema, scopedRuleHash } from './value-runtime';
import { rangeSchemaIdentity } from './range-preparation';
import { schemaDigest } from '../../snapback2/src/offline-schema';
import { decodeHeldProgram } from '../../snapback2/src/held-program';

const col = (Column: string) => ({ Column });
const allow = { Eq: [{ Field: 'allowed' }, { Literal: { Bool: true } }] };
const deny = { Eq: [{ Field: 'allowed' }, { Literal: { Bool: false } }] };
const definition = (read: unknown) => ({
  columns: { id: 'Id', allowed: 'Bool' },
  indexes: { byId: { components: [col('id')], unique: true } },
  rules: { read, insert: 'Allow', update: 'Allow', delete: 'Allow' },
  constraints: [], retain: 'until-revoked',
});
const schema: any = { tables: { allowed: definition(allow), denied: definition(deny) }, maintains: [] };
let canonicalReads = 0;
const maintains = schema.maintains;
Object.defineProperty(schema, 'maintains', {
  enumerable: true,
  get: () => { canonicalReads++; return maintains; },
});
const store = new ClientStore(schema);
const context: any = {
  viewer: 'viewer', principal_kind: 'user', auth_epoch: 0,
  args: {}, now: 1, new_ids: [], read_time: null,
};
const row: any = { Row: { id: { Id: 'one' }, allowed: { Bool: true } } };

canonicalReads = 0;
const runner = new Runner(store, schema, context, null);
assert.equal(runner.readAuthority('allowed', row), true);
assert.equal(runner.readAuthority('allowed', row), true);
assert.equal(runner.readAuthority('denied', row), false);
assert.equal(canonicalReads, 2, 'each distinct rule hashes once despite repeated candidates');

const hashes: Map<unknown, string> = (runner as any).ruleHashes;
const firstAllow = hashes.get(allow);
const firstDeny = hashes.get(deny);
assert.equal(firstAllow, scopedRuleHash(schema, allow), 'memo keeps the owner/twin canonical hash');
assert.equal(firstDeny, scopedRuleHash(schema, deny));
assert.notEqual(firstAllow, firstDeny, 'rules on different tables retain distinct scoped hashes');

const changed = { Eq: [{ Field: 'id' }, { Literal: { Id: 'other' } }] };
schema.tables.allowed.rules.read = changed;
canonicalReads = 0;
const successor = new Runner(store, schema, context, null);
assert.equal(successor.readAuthority('allowed', row), false);
assert.equal(canonicalReads, 1, 'a new execution recomputes after its rule changes');
const successorHash = ((successor as any).ruleHashes as Map<unknown, string>).get(changed);
assert.notEqual(successorHash, firstAllow);
assert.equal(successorHash, scopedRuleHash(schema, changed));

const ir: any = { name: 'read', kind: 'Query', args: {}, read_time_granularity_ms: null, body: [] };
const planHash = sha256(canonicalProgramJson(ir)), schemaHash = sha256(canonicalSchemaJson(schema));
const certificate: any = { plan_hash: planHash, schema_hash: schemaHash,
  value_model_version: CURRENT_VALUE_MODEL_VERSION, evaluator_version: CURRENT_EVALUATOR };
const packet: any = { generation: 'one', schemaHash, schema, programs: { read: { kind: 'query', planHash, ir, certificate } } };
assert.throws(() => decodeHeldProgram({ ...packet,schema: { ...schema,futureFeature: undefined } }),{ code: 'E_SCHEMA' });
assert.throws(() => decodeHeldProgram({ ...packet,programs: { read: { ...packet.programs.read,ir: { ...ir,futureFeature: undefined } } } }),{ code: 'E_SCHEMA' });
const oldTables = structuredClone(schema.tables), newTables = structuredClone(schema.tables); newTables.denied.rules.read = 'Allow';
let tableReads = 0;
const changingSchema = { maintains: [], get tables() { return ++tableReads <= 2 ? oldTables : newTables; } };
const changingHeld = decodeHeldProgram({ ...packet,schema: changingSchema })!;
assert.equal(sha256(canonicalSchemaJson(changingHeld.schema)),changingHeld.schemaHash,
  'schema hash binds the exact isolated snapshot');
let bodyReads = 0;
const unstableIr: any = { name: 'read',kind: 'Query',args: {},read_time_granularity_ms: null,
  get body() { return ++bodyReads === 1 ? [] : ['changed']; } };
const unstableHeld = decodeHeldProgram({ ...packet,programs: { read: { ...packet.programs.read,ir: unstableIr } } })!;
assert.equal(sha256(canonicalProgramJson(unstableHeld.programs.read.ir)),unstableHeld.programs.read.planHash,
  'plan hash binds the exact isolated IR snapshot');
const admitted = decodeHeldProgram(packet)!;
const admittedSchema: any = admitted.schema, admittedRule: any = admittedSchema.tables.allowed.rules.read;
const admittedHash = scopedRuleHash(admitted.schema,admittedRule);
assert.notEqual(admittedHash,scopedRuleHash(admittedSchema,admittedSchema.tables.denied.rules.read));
const objectKeys = Object.keys, admittedStore = new ClientStore(admitted.schema); let preparedReads = 0;
Object.keys = ((value: object) => { if (value === admittedSchema.tables) preparedReads++; return objectKeys(value); }) as typeof Object.keys;
try { for (let index = 0; index < 3; index++) {
  const fresh = new Runner(admittedStore,admitted.schema,context,null);
  assert.equal(fresh.readAuthority('allowed',row),false);
  assert.equal((fresh as any).ruleHashes.get(admittedRule),admittedHash);
  assert.equal(schemaDigest(admitted.schema),schemaHash);
} } finally { Object.keys = objectKeys; }
assert.equal(preparedReads,0,'admitted custody reuses canonical hashes across fresh executions');
assert.equal(admittedHash,scopedRuleHash(schema,changed),'prepared and public hashers retain byte parity');

preparedReads = 0;
Object.keys = ((value: object) => { if (value === admittedSchema.tables) preparedReads++; return objectKeys(value); }) as typeof Object.keys;
try {
  for (let i = 0; i < 3; i++) {
    validateCertificate(admittedSchema, admitted.programs.read.ir, admitted.programs.read.certificate);
    new ClientStore(admittedSchema);
  }
} finally { Object.keys = objectKeys; }
assert.equal(preparedReads,0,'store construction and certificate checks reuse the admitted schema digest');
const callerSchema = Object.freeze(structuredClone(admittedSchema));
validateCertificate(callerSchema, admitted.programs.read.ir, admitted.programs.read.certificate);
callerSchema.tables.denied.rules.read = 'Allow';
assert.throws(() => validateCertificate(callerSchema, admitted.programs.read.ir, admitted.programs.read.certificate),
  /E_TRACE_SUBSET: schema hash mismatch/, 'a frozen caller root cannot cache a mutable descendant');
assert.throws(() => validateCertificate(admittedSchema, { ...admitted.programs.read.ir, name: 'changed' }, admitted.programs.read.certificate),
  /E_TRACE_SUBSET: plan hash mismatch/, 'schema custody never suppresses a changed program check');

const rangeHash = sha256(canonicalJson(admittedSchema));
assert.equal(rangeSchemaIdentity(admittedSchema),rangeHash,'range identity retains its exact prior encoding');
preparedReads = 0;
Object.keys = ((value: object) => { if (value === admittedSchema.tables) preparedReads++; return objectKeys(value); }) as typeof Object.keys;
try { for (let i = 0; i < 4; i++) assert.equal(rangeSchemaIdentity(admittedSchema),rangeHash); }
finally { Object.keys = objectKeys; }
assert.equal(preparedReads,0,'owned immutable schemas do not repeat the range hash traversal');
const mutableRangeSchema = structuredClone(admittedSchema), priorRangeHash = rangeSchemaIdentity(mutableRangeSchema);
Object.freeze(mutableRangeSchema);
mutableRangeSchema.tables.denied.retain = 'delivered-history';
assert.notEqual(rangeSchemaIdentity(mutableRangeSchema),priorRangeHash,'a frozen caller root does not authorize caching mutable descendants');
assert.equal(rangeSchemaIdentity(mutableRangeSchema),sha256(canonicalJson(mutableRangeSchema)));
const preparedRangeSchema = prepareSchema(mutableRangeSchema,schemaDigest(mutableRangeSchema));
assert.equal(rangeSchemaIdentity(preparedRangeSchema),rangeSchemaIdentity(mutableRangeSchema),'fresh custody starts with its own exact hash');

const nested = (value: unknown): boolean => !value || typeof value !== 'object'
  || Object.isFrozen(value) && Object.values(value).every(nested);
assert(nested(admitted) && nested(admittedSchema) && nested(admitted.programs.read.ir)
  && nested(admitted.programs.read.certificate),'held program custody is deeply immutable');
schema.tables.allowed.rules.read = 'Allow'; ir.body.push('changed'); certificate.plan_hash = 'changed';
assert.deepEqual(admittedRule,changed); assert.equal((admitted.programs.read.ir as any).body.length,0);
assert.equal((admitted.programs.read.certificate as any).plan_hash,planHash);

const nextSchema: any = structuredClone(admitted.schema);
nextSchema.tables.denied.rules.read = 'Allow';
const nextSchemaHash = sha256(canonicalSchemaJson(nextSchema));
const nextCertificate = { ...certificate,plan_hash: planHash,schema_hash: nextSchemaHash };
const next = decodeHeldProgram({ generation: 'two',schemaHash: nextSchemaHash,schema: nextSchema,
  programs: { read: { kind: 'query',planHash,ir: admitted.programs.read.ir,certificate: nextCertificate } } })!;
assert.notEqual(next.schema,admitted.schema,'a successor gets new prepared custody');
assert.notEqual(scopedRuleHash(next.schema,(next.schema as any).tables.allowed.rules.read),admittedHash,
  'a nested successor rule change invalidates an unchanged outer rule shape');
assert.equal(schemaDigest(next.schema),nextSchemaHash,'successor custody retains its own validated hash');
assert.equal(schemaDigest(admitted.schema),schemaHash,'successor does not change previous custody');
assert.equal(prepareSchema(next.schema,schemaHash),undefined,'a claimed predecessor hash cannot admit a successor');

// Arbitrary caller objects, including shallow-frozen wrappers, have no trusted custody.
const shallow = Object.freeze(structuredClone(admitted.schema)) as any;
assert.equal(schemaDigest(shallow),schemaHash);
shallow.tables.denied.rules.read = 'Allow';
assert.equal(schemaDigest(shallow),nextSchemaHash,'nested mutation is rehashed even behind a frozen wrapper');
const mutable = structuredClone(admitted.schema) as any;
assert.equal(schemaDigest(mutable),schemaHash);
mutable.tables.denied.rules.read = 'Allow';
assert.equal(schemaDigest(mutable),nextSchemaHash,'mutable caller schemas are never memoized');
