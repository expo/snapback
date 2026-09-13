// @ref LLP 1018.008.007.002#11-block-index-acquisition-restart —
// real IndexedDB catalogue controls compare scope semantics with ClientStore.
import { DurableRows } from '../src/durable-rows.js';
import { DurableScopes } from '../src/durable-scopes.js';
import { scalarFromKey } from '../src/durable-key.js';
import { ClientStore } from '../../evaluator/src/store.js';
import { RowImage } from '../../evaluator/src/row-image.js';
import { SEARCH_CONTRACT } from '../../evaluator/src/unicode.js';
import { sha256 } from '../../evaluator/src/hash.js';
import { canonicalJson, schemaDigest, scopedRuleHash } from '../../evaluator/src/value-runtime.js';
import type { ClosureReceipt, Context, Value } from '../../evaluator/src/types.js';
import type { HeldProgram } from '../src/store/range-store.js';

type Result = { name: string; pass: boolean; error?: string };
type Change = { table: string; id: string; row: RowImage | null; seq: number };
const col = (Column: string) => ({ Column });
const rules = { read: 'Allow', insert: 'Allow', update: 'Allow', delete: 'Allow' };
const context: Context = { viewer: 'viewer', principal_kind: 'user', auth_epoch: 7,
  args: {}, now: 1, new_ids: [], read_time: null };
const text = (String: string): Value => ({ String });
const id = (Id: string): Value => ({ Id });
const check = (condition: unknown, message: string): void => { if (!condition) throw Error(message); };
const json = (value: unknown) => JSON.stringify(value, (_key, v) => v instanceof ArrayBuffer ? [...new Uint8Array(v)]
  : ArrayBuffer.isView(v) ? [...new Uint8Array(v.buffer, v.byteOffset, v.byteLength)] : v);
const equal = (actual: unknown, expected: unknown, message: string): void => {
  check(json(actual) === json(expected), `${message}: ${json(actual)} != ${json(expected)}`);
};
async function refuses(work: Promise<unknown>, pattern: RegExp): Promise<void> {
  try { await work; } catch (error) { check(pattern.test(String(error)), `unexpected refusal: ${String(error)}`); return; }
  throw Error(`expected refusal ${pattern}`);
}
function req<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
}

