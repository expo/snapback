import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, copyFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('../../../scripts/wasm-budget.mjs', import.meta.url));
test('wasm budget accepts a recorded limit and refuses missing, malformed or nonnumeric limits', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'wasm-budget-'));
  const file = path.join(dir, 'wasm-budget.json');
  const run = () => spawnSync(process.execPath, [script, file], { encoding: 'utf8' });
  try {
    assert.notEqual(run().status, 0);
    writeFileSync(file, '{'); assert.notEqual(run().status, 0);
    writeFileSync(file, JSON.stringify({ gzip: '1000', set: '2026-09-17', why: 'test' })); assert.notEqual(run().status, 0);
    writeFileSync(file, JSON.stringify({ gzip: 1000, set: '2026-09-17', why: 'test' }));
    const accepted = run(); assert.equal(accepted.status, 0, accepted.stderr); assert.equal(accepted.stdout.trim(), '1000');
    for (const [bytes, message] of [['999', '(budget 1000: ok)'], ['1001', '(budget 1000: OVER by 1 B — issues/20260913-snapback4-wasm-device-diet.md)']]) {
      const report = spawnSync(process.execPath, [script, file, bytes], { encoding: 'utf8' });
      assert.equal(report.status, 0, report.stderr); assert.equal(report.stdout.trim(), message);
    }
  } finally { rmSync(dir, { recursive: true }); }
});

test('both shipped scripts use the budget helper; dirty measurements are explicit', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'wasm-scripts-'));
  const root = path.join(dir, 'snapback4');
  const bin = path.join(dir, 'bin');
  const source = fileURLToPath(new URL('../../../scripts/', import.meta.url));
  const stub = (name, body) => writeFileSync(path.join(bin, name), `#!/bin/bash\nset -eu\n${body}\n`, { mode: 0o755 });
  try {
    for (const sub of [bin, path.join(root, 'scripts'), path.join(root, 'metrics')]) mkdirSync(sub, { recursive: true });
    for (const name of ['build-wasm.sh', 'measure-wasm.sh', 'wasm-budget.mjs']) copyFileSync(path.join(source, name), path.join(root, 'scripts', name));
    writeFileSync(path.join(root, 'scripts/attribute-wasm.mjs'), `import { appendFileSync } from 'node:fs';
appendFileSync(process.env.TOOLS_LOG, process.argv.slice(2).join(' ') + '\\n');
if (process.argv[2] !== '--check-families' || process.env.TEST_FAMILY_FAIL === 'true') process.exit(1);
`);
    stub('cargo', 'echo cargo >> "$TOOLS_LOG"');
    stub('wasm-bindgen', 'while [ "$1" != --out-dir ]; do shift; done\nshift\nmkdir -p "$1"\nprintf wasm > "$1/snapback4_device_bg.wasm"\nprintf glue > "$1/snapback4_device.js"');
    stub('wasm-opt', 'while [ "$1" != -o ]; do shift; done\ncp "$3" "$2"');
    stub('brotli', 'cat "${@: -1}"');
    stub('git', 'if [ "$1" = -C ]; then\n  printf "%s\\n" "$*" >> "$TOOLS_LOG"\n  if [ -n "$TEST_DIRTY" ]; then for arg in "$@"; do if [ "$arg" = "$TEST_DIRTY" ]; then echo " M $TEST_DIRTY"; fi; done; fi\nelse echo 123456789; fi');
    const budget = path.join(root, 'metrics/wasm-budget.json');
    const log = path.join(dir, 'tools.log');
    for (const name of ['build-wasm.sh', 'measure-wasm.sh']) {
      const run = (dirty = '', familyFail = false, extra = []) => spawnSync('bash', [path.join(root, 'scripts', name), ...extra], {
        encoding: 'utf8', env: { ...process.env, PATH: `${bin}:${path.dirname(process.execPath)}:${process.env.PATH}`, TOOLS_LOG: log, TEST_DIRTY: dirty, TEST_FAMILY_FAIL: String(familyFail) },
      });
      rmSync(budget, { force: true }); writeFileSync(log, '');
      const missing = run(); assert.notEqual(missing.status, 0); assert.match(missing.stderr, /wasm-budget.json/); assert.equal(readFileSync(log, 'utf8'), '');
      writeFileSync(budget, '{');
      const malformed = run(); assert.notEqual(malformed.status, 0); assert.match(malformed.stderr, /wasm-budget.json/); assert.equal(readFileSync(log, 'utf8'), '');
      writeFileSync(budget, JSON.stringify({ gzip: 1, set: '2026-09-17', why: 'force overrun' }));
      for (const dirtyPath of ['', 'snapback4/crates', 'snapback4/rust-toolchain.toml', 'snapback4/metrics/wasm-budget.json']) {
        const dirty = Boolean(dirtyPath);
        const result = run(dirtyPath); assert.equal(result.status, 0, result.stderr);
        assert.match(readFileSync(log, 'utf8'), /cargo/);
        if (name === 'build-wasm.sh') assert.match(result.stdout, /OVER by \d+ B/);
        else {
          const measured = JSON.parse(result.stdout); assert.equal(measured.dirty, dirty); assert.ok(measured.over > 0); assert.equal(measured.sha, '123456789');
          assert.equal(result.stderr.includes('WARNING: measuring a dirty source tree'), dirty);
          assert.match(readFileSync(log, 'utf8'), /status --porcelain -- snapback4\/crates snapback4\/scripts snapback4\/Cargo.toml snapback4\/Cargo.lock snapback4\/rust-toolchain.toml snapback4\/metrics\/wasm-budget.json/);
          assert.match(readFileSync(log, 'utf8'), /--check-families/);
        }
      }
      if (name === 'measure-wasm.sh') {
        writeFileSync(log, '');
        const metrics = path.join(root, 'metrics/wasm.jsonl');
        const before = readFileSync(metrics, 'utf8');
        const preview = run('snapback4/crates', false, ['--no-record']);
        assert.equal(preview.status, 0, preview.stderr);
        assert.equal(JSON.parse(preview.stdout).dirty, true);
        assert.equal(readFileSync(metrics, 'utf8'), before, 'a preview must not append a dirty measurement');
        const unknown = run('', false, ['--unknown']);
        assert.notEqual(unknown.status, 0);
        assert.match(unknown.stderr, /usage:/);
        writeFileSync(log, '');
        const rejected = run('', true);
        assert.notEqual(rejected.status, 0);
        assert.doesNotMatch(readFileSync(log, 'utf8'), /cargo/);
        assert.equal(readFileSync(metrics, 'utf8'), before, 'a second family must not publish a measurement');
      }
    }
  } finally { rmSync(dir, { recursive: true }); }
});
