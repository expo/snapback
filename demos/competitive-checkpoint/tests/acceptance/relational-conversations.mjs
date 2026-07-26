// @ref LLP 0080#7-generated-authoring-surface — the fixture's callable
// relational helper in production shape: an owner-scoped bounded join served
// through the generated artifact pair, paged by the opaque versioned cursor.
// @ref LLP 0080#2-portable-evaluation-semantics — take counts consumed authorized roots, a short
// page is terminal, and every cursor refusal class answers identically.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { SnapbackClient } from '../../../_kit/client.mjs';
import {
  assert,
  assertEqual,
  assertThrows,
  createSuite,
  runAcceptance,
} from '../../../_kit/harness.mjs';
import { startServer } from '../../../_kit/server-process.mjs';
import api from '../../snapback/generated/api.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..', '..');
const backendDir = join(here, '..', '..', 'snapback');
const generated = (name) => JSON.parse(readFileSync(join(backendDir, 'generated', name), 'utf8'));
const ADA = 'user_checkpoint_ada';
const GRACE = 'user_checkpoint_grace';

const server = await startServer({
  port: 0,
  db: ':memory:',
  cwd: repoRoot,
  env: { SNAPBACK_OUTBOUND_ACTIONS: '1' },
  provenance: {
    appId: 'competitive-checkpoint',
    artifactsPath: join(backendDir, 'generated', 'artifacts.json'),
  },
});
const client = new SnapbackClient(server.baseUrl, server.clientOptions);
const cleanups = [() => server.stop()];
const suite = createSuite('competitive checkpoint / relational conversations', { expectedChecks: 5 });

await runAcceptance(suite, async () => {
  const functionManifest = generated('functions.manifest.json');
  const capabilityManifest = generated('capability.manifest.json');

  await suite.check('the generated artifact pair carries the experimental relational capability honestly', async () => {
    const relational = functionManifest.functions.find((fn) => fn.name === 'conversationsWithModel');
    assert(
      relational?.requiredCapabilities?.includes('relational_query_v1'),
      'the callable relational helper must require relational_query_v1',
    );
    assert(
      relational.readSetSummary?.mode === 'relational',
      'the generated read-set summary must declare the relational mode',
    );
    // @ref LLP 0080#7-generated-authoring-surface — the capability is
    // experimental until both RFCs flip; generation acknowledges the
    // experimental contract rather than silently depending on it.
    assert(
      functionManifest.acknowledgedExperimentalCapabilities?.includes('relational_query_v1'),
      'the generated bundle must acknowledge the experimental capability contract',
    );
    assertEqual(
      capabilityManifest.capabilityMaturity?.relational_query_v1,
      'experimental',
      'the paired target artifact records the capability maturity honestly',
    );
    return {
      helper: 'defineRelationalQuery',
      capability: 'relational_query_v1',
      acknowledgedExperimental: true,
    };
  });

  await client.loadSchema(generated('schema.manifest.json'));
  await client.loadFunctions(functionManifest);
  await client.reset();

  await client.mutate(api.registerModel, {
    userId: ADA,
    args: { slug: 'deterministic-v0', displayName: 'Deterministic v0', provider: 'checkpoint-lab' },
  });
  const adaSlugs = [];
  for (let index = 0; index < 10; index += 1) {
    const slug = `conv-${String(index).padStart(2, '0')}`;
    adaSlugs.push(slug);
    await client.mutate(api.createConversation, {
      userId: ADA,
      args: {
        slug,
        title: `Conversation ${index}`,
        model: index % 2 === 0 ? 'deterministic-v0' : 'unregistered-model',
      },
    });
  }
  for (const slug of ['grace-a', 'grace-b']) {
    await client.mutate(api.createConversation, {
      userId: GRACE,
      args: { slug, title: `Grace ${slug}`, model: 'deterministic-v0' },
    });
  }

  let firstPage;
  await suite.check('page 1 consumes the full take with explicit join leaves on both branches', async () => {
    firstPage = await client.query(api.conversationsWithModel, { userId: ADA });
    assertEqual(firstPage.rows.length, 8, 'take: 8 consumes eight authorized roots');
    assert(typeof firstPage.cursor === 'string' && firstPage.cursor.startsWith('sbrc1.'),
      'a full page carries the opaque versioned continuation cursor');
    for (const row of firstPage.rows) {
      if (row.model === 'deterministic-v0') {
        assertEqual(row.modelName, 'Deterministic v0', 'registered model projects its display name');
        assertEqual(row.modelProvider, 'checkpoint-lab', 'registered model projects the v1 provider leaf');
      } else {
        assertEqual(row.modelName ?? null, null, 'left join returns null model leaves');
        assertEqual(row.modelProvider ?? null, null, 'left join returns null provider leaf');
      }
    }
    return { take: 8, page1Rows: firstPage.rows.length, cursorFamily: 'sbrc1' };
  });

  await suite.check('the continuation resumes with no skipped and no duplicated root, and the short page is terminal', async () => {
    const secondPage = await client.query(api.conversationsWithModel, {
      userId: ADA,
      args: { cursor: firstPage.cursor },
    });
    assertEqual(secondPage.rows.length, 2, 'the remaining two roots arrive on page 2');
    assertEqual(secondPage.cursor ?? null, null, 'a short page is terminal — no cursor');
    const seen = [...firstPage.rows, ...secondPage.rows].map((row) => row.slug).sort();
    assertEqual(seen, [...adaSlugs].sort(), 'the union of pages is exactly the owner corpus');
    return { page2Rows: secondPage.rows.length, terminal: true };
  });

  await suite.check('results stay owner-scoped', async () => {
    const grace = await client.query(api.conversationsWithModel, { userId: GRACE });
    assertEqual(grace.rows.map((row) => row.slug).sort(), ['grace-a', 'grace-b'], 'other actor sees only their roots');
    assertEqual(grace.cursor ?? null, null, 'two roots under take: 8 is terminal');
    return { graceRows: grace.rows.length };
  });

  await suite.check('tampered and cross-user cursors refuse with one indistinguishable class', async () => {
    const tampered = `${firstPage.cursor.slice(0, -2)}zz`;
    await assertThrows(
      () => client.query(api.conversationsWithModel, { userId: ADA, args: { cursor: tampered } }),
      'SNAPBACK_RELATIONAL_CURSOR_INVALID',
      'a tampered cursor is refused, never repositioned',
    );
    // @ref LLP 0080#2-portable-evaluation-semantics — the cursor binds the caller's authority
    // partition: another user presenting a stolen cursor learns nothing
    // beyond the single refusal class.
    await assertThrows(
      () => client.query(api.conversationsWithModel, { userId: GRACE, args: { cursor: firstPage.cursor } }),
      'SNAPBACK_RELATIONAL_CURSOR_INVALID',
      'a cross-user cursor refuses with the same class',
    );
    return { refusalClass: 'SNAPBACK_RELATIONAL_CURSOR_INVALID', classes: ['tampered', 'cross-user'] };
  });
}, {
  cleanups,
  reportExtra: {
    schemaVersion: 'snapback.competitive-checkpoint.relational-conversations.v1',
    protocol: 'llp-0075-convex-checkpoint-v0',
    helper: 'defineRelationalQuery',
  },
  reportFile: join(here, '..', '..', 'acceptance', 'results', 'relational-conversations.v1.json'),
});
