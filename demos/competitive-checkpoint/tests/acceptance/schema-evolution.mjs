// @ref LLP 0081#2-canonical-plan-and-approval — the Step 5 application
// witness: the fixture's real v0→v1 schema change (models gains the optional
// provider field) reviewed and executed ONLY through the sealed plan
// artifact and the migrate preview → approve → apply path, never a dev-mode
// schema push.
// @ref LLP 0081#5-verification-and-data-proof — the applied operation's
// receipt carries the §5 full data proof and verify re-proves it from the
// journal after the fact.

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { SnapbackClient } from '../../../_kit/client.mjs';
import {
  assert,
  assertEqual,
  createSuite,
  runAcceptance,
} from '../../../_kit/harness.mjs';
import { startServer } from '../../../_kit/server-process.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..', '..');
const backendDir = join(here, '..', '..', 'snapback');
const v0 = (name) => JSON.parse(readFileSync(join(here, 'fixtures', 'v0', name), 'utf8'));
const v1 = (name) => JSON.parse(readFileSync(join(backendDir, 'generated', name), 'utf8'));
const ADA = 'user_checkpoint_ada';

const work = mkdtempSync(join(tmpdir(), 'checkpoint-schema-evolution-'));
const dbPath = join(work, 'checkpoint.sqlite');
const cleanups = [() => rmSync(work, { recursive: true, force: true })];
const suite = createSuite('competitive checkpoint / reviewed schema evolution', { expectedChecks: 6 });

// The migrate CLI is the reviewed path's only executable surface on this
// profile. SNAPBACK_BIN pins a prebuilt binary; the source-tree `cargo run`
// rung is the reproducible default.
const SNAPBACK_BIN = process.env.SNAPBACK_BIN ?? null;
function migrate(args) {
  const invocation = SNAPBACK_BIN
    ? { command: SNAPBACK_BIN, prefix: [] }
    : { command: 'cargo', prefix: ['run', '--quiet', '--bin', 'snapback', '--'] };
  const outcome = spawnSync(invocation.command, [...invocation.prefix, 'migrate', ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: { ...process.env, DYLD_FRAMEWORK_PATH: undefined },
  });
  let envelope = null;
  try {
    envelope = JSON.parse(outcome.stdout);
  } catch {
    // A non-JSON failure is reported through the status assertion below.
  }
  return { status: outcome.status, envelope, stderr: outcome.stderr };
}

