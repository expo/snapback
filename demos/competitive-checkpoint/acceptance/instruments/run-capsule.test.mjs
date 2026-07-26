import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  mkdtemp,
  mkdir,
  readFile,
  symlink,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  authorizeTimedRun,
  canonicalJson,
  sha256,
  treeDigest,
  verifyRunCapsule,
} from './run-capsule.v0.mjs';

const sourceDir = new URL('.', import.meta.url);
const verifierLock = JSON.parse(
  await readFile(new URL('run-capsule-verifier-lock.candidate.v0.json', sourceDir), 'utf8'),
);
for (const file of verifierLock.files) {
  const bytes = await readFile(new URL(file.path, sourceDir));
  assert.equal(
    createHash('sha256').update(bytes).digest('hex'),
    file.sha256,
    `run-capsule verifier lock drifted: ${file.path}`,
  );
}

const baseDir = await mkdtemp(join(tmpdir(), 'snapback-run-capsule-'));
const fakeSri = `sha512-${Buffer.alloc(64, 7).toString('base64')}`;
for (const directory of [
  'scaffolds/snapback',
  'scaffolds/snapback/src',
  'scaffolds/convex',
  'docs/snapback',
  'docs/convex',
  'instruments',
]) {
  await mkdir(join(baseDir, directory), { recursive: true });
}
await writeFile(join(baseDir, 'prompt.md'), 'Build the exact frozen fixture.\n');
await writeFile(join(baseDir, 'scaffolds/snapback/App.tsx'), 'export default function App() {}\n');
await writeFile(join(baseDir, 'scaffolds/snapback/app.json'), '{}\n');
await writeFile(join(baseDir, 'scaffolds/snapback/src.txt'), 'sibling file\n');
await writeFile(join(baseDir, 'scaffolds/snapback/src/x.txt'), 'nested file\n');
await writeFile(join(baseDir, 'scaffolds/snapback/package.json'), '{"private":true}\n');
await writeFile(join(baseDir, 'scaffolds/convex/package.json'), '{"private":true}\n');
await writeFile(
  join(baseDir, 'scaffolds/snapback/package-lock.json'),
  `${JSON.stringify({
    name: 'checkpoint-snapback-arm',
    version: '0.0.0',
    lockfileVersion: 3,
    requires: true,
    packages: {
      '': {
        name: 'checkpoint-snapback-arm',
        version: '0.0.0',
        dependencies: { '@snapback/client': '1.0.0' },
      },
      'node_modules/@snapback/client': {
        name: '@ccheever/snapback-client',
        version: '1.0.0',
        resolved: 'https://registry.npmjs.org/@ccheever/snapback-client/-/snapback-client-1.0.0.tgz',
        integrity: fakeSri,
      },
    },
  })}\n`,
);
await writeFile(
  join(baseDir, 'scaffolds/convex/package-lock.json'),
  `${JSON.stringify({
    name: 'checkpoint-convex-arm',
    version: '0.0.0',
    lockfileVersion: 3,
    requires: true,
    packages: {
      '': {
        name: 'checkpoint-convex-arm',
        version: '0.0.0',
        dependencies: { convex: '1.42.3' },
      },
      'node_modules/convex': {
        version: '1.42.3',
        resolved: 'https://registry.npmjs.org/convex/-/convex-1.42.3.tgz',
        integrity: fakeSri,
      },
    },
  })}\n`,
);
await writeFile(join(baseDir, 'docs/snapback/index.md'), '# Snapback\n');
await writeFile(join(baseDir, 'docs/convex/index.md'), '# Convex\n');
await writeFile(join(baseDir, 'instruments/network-policy.json'), '{"allow":["registry","provider"]}\n');
await writeFile(join(baseDir, 'instruments/agent-config.json'), '{"model":"fixed-test-model"}\n');
await writeFile(join(baseDir, 'instruments/assistance-policy.md'), '# Fixed assistance policy\n');
for (const name of [
  'convex-credential-health',
  'convex-credential-precondition',
  'snapback-credential-health',
  'snapback-credential-precondition',
]) {
  await writeFile(join(baseDir, `instruments/${name}.mjs`), `export const id = ${JSON.stringify(name)};\n`);
}
await writeFile(
  join(baseDir, 'instruments/snapback-remote-drill-plan.json'),
  '{"schemaVersion":"snapback.remote-drill-plan.v1","planId":"fixture-snapback"}\n',
);
await writeFile(
  join(baseDir, 'instruments/convex-provisioning-plan.json'),
  '{"schemaVersion":"checkpoint.convex-provisioning-plan.v0","planId":"fixture-convex"}\n',
);