function fixture(privateMembership = false, delivered = false) {
  const schema: any = { tables: {
    messages: { columns: { id: 'Id', tenant: 'Id', room: { Text: { max: 100 } }, body: { Text: { max: 100 } }, at: 'Int' },
      indexes: { byId: { components: [col('id')], unique: true },
        search: { components: [col('room'), col('tenant'), { WordPrefixes: { fields: ['body'], contract: SEARCH_CONTRACT } },
          col('at'), col('id')], unique: false } },
      rules: { ...rules, read: { Exists: { table: 'members', index: 'byScopeViewer',
        key: [{ Field: 'tenant' }, { Field: 'room' }, 'Viewer'], provenance: 'Shape' } } },
      constraints: [], retain: delivered ? 'delivered-history' : 'until-revoked' },
    members: { columns: { id: 'Id', tenant: 'Id', room: { Text: { max: 100 } }, viewer: 'Principal' },
      indexes: { byId: { components: [col('id')], unique: true },
        byScopeViewer: { components: [col('tenant'), col('room'), col('viewer')], unique: true },
        byViewer: { components: [col('viewer'), col('tenant'), col('room'), col('id')], unique: false } },
      rules: { ...rules, read: privateMembership ? 'Deny' : 'Allow' }, constraints: [], retain: 'until-revoked' },
  }, maintains: [] };
  const word = { source: { Variable: 'term' }, contract: SEARCH_CONTRACT, source_max: 100 };
  const scan: any = { site: 'search', table: 'messages', index: 'search', prefix: [
    { Scalar: { Field: { base: { Variable: 'member' }, name: 'room' } } },
    { Scalar: { Variable: 'tenant' } }, { WordPrefix: word }], order: 'Asc', take: { Literal: 2 },
    after: { Variable: 'cursor' }, before: null, range: null, opaque_cursor: true, merge_site: 'global', provenance: 'Arg' };
  const discovery = { ...scan, site: 'members', table: 'members', index: 'byViewer',
    prefix: [{ Scalar: { Input: 'Viewer' } }, { Scalar: { Variable: 'tenant' } }],
    take: { Literal: 3 }, after: null, opaque_cursor: false, merge_site: null, provenance: 'Viewer' };
  const descriptor = { table: 'messages', index: 'search', term: word,
    scope: [{ column: 'room', value: scan.prefix[0].Scalar }, { column: 'tenant', value: scan.prefix[1].Scalar }],
    suffix: ['at', 'id'], order: 'Asc', take: scan.take, after: scan.after,
    discovery: { scan: discovery, binding: 'member', authorization_index: 'byScopeViewer' } };
  const ir: any = { name: 'global', kind: 'Query', args: { tenant: 'Id', term: { Text: { max: 100 } }, cursor: { Optional: 'Cursor' } },
    body: [{ Return: { Merge: { site: 'global', lanes: [{ scan, source: discovery, binding: 'member' }], held_search: descriptor } } }] };
  const program = { schema, schemaHash: schemaDigest(schema), generation: 'scope-control-generation',
    programs: { global: { kind: 'query', ir } } } as unknown as HeldProgram;
  const host = new ClientStore(schema, undefined, { readable: delivered ? ['messages'] : [] });
  host.registerHeld(program.programs, context);
  const row = (table: string, body: Record<string, unknown>, seq = 1): Change => ({ table, id: String(body.id), seq,
    row: RowImage.fromWire(schema, table, body, message => { throw Error(message); }, program.schemaHash) });
  const message = (name: string, room: string, tenant = 't', body = '---', seq = 1) =>
    row('messages', { id: name, room, tenant, body, at: 1 }, seq);
  const member = (name: string, room: string, tenant = 't', seq = 1) =>
    row('members', { id: name, room, tenant, viewer: context.viewer }, seq);
  const digest = (room: string, tenant = 't') => sha256(canonicalJson(['members', 'byScopeViewer', [tenant, room, context.viewer]]));
  const receipt = (room: string, result?: boolean, principal = context.viewer, epoch = context.auth_epoch): ClosureReceipt => ({
    schema_hash: program.schemaHash, rows: [], ranges: [],
    absences: result === undefined ? [['members', 'byScopeViewer', [id('t'), text(room), id(context.viewer)]]] : [],
    verdicts: result === undefined ? [] : [{ rule_hash: scopedRuleHash(schema, schema.tables.messages.rules.read),
      pinned_inputs_digest: digest(room), principal, auth_epoch: epoch, result }],
  });
  return { schema, program, host, descriptor, message, member, digest, receipt };
}
type Fixture = ReturnType<typeof fixture>;
async function withStore(f: Fixture, run: (store: DurableRows, name: string) => Promise<void>): Promise<void> {
  const name = `durable-scopes-controls:${crypto.randomUUID()}`, store = await DurableRows.open(name, f.program);
  try { await run(store, name); } finally { store.close(); await req(indexedDB.deleteDatabase(name)); }
}
function apply(host: ClientStore, changes: Change[]): void {
  for (const row of changes) if (row.row) host.put(row.table, row.row); else host.remove(row.table, row.id);
}
async function commit(store: DurableRows, f: Fixture, changes: Change[], seq = 1,
  proofs: Array<[string, ClosureReceipt | undefined]> = [], digests: string[] = []): Promise<void> {
  apply(f.host, changes);
  for (const [owner, proof] of proofs) f.host.setReceipt(owner, proof);
  await store.transaction('readwrite', async tx => {
    const rows = await tx.putRows(changes, seq);
    for (const [owner, proof] of proofs) {
      if (proof) await tx.request(tx.idb.objectStore('proofs').put(proof, owner));
      else await tx.request(tx.idb.objectStore('proofs').delete(owner));
    }
    await new DurableScopes(tx, context).refresh(rows, f.host, digests);
  });
}
async function select(store: DurableRows, f: Fixture, tenant = 't', limit = 10) {
  return store.transaction('readonly', async tx => new DurableScopes(tx, context).directory(f.descriptor)!.select([id(tenant)], limit));
}
async function compare(store: DurableRows, f: Fixture, tenant = 't', limit = 10): Promise<void> {
  equal(await select(store, f, tenant, limit), f.host.heldDirectory(f.descriptor)!.select([id(tenant)], limit), 'ClientStore directory differential');
}
async function records(store: DurableRows): Promise<any[]> {
  return store.transaction('readonly', tx => tx.request(tx.idb.objectStore('scopes').getAll()));
}
async function status(store: DurableRows, room: string, tenant = 't'): Promise<string | undefined> {
  return (await records(store)).find(record => json(record.scopeKey.slice(2).map(scalarFromKey)) === json([text(room), id(tenant)]))?.statuses[0][1];
}
async function snapshot(store: DurableRows): Promise<unknown> {
  return store.transaction('readonly', tx => Promise.all(['pages', 'blocks', 'meta', 'proofs', 'scopes'].map(async name => {
    const store = tx.idb.objectStore(name), keys = tx.request(store.getAllKeys()), values = tx.request(store.getAll());
    return [name, await keys, await values];
  })));
}

