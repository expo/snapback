import { createHash } from 'node:crypto';
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { DbConnection, type SubscriptionHandle } from './module_bindings/index.ts';

const URI = 'ws://127.0.0.1:3320';
const DATABASE = 'llp0102-linear-spacetimedb-w1';
const ARM_ROOT = new URL('../../', import.meta.url);
const EVIDENCE = new URL('evidence/', ARM_ROOT);
const STATE = new URL('state/', ARM_ROOT);
const ARM_START_MONOTONIC_MS = 406_946_700;
const QUERIES = [
  'SELECT * FROM my_organizations',
  'SELECT * FROM my_teams',
  'SELECT * FROM my_projects',
  'SELECT * FROM my_labels',
  'SELECT * FROM my_issues',
  'SELECT * FROM my_issue_labels',
  'SELECT * FROM my_comments',
  'SELECT * FROM my_activities',
  'SELECT * FROM my_page_results',
];

type Client = {
  name: string;
  conn: DbConnection;
  identity: string;
  token: string;
  subscription?: SubscriptionHandle;
};

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

async function armElapsedMs(): Promise<number> {
  const uptime = Number((await readFile('/proc/uptime', 'utf8')).split(' ')[0]);
  return Math.round(uptime * 1000 - ARM_START_MONOTONIC_MS);
}

async function connect(name: string): Promise<Client> {
  return new Promise((resolve, reject) => {
    let settled = false;
    DbConnection.builder()
      .withUri(URI)
      .withDatabaseName(DATABASE)
      .withConfirmedReads(true)
      .onConnect((conn, identity, token) => {
        if (settled) return;
        settled = true;
        resolve({ name, conn, identity: identity.toHexString(), token });
      })
      .onConnectError((_ctx, error) => {
        if (settled) return;
        settled = true;
        reject(error);
      })
      .build();
  });
}

async function subscribe(client: Client): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    client.subscription = client.conn.subscriptionBuilder()
      .onApplied(() => resolve())
      .onError((ctx: any) => reject(
        new Error(String(ctx?.event?.message ?? 'subscription error')),
      ))
      .subscribe(QUERIES);
  });
}

async function waitFor(
  description: string,
  predicate: () => boolean,
  timeoutMs = 20_000,
): Promise<void> {
  const started = performance.now();
  while (!predicate()) {
    if (performance.now() - started > timeoutMs) {
      throw new Error(`settlement timeout: ${description}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

await mkdir(EVIDENCE, { recursive: true });
await mkdir(STATE, { recursive: true });
const clients = await Promise.all([
  connect('Alice'),
  connect('Bob'),
  connect('Mallory'),
]);
const [alice, bob, mallory] = clients;
try {
  await alice.conn.reducers.registerPersona({ name: 'Alice' });
  const firstAuthoritativeMutationMs = await armElapsedMs();
  await bob.conn.reducers.registerPersona({ name: 'Bob' });
  await mallory.conn.reducers.registerPersona({ name: 'Mallory' });
  await Promise.all(clients.map(subscribe));
  const firstLocalReadMs = await armElapsedMs();
  await alice.conn.reducers.seedFixtures({});
  await waitFor(
    'Alice receives exact production-shaped seed',
    () => (
      Array.from(alice.conn.db.myOrganizations.iter()).length === 1
      && Array.from(alice.conn.db.myTeams.iter()).length === 3
      && Array.from(alice.conn.db.myProjects.iter()).length === 4
      && Array.from(alice.conn.db.myLabels.iter()).length === 20
      && Array.from(alice.conn.db.myIssues.iter()).length === 500
      && Array.from(alice.conn.db.myComments.iter()).length === 1000
    ),
  );
  const firstRealtimeTransitionMs = await armElapsedMs();
  await waitFor(
    'Bob receives authorized issue set',
    () => Array.from(bob.conn.db.myIssues.iter()).length === 500,
  );
  await waitFor(
    'Mallory receives no protected rows',
    () => Array.from(mallory.conn.db.myIssues.iter()).length === 0,
  );

  const custodyPath = new URL('actor-custody.json', STATE);
  await writeFile(
    custodyPath,
    `${JSON.stringify({
      uri: URI,
      database: DATABASE,
      actors: Object.fromEntries(clients.map((client) => [
        client.name.toLowerCase(),
        {
          identity: client.identity,
          credential: client.token,
        },
      ])),
    }, null, 2)}\n`,
    { mode: 0o600 },
  );
  await writeFile(
    new URL('milestones.partial.json', EVIDENCE),
    `${JSON.stringify({
      firstLocalReadMs,
      firstAuthoritativeMutationMs,
      firstRealtimeTransitionMs,
    }, null, 2)}\n`,
  );
  await chmod(custodyPath, 0o600);

  const counts = {
    organizations: 2,
    primaryTeams: Array.from(alice.conn.db.myTeams.iter()).length,
    primaryProjects: Array.from(alice.conn.db.myProjects.iter()).length,
    issues: Array.from(alice.conn.db.myIssues.iter()).length,
    comments: Array.from(alice.conn.db.myComments.iter()).length,
    labels: Array.from(alice.conn.db.myLabels.iter()).length,
    activities: Array.from(alice.conn.db.myActivities.iter()).length,
    issueLabels: Array.from(alice.conn.db.myIssueLabels.iter()).length,
  };
  await writeFile(
    new URL('migration-before.json', EVIDENCE),
    `${JSON.stringify({
      schemaVersion: 1,
      database: DATABASE,
      schemaPhase: 'v1-before-customer-impact',
      counts,
      actors: Object.fromEntries(clients.map((client) => [
        client.name.toLowerCase(),
        sha256(client.identity),
      ])),
      rawCredentialsPersistedInEvidence: false,
    }, null, 2)}\n`,
  );
  process.stdout.write(`${JSON.stringify({ ok: true, counts })}\n`);
} finally {
  for (const client of clients) client.conn.disconnect();
}
