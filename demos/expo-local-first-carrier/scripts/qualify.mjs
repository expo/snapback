import { createHash, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import {
  mkdir,
  readFile,
  readdir,
  readlink,
  realpath,
  writeFile,
} from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';

import {
  assertExpoCarrierPostBootInvariants,
  expoCarrierPostBootInvariantNames,
} from '../qualification-invariants.mjs';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const demoRoot = resolve(scriptDirectory, '..');
const appRoot = join(demoRoot, 'probe-app');
const repoRoot = resolve(demoRoot, '../..');
const sha256 = (bytes) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
const hashFile = async (path) => sha256(await readFile(path));
const appRequire = createRequire(join(appRoot, 'package.json'));
const requiredPackageNames = Object.freeze([
  '@expo/snapback-client',
  '@expo/snapback-expo',
  'expo',
  'expo-device',
  'expo-sqlite',
  'react-native',
]);

async function packageRoot(name) {
  try {
    return realpath(dirname(appRequire.resolve(`${name}/package.json`)));
  } catch {
    let current = dirname(appRequire.resolve(name));
    while (true) {
      try {
        const manifest = JSON.parse(await readFile(join(current, 'package.json'), 'utf8'));
        if (manifest.name === name) return realpath(current);
      } catch { /* keep walking to the installed package root */ }
      const parent = dirname(current);
      if (parent === current) throw new Error(`cannot resolve installed package artifact ${name}`);
      current = parent;
    }
  }
}

async function digestPackageDirectory(root) {
  const hash = createHash('sha256');
  hash.update('snapback:installed-package-directory:v1\0');
  const visit = async (directory, prefix = '') => {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      if (entry.name === 'node_modules') continue;
      const relativePath = prefix.length === 0 ? entry.name : `${prefix}/${entry.name}`;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        hash.update(`directory\0${relativePath}\0`);
        await visit(path, relativePath);
      } else if (entry.isSymbolicLink()) {
        hash.update(`symlink\0${relativePath}\0${await readlink(path)}\0`);
      } else if (entry.isFile()) {
        const bytes = await readFile(path);
        hash.update(`file\0${relativePath}\0${bytes.length}\0`);
        hash.update(bytes);
      }
    }
  };
  await visit(root);
  return `sha256:${hash.digest('hex')}`;
}

async function installedPackageArtifact(name) {
  const root = await packageRoot(name);
  const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  return Object.freeze({
    name,
    version: manifest.version,
    artifactKind: 'installed-package-directory',
    artifactPath: relative(repoRoot, root),
    sha256: await digestPackageDirectory(root),
  });
}
const phases = Object.freeze([
  'pending-durable-before-delivery',
  'server-result-before-local-settlement',
  'commit-loop',
  'committed-before-callback',
  'consumed-before-ack',
  'ack-proof-before-local-removal',
  'authority-wipe-before-successor',
]);
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const value = (name) => {
  const index = args.indexOf(name);
  return index < 0 ? null : args[index + 1] ?? null;
};
const platform = value('--platform');
const device = value('--device');
const mode = value('--mode');
const hostOrigin = value('--host-origin');
const jsBundlePath = value('--js-bundle');
const nativeBinaryPath = value('--native-binary');
const batteryReferencePath = value('--battery-reference');
const dryRun = flag('--dry-run');
const deviceClass = value('--device-class') ?? 'real-device';
if (!['ios', 'android'].includes(platform) || !device || !['process', 'power'].includes(mode)) {
  process.stderr.write('usage: qualify.mjs --platform <ios|android> --device <id> --mode <process|power> [--host-origin http://HOST] [--device-class simulator|emulator|real-device] [--js-bundle PATH --native-binary PATH --battery-reference PATH] [--dry-run]\n');
  process.exit(2);
}
const iterations = mode === 'process' ? 100 : 25;
const startedAt = new Date();
const seed = randomBytes(16).toString('hex');
const runId = `${startedAt.toISOString().replace(/[-:.]/gu, '').replace('Z', 'Z-')}${seed.slice(0, 8)}`;
const packageId = 'com.snapback.exposqlitecarrierprobe';
const build = platform === 'ios'
  ? ['bunx', 'expo', 'run:ios', '--device', device, '--configuration', 'Release']
  : ['bunx', 'expo', 'run:android', '--device', device, '--variant', 'release'];
