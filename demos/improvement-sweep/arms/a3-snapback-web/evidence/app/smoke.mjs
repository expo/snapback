// Early A3 smoke: dev lifecycle, seed install, invite redemption, membership
// gating, search, keyset pages. Own-port discipline: guard 4288/4289, never 4420.
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { join, resolve } from 'node:path';
import { SnapbackClient } from '@expo/snapback-client';
import api from './snapback/generated/api.mjs';

const root = resolve(import.meta.dirname);
const readyFile = join(root, '.snapback', 'dev.ready.json');
for (const suffix of ['', '-wal', '-shm', '.admin-token', '.auth-keyring.json']) {
  rmSync(join(root, '.snapback', `dev.sqlite3${suffix}`), { force: true });
}

const guards = [];
for (const port of [4288, 4289]) {
  const guard = createServer(() => {});
  await new Promise((res) => { guard.once('error', () => res()); guard.listen(port, '127.0.0.1', () => res()); });
  guards.push(guard);
}

const child = spawn(join(root, 'node_modules', '.bin', 'snapback'), ['dev', 'snapback'], {
  cwd: root, stdio: ['pipe', 'pipe', 'pipe'],
});
let out = '';
child.stdout.on('data', (c) => { out += c; });
child.stderr.on('data', (c) => { out += c; });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, label, timeoutMs = 45_000) => {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() >= deadline) throw new Error(`timeout: ${label}\n${out.slice(-3000)}`);
    await sleep(30);
  }
};

let exitCode = 1;
try {
  const ready = await until(() => {
    if (!existsSync(readyFile)) return null;
    try {
      const d = JSON.parse(readFileSync(readyFile, 'utf8'));
      return out.includes('generated-and-loaded') ? d : null;
    } catch { return null; }
  }, 'dev ready');
  for (const g of guards) g.close();
  if (ready.port === 4420 || ready.port === 4288 || ready.port === 4289) throw new Error(`forbidden port ${ready.port}`);
  console.error('ready on', ready.serverUrl);
  const adminToken = readFileSync(ready.adminTokenFile, 'utf8').trim();
  const impersonation = readFileSync(ready.impersonationCapabilityFile, 'utf8').trim();
  const headers = { 'content-type': 'application/json', 'x-snapback-auth-client-protocol': '1' };

  const signIn = async (email) => {
    const requested = await fetch(`${ready.serverUrl}/auth/request-code`, {
      method: 'POST', headers, body: JSON.stringify({ email }),
    }).then((r) => r.json());
    const mailbox = await fetch(
      `${ready.serverUrl}/_snapback/api/auth/mailbox?challengeId=${encodeURIComponent(requested.challengeId)}`,
      { headers: { 'x-snapback-admin-token': adminToken, 'x-snapback-impersonation-capability': impersonation } },
    ).then((r) => r.json());
    const credential = await fetch(`${ready.serverUrl}/auth/exchange`, {
      method: 'POST', headers,
      body: JSON.stringify({ challengeId: requested.challengeId, code: mailbox.code }),
    }).then((r) => r.json());
    if (typeof credential.token !== 'string') throw new Error(`sign-in failed ${email}: ${JSON.stringify(credential)}`);
    const client = new SnapbackClient(ready.serverUrl, {
      bearerToken: credential.token,
      authClientProtocol: 1, authInvalidationProtocol: 1,
      authorityDescriptorProtocol: 1, authorizedLeaseProtocol: 1,
      rqsStore: null,
    });
    return { client, userId: credential.session.userId, email };
  };

  const alice = await signIn('alice@sweep-a3.test');
  const mallory = await signIn('mallory@sweep-a3.test');
  console.error('signed in', alice.userId.slice(0, 8), mallory.userId.slice(0, 8));

  // pre-membership: alice denied
  try {
    await alice.client.query(api.columnIssues, { args: { orgId: 'org_relay', status: 'todo' } });
    console.error('UNEXPECTED: pre-invite read allowed');
  } catch (e) {
    console.error('pre-invite denial:', e?.diagnostic?.code ?? e.message);
  }

  const redeemed = await alice.client.mutate(api.redeemInvite, { args: { code: 'INV-OWNER-7391' } });
  console.error('redeem:', JSON.stringify(redeemed));

  const col = await alice.client.query(api.columnIssues, { args: { orgId: 'org_relay', status: 'todo' } });
  console.error('todo column rows:', col.rows.length, col.rows.map((r) => r.identifier).join(','));

  // outsider denial
  try {
    await mallory.client.query(api.columnIssues, { args: { orgId: 'org_relay', status: 'todo' } });
    console.error('UNEXPECTED: outsider read allowed');
  } catch (e) {
    console.error('outsider denial:', e?.diagnostic?.code ?? e.message);
  }

  // double redeem refused
  try {
    await alice.client.mutate(api.redeemInvite, { args: { code: 'INV-OWNER-7391' } });
    console.error('UNEXPECTED: double redeem allowed');
  } catch (e) {
    console.error('double redeem refusal:', e?.diagnostic?.code ?? e.message);
  }

  // keyset first page (alice owns nothing yet -> empty page)
  try {
    const first = await alice.client.query(api.myIssuesFirstPage, { args: {} });
    console.error('myIssuesFirstPage:', JSON.stringify(first).slice(0, 300));
  } catch (e) {
    console.error('myIssuesFirstPage ERR:', e?.diagnostic?.code ?? e.message);
  }

  // search (alice partition, empty until assignment)
  try {
    const { parseSearchQueryV1 } = await import('@expo/snapback-client');
    const found = await alice.client.search(api.searchMyIssues, {
      query: parseSearchQueryV1('pagination', { fields: ['title', 'description'] }),
    });
    console.error('search pre-assign:', JSON.stringify(found).slice(0, 200));
    const assigned = await alice.client.mutate(api.assignIssue, {
      args: { issueId: 'iss_142', assigneeId: alice.userId, assigneeName: 'Alice', actorName: 'Alice' },
    });
    console.error('assign revision:', JSON.stringify(assigned));
    const found2 = await alice.client.search(api.searchMyIssues, {
      query: parseSearchQueryV1('pagination', { fields: ['title', 'description'] }),
    });
    console.error('search post-assign:', JSON.stringify(found2).slice(0, 400));
  } catch (e) {
    console.error('search ERR:', e?.diagnostic?.code ?? e.message, JSON.stringify(e?.diagnostic ?? {}).slice(0, 300));
  }

  // range query (declarative)
  try {
    const ranged = await alice.client.query(api.issuesUpdatedInRange, {
      args: { orgId: 'org_relay', since: 1782800000000, until: 1782999999999 },
    });
    console.error('range rows:', ranged.rows.length, ranged.rows.map((r) => r.identifier).join(','));
  } catch (e) {
    console.error('range ERR:', e?.diagnostic?.code ?? e.message);
  }

  exitCode = 0;
} catch (error) {
  console.error('SMOKE FAIL:', error?.message ?? error);
} finally {
  child.stdin.end();
  await sleep(800);
  process.exit(exitCode);
}