/** Called by the combined harness in its one allocated real browser. */
export async function runDurableScopesControls(): Promise<Result[]> {
  const results: Result[] = [];
  async function test(name: string, run: () => Promise<void>) {
    try { await run(); results.push({ name, pass: true }); }
    catch (error) { results.push({ name, pass: false, error: error instanceof Error ? error.stack : String(error) }); }
  }

  await test('empty-word scopes, non-leading fixed field and Unicode order match ClientStore', async () => {
    const f = fixture(false, true);
    await withStore(f, async store => {
      await commit(store, f, [f.message('astral', '\u{10000}'), f.message('bmp', '\ue000'),
        f.message('a', 'a'), f.message('other', '0', 'other'), f.message('duplicate', 'a')]);
      await compare(store, f); await compare(store, f, 'other'); await compare(store, f, 't', 0);
      equal(await select(store, f, 't', 2), { scopes: [[text('a'), id('t')], [text('\ue000'), id('t')]], overflow: true, missing: false },
        'scope order uses Unicode codepoints and cap is independent of empty postings');
      equal((await records(store)).length, 4, 'one catalogue row per scope, not per message');
      await store.transaction('readonly', async tx => {
        const scopes = new DurableScopes(tx, context), directory = scopes.directory(f.descriptor)!;
        equal(directory.fixed, [1], 'fixed field permutation');
        equal(scopes.directory({ ...f.descriptor, order: 'Desc' }), undefined, 'unregistered descriptor does not broaden authority');
        await refuses(Promise.resolve().then(() => directory.select([text('t')], -1)), /bound/);
      });
    });
  });

  await test('matching unknown wins beyond allowed limit; foreign fixed scopes do not interfere', async () => {
    const f = fixture();
    await withStore(f, async store => {
      await commit(store, f, [f.message('a', 'a'), f.message('b', 'b'), f.message('z', 'z'),
        f.message('foreign', '0', 'foreign'), f.member('ma', 'a'), f.member('mb', 'b')]);
      equal(await select(store, f, 't', 1), { scopes: [], overflow: false, missing: true }, 'unknown z beyond allowed a still wins');
      await compare(store, f, 't', 1);
      await commit(store, f, [], 2, [['deny-z', f.receipt('z')]], [f.digest('z')]);
      equal(await status(store, 'z'), 'denied', 'absence removes unknown scope from domain');
      equal(await select(store, f, 't', 1), { scopes: [[text('a'), id('t')]], overflow: true, missing: false }, 'foreign unknown does not contaminate t');
      await compare(store, f, 't', 1); await compare(store, f, 'foreign', 1);
    });
  });

  await test('representative deletion, scope move and last body deletion maintain exact counts', async () => {
    const f = fixture(false, true);
    await withStore(f, async store => {
      await commit(store, f, [f.message('a', 'room'), f.message('b', 'room')]);
      let row = (await records(store))[0]; equal([row.count, row.representative], [2, 'a'], 'initial representative');
      await commit(store, f, [{ table: 'messages', id: 'a', row: null, seq: 2 }], 2);
      row = (await records(store))[0]; equal([row.count, row.representative], [1, 'b'], 'replacement representative');
      await commit(store, f, [f.message('b', 'moved', 't', 'café', 3)], 3);
      equal(await status(store, 'room'), undefined, 'old scope deleted on move');
      equal(await status(store, 'moved'), 'allowed', 'new scope installed on move'); await compare(store, f);
      await commit(store, f, [{ table: 'messages', id: 'b', row: null, seq: 4 }], 4);
      equal(await records(store), [], 'last body deletes catalogue record'); await compare(store, f);
    });
  });

  await test('ordinary authority key changes refresh old and new dependencies only', async () => {
    const f = fixture();
    await withStore(f, async store => {
      await commit(store, f, [f.message('a', 'a'), f.message('b', 'b'), f.message('c', 'c'), f.member('m', 'a'), f.member('mc', 'c')]);
      const moved = f.member('m', 'b', 't', 2); apply(f.host, [moved]);
      const touched: string[] = [];
      await store.transaction('readwrite', async tx => {
        const changes = await tx.putRows([moved], 2), read = tx.row.bind(tx);
        tx.row = record => { touched.push(record.id); return read(record); };
        await new DurableScopes(tx, context).refresh(changes, f.host);
      });
      equal(touched.sort(), ['a', 'b'], 'authority refresh follows only indexed old and new points');
      equal([await status(store, 'a'), await status(store, 'b'), await status(store, 'c')], ['unknown', 'allowed', 'allowed'], 'scope statuses after membership move');
      await compare(store, f);
    });
  });

  await test('absence replacement and removal refresh authority without touching content rows', async () => {
    const f = fixture();
    await withStore(f, async store => {
      await commit(store, f, [f.message('a', 'a'), f.message('b', 'b')]);
      await commit(store, f, [], 2, [['proof', f.receipt('a')]], [f.digest('a')]);
      equal([await status(store, 'a'), await status(store, 'b')], ['denied', 'unknown'], 'absence targets one dependency');
      await commit(store, f, [], 3, [['proof', f.receipt('b')]], [f.digest('a'), f.digest('b')]);
      equal([await status(store, 'a'), await status(store, 'b')], ['unknown', 'denied'], 'replacement refreshes removed and added proof points');
      await commit(store, f, [], 4, [['proof', undefined]], [f.digest('b')]);
      equal(await status(store, 'b'), 'unknown', 'removed absence restores unknown'); await compare(store, f);
    });
  });

  await test('private authority requires current principal and epoch verdict; held rule rows do not substitute', async () => {
    const f = fixture(true);
    await withStore(f, async store => {
      await commit(store, f, [f.message('a', 'a'), f.member('private', 'a')]);
      equal(await status(store, 'a'), 'unknown', 'private held membership is not a grant');
      let seq = 2;
      for (const [proof, expected] of [[f.receipt('a', true), 'allowed'], [f.receipt('a', false), 'denied'],
        [f.receipt('a', true, 'other'), 'unknown'], [f.receipt('a', true, context.viewer, 6), 'unknown'],
        [f.receipt('a', true), 'allowed'], [undefined, 'unknown']] as const) {
        await commit(store, f, [], seq++, [['proof', proof]], [f.digest('a')]);
        equal(await status(store, 'a'), expected, 'verdict transition');
        equal((await records(store))[0].count, 1, 'proof-only changes preserve the membership count'); await compare(store, f);
      }
    });
  });

  await test('late abort restores rows, postings, proofs, catalogue and metadata together', async () => {
    const f = fixture();
    await withStore(f, async store => {
      await commit(store, f, [f.message('a', 'a')]);
      await store.transaction('readwrite', tx => tx.putMeta('collision', 'committed'));
      const before = await snapshot(store), added = f.message('b', 'b', 't', 'coffee', 2), proof = f.receipt('a');
      apply(f.host, [added]); f.host.setReceipt('proof', proof);
      let refreshed = false;
      await refuses(store.transaction('readwrite', async tx => {
        const changes = await tx.putRows([added], 2);
        await tx.request(tx.idb.objectStore('proofs').put(proof, 'proof'));
        await tx.putMeta('state', { seq: 2, packets: ['uncommitted-obligation'] });
        await new DurableScopes(tx, context).refresh(changes, f.host, [f.digest('a')]);
        refreshed = true;
        await tx.request(tx.idb.objectStore('meta').add('duplicate', 'collision'));
      }), /ConstraintError/);
      check(refreshed, 'failure did not occur after catalogue writes');
      equal(await snapshot(store), before, 'abort changed committed five-store snapshot');
      equal(await status(store, 'a'), 'unknown', 'rolled-back authority was published');
    });
  });

  await test('cold selection reads catalogue only and keeps context ownership', async () => {
    const f = fixture(false, true);
    await withStore(f, async (store, name) => {
      await commit(store, f, [f.message('a', 'a'), f.message('b', 'b')]); store.close();
      const reopened = await DurableRows.open(name, f.program);
      try {
        await reopened.transaction('readonly', async tx => {
          tx.row = () => { throw Error('selection read a row body'); };
          tx.directory = () => { throw Error('selection read a row directory'); };
          const ownedContext = structuredClone(context), scopes = new DurableScopes(tx, ownedContext);
          ownedContext.viewer = 'other'; ownedContext.auth_epoch++;
          equal(await scopes.directory(f.descriptor)!.select([id('t')], 1),
            { scopes: [[text('a'), id('t')]], overflow: true, missing: false }, 'cold bounded selection');
        });
      } finally { reopened.close(); }
    });
  });

  await test('catalogue partition and epoch mismatch fail instead of granting empty results', async () => {
    const f = fixture(false, true);
    await withStore(f, async store => {
      await commit(store, f, [f.message('a', 'a')]);
      for (const changed of [{ ...context, viewer: 'other' }, { ...context, auth_epoch: context.auth_epoch + 1 }]) {
        await refuses(store.transaction('readonly', async tx => new DurableScopes(tx, changed).directory(f.descriptor)!.select([id('t')], 1)), /identity/);
        const before = await snapshot(store);
        await refuses(store.transaction('readwrite', tx => new DurableScopes(tx, changed).refresh([], f.host)), /identity/);
        equal(await snapshot(store), before, 'identity refusal changed catalogue');
      }
    });
  });

  await test('missing catalogue cannot be initialized by a partial later write', async () => {
    const f = fixture(false, true);
    await withStore(f, async store => {
      equal(await select(store, f), { scopes: [], overflow: false, missing: false }, 'fresh empty partition');
      await store.transaction('readwrite', tx => tx.putRows([f.message('old', 'old')], 1));
      await refuses(select(store, f), /no initialized/);
      const before = await snapshot(store);
      await refuses(store.transaction('readwrite', async tx => {
        const changes = await tx.putRows([f.message('new', 'new', 't', 'coffee', 2)], 2);
        await new DurableScopes(tx, context).refresh(changes, f.host);
      }), /no initialized/);
      equal(await snapshot(store), before, 'partial initialization did not abort');
    });
  });

  await test('a complete later membership set can initialize an absent catalogue', async () => {
    const f = fixture(false, true);
    await withStore(f, async store => {
      const initial = [f.message('a', 'a'), f.message('b', 'b')];
      await store.transaction('readwrite', tx => tx.putRows(initial, 1));
      await refuses(select(store, f), /no initialized/);
      await commit(store, f, [f.message('a', 'a', 't', 'coffee', 2), f.message('b', 'b', 't', '---', 2)], 2);
      equal((await records(store)).map(record => record.count), [1, 1], 'complete final set initializes exact scope counts');
      await compare(store, f);
    });
  });

  await test('distinct net row deltas retain representatives through intermediate moves and repeated notifications', async () => {
    const f = fixture(false, true);
    await withStore(f, async store => {
      await commit(store, f, [f.message('a', 'room'), f.message('b', 'room'), f.message('c', 'else')]);
      const move = f.message('a', 'else', 't', 'coffee', 2);
      const final = [f.message('a', 'room', 't', 'coffee', 3), f.message('d', 'room', 't', '---', 3),
        { table: 'messages', id: 'b', row: null, seq: 3 }];
      apply(f.host, [move, ...final]);
      await store.transaction('readwrite', async tx => {
        const first = await tx.putRows([move], 2), last = await tx.putRows(final, 3);
        await new DurableScopes(tx, context).refresh([...first, ...last, ...last], f.host);
        equal(await tx.scopeTotal('messages', 'search'), 3, 'cumulative membership total tracks net live rows');
      });
      const current = await records(store);
      const room = current.find(record => json(record.scopeKey.slice(2).map(scalarFromKey)) === json([text('room'), id('t')]));
      equal([room.count, room.representative], [2, 'a'], 'net-unchanged representative survives intermediate move');
      equal(current.map(record => record.count).sort(), [1, 2], 'duplicate notification does not add another member');
      await compare(store, f);
    });
  });

  await test('an established binding cannot silently reset a missing scope baseline', async () => {
    const f = fixture(false, true);
    await withStore(f, async store => {
      await commit(store, f, [f.message('a', 'a')]);
      const old = (await records(store))[0];
      await store.transaction('readwrite', tx => tx.request(tx.idb.objectStore('scopes').delete(old.scopeKey)));
      const before = await snapshot(store), update = f.message('a', 'a', 't', 'changed', 2);
      apply(f.host, [update]);
      await refuses(store.transaction('readwrite', async tx => {
        const changes = await tx.putRows([update], 2);
        await new DurableScopes(tx, context).refresh(changes, f.host);
      }), /scope baseline/);
      equal(await snapshot(store), before, 'missing-baseline refusal rolls back body, blocks and metadata');
    });
  });

  await test('a new identity cannot replace a missing catalogue over existing scope members', async () => {
    // Exercise both an unexpected first member and one after the new member.
    for (const added of ['c', '0']) {
      const f = fixture(false, true);
      await withStore(f, async store => {
        await commit(store, f, [f.message('a', 'room'), f.message('b', 'room')]);
        const old = (await records(store))[0];
        await store.transaction('readwrite', tx => tx.request(tx.idb.objectStore('scopes').delete(old.scopeKey)));
        const before = await snapshot(store), update = f.message(added, 'room', 't', 'new member', 2);
        apply(f.host, [update]);
        await refuses(store.transaction('readwrite', async tx => {
          const changes = await tx.putRows([update], 2);
          equal(changes[0].before, null, 'new identity has no before record to expose the missing baseline');
          await new DurableScopes(tx, context).refresh(changes, f.host);
        }), /scope baseline/);
        equal(await snapshot(store), before, 'new-member refusal rolls back all five stores');
      });
    }
  });

  await test('malformed selected catalogue record fails closed', async () => {
    const f = fixture(false, true);
    await withStore(f, async store => {
      await commit(store, f, [f.message('a', 'a')]);
      const record = (await records(store))[0];
      await store.transaction('readwrite', tx => tx.request(tx.idb.objectStore('scopes').put({ ...record, count: 0 }, record.scopeKey)));
      await refuses(select(store, f), /invalid catalogue/);
    });
  });
  return results;
}