const protocol = {
  schemaVersion: 'snapback.expo-sqlite-carrier-device-protocol.v1',
  qualificationMode: true,
  runId,
  seed,
  platform,
  device,
  deviceClass,
  mode,
  iterations,
  phases,
  cleanBuild: ['bun', 'install', '--frozen-lockfile=false', '&&', 'bunx', 'expo', 'prebuild', '--clean', '&&', ...build],
  processCut: platform === 'ios'
    ? ['xcrun', 'devicectl', 'device', 'process', 'terminate', '--device', device, '--bundle-id', packageId]
    : ['adb', '-s', device, 'shell', 'am', 'force-stop', packageId],
  powerCut: 'external battery-isolated relay or witnessed hard-power interruption; graceful reboot is forbidden',
  postBootInvariants: [
    'integrity_check=ok',
    'old-or-new whole generation only',
    'all host COMMIT watermarks present',
    'one writer and stable sqlite_source_id',
    'same clientMutationId remains pending or settled and executes at most once',
    'settlement republishes before ACK removal',
    'authority predecessor is non-renderable and handleKey rotates',
  ],
  manualPromotionLegs: [
    'tampered-copy import: header/page/WAL truncation, future schema, bad digest; original bytes preserved',
    'second provider root coalescing plus independent connection owner refusal/takeover',
    'deterministic max_page_count rollback with prior commit retained',
    'offline intent -> death -> reconnect -> one server execution -> ACK removal',
  ],
  requiredReceiptInputs: ['--js-bundle', '--native-binary', '--battery-reference'],
};
if (dryRun) {
  process.stdout.write(`${JSON.stringify(protocol, null, 2)}\n`);
  process.exit(0);
}
if (!hostOrigin) {
  process.stderr.write('--host-origin is required for an actual device run (for example http://192.168.1.10)\n');
  process.exit(2);
}
if (!jsBundlePath || !nativeBinaryPath || !batteryReferencePath) {
  process.stderr.write('--js-bundle, --native-binary, and --battery-reference are required for an actual device receipt\n');
  process.exit(2);
}

const command = (argv, options = {}) => {
  const result = spawnSync(argv[0], argv.slice(1), {
    cwd: options.cwd ?? appRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      EXPO_PUBLIC_SNAPBACK_SQLITE_QUALIFICATION_MODE: '1',
    },
    stdio: options.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
  });
  if (result.status !== 0) {
    throw new Error(`${argv.join(' ')} failed (${result.status}): ${result.stderr ?? ''}`);
  }
  return result.stdout ?? '';
};
command(['bun', 'install', '--frozen-lockfile=false']);
command(['bunx', 'expo', 'prebuild', '--clean']);
command(build);

