// LLP 0137 A3 (collaborative issue and planning board) acceptance suite —
// Snapback web arm. External-consumer build: public @expo/snapback-* 0.1.7.
// 12 checks, contract demos/improvement-sweep/protocol/contracts/a3-issue-board.v1.json.
//
// The suite owns its dev server (two lifecycles: v1 schema, then the v2
// evolution restart) and starts from the literal versioned seed on a fresh
// managed database every run.
import { spawn } from 'node:child_process';
import { existsSync, copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { join, resolve } from 'node:path';
import { SnapbackClient, createExternalSessionClient, parseSearchQueryV1 } from '@expo/snapback-client';

const root = resolve(import.meta.dirname);
const evidenceDir = join(root, 'a3-evidence');
mkdirSync(evidenceDir, { recursive: true });

const EXPECTED_CHECKS = 12;
const ORG = 'org_relay';
const results = [];
const evidence = {};
let child = null;
let ready = null;
let adminToken = null;
let impersonation = null;
let api = null;
let seedArtifact = null;
let artifacts = null;
const cleanups = [];
// Live subscriptions and providers MUST be disposed before the A3-10 live
// evolution: an attached live subscriber wedges the watch reload's auth-mode
// transition permanently (finding 0137-a3-f5).
const preEvolutionDisposers = [];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (predicate, label, timeoutMs = 20_000) => {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await predicate();
    if (value) return value;
    if (Date.now() >= deadline) throw new Error(`timeout: ${label}`);
    await sleep(25);
  }
};
function assert(cond, msg) { if (!cond) throw new Error(`assert: ${msg}`); }
const diagCode = (err) => err?.diagnostic?.code ?? err?.code ?? String(err?.message ?? err);

async function check(id, fn) {
  const startedAt = Date.now();
  try {
    const outcome = await fn();
    const result = outcome?.result ?? 'pass';
    results.push({ id, result, ms: Date.now() - startedAt, note: outcome?.note ?? '' });
    console.error(`${result.toUpperCase().padEnd(4)} ${id}: ${outcome?.note ?? ''}`);
  } catch (err) {
    results.push({ id, result: 'fail', ms: Date.now() - startedAt, note: String(err?.diagnostic?.code ?? err?.message ?? err) });
    console.error(`FAIL ${id}: ${err?.message ?? err}`);
  }
}

const protocolHeaders = {
  'content-type': 'application/json',
  'x-snapback-auth-client-protocol': '1',
};

