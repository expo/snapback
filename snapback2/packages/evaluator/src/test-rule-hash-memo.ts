import assert from 'node:assert/strict';
import { Runner } from './runner';
import { ClientStore } from './store';
import { scopedRuleHash } from './value-runtime';

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
