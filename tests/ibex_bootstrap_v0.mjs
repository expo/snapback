import { strict as assert } from 'node:assert';
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
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
  if (platform === 'darwin') {
    const frameworks = join(vendor, 'ios', 'Frameworks');
    touch(join(frameworks, 'hermes-headers', 'hermes', 'hermes.h'));
    touch(join(frameworks, 'hermes-headers', 'jsi', 'jsi.h'));
    touch(join(frameworks, 'hermes.framework', 'hermes'));
    touch(join(vendor, 'tools', 'hermes', `hermesc-macos-${hermesArch}`));
  } else if (platform === 'linux') {
    touch(join(vendor, 'linux', 'hermes-headers', 'hermes', 'hermes.h'));
    touch(join(vendor, 'linux', 'hermes-headers', 'jsi', 'jsi.h'));
    touch(join(vendor, 'linux', 'lib', 'libhermesvm.so'));
    touch(join(vendor, 'tools', 'hermes', `hermesc-linux-${hermesArch}`));
  } else {
    process.stdout.write(`ibex_bootstrap_v0 SKIP: unsupported fixture platform ${platform}\n`);
    process.exit(0);
  }

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

  process.stdout.write('ibex_bootstrap_v0 OK\n');
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