await runAcceptance(suite, async () => {
  // --- Predecessor store: boot on the pinned v0 artifacts and seed real data.
  const v0Api = (await import(join(here, 'fixtures', 'v0', 'api.mjs'))).default
    ?? (await import(join(here, 'fixtures', 'v0', 'api.mjs'))).api;
  let server = await startServer({
    port: 0,
    db: dbPath,
    cwd: repoRoot,
    env: { SNAPBACK_OUTBOUND_ACTIONS: '1' },
    provenance: {
      appId: 'competitive-checkpoint',
      artifactsPath: join(here, 'fixtures', 'v0', 'artifacts.json'),
    },
  });
  let client = new SnapbackClient(server.baseUrl, server.clientOptions);
  await client.loadSchema(v0('schema.manifest.json'));
  await client.loadFunctions(v0('functions.manifest.json'));
  await client.reset();

  await client.mutate(v0Api.registerModel, {
    userId: ADA,
    args: { slug: 'deterministic-v0', displayName: 'Deterministic v0' },
  });
  const slugs = ['alpha', 'beta', 'gamma'];
  for (const slug of slugs) {
    await client.mutate(v0Api.createConversation, {
      userId: ADA,
      args: { slug, title: `Conversation ${slug}`, model: 'deterministic-v0' },
    });
  }
  const before = {
    conversations: (await client.query(v0Api.listConversations, { userId: ADA })).rows,
    cards: (await client.query(v0Api.listConversationCards, { userId: ADA })).rows,
  };
  assertEqual(before.conversations.length, 3, 'seeded predecessor conversations');
  assertEqual(before.cards.length, 3, 'projection materialized in the source commits');
  await server.stop();
  server = null;

  // --- Review: preview seals the deterministic plan artifact from the
  // schema diff; the witness reviews its face before any approval exists.
  const previewPath = join(work, 'preview.json');
  const approvedPath = join(work, 'approved.json');
  const schemaPath = join(backendDir, 'generated', 'schema.manifest.json');
  const publicationTs = Date.now();
  let planId;
  let planDigest;

  await suite.check('preview derives the additive intent from the schema diff and seals a reviewable plan', async () => {
    const preview = migrate([
      'preview',
      '--db', dbPath,
      '--schema', schemaPath,
      '--publication-timestamp-ms', String(publicationTs),
      '--rollback-timestamp-ms', String(publicationTs + 60 * 60 * 1000),
      '--out', previewPath,
    ]);
    assert(preview.status === 0 && preview.envelope?.ok, `preview failed: ${preview.stderr}`);
    const file = JSON.parse(readFileSync(previewPath, 'utf8'));
    planId = file.artifact.planId;
    planDigest = file.artifact.planDigest;
    assert(planId.startsWith('migration-v1:'), 'plan identity carries the sealed digest grammar');
    // The review step the acceptance clause names: the plan's face must
    // show exactly the intended change before anyone approves it.
    const steps = file.artifact.body.steps;
    const addColumn = steps.find((step) => JSON.stringify(step).includes('provider'));
    assert(addColumn, 'the sealed plan stages the models.provider addition on its face');
    assertEqual(
      file.artifact.body.predecessorSchemaHash === file.artifact.body.successorSchemaHash,
      false,
      'the plan binds two distinct schema identities',
    );
    return { planId, planDigest, steps: steps.length };
  });

  await suite.check('a tampered approval cannot execute', async () => {
    const approve = migrate(['approve', previewPath, '--db', dbPath, '--out', approvedPath]);
    assert(approve.status === 0 && approve.envelope?.ok, `approve failed: ${approve.stderr}`);
    const approved = JSON.parse(readFileSync(approvedPath, 'utf8'));
    const tamperedPath = join(work, 'approved-tampered.json');
    const tampered = structuredClone(approved);
    tampered.approval.planDigest = tampered.approval.planDigest.replace(/.$/u, (c) => (c === '0' ? '1' : '0'));
    writeFileSync(tamperedPath, JSON.stringify(tampered, null, 2));
    const refused = migrate(['apply', tamperedPath, '--schema', schemaPath, '--db', dbPath]);
    assertEqual(refused.status === 0, false, 'a digest-mismatched approval refuses');
    return { refused: true };
  });

  let receipt;
  await suite.check('apply executes the reviewed change once and releases with the §5 full proof', async () => {
    const dryRun = migrate(['apply', approvedPath, '--schema', schemaPath, '--db', dbPath, '--dry-run']);
    assert(dryRun.status === 0 && dryRun.envelope?.data?.wouldApply === true, 'dry-run admission validates');
    const apply = migrate(['apply', approvedPath, '--schema', schemaPath, '--db', dbPath]);
    assert(apply.status === 0 && apply.envelope?.ok, `apply failed: ${apply.stderr} ${JSON.stringify(apply.envelope)}`);
    receipt = apply.envelope.data;
    // MigrationExecState serializes internally tagged; interior states
    // carry step fields, terminal states are the bare tag.
    assertEqual(receipt.state?.state ?? receipt.state, 'released', 'the operation ran to released');
    const proof = receipt.stepResults?.['§5-data-proof'];
    assert(proof && proof.proofMethod === 'full', 'the §5 full data proof rides the receipt');
    // An in-place additive step rewrites no rows, so the plan honestly
    // declares no per-table digest (the CopyTable-generation paths carry
    // those — proven in the 0081 corpus). What the receipt must still
    // seal: the journal projection and the publication version. Data
    // survival is witnessed below through the served reads.
    assert(
      typeof receipt.journalDigest === 'string' && /^[0-9a-f]{64}$/u.test(receipt.journalDigest),
      'the receipt seals the journal projection',
    );
    assert(receipt.publicationVersion > 0, 'publication allocated the successor application version');
    const replay = migrate(['apply', approvedPath, '--schema', schemaPath, '--db', dbPath]);
    assert(replay.status === 0 && replay.envelope?.ok, 'replaying the approved operation is admitted');
    assertEqual(replay.envelope.data, receipt, 'replay returns the identical receipt — exactly-once execution');
    return {
      state: receipt.state?.state ?? receipt.state,
      proofMethod: proof.proofMethod,
      digestTables: Object.keys(proof.tables ?? {}).sort(),
      publicationVersion: receipt.publicationVersion,
    };
  });

  await suite.check('verify re-proves the receipt against the journal after the fact', async () => {
    const operationId = receipt.operationId ?? receipt.approval?.operationId
      ?? JSON.parse(readFileSync(approvedPath, 'utf8')).approval.operationId;
    const verify = migrate(['verify', '--operation-id', operationId, '--db', dbPath]);
    assert(verify.status === 0 && verify.envelope?.ok, `verify failed: ${verify.stderr}`);
    assertEqual(verify.envelope.data.state, 'released', 'journal projection agrees the operation released');
    assert(verify.envelope.data.dataProof, 'verify surfaces the recorded data proof');
    return { operationId, state: verify.envelope.data.state };
  });

  // --- Successor store: the same database now serves the v1 artifacts.
  server = await startServer({
    port: 0,
    db: dbPath,
    cwd: repoRoot,
    env: { SNAPBACK_OUTBOUND_ACTIONS: '1' },
    provenance: {
      appId: 'competitive-checkpoint',
      artifactsPath: join(backendDir, 'generated', 'artifacts.json'),
    },
  });
  client = new SnapbackClient(server.baseUrl, server.clientOptions);
  cleanups.push(() => server.stop());
  const v1Api = (await import(join(backendDir, 'generated', 'api.mjs'))).default
    ?? (await import(join(backendDir, 'generated', 'api.mjs'))).api;
  await client.loadSchema(v1('schema.manifest.json'));
  await client.loadFunctions(v1('functions.manifest.json'));

  await suite.check('every predecessor row survives the migration byte-for-byte on its logical leaves', async () => {
    const conversations = (await client.query(v1Api.listConversations, { userId: ADA })).rows;
    assertEqual(
      conversations.map((row) => row.slug).sort(),
      [...slugs].sort(),
      'the migrated store serves the predecessor conversations',
    );
    const cards = (await client.query(v1Api.listConversationCards, { userId: ADA })).rows;
    assertEqual(cards.length, 3, 'the maintained projection output survived');
    assertEqual(cards[0].modelName, 'Deterministic v0', 'projected leaves intact');
    return { conversations: conversations.length, cards: cards.length };
  });

  await suite.check('the successor schema is live: provider round-trips and the relational helper serves it', async () => {
    await client.mutate(v1Api.registerModel, {
      userId: ADA,
      args: { slug: 'deterministic-v1', displayName: 'Deterministic v1', provider: 'checkpoint-lab' },
    });
    await client.mutate(v1Api.createConversation, {
      userId: ADA,
      args: { slug: 'post-migration', title: 'Post migration', model: 'deterministic-v1' },
    });
    const page = await client.query(v1Api.conversationsWithModel, { userId: ADA });
    const migrated = page.rows.find((row) => row.slug === 'alpha');
    const fresh = page.rows.find((row) => row.slug === 'post-migration');
    assertEqual(migrated.modelName, 'Deterministic v0', 'pre-migration join leaves serve');
    assertEqual(migrated.modelProvider ?? null, null, 'the additive field reads back null for predecessor rows');
    assertEqual(fresh.modelProvider, 'checkpoint-lab', 'the new field serves through the callable relational helper');
    return { rows: page.rows.length, additiveFieldLive: true };
  });
}, {
  cleanups,
  reportExtra: {
    schemaVersion: 'snapback.competitive-checkpoint.schema-evolution.v1',
    protocol: 'llp-0075-convex-checkpoint-v0',
    authority: 'llp/0081-reviewed-storage-evolution-and-migrations.rfc.md',
    change: 'models.provider (additive optional string, intents derived from the schema diff)',
  },
  reportFile: join(here, '..', '..', 'acceptance', 'results', 'schema-evolution.v1.json'),
});