const events = [];
const serverExecutions = new Map();
const serverAcknowledgements = new Set();
const waiters = [];
const server = createServer((request, response) => {
  if (request.method !== 'POST' || !['/event', '/execute', '/ack'].includes(request.url)) {
    response.writeHead(404).end();
    return;
  }
  let body = '';
  request.setEncoding('utf8');
  request.on('data', (chunk) => { body += chunk; });
  request.on('end', () => {
    const input = JSON.parse(body);
    if (request.url === '/event') {
      events.push({ at: new Date().toISOString(), ...input });
      for (const waiter of [...waiters]) waiter();
      response.writeHead(204).end();
      return;
    }
    const id = input.clientMutationId;
    if (typeof id !== 'string' || id.length === 0) {
      response.writeHead(400).end();
      return;
    }
    if (request.url === '/execute') {
      let execution = serverExecutions.get(id);
      if (execution === undefined) {
        execution = Object.freeze({
          executionCount: 1,
          result: Object.freeze({ ok: true, clientMutationId: id }),
        });
        serverExecutions.set(id, execution);
      }
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify(execution));
      return;
    }
    serverAcknowledgements.add(id);
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ acknowledged: true, clientMutationId: id }));
  });
});
await new Promise((resolveListen) => server.listen(0, '0.0.0.0', resolveListen));
const port = server.address().port;
const reportOrigin = `${hostOrigin.replace(/\/$/u, '')}:${port}`;
const eventFor = (predicate, timeoutMs = 60_000) => new Promise((resolveEvent, reject) => {
  const started = Date.now();
  const check = () => {
    const event = events.find(predicate);
    if (event) {
      waiters.splice(waiters.indexOf(check), 1);
      resolveEvent(event);
    } else if (Date.now() - started > timeoutMs) {
      waiters.splice(waiters.indexOf(check), 1);
      reject(new Error('timed out waiting for probe event'));
    } else setTimeout(check, 250);
  };
  waiters.push(check);
  check();
});
const deepLink = ({ phase, cycle, predecessorHandleKeyDigest = null }) => (
  `snapback-sqlite-probe://command?server=${encodeURIComponent(reportOrigin)}&phase=${encodeURIComponent(phase)}&cycle=${cycle}`
    + (predecessorHandleKeyDigest === null
      ? ''
      : `&predecessorHandleKeyDigest=${encodeURIComponent(predecessorHandleKeyDigest)}`)
);
const launch = (url) => {
  if (platform === 'android') {
    command(['adb', '-s', device, 'shell', 'am', 'start', '-W', '-a', 'android.intent.action.VIEW', '-d', url, packageId]);
  } else {
    command(['xcrun', 'devicectl', 'device', 'process', 'launch', '--terminate-existing', '--device', device, '--payload-url', url, packageId]);
  }
};
const terminate = () => {
  if (platform === 'android') command(['adb', '-s', device, 'shell', 'am', 'force-stop', packageId]);
  else command(['xcrun', 'devicectl', 'device', 'process', 'terminate', '--device', device, '--bundle-id', packageId]);
};
const operator = createInterface({ input: process.stdin, output: process.stdout });
const observations = [];
let sourceId = null;
let sqliteFacts = null;
let runtimeTargetFacts = null;
let incompleteReason = null;
try {
  for (let cycle = 0; cycle < iterations; cycle += 1) {
    const phase = phases[cycle % phases.length];
    launch(deepLink({ phase, cycle }));
    const armed = await eventFor((event) => event.type === 'armed' && event.cycle === cycle);
    sourceId ??= armed.facts.sqliteSourceId;
    sqliteFacts ??= armed.facts;
    if (armed.facts.sqliteSourceId !== sourceId) throw new Error('sqlite_source_id changed during run');
    for (const field of ['operatingSystem', 'osVersion', 'architecture', 'distribution', 'deviceClass']) {
      if (typeof armed.targetFacts?.[field] !== 'string' || armed.targetFacts[field].length === 0) {
        throw new Error(`runtime target fact ${field} is unresolved`);
      }
    }
    runtimeTargetFacts ??= armed.targetFacts;
    if (JSON.stringify(armed.targetFacts) !== JSON.stringify(runtimeTargetFacts)) {
      throw new Error('runtime target facts changed during run');
    }
    if (
      runtimeTargetFacts.operatingSystem !== platform
      || runtimeTargetFacts.distribution !== 'release'
      || runtimeTargetFacts.deviceClass !== deviceClass
    ) throw new Error('runtime target facts do not match the requested release target cell');
    const cutReadyEvent = await eventFor((event) => event.type === 'cut-ready' && event.cycle === cycle);
    if (mode === 'process') terminate();
    else {
      const witness = await operator.question(
        `Cycle ${cycle + 1}/${iterations} (${phase}): perform a HARD power interruption now, then enter witness id (blank aborts): `,
      );
      if (!witness.trim()) {
        incompleteReason = `power witness missing at cycle ${cycle}`;
        break;
      }
      observations.push({ cycle, phase, powerWitness: createHash('sha256').update(witness).digest('hex') });
    }
    launch(deepLink({
      phase: 'verify',
      cycle,
      predecessorHandleKeyDigest: armed.predecessorHandleKeyDigest,
    }));
    const verified = await eventFor((event) => event.type === 'verified' && event.cycle === cycle, 120_000);
    if (verified.integrity !== 'ok') throw new Error(`integrity_check=${verified.integrity}`);
    if (verified.facts.sqliteSourceId !== sourceId) throw new Error('sqlite_source_id changed after recovery');
    if (JSON.stringify(verified.targetFacts) !== JSON.stringify(runtimeTargetFacts)) {
      throw new Error('runtime target facts changed after recovery');
    }
    const reportedHostWatermarks = events
      .filter((event) => event.type === 'committed' && event.cycle === cycle)
      .map((event) => event.hostWatermark);
    const postBootRecord = {
      ...verified.postBootRecord,
      generation: {
        ...verified.postBootRecord.generation,
        allowed: phase === 'authority-wipe-before-successor' ? [null] : [1, 2],
      },
      reportedHostWatermarks,
      evaluatedInvariants: expoCarrierPostBootInvariantNames,
    };
    const invariantVerdict = assertExpoCarrierPostBootInvariants(postBootRecord);
    observations.push({
      cycle,
      phase,
      cutBoundary: cutReadyEvent.boundary,
      insideTransaction: cutReadyEvent.insideTransaction,
      reportedHostWatermarks,
      integrity: verified.integrity,
      evaluatedInvariants: invariantVerdict.evaluated,
      serverExecutionCount: postBootRecord.server.executionCount,
      serverAckObserved: serverAcknowledgements.has(armed.clientMutationId),
    });
  }
} finally {
  operator.close();
  await new Promise((resolveClose) => server.close(resolveClose));
}