const artifact = async (path) => ({
  path,
  sha256: sha256(await readFile(join(baseDir, path))),
});
const tree = async (root, paths) => {
  const files = [];
  for (const path of [...paths].sort()) {
    const absolute = join(baseDir, root, path);
    files.push({
      path,
      sha256: sha256(await readFile(absolute)),
    });
  }
  return { root, treeSha256: treeDigest(files), files };
};
const normativeArtifacts = [];
for (const path of [
  'instruments/agent-config.json',
  'instruments/assistance-policy.md',
  'instruments/convex-credential-health.mjs',
  'instruments/convex-credential-precondition.mjs',
  'instruments/convex-provisioning-plan.json',
  'instruments/network-policy.json',
  'instruments/snapback-credential-health.mjs',
  'instruments/snapback-credential-precondition.mjs',
  'instruments/snapback-remote-drill-plan.json',
]) {
  normativeArtifacts.push(await artifact(path));
}
const normative = Object.fromEntries(normativeArtifacts.map((value) => [value.path, value]));
const content = {
  neutralPrompt: await artifact('prompt.md'),
  startingScaffolds: {
    snapback: await tree('scaffolds/snapback', [
      'App.tsx',
      'app.json',
      'package-lock.json',
      'package.json',
      'src.txt',
      'src/x.txt',
    ]),
    convex: await tree('scaffolds/convex', ['package-lock.json', 'package.json']),
  },
  normativeArtifacts,
  machine: {
    image: 'checkpoint-runner',
    imageDigest: `sha256:${'1'.repeat(64)}`,
    os: 'linux',
    architecture: 'arm64',
    cpu: 'fixed-test-cpu',
    memoryBytes: 8589934592,
  },
  networkPolicy: {
    name: 'checkpoint-egress-v0',
    artifact: normative['instruments/network-policy.json'],
    description: 'Registry, provider, frontend host, identity provider, and frozen stream fixture only.',
  },
  packages: {
    snapback: {
      lockfile: await artifact('scaffolds/snapback/package-lock.json'),
      entries: [{
        path: 'node_modules/@snapback/client',
        name: '@ccheever/snapback-client',
        version: '1.0.0',
        registry: 'https://registry.npmjs.org',
        integrity: fakeSri,
      }],
    },
    convex: {
      lockfile: await artifact('scaffolds/convex/package-lock.json'),
      entries: [{
        path: 'node_modules/convex',
        name: 'convex',
        version: '1.42.3',
        registry: 'https://registry.npmjs.org',
        integrity: fakeSri,
      }],
    },
  },
  providers: {
    snapback: {
      backend: 'single-instance-container-vm.v1',
      region: 'test-region-1',
      plan: 'isolated-test',
      localTopology: 'local-dev-sqlite-ibex',
      frontendHost: 'test-static-host',
      provisioningPlan: normative['instruments/snapback-remote-drill-plan.json'],
    },
    convex: {
      backend: 'convex-cloud',
      region: 'test-region-1',
      plan: 'isolated-test',
      localTopology: 'account-free-local-convex',
      frontendHost: 'test-static-host',
      provisioningPlan: normative['instruments/convex-provisioning-plan.json'],
    },
  },
  credentials: {
    snapback: {
      preconditions: [{
        id: 'snapback-provider-health-v0',
        artifact: normative['instruments/snapback-credential-precondition.mjs'],
      }],
      provisioningBoundary: 'excluded-before-T0',
      healthChecks: [{
        id: 'snapback-two-principal-health-v0',
        artifact: normative['instruments/snapback-credential-health.mjs'],
      }],
    },
    convex: {
      preconditions: [{
        id: 'convex-provider-health-v0',
        artifact: normative['instruments/convex-credential-precondition.mjs'],
      }],
      provisioningBoundary: 'excluded-before-T0',
      healthChecks: [{
        id: 'convex-two-principal-health-v0',
        artifact: normative['instruments/convex-credential-health.mjs'],
      }],
    },
  },
  assistance: {
    agentConfig: normative['instruments/agent-config.json'],
    policy: normative['instruments/assistance-policy.md'],
    documentationCorpora: {
      snapback: await tree('docs/snapback', ['index.md']),
      convex: await tree('docs/convex', ['index.md']),
    },
  },
};
await writeFile(
  join(baseDir, 'protocol-candidate.json'),
  `${JSON.stringify({
    protocolId: 'llp-0075-convex-checkpoint-v0',
    protocolVersion: 'v0.4',
    amendments: [{ version: 'v0.4', date: '2026-07-23' }],
  })}\n`,
);
const capsule = {
  schemaVersion: 'snapback.convex-checkpoint-run-capsule.candidate.v0',
  protocol: {
    ...await artifact('protocol-candidate.json'),
    id: 'llp-0075-convex-checkpoint-v0',
    version: 'v0.4',
  },
  contentSha256: sha256(canonicalJson(content)),
  content,
  authorization: { status: 'candidate-unratified-blocks-timed-runs' },
};

assert.deepEqual(await verifyRunCapsule(capsule, { baseDir }), {
  protocolId: capsule.protocol.id,
  protocolVersion: capsule.protocol.version,
  protocolSha256: capsule.protocol.sha256,
  contentSha256: capsule.contentSha256,
  authorization: 'candidate-unratified-blocks-timed-runs',
});