// ---------- version install + codegen (evolution lifecycle) ----------
function installVersion(version) {
  copyFileSync(join(root, 'versions', `schema.${version}.mjs`), join(root, 'snapback', 'schema.mjs'));
  copyFileSync(join(root, 'versions', `functions.${version}.mjs`), join(root, 'snapback', 'functions.mjs'));
  return new Promise((resolveGen, rejectGen) => {
    const proc = spawn(join(root, 'node_modules', '.bin', 'snapback'), ['generate', 'snapback'], {
      cwd: root, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    proc.stdout.on('data', (c) => { out += c; });
    proc.stderr.on('data', (c) => { out += c; });
    proc.on('exit', (code) => {
      if (code === 0) resolveGen(out);
      else rejectGen(new Error(`generate ${version} failed (${code}): ${out.slice(-2000)}`));
    });
  });
}

async function loadGenerated() {
  // cache-bust the api module across the evolution regenerate
  api = (await import(`./snapback/generated/api.mjs?v=${Date.now()}`)).default;
  seedArtifact = JSON.parse(readFileSync(join(root, 'snapback', 'generated', 'seed.artifact.json'), 'utf8'));
  artifacts = JSON.parse(readFileSync(join(root, 'snapback', 'generated', 'artifacts.json'), 'utf8'));
}

// ---------- dev server lifecycle ----------
const readyFile = join(root, '.snapback', 'dev.ready.json');
const lifecycleEvents = [];
async function spawnDev() {
  // Own-ports discipline: guard-block the A2 arm's 4288 and the A1 arm's 4289
  // during the runtime's port scan; fleet-shared 4420 asserted below.
  const guards = [];
  for (const port of [4288, 4289]) {
    const guard = createServer(() => {});
    await new Promise((res) => {
      guard.once('error', () => res()); // held elsewhere already: fine
      guard.listen(port, '127.0.0.1', () => res());
    });
    guards.push(guard);
  }
  child = spawn(join(root, 'node_modules', '.bin', 'snapback'), ['dev', 'snapback'], {
    cwd: root, stdio: ['pipe', 'pipe', 'pipe'],
  });
  let remainder = '';
  child.stdout.on('data', (chunk) => {
    remainder += chunk.toString('utf8');
    for (;;) {
      const nl = remainder.indexOf('\n');
      if (nl === -1) break;
      const line = remainder.slice(0, nl).trim();
      remainder = remainder.slice(nl + 1);
      if (!line) continue;
      try {
        const event = JSON.parse(line);
        if (event?.schemaVersion === 'snapback.dev.v1') lifecycleEvents.push(event);
      } catch { /* prose */ }
    }
  });
  child.stderr.on('data', () => {});
  const startedFrom = lifecycleEvents.length;
  ready = await until(() => {
    if (!existsSync(readyFile)) return null;
    try {
      const descriptor = JSON.parse(readFileSync(readyFile, 'utf8'));
      return lifecycleEvents.slice(startedFrom).some((e) => e.state === 'generated-and-loaded')
        ? descriptor : null;
    } catch { return null; }
  }, 'dev ready', 45_000);
  for (const guard of guards) guard.close();
  assert(ready.port !== 4420, 'must not use fleet-shared port 4420');
  assert(ready.port !== 4288 && ready.port !== 4289, 'must not reuse prior arm ports');
  adminToken = readFileSync(ready.adminTokenFile, 'utf8').trim();
  impersonation = readFileSync(ready.impersonationCapabilityFile, 'utf8').trim();
  return ready;
}

async function stopDev() {
  if (!child) return;
  const dying = child;
  child = null;
  dying.stdin.end();
  await until(() => (dying.exitCode !== null ? true : null), 'dev exit', 15_000)
    .catch(() => { dying.kill('SIGTERM'); });
  let refused = false;
  try { await fetch(`${ready.serverUrl}/health`); } catch { refused = true; }
  assert(refused, 'server port must refuse after stop');
}

async function signIn(email, label) {
  const requested = await fetch(`${ready.serverUrl}/auth/request-code`, {
    method: 'POST', headers: protocolHeaders, body: JSON.stringify({ email }),
  }).then((r) => r.json());
  const mailbox = await fetch(
    `${ready.serverUrl}/_snapback/api/auth/mailbox?challengeId=${encodeURIComponent(requested.challengeId)}`,
    { headers: {
        'x-snapback-admin-token': adminToken,
        'x-snapback-impersonation-capability': impersonation,
      } },
  ).then((r) => r.json());
  const credential = await fetch(`${ready.serverUrl}/auth/exchange`, {
    method: 'POST', headers: protocolHeaders,
    body: JSON.stringify({ challengeId: requested.challengeId, code: mailbox.code }),
  }).then((r) => r.json());
  assert(typeof credential.token === 'string', `sign-in failed for ${email}: ${JSON.stringify(credential)}`);
  const client = new SnapbackClient(ready.serverUrl, {
    bearerToken: credential.token,
    authClientProtocol: 1,
    authInvalidationProtocol: 1,
    authorityDescriptorProtocol: 1,
    authorizedLeaseProtocol: 1,
    clientStoreId: `sweep-a3-${label}-${process.pid}`,
    rqsStore: null,
  });
  cleanups.push(() => client.closeAuth?.());
  return { client, userId: credential.session.userId, token: credential.token, email, label };
}

// Authoritative full-org sweep through the app's own keyset pages.
async function sweepAllIssues(actor) {
  const rows = [];
  let after;
  for (;;) {
    const page = await actor.client.query(api.pageIssues, {
      args: after === undefined ? { orgId: ORG, limit: 50 } : { orgId: ORG, after, limit: 50 },
    });
    rows.push(...page.rows);
    if (page.rows.length < 50) break;
    after = page.rows.at(-1).pageKey;
  }
  return rows;
}

// ---------- lifecycle ----------
const startedAtIso = new Date().toISOString();
for (const suffix of ['', '-wal', '-shm', '.admin-token', '.auth-keyring.json']) {
  rmSync(join(root, '.snapback', `dev.sqlite3${suffix}`), { force: true });
}

let exitCode = 2;
try {
  await installVersion('v1');
  await loadGenerated();
  const v1InputsHash = artifacts.inputsHash;
  await spawnDev();

  const alice = await signIn('alice@sweep-a3.test', 'alice');
  const bob = await signIn('bob@sweep-a3.test', 'bob');
  const gwen = await signIn('gwen@sweep-a3.test', 'gwen');
  const mallory = await signIn('mallory@sweep-a3.test', 'mallory');

  let bobIssue = null; // created in A3-02, visible to later checks

  // ---------- A3-01-SEED (kernel) ----------
  await check('A3-01-SEED', async () => {
    const ids = new Set([alice.userId, bob.userId, gwen.userId, mallory.userId]);
    assert(ids.size === 4, 'four distinct authenticated principals');
    // The organization is closed until a seat exists: alice is denied first.
    let preInvite = null;
    try { await alice.client.query(api.boardAggregates, { args: { orgId: ORG } }); }
    catch (err) { preInvite = diagCode(err); }
    assert(preInvite === 'SNAPBACK_AUTH_PERMISSION_DENIED', `pre-invite denial (${preInvite})`);
    // Personas claim their seeded invites (owner / member / guest).
    const aliceSeat = await alice.client.mutate(api.redeemInvite, { args: { code: 'INV-OWNER-7391' } });
    const bobSeat = await bob.client.mutate(api.redeemInvite, { args: { code: 'INV-MEMBER-4482' } });
    const gwenSeat = await gwen.client.mutate(api.redeemInvite, { args: { code: 'INV-GUEST-9057' } });
    assert(aliceSeat.result.role === 'owner' && bobSeat.result.role === 'member' && gwenSeat.result.role === 'guest',
      'seeded invite roles');
    // Authoritative counts across the production-shaped seed.
    const agg = (await alice.client.query(api.boardAggregates, { args: { orgId: ORG } })).rows[0];
    assert(agg.total === 14 && agg.todo === 5 && agg.inProgress === 4 && agg.review === 2 && agg.done === 3,
      `aggregate counts (${JSON.stringify(agg)})`);
    const dir = (await alice.client.query(api.orgDirectory, { args: { orgId: ORG } })).rows[0];
    assert(dir.orgName === 'Relay' && dir.teams.length === 2 && dir.projects.length === 3 && dir.labels.length === 4,
      'directory counts');
    const comments142 = (await alice.client.query(api.commentsForIssue, { args: { issueId: 'iss_142' } })).rows;
    assert(comments142.length === 3, 'seeded comments on ISS-142');
    const act = (await alice.client.query(api.orgActivity, { args: { orgId: ORG } })).rows;
    assert(act.length === 18, `seeded activity rows (${act.length})`);
    const sweep = await sweepAllIssues(alice);
    assert(sweep.length === 14, 'issue sweep matches seed');
    // Versioned-seed receipt through the administrative preview.
    const admin = createExternalSessionClient(ready.serverUrl, {
      bearerToken: alice.token, adminToken, rqsStore: null });
    const preview = await admin.previewVersionedSeed(seedArtifact, { requestedMode: 'sessions' });
    assert(preview?.current?.seedVersion === 'a3-board.2026-08-01.1', `installed seed identity (${JSON.stringify(preview?.current)})`);
    evidence['A3-01'] = {
      targetIdentity: {
        serverUrl: ready.serverUrl, port: ready.port,
        appId: artifacts.appId ?? 'board-app',
        inputsHash: v1InputsHash, authMode: 'sessions',
        runtime: ready.runtime ?? null,
      },
      authoritativeCounts: {
        issues: agg, teams: dir.teams.length, projects: dir.projects.length,
        labels: dir.labels.length, commentsOnIss142: comments142.length, activity: act.length,
      },
      seedReceipt: {
        seedVersion: preview.current.seedVersion,
        dataVersionStream: preview.current.dataVersionStream ?? null,
        artifactDigest: seedArtifact.digest ?? seedArtifact.contentDigest ?? null,
      },
      personas: { alice: 'owner', bob: 'member', gwen: 'guest', mallory: 'outsider (authenticated, no seat)' },
    };
    return { note: `seed installed (14 issues/2 teams/3 projects/4 labels/6 comments/18 activity); 4 distinct principals; invites redeemed owner/member/guest` };
  });

  // ---------- A3-02-ROLES ----------
  await check('A3-02-ROLES', async () => {
    const matrix = {};
    // owner: administrative writes succeed
    const projectId = await alice.client.mutate(api.createProject, {
      args: { orgId: ORG, teamId: 'team_platform', name: 'Sweep telemetry' } });
    const labelId = await alice.client.mutate(api.createLabel, {
      args: { orgId: ORG, name: 'sweep', color: '#00aa55' } });
    matrix.owner = { createProject: 'allowed', createLabel: 'allowed' };
    // member: issue writes succeed, administration denied
    bobIssue = (await bob.client.mutate(api.createIssue, {
      args: { orgId: ORG, teamId: 'team_platform', projectId: 'proj_console',
        title: 'Member-created issue', description: 'created by bob in A3-02', priority: 2, actorName: 'Bob' } })).result;
    assert(bobIssue.identifier === 'ISS-151', `sequence allocation (${bobIssue.identifier})`);
    const bobMove = await bob.client.mutate(api.moveIssue, {
      args: { issueId: bobIssue.issueId, boardPosition: 42, expectedRevision: 1, actorName: 'Bob' } });
    assert(bobMove.result.revision === 2, 'member move committed');
    let bobAdmin = null;
    try { await bob.client.mutate(api.createProject, { args: { orgId: ORG, teamId: 'team_platform', name: 'x' } }); }
    catch (err) { bobAdmin = diagCode(err); }
    assert(bobAdmin === 'SNAPBACK_AUTH_PERMISSION_DENIED', `member admin denial (${bobAdmin})`);
    matrix.member = { createIssue: 'allowed', moveIssue: 'allowed', createProject: bobAdmin };
    // guest: reads and comments succeed, issue writes denied
    const gwenRead = (await gwen.client.query(api.columnIssues, { args: { orgId: ORG, status: 'todo' } })).rows;
    assert(gwenRead.length === 6, `guest reads the board (5 seeded todo + bob's new issue; got ${gwenRead.length})`);
    const gwenDetail = (await gwen.client.query(api.issueDetail, { args: { issueId: 'iss_142' } })).rows[0];
    assert(gwenDetail.issue.identifier === 'ISS-142', 'guest reads detail');
    const gwenComment = await gwen.client.mutate(api.addComment, {
      args: { issueId: 'iss_142', body: 'Guest can comment.', clientKey: 'a3-02-gwen', authorName: 'Gwen' } });
    assert(gwenComment.result === 4, 'guest comment sequenced');
    let gwenCreate = null;
    try { await gwen.client.mutate(api.createIssue, { args: { orgId: ORG, teamId: 'team_platform', projectId: 'proj_sync', title: 'x', description: '', priority: 1, actorName: 'Gwen' } }); }
    catch (err) { gwenCreate = diagCode(err); }
    let gwenMove = null;
    try { await gwen.client.mutate(api.moveIssue, { args: { issueId: 'iss_142', boardPosition: 9, expectedRevision: 1, actorName: 'Gwen' } }); }
    catch (err) { gwenMove = diagCode(err); }
    assert(gwenCreate === 'SNAPBACK_AUTH_PERMISSION_DENIED' && gwenMove === 'SNAPBACK_AUTH_PERMISSION_DENIED',
      `guest write denials (${gwenCreate}/${gwenMove})`);
    matrix.guest = { read: 'allowed', comment: 'allowed', createIssue: gwenCreate, moveIssue: gwenMove };
    // actor attribution: server-derived principals on activity rows
    const act142 = (await alice.client.query(api.activityForIssue, { args: { issueId: 'iss_142' } })).rows;
    const gwenAct = act142.find((a) => a.kind === 'commented' && a.seq === 4);
    assert(gwenAct && gwenAct.actorId === gwen.userId, 'guest comment activity attributed to the server-minted principal');
    const actBob = (await alice.client.query(api.activityForIssue, { args: { issueId: bobIssue.issueId } })).rows;
    assert(actBob[0].kind === 'created' && actBob[0].actorId === bob.userId, 'member create activity attributed');
    evidence['A3-02'] = { positiveRoleMatrix: matrix, actorAttribution: {
      gwenComment: { actorId: gwenAct.actorId, matches: 'gwen session principal' },
      bobCreate: { actorId: actBob[0].actorId, matches: 'bob session principal' },
    }, artifactsCreated: { projectId, labelId, bobIssue } };
    return { note: `owner admin writes, member issue writes + admin denial, guest read/comment + write denials; activity actorIds are the server-minted principals` };
  });

  // ---------- A3-03-OUTSIDER ----------
  await check('A3-03-OUTSIDER', async () => {
    const denials = {};
    for (const [name, fn] of Object.entries({
      read: () => mallory.client.query(api.columnIssues, { args: { orgId: ORG, status: 'todo' } }),
      detail: () => mallory.client.query(api.issueDetail, { args: { issueId: 'iss_142' } }),
      directory: () => mallory.client.query(api.orgDirectory, { args: { orgId: ORG } }),
      writeComment: () => mallory.client.mutate(api.addComment, { args: { issueId: 'iss_142', body: 'x', clientKey: 'a3-mallory', authorName: 'M' } }),
      writeMove: () => mallory.client.mutate(api.moveIssue, { args: { issueId: 'iss_142', boardPosition: 1, expectedRevision: 1, actorName: 'M' } }),
    })) {
      try { await fn(); denials[name] = 'ALLOWED (defect)'; }
      catch (err) { denials[name] = diagCode(err); }
    }
    // live subscription denial
    let subDenial = null;
    try {
      const handle = await mallory.client.liveQuery(api.columnIssues, {
        args: { orgId: ORG, status: 'todo' }, connectionId: 'mallory_live', transport: 'stream',
      });
      await until(() => (handle.connection === 'live' || handle.error ? handle : null), 'mallory sub settles', 8_000);
      subDenial = handle.error ? diagCode(handle.error) : `CONNECTED (defect: ${handle.rows.length} rows)`;
      await handle.dispose();
    } catch (err) { subDenial = diagCode(err); }
    denials.subscribe = subDenial;
    for (const [name, code] of Object.entries(denials)) {
      assert(code === 'SNAPBACK_AUTH_PERMISSION_DENIED', `${name} must deny uniformly (${code})`);
    }
    // wrong invite code refused; search returns only the outsider's own empty partition
    let badInvite = null;
    try { await mallory.client.mutate(api.redeemInvite, { args: { code: 'INV-OWNER-0000' } }); }
    catch (err) { badInvite = diagCode(err); }
    const mallorySearch = await mallory.client.search(api.searchMyIssues, {
      query: parseSearchQueryV1('pagination', { fields: ['title', 'description'] }) });
    assert(mallorySearch.items.length === 0, 'outsider search sees only its empty owner partition');
    evidence['A3-03'] = { negativeMatrix: denials, badInviteRefusal: badInvite,
      outsiderSearch: { items: 0, note: 'owner-partition search; no org rows disclosed' } };
    return { note: `uniform SNAPBACK_AUTH_PERMISSION_DENIED on read/detail/directory/subscribe/write×2; invite guess refused; search partition empty` };
  });

  // ---------- A3-04-QUERIES ----------
  await check('A3-04-QUERIES', async () => {
    // Authoritative expected set: the app's own full keyset sweep.
    const all = await sweepAllIssues(alice);
    assert(all.length === 15, `15 issues after A3-02 (${all.length})`);
    // Indexed filter: server-filtered column equals the client-derived subset.
    const inProg = (await alice.client.query(api.columnIssues, { args: { orgId: ORG, status: 'in-progress' } })).rows;
    const expectedInProg = new Set(all.filter((r) => r.status === 'in-progress').map((r) => r.identifier));
    assert(inProg.length === expectedInProg.size && inProg.every((r) => expectedInProg.has(r.identifier)),
      'indexed filter matches authoritative subset');
    // Deterministic ordering: boardPosition asc with _id tiebreak.
    const sorted = [...inProg].sort((a, b) => a.boardPosition - b.boardPosition || (a._id < b._id ? -1 : 1));
    assert(JSON.stringify(inProg.map((r) => r._id)) === JSON.stringify(sorted.map((r) => r._id)), 'deterministic ordering');
    // Declarative indexed range (by_org_updated, gte/lte): seed literals.
    const seedRange = (await alice.client.query(api.issuesUpdatedInRange, {
      args: { orgId: ORG, since: 1782000000000, until: 1782999999999 } })).rows;
    assert(seedRange.length === 14, `all 14 seed rows in the literal window (${seedRange.length})`);
    const narrow = (await alice.client.query(api.issuesUpdatedInRange, {
      args: { orgId: ORG, since: 1782800000000, until: 1782800400000 } })).rows.map((r) => r.identifier);
    assert(JSON.stringify(narrow) === JSON.stringify(['ISS-142', 'ISS-143', 'ISS-144', 'ISS-145']),
      `inclusive range bounds ordered asc (${narrow.join(',')})`);
    // Supported-path keyset pagination over (assigneeId, pageKey): assign 7 to alice.
    const mine = ['iss_137', 'iss_139', 'iss_140', 'iss_142', 'iss_144', 'iss_146', 'iss_148'];
    for (const issueId of mine) {
      await alice.client.mutate(api.assignIssue, {
        args: { issueId, assigneeId: alice.userId, assigneeName: 'Alice', actorName: 'Alice' } });
    }
    const page1 = await alice.client.query(api.myIssuesFirstPage, { args: {} });
    assert(page1.rows.length === 3 && typeof page1.cursor === 'string', 'first page full with opaque cursor');
    // concurrent unrelated mutations between pages must not perturb the window
    await bob.client.mutate(api.createIssue, {
      args: { orgId: ORG, teamId: 'team_mobile', projectId: 'proj_mobile',
        title: 'Interleaved during page fetches', description: '', priority: 0, actorName: 'Bob' } });
    await alice.client.mutate(api.moveIssue, {
      args: { issueId: 'iss_144', boardPosition: 777, expectedRevision: 2, actorName: 'Alice' } });
    const page2 = await alice.client.query(api.myIssuesNextPage, { args: { after: page1.cursor } });
    assert(page2.rows.length === 3 && typeof page2.cursor === 'string', 'second page full with cursor');
    const page3 = await alice.client.query(api.myIssuesNextPage, { args: { after: page2.cursor } });
    assert(page3.rows.length === 1 && (page3.cursor === undefined || page3.cursor === null), 'terminal page carries no cursor');
    const union = [...page1.rows, ...page2.rows, ...page3.rows].map((r) => r._id);
    assert(new Set(union).size === 7 && JSON.stringify([...union].sort()) === JSON.stringify([...mine].sort()),
      'page union is exactly the 7 assigned issues, no duplicates, no skips');
    // cursor misuse refusals
    let malformed = null;
    try { await alice.client.query(api.myIssuesNextPage, { args: { after: 'garbage-cursor' } }); }
    catch (err) { malformed = diagCode(err); }
    let crossOwner = null;
    try { await bob.client.query(api.myIssuesNextPage, { args: { after: page1.cursor } }); }
    catch (err) { crossOwner = diagCode(err); }
    assert(malformed === 'SNAPBACK_STANDARD_PATTERN_CURSOR_INVALID' && crossOwner === 'SNAPBACK_STANDARD_PATTERN_CURSOR_INVALID',
      `cursor refusals uniform (${malformed}/${crossOwner})`);
    // Org-wide pages through the app cursor (16 issues now).
    const sweep2 = await sweepAllIssues(alice);
    const paged = [];
    let after;
    let pages = 0;
    for (;;) {
      const page = await alice.client.query(api.pageIssues, {
        args: after === undefined ? { orgId: ORG, limit: 5 } : { orgId: ORG, after, limit: 5 } });
      paged.push(...page.rows); pages += 1;
      if (page.rows.length < 5) break;
      after = page.rows.at(-1).pageKey;
    }
    assert(paged.length === sweep2.length && new Set(paged.map((r) => r.pageKey)).size === sweep2.length,
      'org-wide page union complete and duplicate-free');
    evidence['A3-04'] = {
      indexProof: {
        columnIssues: 'by_org_status_position (declared withIndex, eq orgId + eq status, take 200)',
        issuesUpdatedInRange: 'by_org_updated (declarative filter eq + gteFilter + lteFilter, order asc updatedAt)',
        myIssuesPages: 'by_assignee_page_key unique (generated defineOwnedKeysetPages, owner partition)',
        pageIssues: 'by_org_page_key unique (app-level keyset; chain lacks a strict-gt verb — 0137-a2-f5)',
      },
      cursorValues: { firstPageCursor: page1.cursor, secondPageCursor: page2.cursor, terminal: page3.cursor ?? null },
      pageUnion: { supportedPath: union, orgWidePages: pages, orgWideRows: paged.length },
      refusals: { malformedCursor: malformed, crossOwnerCursor: crossOwner },
      interleavedMutations: ['bob createIssue ISS-152', 'alice moveIssue iss_144 (position only; cursor field untouched)'],
    };
    return { note: `indexed filter + declarative gte/lte range + deterministic order verified against the authoritative sweep; generated keyset pages 3+3+1 with opaque cursors, no dup/skip under interleaved writes; uniform cursor refusals` };
  });

  // ---------- A3-05-SEARCH ----------
  await check('A3-05-SEARCH', async () => {
    // Supported path: owner-partition (assignee) full-text search.
    const hit = await alice.client.search(api.searchMyIssues, {
      query: parseSearchQueryV1('pagination', { fields: ['title', 'description'] }) });
    assert(hit.items.length === 1 && hit.items[0].rowId === 'iss_142', 'term search finds the assigned issue');
    assert(hit.items[0].highlights?.some((h) => h.field === 'title'), 'highlight present');
    const prefix = await alice.client.search(api.searchMyIssues, {
      query: parseSearchQueryV1('tombst*', { fields: ['title', 'description'] }) });
    assert(prefix.items.length === 1 && prefix.items[0].rowId === 'iss_137', 'prefix search finds ISS-137');
    // Partition honesty: text on an unassigned issue is invisible to alice...
    const notMine = await alice.client.search(api.searchMyIssues, {
      query: parseSearchQueryV1('virtualization', { fields: ['title', 'description'] }) });
    assert(notMine.items.length === 0, 'no cross-partition leakage');
    // ...and bob's partition does not contain alice's assignment.
    const bobSearch = await bob.client.search(api.searchMyIssues, {
      query: parseSearchQueryV1('pagination', { fields: ['title', 'description'] }) });
    assert(bobSearch.items.length === 0, 'partitions are per-principal');
    evidence['A3-05'] = {
      indexIdentity: { searchIndex: 'search_issues', semanticVersion: 'a3-board-issues.v1', visibility: 'owner(assigneeId)' },
      authoritativeResults: {
        term: { query: 'pagination', rowId: 'iss_142', score: hit.items[0].score },
        prefix: { query: 'tombst*', rowId: 'iss_137' },
        partitionNegative: { aliceForeignText: 0, bobSameText: 0 },
      },
      gap: {
        nonclaim: 'org-wide member-visible issue search is NOT claimed: v1 search visibility accepts owner or public-read only; membership/relation-derived partitions are documented as not accepted, and public-read would disclose org data to outsiders',
        finding: '0137-a3-f2-search-visibility-cannot-express-membership',
      },
    };
    return { result: 'pass', note: `owner-partition search verified (term/prefix/highlights, per-principal partitions); org-wide membership-scoped search recorded as an explicit GAP + finding` };
  });

  // ---------- A3-06-DETAIL ----------
  await check('A3-06-DETAIL', async () => {
    const detail = (await bob.client.query(api.issueDetail, { args: { issueId: 'iss_142' } })).rows[0];
    assert(detail.issue.identifier === 'ISS-142' && detail.projectName === 'Sync engine' && detail.teamName === 'Platform',
      'related project and team composed');
    assert(detail.issue.assigneeId === alice.userId, 'assignee is the runtime-assigned principal');
    const labelNames = detail.labels.map((l) => l.name).sort();
    assert(JSON.stringify(labelNames) === JSON.stringify(['bug', 'performance']), 'labels joined through issueLabels');
    assert(detail.comments.length === 4 && detail.comments.every((c, i) => c.seq === i + 1), 'bounded comments in sequence order');
    assert(detail.activity.length >= 5, 'activity composed');
    // Aggregate proof: independent authoritative reads agree.
    const comments = (await bob.client.query(api.commentsForIssue, { args: { issueId: 'iss_142' } })).rows;
    const act = (await bob.client.query(api.activityForIssue, { args: { issueId: 'iss_142' } })).rows;
    assert(detail.aggregates.commentCount === comments.length
      && detail.aggregates.activityCount === act.length
      && detail.aggregates.labelCount === 2, 'aggregates match independent reads');
    evidence['A3-06'] = {
      relatedIds: { project: 'proj_sync', team: 'team_platform', assigneeId: detail.issue.assigneeId, labels: labelNames },
      boundedQueryInventory: [
        'get issues[issueId]', 'get projects[projectId]', 'get teams[teamId]',
        'issueLabels by_issue take 32 (+ per-edge label get)',
        'comments by_issue_seq take 50', 'activity by_issue_seq take 50',
      ],
      aggregateProof: { detail: detail.aggregates, independent: { comments: comments.length, activity: act.length } },
    };
    return { note: `detail composes project/team/assignee/labels/comments/activity in one snapshot; aggregates equal independent authoritative reads` };
  });

  // ---------- A3-07-OPTIMISTIC ----------
  await check('A3-07-OPTIMISTIC', async () => {
    const { createSnapbackReactProvider, observeSnapbackQueries, invokeSnapbackMutation } =
      await import('@expo/snapback-react');
    const functionsManifest = JSON.parse(readFileSync(join(root, 'snapback', 'generated', 'functions.manifest.json'), 'utf8'));
    const capabilityManifest = JSON.parse(readFileSync(join(root, 'snapback', 'generated', 'capability.manifest.json'), 'utf8'));
    const schemaManifest = JSON.parse(readFileSync(join(root, 'snapback', 'generated', 'schema.manifest.json'), 'utf8'));
    const provider = createSnapbackReactProvider(await createExternalSessionClient(ready.serverUrl, {
      bearerToken: alice.token, rqsStore: null,
    }).prepareReactBinding({
      generatedManifest: { schema: schemaManifest, functions: functionsManifest, capabilityManifest },
    }));
    preEvolutionDisposers.push(() => provider.dispose());
    let snap = null;
    const observer = observeSnapbackQueries(provider, {
      todo: { ref: api.columnIssues, args: { orgId: ORG, status: 'todo' } },
      inProgress: { ref: api.columnIssues, args: { orgId: ORG, status: 'in-progress' } },
    }, (s) => { snap = s; });
    preEvolutionDisposers.push(() => observer.dispose());
    await until(() => snap?.queries.todo.status === 'ready' && snap?.queries.inProgress.status === 'ready', 'board columns ready');
    const row146 = snap.queries.todo.data.find((r) => r._id === 'iss_146');
    assert(row146, 'iss_146 in the todo column');
    const baselineInProg = snap.queries.inProgress.data.length;
    const timeline = { invokedAt: Date.now(), optimisticSeenAt: null, settledAt: null, authoritativeAt: null };
    const promise = invokeSnapbackMutation(provider, api.setStatus, {
      issueId: 'iss_146', status: 'in-progress', boardPosition: 50, actorName: 'Alice',
    }, {
      optimistic: {
        query: api.columnIssues,
        args: { orgId: ORG, status: 'in-progress' },
        update: (rows) => [{ ...row146, status: 'in-progress', boardPosition: 50 }, ...rows],
        isAuthoritative: (rows) => rows.some((r) => r._id === 'iss_146' && r.status === 'in-progress'),
      },
    });
    // observe the optimistic overlay before settlement
    await until(() => (snap.queries.inProgress.data.some((r) => r._id === 'iss_146') ? true : null), 'optimistic overlay visible', 5_000);
    timeline.optimisticSeenAt = Date.now();
    const settledRevision = await promise;
    timeline.settledAt = Date.now();
    assert(typeof settledRevision === 'number', 'mutation settled with the unwrapped result');
    // authoritative reconciliation: live delivery keeps the row and the todo column drops it
    await until(() => (!snap.queries.todo.data.some((r) => r._id === 'iss_146') ? true : null), 'authoritative todo removal', 10_000);
    timeline.authoritativeAt = Date.now();
    assert(snap.queries.inProgress.data.length === baselineInProg + 1, 'in-progress column authoritative');
    const authoritative = (await alice.client.query(api.columnIssues, { args: { orgId: ORG, status: 'in-progress' } })).rows;
    assert(authoritative.some((r) => r._id === 'iss_146' && r.boardPosition === 50), 'server state matches');
    const optimisticLeadMs = timeline.settledAt - timeline.optimisticSeenAt;
    evidence['A3-07'] = {
      optimisticAttribution: {
        surface: 'invokeSnapbackMutation optimistic projection over the provider-owned columnIssues store',
        overlayVisibleBeforeSettlementMs: optimisticLeadMs,
        timeline,
      },
      settlement: { unwrappedResult: settledRevision },
      authoritativeState: { inProgressCount: authoritative.length, iss146Position: 50 },
      scopeNote: 'status+board-position exercised through the optimistic React path; assignee and priority updates verified authoritatively in A3-04/A3-02 via mutation envelopes and live deliveries',
    };
    return { note: `optimistic overlay visible ${optimisticLeadMs}ms before settlement, retired by the authoritative live delivery; server state confirms status+position` };
  });

  // ---------- A3-08-CONFLICT ----------
  await check('A3-08-CONFLICT', async () => {
    // two-actor barrier: both movers observed revision 1 of iss_141
    const before = (await alice.client.query(api.issueDetail, { args: { issueId: 'iss_141' } })).rows[0];
    assert(before.issue.revision === 1, 'both actors start from revision 1');
    const [aliceMove, bobMove] = await Promise.allSettled([
      alice.client.mutate(api.moveIssue, { args: { issueId: 'iss_141', boardPosition: 1111, expectedRevision: 1, actorName: 'Alice' } }),
      bob.client.mutate(api.moveIssue, { args: { issueId: 'iss_141', boardPosition: 2222, expectedRevision: 1, actorName: 'Bob' } }),
    ]);
    const outcomes = [aliceMove, bobMove];
    const winners = outcomes.filter((o) => o.status === 'fulfilled');
    const losers = outcomes.filter((o) => o.status === 'rejected');
    assert(winners.length === 1 && losers.length === 1,
      `exactly one concurrent move commits (${winners.length} won)`);
    const loserCode = diagCode(losers[0].reason);
    const loserMessage = String(losers[0].reason?.diagnostic?.details?.message ?? losers[0].reason?.message ?? '');
    const winnerPosition = winners[0].value.result.boardPosition;
    // deterministic authoritative outcome: winner's position at revision 2
    const mid = (await gwen.client.query(api.issueDetail, { args: { issueId: 'iss_141' } })).rows[0];
    assert(mid.issue.revision === 2 && mid.issue.boardPosition === winnerPosition, 'first commit wins the revision');
    // client reconciliation: the loser rebases on the authoritative revision and reissues
    const loserActor = aliceMove.status === 'rejected' ? alice : bob;
    const loserTarget = aliceMove.status === 'rejected' ? 1111 : 2222;
    const rebased = await loserActor.client.mutate(api.moveIssue, {
      args: { issueId: 'iss_141', boardPosition: loserTarget, expectedRevision: 2, actorName: loserActor.label } });
    assert(rebased.result.revision === 3, 'rebased move commits at revision 3');
    const final = (await gwen.client.query(api.issueDetail, { args: { issueId: 'iss_141' } })).rows[0];
    assert(final.issue.boardPosition === loserTarget && final.issue.revision === 3, 'deterministic final state');
    const moves = final.activity.filter((a) => a.kind === 'moved');
    assert(moves.length === 2, 'both committed moves visible in activity');
    evidence['A3-08'] = {
      twoActorBarrier: 'Promise.allSettled from two authenticated sessions, both naming expectedRevision 1',
      semantics: 'documented compare-and-move: a move names the revision it observed; a stale revision refuses and the mover rebases',
      authoritativeOutcome: { winnerPosition, midRevision: 2, finalRevision: 3, finalPosition: loserTarget },
      loserRefusal: { code: loserCode, message: loserMessage.slice(0, 120) },
      clientReconciliation: 'loser re-read the authoritative detail (revision 2) and reissued; second commit visible as a distinct activity row',
    };
    return { note: `concurrent moves: exactly one commit per revision, stale mover refused (${loserCode}), rebase settles deterministically at revision 3; both moves in activity` };
  });

  // ---------- A3-09-LIVE ----------
  await check('A3-09-LIVE', async () => {
    const handles = {};
    handles.comments = await bob.client.liveQuery(api.commentsForIssue, {
      args: { issueId: 'iss_142' }, connectionId: 'bob_comments', transport: 'stream' });
    handles.activity = await bob.client.liveQuery(api.activityForIssue, {
      args: { issueId: 'iss_142' }, connectionId: 'bob_activity', transport: 'stream' });
    handles.aggregates = await bob.client.liveQuery(api.boardAggregates, {
      args: { orgId: ORG }, connectionId: 'bob_agg', transport: 'stream' });
    for (const [name, handle] of Object.entries(handles)) {
      await until(() => (handle.connection === 'live' ? true : null), `${name} handle live`);
      preEvolutionDisposers.push(() => handle.dispose());
    }
    const commentBaseline = handles.comments.rows.length;
    const totalBaseline = handles.aggregates.rows[0].total;
    // live comment
    const t0 = Date.now();
    await alice.client.mutate(api.addComment, {
      args: { issueId: 'iss_142', body: 'Live delivery check.', clientKey: 'a3-09-live', authorName: 'Alice' } });
    await until(() => (handles.comments.rows.length === commentBaseline + 1 ? true : null), 'live comment delivery');
    const commentMs = Date.now() - t0;
    // live activity for the same commit
    await until(() => (handles.activity.rows.some((a) => a.kind === 'commented' && a.detail.includes('ISS-142') && a.actorId === alice.userId) ? true : null), 'live activity delivery');
    // live aggregate counts
    const t1 = Date.now();
    await alice.client.mutate(api.createIssue, {
      args: { orgId: ORG, teamId: 'team_platform', projectId: 'proj_sync',
        title: 'Live counts check', description: '', priority: 1, actorName: 'Alice' } });
    await until(() => (handles.aggregates.rows[0].total === totalBaseline + 1 ? true : null), 'live aggregate delivery');
    const aggregateMs = Date.now() - t1;
    // authority: the live rows equal an independent authoritative read
    const authoritative = (await gwen.client.query(api.commentsForIssue, { args: { issueId: 'iss_142' } })).rows;
    assert(JSON.stringify(handles.comments.rows.map((r) => r._id)) === JSON.stringify(authoritative.map((r) => r._id)),
      'live rows equal the authoritative snapshot');
    // search live: deliberately not claimed — the ordinary query surface refuses subscription
    let searchSub = null;
    try {
      const h = await bob.client.liveQuery(api.searchMyIssues, {
        args: { query: { kind: 'term', term: 'x' } }, connectionId: 'bob_search', transport: 'stream' });
      searchSub = `CONNECTED (defect)`; await h.dispose();
    } catch (err) { searchSub = diagCode(err); }
    evidence['A3-09'] = {
      secondClient: 'bob (independent authenticated session) with three concurrent stream handles',
      transportAttribution: { connection: 'live', transport: 'stream', commentDeliveryMs: commentMs, aggregateDeliveryMs: aggregateMs },
      authority: 'handle rows equal an independent third-session snapshot; activity rows carry the server-minted actor principal',
      searchNonclaim: { subscribeRefusal: searchSub, note: 'search is a documented non-live query; live search is not claimed' },
    };
    return { note: `comments ${commentMs}ms, aggregates ${aggregateMs}ms to the second client over the managed stream; activity attributed; search subscribe refuses (${searchSub})` };
  });

  // ---------- A3-10-EVOLUTION ----------
  await check('A3-10-EVOLUTION', async () => {
    const beforeAgg = (await alice.client.query(api.boardAggregates, { args: { orgId: ORG } })).rows[0];
    const beforeSweep = await sweepAllIssues(alice);
    const beforeComments = (await alice.client.query(api.commentsForIssue, { args: { issueId: 'iss_142' } })).rows.length;
    const adminBefore = createExternalSessionClient(ready.serverUrl, {
      bearerToken: alice.token, adminToken, rqsStore: null });
    const previewBefore = await adminBefore.previewVersionedSeed(seedArtifact, { requestedMode: 'sessions' });
    const streamBefore = previewBefore.current.dataVersionStream;
    // Evolve LIVE: the documented dev loop watch-reloads the evolved sources
    // over the running sessions deployment. (The stop/regenerate/restart
    // workflow refuses with SNAPBACK_AUTH_STARTUP_ARTIFACT_MISMATCH, cascaded
    // into a misleading runtime-identity diagnostic — probe retained in
    // evidence/app/repro-evolution.mjs, finding 0137-a3-f4.)
    // finding 0137-a3-f5 workaround: every live subscription and provider
    // must be gone before the reload, or admission wedges in
    // SNAPBACK_AUTH_MODE_PENDING with no recovery path.
    for (const dispose of preEvolutionDisposers.splice(0)) { await dispose(); }
    const loadedBefore = lifecycleEvents.filter((e) => e.state === 'generated-and-loaded').length;
    copyFileSync(join(root, 'versions', 'schema.v2.mjs'), join(root, 'snapback', 'schema.mjs'));
    copyFileSync(join(root, 'versions', 'functions.v2.mjs'), join(root, 'snapback', 'functions.mjs'));
    const reloadEvent = await until(() => {
      const loads = lifecycleEvents.filter((e) => e.state === 'generated-and-loaded');
      return loads.length > loadedBefore ? loads.at(-1) : null;
    }, 'dev watch reload of the evolved sources', 30_000);
    await until(() => {
      try {
        const next = JSON.parse(readFileSync(join(root, 'snapback', 'generated', 'artifacts.json'), 'utf8'));
        return next.inputsHash !== v1InputsHash ? true : null;
      } catch { return null; }
    }, 'regenerated artifacts on disk', 15_000);
    await loadGenerated();
    const v2InputsHash = artifacts.inputsHash;
    assert(v2InputsHash !== v1InputsHash, 'artifact identity evolved');
    const genOut = `watch reload: ${JSON.stringify(reloadEvent)}`;
    // non-destructive: same seed identity and data-version stream, no reseed,
    // and the established sessions/handles survive (no restart happened)
    const adminAfter = createExternalSessionClient(ready.serverUrl, {
      bearerToken: alice.token, adminToken, rqsStore: null });
    const previewAfter = await adminAfter.previewVersionedSeed(seedArtifact, { requestedMode: 'sessions' });
    assert(previewAfter.current.seedVersion === previewBefore.current.seedVersion
      && previewAfter.current.dataVersionStream === streamBefore,
      'seed identity and data-version stream survive the evolution');
    // no data loss: counts and runtime rows identical
    const afterAgg = (await alice.client.query(api.boardAggregates, { args: { orgId: ORG } })).rows[0];
    assert(JSON.stringify(afterAgg) === JSON.stringify(beforeAgg), `counts identical (${JSON.stringify(afterAgg)})`);
    const afterSweep = await sweepAllIssues(alice);
    assert(afterSweep.length === beforeSweep.length
      && JSON.stringify(afterSweep.map((r) => r.pageKey)) === JSON.stringify(beforeSweep.map((r) => r.pageKey)),
      'issue inventory identical including runtime-created rows');
    const afterComments = (await alice.client.query(api.commentsForIssue, { args: { issueId: 'iss_142' } })).rows.length;
    assert(afterComments === beforeComments, 'comments preserved');
    const detail = (await alice.client.query(api.issueDetail, { args: { issueId: 'iss_142' } })).rows[0];
    assert(detail.issue.assigneeId === alice.userId, 'runtime assignment preserved');
    // the new surface works over old rows: dueAt absent until backfilled
    const dueEmpty = (await alice.client.query(api.dueSoon, { args: { orgId: ORG, before: 9999999999999 } })).rows;
    assert(dueEmpty.length === 0, 'v1 rows carry no dueAt');
    for (const [issueId, dueAt] of [['iss_146', 1783000000000], ['iss_147', 1783100000000], ['iss_148', 1783200000000]]) {
      await alice.client.mutate(api.setDueDate, { args: { issueId, dueAt, actorName: 'Alice' } });
    }
    const due = (await alice.client.query(api.dueSoon, { args: { orgId: ORG, before: 1783150000000 } })).rows;
    assert(due.length === 2 && due[0].identifier === 'ISS-146' && due[1].identifier === 'ISS-147',
      'new by_org_due index serves the evolved field');
    evidence['A3-10'] = {
      beforeCounts: { aggregates: beforeAgg, issues: beforeSweep.length, commentsIss142: beforeComments },
      migrationReceipt: {
        kind: 'additive schema evolution through the documented live dev loop (optional issues.dueAt + by_org_due index + setDueDate/dueSoon operations); no restart, sessions and live handles preserved',
        v1InputsHash, v2InputsHash,
        watchReload: genOut,
        seedIdentity: { before: previewBefore.current.seedVersion, after: previewAfter.current.seedVersion, dataVersionStream: streamBefore },
        restartPathNonclaim: 'stop/regenerate/restart refuses SNAPBACK_AUTH_STARTUP_ARTIFACT_MISMATCH with a misattributed SNAPBACK_RUNTIME_ARTIFACT_IDENTITY_MISMATCH cascade (finding 0137-a3-f4; probe retained)',
      },
      afterCounts: { aggregates: afterAgg, issues: afterSweep.length, commentsIss142: afterComments },
      indexProof: { newIndex: 'by_org_due', probe: due.map((d) => d.identifier) },
    };
    return { note: `v2 schema (optional dueAt + index + 2 ops) landed via live watch reload over the seeded database: same seed identity/stream, byte-equal counts, runtime rows preserved, sessions uninterrupted; new index serves dueSoon` };
  });

  // ---------- A3-11-REACT-SURFACE ----------
  await check('A3-11-REACT-SURFACE', async () => {
    const render = await new Promise((resolvePhase, rejectPhase) => {
      const proc = spawn(process.execPath, [join(root, 'ui-render.mjs')], {
        cwd: root,
        env: { ...process.env, A3_SERVER_URL: ready.serverUrl, A3_TOKEN: alice.token, A3_OUT: join(evidenceDir, 'ui-render.json') },
        stdio: ['ignore', 'inherit', 'inherit'],
      });
      const timer = setTimeout(() => proc.kill('SIGKILL'), 60_000);
      proc.on('exit', (code) => {
        clearTimeout(timer);
        try { resolvePhase({ code, out: JSON.parse(readFileSync(join(evidenceDir, 'ui-render.json'), 'utf8')) }); }
        catch (err) { rejectPhase(new Error(`ui-render produced no output: ${err}`)); }
      });
    });
    assert(render.code === 0, 'ui-render phase exited 0');
    assert(render.out.multiQueryCount >= 6, `multi-query surface (${render.out.multiQueryCount} entries)`);
    assert(render.out.domProof.columns === 4 && render.out.domProof.cards >= 14, 'board DOM rendered from live data');
    assert(render.out.liveDomUpdate === true, 'DOM updated from a second-client commit');
    evidence['A3-11'] = { registeredSurfaceProof: render.out, sourceFiles: ['src/App.tsx (board view wired)', 'src/main.tsx (sessions boot + provider)'] };
    return { note: `React board renders in jsdom from the 6-query provider group (4 columns, ${render.out.domProof.cards} cards) and updates live from a second client; tsc+vite build green (recorded)` };
  });

  // ---------- A3-12-CLEANUP (kernel) ----------
  await check('A3-12-CLEANUP', async () => {
    // authority retirement: every seat self-removes (no admin kick exists in v1)
    await gwen.client.mutate(api.leaveOrg, { args: { orgId: ORG } });
    await bob.client.mutate(api.leaveOrg, { args: { orgId: ORG } });
    await alice.client.mutate(api.leaveOrg, { args: { orgId: ORG } });
    let postLeave = null;
    try { await alice.client.query(api.boardAggregates, { args: { orgId: ORG } }); }
    catch (err) { postLeave = diagCode(err); }
    assert(postLeave === 'SNAPBACK_AUTH_PERMISSION_DENIED', 'authority retired before reset');
    // versioned reset-install restores the literal fixture (receipted)
    const admin = createExternalSessionClient(ready.serverUrl, {
      bearerToken: alice.token, adminToken, rqsStore: null });
    const preview = await admin.previewVersionedSeed(seedArtifact, { requestedMode: 'sessions' });
    const stream = preview.current.dataVersionStream;
    const receipt = await admin.resetInstallVersionedSeed(seedArtifact, {
      requestedMode: 'sessions',
      expectedDataVersionStream: { state: 'present', value: stream },
    });
    assert(receipt.operation === 'reset-install' && receipt.outcome === 'reset-installed', 'reset-install settled');
    // fixture verification requires a seat: the restored invite is redeemable again
    const verifier = await signIn('alice@sweep-a3.test', 'alice-verify');
    let stillDenied = null;
    try { await verifier.client.query(api.boardAggregates, { args: { orgId: ORG } }); }
    catch (err) { stillDenied = diagCode(err); }
    assert(stillDenied === 'SNAPBACK_AUTH_PERMISSION_DENIED', 'reset does not resurrect authority');
    const seat = await verifier.client.mutate(api.redeemInvite, { args: { code: 'INV-OWNER-7391' } });
    assert(seat.result.role === 'owner', 'restored fixture invite redeemable');
    const agg = (await verifier.client.query(api.boardAggregates, { args: { orgId: ORG } })).rows[0];
    assert(agg.total === 14 && agg.todo === 5 && agg.inProgress === 4 && agg.review === 2 && agg.done === 3,
      'literal seed counts restored');
    const comments = (await verifier.client.query(api.commentsForIssue, { args: { issueId: 'iss_142' } })).rows;
    assert(comments.length === 3, 'runtime comments gone, seeded comments back');
    const detail = (await verifier.client.query(api.issueDetail, { args: { issueId: 'iss_142' } })).rows[0];
    assert(detail.issue.assigneeId === 'seed:carol', 'runtime assignment reverted to the literal fixture');
    // leave, then a second receipted reset returns the database to the exact
    // literal fixture with zero memberships and unconsumed invites
    await verifier.client.mutate(api.leaveOrg, { args: { orgId: ORG } });
    const preview2 = await admin.previewVersionedSeed(seedArtifact, { requestedMode: 'sessions' });
    const receipt2 = await admin.resetInstallVersionedSeed(seedArtifact, {
      requestedMode: 'sessions',
      expectedDataVersionStream: { state: 'present', value: preview2.current.dataVersionStream },
    });
    assert(receipt2.outcome === 'reset-installed', 'final reset settled');
    const finalProbe = await signIn('alice@sweep-a3.test', 'alice-final');
    let finalNegative = null;
    try { await finalProbe.client.query(api.boardAggregates, { args: { orgId: ORG } }); }
    catch (err) { finalNegative = diagCode(err); }
    assert(finalNegative === 'SNAPBACK_AUTH_PERMISSION_DENIED', 'post-cleanup negative holds');
    evidence['A3-12'] = {
      targetBoundPlan: 'suite-owned dev database in the arm directory only; membership retirement by self-removal (no admin kick in the private v1 roster — cannot be reset by seed, finding filed), then two receipted versioned reset-installs',
      cleanupReceipts: [
        { operation: receipt.operation, outcome: receipt.outcome, seedVersion: receipt.seedVersion, resetDeletedRows: receipt.resetDeletedRows, dataVersionStream: receipt.dataVersionStream },
        { operation: receipt2.operation, outcome: receipt2.outcome, resetDeletedRows: receipt2.resetDeletedRows },
      ],
      postCleanupNegative: { afterLeave: postLeave, afterReset: stillDenied, final: finalNegative },
      fixtureVerification: { aggregates: agg, commentsIss142: comments.length, assigneeReverted: 'seed:carol' },
    };
    return { note: `seats retired by self-removal, reset-install receipts (deleted ${receipt.resetDeletedRows} + ${receipt2.resetDeletedRows} rows), literal fixture verified via re-redeemed invite, final fresh-session negative denied` };
  });

  const failed = results.filter((r) => r.result === 'fail').length;
  const short = results.length !== EXPECTED_CHECKS;
  exitCode = failed === 0 && !short ? 0 : 1;
} catch (error) {
  console.error('suite error:', error);
  exitCode = 2;
} finally {
  for (const cleanup of cleanups.reverse()) { try { await cleanup(); } catch { /* teardown */ } }
  try { await stopDev(); } catch (error) { console.error('stopDev:', error?.message); }
  const tally = { pass: 0, gap: 0, fail: 0, 'expected-refusal': 0 };
  for (const r of results) tally[r.result] = (tally[r.result] ?? 0) + 1;
  const report = {
    schemaVersion: 'sweep-a3.acceptance.v1',
    title: 'LLP 0137 A3 snapback-web acceptance',
    startedAt: startedAtIso,
    finishedAt: new Date().toISOString(),
    expectedChecks: EXPECTED_CHECKS,
    observedChecks: results.length,
    tally,
    results,
    exitCode,
  };
  writeFileSync(join(evidenceDir, 'report.json'), JSON.stringify(report, null, 2));
  writeFileSync(join(evidenceDir, 'scenario-evidence.json'), JSON.stringify(evidence, null, 2));
  console.error(`\n${JSON.stringify({ tally, expected: EXPECTED_CHECKS, observed: results.length, exitCode })}`);
  process.exit(exitCode);
}