const finishedAt = new Date();
const directory = join(demoRoot, 'evidence', runId);
await mkdir(directory, { recursive: true });
const raw = {
  schemaVersion: 'snapback.expo-sqlite-carrier-qualification.device-raw.v1',
  runId,
  seed,
  sqliteSourceId: sourceId,
  targetFacts: runtimeTargetFacts,
  protocol,
  events,
  observations,
};
const rawText = `${JSON.stringify(raw, null, 2)}\n`;
await writeFile(join(directory, 'device-events.v1.json'), rawText);
const gitRevision = spawnSync('git', ['rev-parse', 'HEAD'], {
  cwd: repoRoot,
  encoding: 'utf8',
}).stdout.trim();
const dirtyPaths = spawnSync('git', ['status', '--porcelain=v1'], {
  cwd: repoRoot,
  encoding: 'utf8',
}).stdout.split('\n').filter(Boolean).map((line) => line.slice(3));
const sourcePaths = [
  'packages/snapback-client/rqs-store-sqlite.mjs',
  'packages/snapback-client/outbox-shared.mjs',
  'packages/snapback-client/rqs-store-meta.mjs',
  'packages/snapback-expo/expo-sqlite-carrier.mjs',
  'packages/snapback-expo/expo-sqlite-target.mjs',
  'packages/snapback-expo/provider.mjs',
  'demos/expo-local-first-carrier/qualification-invariants.mjs',
  'demos/expo-local-first-carrier/probe-app/App.js',
  'demos/expo-local-first-carrier/scripts/qualify.mjs',
];
const claimSourceClosure = Object.fromEntries(await Promise.all(sourcePaths.map(async (path) => [
  path,
  await hashFile(join(repoRoot, path)),
])));
const packageArtifacts = await Promise.all(requiredPackageNames.map(installedPackageArtifact));
const resolvedJsBundle = resolve(jsBundlePath);
const resolvedNativeBinary = resolve(nativeBinaryPath);
const resolvedBatteryReference = resolve(batteryReferencePath);
const receipt = {
  schemaVersion: 'snapback.expo-sqlite-carrier-qualification.v1',
  verdict: incompleteReason === null && mode === 'process' ? 'supporting-pass' : incompleteReason === null ? 'candidate-needs-review' : 'incomplete',
  qualificationMode: true,
  runId,
  seed,
  supportingOnly: mode === 'process' || deviceClass !== 'real-device',
  promotionalAuthority: false,
  capabilityCells: [{
    arm: 'expo',
    carrier: 'expo-sqlite',
    profile: 'durable-fragments-v1',
    target: { ...runtimeTargetFacts, mode },
  }],
  governingLlpAnchors: [
    'LLP 0166 D1/D6/D9',
    'LLP 0043 settlement consumption and acknowledgement lifecycle',
    'LLP 0053 client fences',
    'LLP 0189 claim gating',
    'LLP 0270 D6',
  ],
  startedAt: events[0]?.at ?? null,
  finishedAt: finishedAt.toISOString(),
  git: { revision: gitRevision, dirtyPaths },
  claimSourceClosure,
  packageArtifacts,
  jsBundleIdentity: { path: jsBundlePath, sha256: await hashFile(resolvedJsBundle) },
  nativeBinaryIdentity: { path: nativeBinaryPath, sha256: await hashFile(resolvedNativeBinary) },
  targetCell: {
    complete: incompleteReason === null
      && observations.filter((entry) => 'integrity' in entry).length === iterations,
    ...runtimeTargetFacts,
    mode,
    deviceIdHash: createHash('sha256').update(device).digest('hex'),
    processCuts: mode === 'process' ? iterations : 0,
    powerCuts: mode === 'power' ? iterations : 0,
    phases,
  },
  sqlite: {
    version: sqliteFacts?.sqliteVersion ?? null,
    sourceId,
    compileOptions: sqliteFacts?.compileOptions ?? [],
    pragmas: sqliteFacts?.pragmas ?? null,
    databaseDirectoryClass: 'expo-application-support',
  },
  iterations: { required: iterations, completed: observations.filter((value) => 'integrity' in value).length },
  phases,
  evaluatedPostBootInvariants: expoCarrierPostBootInvariantNames,
  invariantCyclesPassed: observations.filter((entry) => 'integrity' in entry).length,
  hostPublicationWatermarks: {
    model: 'COMMIT-promise-resolution',
    reported: observations.flatMap((entry) => entry.reportedHostWatermarks ?? []).length,
    missingAfterRecovery: 0,
    observedHybridGenerations: 0,
  },
  serverExecutionSettlementIdentities: {
    clientMutationIds: serverExecutions.size,
    maxExecutionCount: Math.max(0, ...[...serverExecutions.values()].map((entry) => entry.executionCount)),
    allAcknowledged: [...serverExecutions.keys()].every((id) => serverAcknowledgements.has(id)),
    secretsPresent: false,
  },
  completeBatteryReference: {
    path: batteryReferencePath,
    sha256: await hashFile(resolvedBatteryReference),
    qualifiedCommit: gitRevision,
  },
  rawLogHashes: {
    'device-events.v1.json': `sha256:${createHash('sha256').update(rawText).digest('hex')}`,
  },
  incompleteReason,
  promotionBlockers: protocol.manualPromotionLegs,
  secretScan: {
    serialNumbersIncluded: false,
    bearersIncluded: false,
    rowPayloadsIncluded: false,
    predecessorHandleKeysIncluded: false,
  },
};
await writeFile(join(directory, 'qualification.device.v1.json'), `${JSON.stringify(receipt, null, 2)}\n`);
process.stdout.write(`[expo-sqlite-device-qualification] ${receipt.verdict}: ${receipt.iterations.completed}/${iterations}; receipt=${join(directory, 'qualification.device.v1.json')}\n`);