await writeFile(join(baseDir, 'capsule.json'), `${JSON.stringify(capsule)}\n`);
const localeVerification = spawnSync(
  process.execPath,
  [
    '--input-type=module',
    '--eval',
    `import { readFile } from 'node:fs/promises';
import { verifyRunCapsule } from ${JSON.stringify(new URL('./run-capsule.v0.mjs', sourceDir).href)};
if (!new Intl.Collator().resolvedOptions().locale.toLowerCase().startsWith('sv')) {
  throw new Error('child process did not select the requested Swedish ICU locale');
}
const capsule = JSON.parse(await readFile(${JSON.stringify(join(baseDir, 'capsule.json'))}, 'utf8'));
await verifyRunCapsule(capsule, { baseDir: ${JSON.stringify(baseDir)} });`,
  ],
  {
    env: { ...process.env, LANG: 'sv_SE.UTF-8', LC_ALL: 'sv_SE.UTF-8' },
    encoding: 'utf8',
  },
);
assert.equal(
  localeVerification.status,
  0,
  `run-capsule verification changed under sv_SE.UTF-8:\n${localeVerification.stderr}`,
);

await assert.rejects(
  () => authorizeTimedRun(capsule, { baseDir }),
  /not ratified by a dated amendment/,
);

await writeFile(
  join(baseDir, 'protocol-ratified.json'),
  `${JSON.stringify({
    protocolId: 'llp-0075-convex-checkpoint-v0',
    protocolVersion: 'v0.5',
    amendments: [{
      version: 'v0.5',
      date: '2026-07-24',
      ratifier: 'Named author',
      runCapsuleContentSha256: capsule.contentSha256,
      timedRunsAuthorized: true,
    }],
  })}\n`,
);
const ratified = structuredClone(capsule);
ratified.protocol = {
  ...await artifact('protocol-ratified.json'),
  id: 'llp-0075-convex-checkpoint-v0',
  version: 'v0.5',
};
ratified.authorization = {
  status: 'ratified-by-dated-amendment',
  author: 'Named author',
  date: '2026-07-24',
  amendmentVersion: 'v0.5',
};
assert.equal((await authorizeTimedRun(ratified, { baseDir })).contentSha256, capsule.contentSha256);

const inventedRatification = structuredClone(ratified);
inventedRatification.authorization.amendmentVersion = 'v9.9';
await assert.rejects(
  () => authorizeTimedRun(inventedRatification, { baseDir }),
  /not backed by the named protocol amendment/,
);

const contentDrift = structuredClone(capsule);
contentDrift.content.machine.cpu = 'changed-cpu';
await assert.rejects(
  () => verifyRunCapsule(contentDrift, { baseDir }),
  /contentSha256 does not match/,
);

await writeFile(join(baseDir, 'scaffolds/snapback/undeclared.mjs'), 'export {};\n');
await assert.rejects(
  () => verifyRunCapsule(capsule, { baseDir }),
  /file closure differs from its manifest/,
);
await unlink(join(baseDir, 'scaffolds/snapback/undeclared.mjs'));

await mkdir(join(baseDir, 'outside'), { recursive: true });
await writeFile(join(baseDir, 'outside/stolen.md'), 'not allowed\n');
await symlink(join(baseDir, 'outside'), join(baseDir, 'docs/snapback/link'));
const symlinked = structuredClone(capsule);
symlinked.content.assistance.documentationCorpora.snapback.files.push({
  path: 'link/stolen.md',
  sha256: sha256('not allowed\n'),
});
symlinked.content.assistance.documentationCorpora.snapback.files.sort((left, right) =>
  left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
symlinked.content.assistance.documentationCorpora.snapback.treeSha256 = treeDigest(
  symlinked.content.assistance.documentationCorpora.snapback.files,
);
symlinked.contentSha256 = sha256(canonicalJson(symlinked.content));
await assert.rejects(
  () => verifyRunCapsule(symlinked, { baseDir }),
  /symbolic link/,
);
await unlink(join(baseDir, 'docs/snapback/link'));

const privateRegistry = structuredClone(capsule);
privateRegistry.content.packages.snapback.entries[0].registry = 'https://private.example.test';
privateRegistry.contentSha256 = sha256(canonicalJson(privateRegistry.content));
await assert.rejects(
  () => verifyRunCapsule(privateRegistry, { baseDir }),
  /canonical public npm registry/,
);

const incompletePackageClosure = structuredClone(capsule);
incompletePackageClosure.content.packages.snapback.entries[0].version = '1.0.1';
incompletePackageClosure.contentSha256 = sha256(canonicalJson(incompletePackageClosure.content));
await assert.rejects(
  () => verifyRunCapsule(incompletePackageClosure, { baseDir }),
  /complete npm lockfile closure/,
);

await writeFile(join(baseDir, 'prompt.md'), 'changed\n');
await assert.rejects(
  () => verifyRunCapsule(capsule, { baseDir }),
  /bytes do not match sha256/,
);

console.log('competitive checkpoint candidate run-capsule verifier passes');
