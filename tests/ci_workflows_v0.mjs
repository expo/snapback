import { execFileSync, spawnSync } from 'node:child_process';
import { strict as assert } from 'node:assert';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const workflowDir = join(ROOT, '.github', 'workflows');
const workflowNames = readdirSync(workflowDir).filter((name) => /\.ya?ml$/.test(name)).sort();
assert.deepEqual(workflowNames, [
  'all-aboard-cold-clone.yml',
  'local-proof.yml',
  'ref-check.yml',
  'required-surface-builds.yml',
]);

let actionCount = 0;
let setupNodeCount = 0;
for (const name of workflowNames) {
  const text = readFileSync(join(workflowDir, name), 'utf8');
  const permissions = /^permissions:\n((?:[ \t]+[^\n]*(?:\n|$))*)/m.exec(text);
  assert(permissions, `${name} must declare top-level permissions`);
  assert.equal(
    permissions[1].trim(),
    'contents: read',
    `${name} must grant only read-only contents permission`,
  );
  assert.match(text, /run: scripts\/check-checkout-credentials/, `${name} must attest checkout cleanup`);

  const uses = [...text.matchAll(/^\s*-?\s*uses:\s+([^\s#]+)(?:\s+#\s*(\S+))?$/gm)];
  assert(uses.length > 0, `${name} must contain actions`);
  for (const match of uses) {
    const [ownerRepo, revision] = match[1].split('@');
    assert.match(ownerRepo, /^[^/\s]+\/[^/\s]+$/, `${name} has an invalid action owner/repo`);
    assert.match(revision ?? '', /^[0-9a-f]{40}$/, `${name} action ${match[1]} must use an immutable SHA`);
    assert(match[2], `${name} action ${match[1]} must keep a human-readable version comment`);
    actionCount += 1;
  }

  const lines = text.split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    if (!lines[index].includes('actions/checkout@')) continue;
    const indent = /^\s*/.exec(lines[index])[0].length;
    let end = index + 1;
    while (end < lines.length) {
      const nextIndent = /^\s*/.exec(lines[end])[0].length;
      if (/^\s*-\s/.test(lines[end]) && nextIndent === indent) break;
      end += 1;
    }
    const block = lines.slice(index, end).join('\n');
    assert.match(block, /persist-credentials:\s*false/, `${name} checkout must not persist credentials`);
  }

  for (let index = 0; index < lines.length; index += 1) {
    if (!lines[index].includes('oven-sh/setup-bun@')) continue;
    const indent = /^\s*/.exec(lines[index])[0].length;
    let end = index + 1;
    while (end < lines.length) {
      const nextIndent = /^\s*/.exec(lines[end])[0].length;
      if (/^\s*-\s/.test(lines[end]) && nextIndent === indent) break;
      end += 1;
    }
    assert.match(
      lines.slice(index, end).join('\n'),
      /bun-version-file:\s*package\.json/,
      `${name} setup-bun must consume the root packageManager authority`,
    );
  }

  // ENG-24513: every setup-node step consumes the root .node-version
  // authority; a floating `node-version:` input would let the same SHA run
  // proof scripts under different Node patch releases over time.
  for (let index = 0; index < lines.length; index += 1) {
    if (!lines[index].includes('actions/setup-node@')) continue;
    setupNodeCount += 1;
    const indent = /^\s*/.exec(lines[index])[0].length;
    let end = index + 1;
    while (end < lines.length) {
      const nextIndent = /^\s*/.exec(lines[end])[0].length;
      if (/^\s*-\s/.test(lines[end]) && nextIndent === indent) break;
      end += 1;
    }
    const block = lines.slice(index, end).join('\n');
    assert.match(
      block,
      /node-version-file:\s*\.node-version/,
      `${name} setup-node must consume the root .node-version authority`,
    );
    assert.doesNotMatch(
      block,
      /node-version:/,
      `${name} setup-node must not declare an inline node-version`,
    );
  }
}
assert.equal(setupNodeCount, 3, 'the Node-using workflow inventory changed; review and update this count');
assert.equal(actionCount, 14, 'the reviewed workflow action inventory changed; review and update this count');

const localProof = readFileSync(join(workflowDir, 'local-proof.yml'), 'utf8');
assert.match(localProof, /SNAPBACK_VERIFY_EXACT:\s*"1"/, 'canonical CI must require Exact/admin checks');
assert.match(
  localProof,
  /Reclaim unused GitHub-hosted runner disk/,
  'canonical CI must reclaim image toolchains the native proof never uses',
);
const reclaimStepStart = localProof.indexOf('      - name: Reclaim unused GitHub-hosted runner disk');
const reclaimStepEnd = localProof.indexOf('\n      - ', reclaimStepStart + 1);
assert(reclaimStepStart >= 0 && reclaimStepEnd > reclaimStepStart, 'disk reclaim step block must be bounded');
const reclaimStep = localProof.slice(reclaimStepStart, reclaimStepEnd);
const reclaimPaths = /readonly ci_unused_paths=\(\n([\s\S]*?)\n\s*\)/.exec(reclaimStep)?.[1]
  .split('\n')
  .map((line) => line.trim())
  .filter(Boolean);
assert.deepEqual(
  reclaimPaths,
  ['/usr/local/lib/android', '/usr/share/dotnet', '/usr/local/.ghcup'],
  'canonical CI disk reclaim must remain an exact reviewed path allowlist',
);
assert.match(
  reclaimStep,
  /sudo rm -rf --one-file-system -- "\$ci_unused_path"/,
  'disk reclaim must remain variable-safe and filesystem-bounded',
);
assert.match(
  reclaimStep,
  /SNAPBACK_CI_DISK_HEADROOM_LOW/,
  'canonical CI must fail early with a stable diagnostic when cleanup leaves inadequate disk',
);
assert.match(
  reclaimStep,
  /ci_required_kib=\$\(\(20 \* 1024 \* 1024\)\)/,
  'canonical CI must retain 20 GiB of pre-proof headroom for native clippy/test artifacts',
);
for (const laterStep of [
  'Cache Hermes Linux build',
  'Cache Rust build',
  'Install cargo-audit',
  'Verify Snapback local proof',
]) {
  assert(
    reclaimStepStart < localProof.indexOf(`- name: ${laterStep}`),
    `disk reclaim must run before ${laterStep}`,
  );
}
const localProofScript = readFileSync(join(ROOT, 'scripts', 'verify-local-proof'), 'utf8');
assert.match(
  localProofScript,
  /admin-ui[^\n]*audit:production|audit:production/,
  'canonical local/CI proof must run the admin production dependency audit',
);

const packageJson = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
assert.match(packageJson.packageManager ?? '', /^bun@\d+\.\d+\.\d+$/);
assert.match(packageJson.devDependencies?.typescript ?? '', /^\d+\.\d+\.\d+$/);

// ENG-24513: .node-version is the single exact Node runtime authority for CI
// and the canonical proof. Package engines stay compatibility ranges that the
// authority must satisfy — declarations, never the CI authority itself.
const nodeAuthorityText = readFileSync(join(ROOT, '.node-version'), 'utf8');
assert.match(
  nodeAuthorityText,
  /^\d+\.\d+\.\d+\n$/,
  '.node-version must pin one exact Node release (no v prefix, one trailing newline)',
);
const nodeAuthority = nodeAuthorityText.trim().split('.').map(Number);
for (const entry of readdirSync(join(ROOT, 'packages')).sort()) {
  const manifestPath = join(ROOT, 'packages', entry, 'package.json');
  if (!existsSync(manifestPath)) continue;
  const engineRange = JSON.parse(readFileSync(manifestPath, 'utf8')).engines?.node;
  if (engineRange === undefined) continue;
  const minimum = /^>=(\d+)\.(\d+)\.(\d+)$/.exec(engineRange);
  assert(
    minimum,
    `packages/${entry} engines.node must stay a >=x.y.z compatibility range, found ${engineRange}`,
  );
  const floor = minimum.slice(1, 4).map(Number);
  const satisfied = nodeAuthority[0] !== floor[0]
    ? nodeAuthority[0] > floor[0]
    : nodeAuthority[1] !== floor[1]
      ? nodeAuthority[1] > floor[1]
      : nodeAuthority[2] >= floor[2];
  assert(
    satisfied,
    `.node-version ${nodeAuthorityText.trim()} must satisfy packages/${entry} engines.node ${engineRange}`,
  );
}

const toolchainAuthority = readFileSync(join(ROOT, 'scripts', 'check-toolchain-authority.mjs'), 'utf8');
assert.match(
  toolchainAuthority,
  /\.node-version/,
  'the canonical toolchain proof must assert the Node runtime authority',
);

const generatedTypesGate = join(ROOT, 'scripts', 'check-generated-types');
const generatedTypesSource = readFileSync(generatedTypesGate, 'utf8');
assert.doesNotMatch(
  generatedTypesSource,
  /\b(?:npx|bunx)\b/,
  'generated-types proof must not contain a registry-capable package-runner fallback',
);
const missingTypeScriptRoot = mkdtempSync(join(tmpdir(), 'snapback-missing-typescript-'));
try {
  const missingTypeScript = spawnSync(generatedTypesGate, [], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, SNAPBACK_TYPESCRIPT_NODE_MODULES: missingTypeScriptRoot },
  });
  assert.equal(missingTypeScript.status, 1, 'missing locked TypeScript must fail closed');
  assert.match(missingTypeScript.stderr, /locked TypeScript .* is not installed/);
  assert.doesNotMatch(
    `${missingTypeScript.stdout}${missingTypeScript.stderr}`,
    /downloading|fetching|registry\.npmjs|npm ERR/i,
    'missing TypeScript must not trigger or suggest an automatic network fallback',
  );
} finally {
  rmSync(missingTypeScriptRoot, { recursive: true, force: true });
}

const installerGuard = join(ROOT, 'scripts', 'require-bun-package-manager.mjs');
const rejected = spawnSync(process.execPath, [installerGuard], {
  cwd: ROOT,
  encoding: 'utf8',
  env: { ...process.env, npm_config_user_agent: '', npm_execpath: '' },
});
assert.equal(rejected.status, 1);
assert.match(rejected.stderr, /SNAPBACK_PACKAGE_MANAGER_UNSUPPORTED/);
const accepted = spawnSync(process.execPath, [installerGuard], {
  cwd: ROOT,
  encoding: 'utf8',
  env: { ...process.env, npm_config_user_agent: `bun/${packageJson.packageManager.slice(4)}`, npm_execpath: 'bun' },
});
assert.equal(accepted.status, 0, accepted.stderr);

  const credentialCheck = spawnSync(join(ROOT, 'scripts', 'check-checkout-credentials'), [], {
  cwd: ROOT,
  encoding: 'utf8',
});
assert.equal(credentialCheck.status, 0, credentialCheck.stderr);

const credentialScratch = mkdtempSync(join(tmpdir(), 'snapback-checkout-credentials-'));
try {
  const child = join(credentialScratch, 'child');
  const parent = join(credentialScratch, 'parent');
  execFileSync('git', ['init', '--quiet', child]);
  execFileSync('git', ['-C', child, '-c', 'user.name=Snapback Test', '-c', 'user.email=test@example.invalid',
    'commit', '--quiet', '--allow-empty', '-m', 'seed']);
  execFileSync('git', ['init', '--quiet', parent]);
  execFileSync('git', ['-C', parent, '-c', 'protocol.file.allow=always', 'submodule', 'add', '--quiet', child, 'modules/child']);

  execFileSync('git', ['-C', parent, 'config',
    'http.https://github.com/.extraheader', 'AUTHORIZATION: basic root-sentinel-must-not-leak']);
  const rootCredentialCheck = spawnSync(join(ROOT, 'scripts', 'check-checkout-credentials'), [], {
    cwd: parent,
    encoding: 'utf8',
  });
  assert.equal(rootCredentialCheck.status, 1, 'root credential must fail the checkout proof');
  assert.match(rootCredentialCheck.stderr, /authorization header in a repository config/);
  assert.doesNotMatch(
    `${rootCredentialCheck.stdout}${rootCredentialCheck.stderr}`,
    /root-sentinel-must-not-leak/,
    'root credential values must never enter diagnostics',
  );
  execFileSync('git', ['-C', parent, 'config', '--unset-all', 'http.https://github.com/.extraheader']);

  execFileSync('git', ['-C', join(parent, 'modules/child'), 'config',
    'http.https://github.com/.extraheader', 'AUTHORIZATION: basic sentinel-must-not-leak']);
  const recursiveCredentialCheck = spawnSync(join(ROOT, 'scripts', 'check-checkout-credentials'), [], {
    cwd: parent,
    encoding: 'utf8',
  });
  assert.equal(recursiveCredentialCheck.status, 1, 'submodule credential must fail the checkout proof');
  assert.match(recursiveCredentialCheck.stderr, /authorization header in a repository config/);
  assert.doesNotMatch(
    `${recursiveCredentialCheck.stdout}${recursiveCredentialCheck.stderr}`,
    /sentinel-must-not-leak/,
    'credential values must never enter diagnostics',
  );
} finally {
  rmSync(credentialScratch, { recursive: true, force: true });
}

console.log(`CI workflow tests: PASS (${workflowNames.length} workflows, ${actionCount} immutable action pins)`);
