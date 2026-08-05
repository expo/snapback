import { strict as assert } from 'node:assert';
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const scratch = mkdtempSync(join(tmpdir(), 'snapback-ibex-bootstrap-'));

function touch(path, contents = '') {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents);
}

try {
  const checkout = join(scratch, 'snapback');
  const vendor = join(checkout, 'vendor', 'ibex');
  const peer = join(scratch, 'ibex');
  const script = join(checkout, 'scripts', 'bootstrap-ibex-runtime');
  mkdirSync(dirname(script), { recursive: true });
  copyFileSync(join(ROOT, 'scripts', 'bootstrap-ibex-runtime'), script);
  chmodSync(script, 0o755);
  touch(join(vendor, 'Cargo.toml'), '[package]\nname = "ibex-fixture"\n');

  const platform = process.platform;
  const hermesArch = ['arm64', 'aarch64'].includes(process.arch) ? 'arm64' :
    ['x64', 'x86_64', 'amd64'].includes(process.arch) ? 'x64' : process.arch;

  function installProfileAuthorities(base) {
    touch(join(base, 'scripts', 'hermes-version.sh'), `#!/usr/bin/env bash
IBEX_HERMES_VERSION="\${IBEX_HERMES_VERSION:-fixture-version}"
IBEX_HERMES_SOURCE_REF="\${IBEX_HERMES_SOURCE_REF:-fixture-ref}"
IBEX_HERMES_SOURCE_COMMIT="\${IBEX_HERMES_SOURCE_COMMIT:-0123456789abcdef0123456789abcdef01234567}"
IBEX_HERMES_BUILD_REF="\${IBEX_HERMES_BUILD_REF:-\$IBEX_HERMES_SOURCE_COMMIT}"
ibex_hermes_apple_source_cache_key() {
  if [[ "\${2:-}" == "-debug" ]]; then printf 'fixture-debug\\n'; else printf 'fixture-release\\n'; fi
}
ibex_hermes_linux_source_cache_key() { printf 'fixture-linux\\n'; }
`);
  }

  function installArtifacts(base, cacheKey) {
    if (platform === 'darwin') {
      const frameworks = join(base, 'ios', 'Frameworks');
      touch(join(frameworks, 'hermes-headers', 'hermes', 'hermes.h'));
      touch(join(frameworks, 'hermes-headers', 'jsi', 'jsi.h'));
      touch(join(frameworks, 'hermes.framework', 'hermes'));
      touch(join(frameworks, 'hermes-profile-provenance.json'), `{\n  "cacheKey": "${cacheKey}",\n  "fixture": true\n}\n`);
      touch(join(base, 'tools', 'hermes', `hermesc-macos-${hermesArch}`));
      return join(frameworks, 'hermes-profile-provenance.json');
    }
    if (platform === 'linux') {
      touch(join(base, 'linux', 'hermes-headers', 'hermes', 'hermes.h'));
      touch(join(base, 'linux', 'hermes-headers', 'jsi', 'jsi.h'));
      touch(join(base, 'linux', 'lib', 'libhermesvm.so'));
      const receipt = join(base, 'linux', 'lib', 'hermes-profile-provenance.json');
      touch(receipt, `{\n  "cacheKey": "${cacheKey}",\n  "fixture": true\n}\n`);
      touch(join(base, 'tools', 'hermes', `hermesc-linux-${hermesArch}`));
      return receipt;
    }
    return null;
  }

  if (!['darwin', 'linux'].includes(platform)) {
    process.stdout.write(`ibex_bootstrap_v0 SKIP: unsupported fixture platform ${platform}\n`);
    process.exit(0);
  }

  installProfileAuthorities(vendor);
  const matchingKey = platform === 'darwin' ? 'fixture-debug' : 'fixture-linux';
  installArtifacts(vendor, matchingKey);

  const peerCli = join(peer, 'target', 'debug', 'ibex');
  touch(peerCli, '#!/usr/bin/env sh\nexit 0\n');
  chmodSync(peerCli, 0o755);
  const vendoredCli = join(vendor, 'target', 'debug', 'ibex');
  mkdirSync(dirname(vendoredCli), { recursive: true });
  symlinkSync(join(scratch, 'missing-ibex'), vendoredCli);

  const result = spawnSync(script, [], {
    cwd: checkout,
    encoding: 'utf8',
    env: {
      ...process.env,
      SNAPBACK_BOOTSTRAP_CHECK: '0',
      SNAPBACK_IBEX_CHECKOUT: peer,
    },
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /vendored Ibex\/Hermes artifacts are already usable/);
  assert.match(result.stdout, /removed dangling vendored Ibex CLI symlink/);
  assert.match(result.stdout, /linked vendored Ibex CLI/);
  assert.equal(readlinkSync(vendoredCli), peerCli);

  // LLP 0175 D3.2: a clean exact-revision, digest-coherent readiness receipt
  // makes a repeated bootstrap a verifier, not another Cargo producer. The
  // fixture deliberately has no runtime-link-smoke helper, so success proves
  // the exact-link path was not entered.
  const servedBinary = join(checkout, 'target', 'debug', 'snapback');
  touch(servedBinary, '#!/usr/bin/env sh\nexit 0\n');
  chmodSync(servedBinary, 0o755);
  spawnSync('git', ['init', '-q'], { cwd: checkout });
  spawnSync('git', ['config', 'user.email', 'fixture@example.invalid'], { cwd: checkout });
  spawnSync('git', ['config', 'user.name', 'Snapback Fixture'], { cwd: checkout });
  spawnSync('git', ['add', '-A'], { cwd: checkout });
  const commitResult = spawnSync('git', ['commit', '-qm', 'fixture'], {
    cwd: checkout,
    encoding: 'utf8',
  });
  assert.equal(commitResult.status, 0, commitResult.stderr);
  const fixtureCommit = spawnSync('git', ['rev-parse', 'HEAD'], {
    cwd: checkout,
    encoding: 'utf8',
  }).stdout.trim();
  const fakeBin = join(scratch, 'fake-bin');
  const fakeNode = join(fakeBin, 'node');
  touch(fakeNode, `#!/usr/bin/env bash
printf '{"ok":true,"receipt":{"buildIdentity":{"gitCommit":"%s","gitDirty":false,"buildProfile":"debug"}}}\\n' "$FIXTURE_COMMIT"
`);
  chmodSync(fakeNode, 0o755);
  const reuseResult = spawnSync(script, [], {
    cwd: checkout,
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${fakeBin}:${process.env.PATH}`,
      FIXTURE_COMMIT: fixtureCommit,
      SNAPBACK_BOOTSTRAP_CHECK: '1',
      SNAPBACK_IBEX_CHECKOUT: peer,
    },
  });
  assert.equal(reuseResult.status, 0, `${reuseResult.stdout}\n${reuseResult.stderr}`);
  assert.match(reuseResult.stdout, /reusing exact current-revision runtime readiness receipt/);

  const driftCheckout = join(scratch, 'snapback-drift');
  const driftVendor = join(driftCheckout, 'vendor', 'ibex');
  const driftPeer = join(scratch, 'ibex-drift');
  const driftScript = join(driftCheckout, 'scripts', 'bootstrap-ibex-runtime');
  mkdirSync(dirname(driftScript), { recursive: true });
  copyFileSync(join(ROOT, 'scripts', 'bootstrap-ibex-runtime'), driftScript);
  chmodSync(driftScript, 0o755);
  touch(join(driftVendor, 'Cargo.toml'), '[package]\nname = "ibex-fixture"\n');
  installProfileAuthorities(driftVendor);
  const driftReceipt = installArtifacts(driftVendor, 'fixture-stale');
  installArtifacts(driftPeer, 'fixture-newer');

  const download = join(driftVendor, 'scripts', 'download-hermes.sh');
  touch(download, `#!/usr/bin/env bash
set -euo pipefail
printf '%s\\n' '{' '  "cacheKey": "${matchingKey}",' '  "fixture": true' '}' > "${driftReceipt}"
`);
  chmodSync(download, 0o755);

  const driftResult = spawnSync(driftScript, [], {
    cwd: driftCheckout,
    encoding: 'utf8',
    env: {
      ...process.env,
      SNAPBACK_BOOTSTRAP_CHECK: '0',
      SNAPBACK_IBEX_CHECKOUT: driftPeer,
    },
  });
  assert.equal(driftResult.status, 0, `${driftResult.stdout}\n${driftResult.stderr}`);
  assert.match(driftResult.stdout, /observed profile cache key: fixture-stale/);
  assert.match(driftResult.stdout, /observed profile cache key: fixture-newer/);
  assert.match(driftResult.stdout, /no complete compatible sibling Ibex artifact set/);
  assert.match(driftResult.stdout, /running vendored Ibex Hermes bootstrap/);
  assert.match(readFileSync(driftReceipt, 'utf8'), new RegExp(matchingKey));

  process.stdout.write('ibex_bootstrap_v0 OK\n');
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
