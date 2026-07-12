import { execFileSync, spawnSync } from 'node:child_process';
import { strict as assert } from 'node:assert';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
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
}
assert.equal(actionCount, 14, 'the reviewed workflow action inventory changed; review and update this count');

const localProof = readFileSync(join(workflowDir, 'local-proof.yml'), 'utf8');
assert.match(localProof, /SNAPBACK_VERIFY_EXACT:\s*"1"/, 'canonical CI must require Exact/admin checks');

const packageJson = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
assert.match(packageJson.packageManager ?? '', /^bun@\d+\.\d+\.\d+$/);
assert.match(packageJson.devDependencies?.typescript ?? '', /^\d+\.\d+\.\d+$/);

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
