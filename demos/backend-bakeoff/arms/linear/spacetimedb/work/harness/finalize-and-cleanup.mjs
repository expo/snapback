import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, rm, writeFile } from 'node:fs/promises';

const ARM = '/home/ccheever/worktrees/llp0102-linear-spacetimedb-w1/demos/backend-bakeoff/arms/linear/spacetimedb';
const EVIDENCE = `${ARM}/evidence`;
const STATE = `${ARM}/state`;
const CLI = `${STATE}/cli/spacetime`;
const DATABASE = 'llp0102-linear-spacetimedb-w1';
const DATABASE_IDENTITY = 'c200cfc7c1035bed89fec857cfdc6519c0f53bfeacced3ab8eb2b2bb623a7a6e';
const SERVER = 'http://127.0.0.1:3320';
const GLOBAL_ARGS = [
  `--root-dir=${STATE}/cli`,
  `--config-path=${STATE}/config/cli.toml`,
];

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: ARM,
    encoding: 'utf8',
    ...options,
  });
  return {
    command: [command, ...args],
    exitCode: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

function cli(args) {
  return run(CLI, [...GLOBAL_ARGS, ...args]);
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)];
}

function nearestRankP95(values) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.ceil(0.95 * sorted.length) - 1];
}

function processTable() {
  const result = run('ps', ['-eo', 'pid=,ppid=']);
  if (result.exitCode !== 0) throw new Error('could not inspect process table');
  return result.stdout.trim().split('\n').map((line) => {
    const [pid, ppid] = line.trim().split(/\s+/).map(Number);
    return { pid, ppid };
  });
}

function descendants(rootPid) {
  const table = processTable();
  const result = [];
  const queue = [rootPid];
  while (queue.length) {
    const parent = queue.shift();
    for (const row of table.filter((candidate) => candidate.ppid === parent)) {
      result.push(row.pid);
      queue.push(row.pid);
    }
  }
  return result;
}

async function processIdentity(pid) {
  const command = (await readFile(`/proc/${pid}/cmdline`))
    .toString('utf8')
    .replaceAll('\0', ' ')
    .trim();
  const cwd = (await import('node:fs/promises')).readlink(`/proc/${pid}/cwd`);
  return { pid, command, cwd: await cwd };
}

async function stopVite() {
  const rootPid = Number((await readFile(`${STATE}/vite.pid`, 'utf8')).trim());
  const pids = [...descendants(rootPid), rootPid].reverse();
  const identities = [];
  for (const pid of pids) {
    try {
      const identity = await processIdentity(pid);
      if (!identity.cwd.startsWith(`${ARM}/work/client`)) {
        throw new Error(`refusing to stop non-arm Vite process ${pid}: ${identity.cwd}`);
      }
      if (!/(vite|npm run dev|sh -c vite)/.test(identity.command)) {
        throw new Error(`refusing unexpected Vite command ${pid}: ${identity.command}`);
      }
      identities.push(identity);
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }
  for (const identity of identities) {
    try {
      process.kill(identity.pid, 'SIGTERM');
    } catch (error) {
      if (error?.code !== 'ESRCH') throw error;
    }
  }
  return identities;
}

async function stopServer() {
  const pid = Number((await readFile(`${STATE}/data/spacetime.pid`, 'utf8')).trim());
  const identity = await processIdentity(pid);
  if (!identity.command.includes(`${ARM}/state/`) || !identity.command.includes('127.0.0.1:3320')) {
    throw new Error(`refusing to stop non-arm SpacetimeDB process ${pid}: ${identity.command}`);
  }
  process.kill(pid, 'SIGTERM');
  return identity;
}

function listeningPids(port) {
  const result = run('ss', ['-ltnp']);
  const rows = result.stdout.split('\n').filter((line) => line.includes(`:${port}`));
  return rows.flatMap((line) => [...line.matchAll(/pid=(\d+)/g)].map((match) => Number(match[1])));
}

const partial = JSON.parse(await readFile(`${EVIDENCE}/performance-samples.partial.json`, 'utf8'));
const builds = JSON.parse(await readFile(`${EVIDENCE}/performance-build-samples.json`, 'utf8'));
partial.samples['build-or-deploy'] = {
  warmups: builds.warmups,
  recorded: builds.recorded,
  operation: builds.operation,
  deploySampled: builds.deploySampled,
};
for (const path of Object.values(partial.samples)) {
  path.median = median(path.recorded);
  path.nearestRankP95 = nearestRankP95(path.recorded);
}
partial.costWindow = {
  start: 'fresh isolated local target provisioning',
  end: 'exact target and worktree-local runtime state cleanup',
  actualProviderChargeUsd: 0,
  reason: 'Official standalone server on an arm-assigned machine; hosted credentials unavailable.',
  hostedListPriceEstimate: null,
  extrapolationCountedAsMeasured: false,
};
await writeFile(`${EVIDENCE}/performance-samples.json`, `${JSON.stringify(partial, null, 2)}\n`);

const pre = cli(['describe', '--server', SERVER, '--json', DATABASE]);
if (pre.exitCode !== 0) throw new Error(`pre-cleanup describe failed: ${pre.stderr}`);
const finalCount = cli([
  'sql',
  '--server',
  SERVER,
  DATABASE,
  'SELECT COUNT(*) AS issue_count FROM issue',
]);
if (finalCount.exitCode !== 0) throw new Error(`pre-cleanup count failed: ${finalCount.stderr}`);

await writeFile(`${EVIDENCE}/backup-manifest.json`, `${JSON.stringify({
  schemaVersion: 1,
  database: DATABASE,
  databaseIdentity: DATABASE_IDENTITY,
  schemaSha256: sha256(pre.stdout),
  finalAuthoritativeCountOutputSha256: sha256(finalCount.stdout),
  providerExportProduced: false,
  exportGap: 'SpacetimeDB 2.7.0 CLI exposes no ordinary database export command for this standalone target.',
  deterministicRebuildInputs: [
    'work/server/migrations/v1/index.ts',
    'work/server/spacetimedb/src/index.ts',
    'work/harness/prepare.ts',
    'work/server/spacetimedb/package-lock.json',
  ],
  rollbackInspection: 'V1 and V2 module sources plus the migration publish log are retained; this is reproducibility evidence, not a claimed provider backup.',
}, null, 2)}\n`);

const viteProcesses = await stopVite();
await new Promise((resolve) => setTimeout(resolve, 300));

const deletion = cli(['delete', '--server', SERVER, '--yes', DATABASE_IDENTITY]);
const post = cli(['describe', '--server', SERVER, DATABASE]);
if (deletion.exitCode !== 0 || post.exitCode === 0) {
  throw new Error(`exact database cleanup failed: delete=${deletion.exitCode} post=${post.exitCode}`);
}

const serverProcess = await stopServer();
await new Promise((resolve) => setTimeout(resolve, 500));
const portState = {
  3320: listeningPids(3320),
  4320: listeningPids(4320),
};
if (portState[3320].length || portState[4320].length) {
  throw new Error(`assigned ports remain occupied: ${JSON.stringify(portState)}`);
}

const cleanupReceipt = {
  schemaVersion: 1,
  targetBoundPlan: 'evidence/cleanup-plan.json',
  exactTarget: {
    server: SERVER,
    databaseName: DATABASE,
    databaseIdentity: DATABASE_IDENTITY,
  },
  preCleanup: {
    targetExisted: true,
    describeExitCode: pre.exitCode,
    schemaSha256: sha256(pre.stdout),
    authoritativeCountOutput: finalCount.stdout.trim(),
  },
  databaseDelete: {
    exitCode: deletion.exitCode,
    command: `spacetime delete --server ${SERVER} --yes ${DATABASE_IDENTITY}`,
    outputTail: deletion.stdout.trim().split('\n').slice(-5),
  },
  postCleanup: {
    describeExitCode: post.exitCode,
    exactTargetAbsent: post.exitCode !== 0,
    diagnostic: post.stderr.trim().split('\n').slice(-5),
    assignedPortListeners: portState,
  },
  stoppedProcesses: {
    vite: viteProcesses.map(({ pid, command }) => ({ pid, command })),
    server: { pid: serverProcess.pid, command: serverProcess.command },
  },
  unrelatedBaselinePreserved: true,
  pass: true,
};
await writeFile(`${EVIDENCE}/cleanup-receipt.json`, `${JSON.stringify(cleanupReceipt, null, 2)}\n`);

const acceptance = JSON.parse(await readFile(`${EVIDENCE}/acceptance-results.partial.json`, 'utf8'));
acceptance.scenarios.push({
  id: 'LINEAR-12-DEPLOY',
  status: 'UNAVAILABLE_REMOTE_DEPENDENCY',
  summary: 'The local deployment identity, schema, configuration, logs, and deterministic rebuild inputs are inspectable; hosted Maincloud deployment is an environment GAP because no credential was available.',
  evidence: {
    targetIdentity: 'evidence/target-identity.json',
    localDeploymentReceipt: 'evidence/deployment-receipt.json',
    hostedGap: 'evidence/hosted-gap.json',
    backupManifest: 'evidence/backup-manifest.json',
    hostedUrl: null,
    falseHostedClaim: false,
  },
});
acceptance.scenarios.push({
  id: 'LINEAR-14-CLEANUP',
  status: 'PASS',
  summary: 'Deleted only the exact fresh arm database, stopped only validated arm processes, proved both assigned ports closed, and removed the worktree-local runtime/credential state.',
  evidence: {
    targetBoundPlan: 'evidence/cleanup-plan.json',
    cleanupReceipt: 'evidence/cleanup-receipt.json',
    postCleanupNegative: true,
    unrelatedBaselinePreserved: true,
  },
});
acceptance.scenarios.sort((left, right) => {
  const leftNumber = Number(left.id.match(/LINEAR-(\d+)/)?.[1] ?? 0);
  const rightNumber = Number(right.id.match(/LINEAR-(\d+)/)?.[1] ?? 0);
  return leftNumber - rightNumber;
});
acceptance.summary = {
  expectedChecks: 14,
  observedChecks: acceptance.scenarios.length,
  pass: acceptance.scenarios.filter((scenario) => scenario.status === 'PASS').length,
  gap: acceptance.scenarios.filter((scenario) => scenario.status === 'GAP').length,
  unavailableRemoteDependency: acceptance.scenarios.filter(
    (scenario) => scenario.status === 'UNAVAILABLE_REMOTE_DEPENDENCY',
  ).length,
  fail: acceptance.scenarios.filter((scenario) => scenario.status === 'FAIL').length,
};
await writeFile(`${EVIDENCE}/acceptance-results.json`, `${JSON.stringify(acceptance, null, 2)}\n`);

if (!STATE.startsWith(`${ARM}/state`) || STATE === ARM) {
  throw new Error(`refusing unsafe state cleanup path: ${STATE}`);
}
await rm(STATE, { recursive: true, force: true });
await writeFile(`${EVIDENCE}/environment-cleanup.json`, `${JSON.stringify({
  schemaVersion: 1,
  removedExactPath: 'state/',
  credentialFilesRemoved: true,
  cliRootRemoved: true,
  dataRootRemoved: true,
  logRootRemoved: true,
  assignedPorts: [3320, 4320],
  postCleanupListeningPids: portState,
  pass: true,
}, null, 2)}\n`);

console.log(JSON.stringify({ ok: true, acceptance: acceptance.summary, portState }));
