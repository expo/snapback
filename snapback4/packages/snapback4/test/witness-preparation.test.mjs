import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { inventory, hbc, nativeFiles, differences, seal, installedInventory, shellQuote } from '../../../crates/snapback4/src/verbs/witness/payload.mjs';

test('Xcode shell environment keeps executable paths literal', () => {
  const value = "/a path/with'quotes/$HOME/$(printf wrong)/`printf wrong`/node";
  const result = spawnSync('/bin/sh', ['-c', `printf %s ${shellQuote(value)}`], { encoding: 'utf8' });
  assert.equal(result.status, 0);
  assert.equal(result.stdout, value);
});

test('installation accepts only the measured framework execute-bit normalization', () => {
  const file = { path: 'Frameworks/Hermes.framework/Hermes', type: 'file', mode: 0o755, bytes: 100, sha256: 'same' };
  const base = { files: [file] }, installed = { files: [{ ...file, mode: 0o644 }] };
  assert.equal(installedInventory(base, installed, [file]), installed);
  for (const change of [{ sha256: 'changed' }, { bytes: 101 }, { mode: 0o600 }, { type: 'symlink' }]) {
    assert.throws(() => installedInventory(base, { files: [{ ...installed.files[0], ...change }] }, [file]), /E_WITNESS_PROOF/);
  }
  assert.throws(() => installedInventory(base, installed, []), /E_WITNESS_PROOF/);
  assert.throws(() => installedInventory({ files: [{ ...file, path: 'App' }] }, { files: [{ ...file, path: 'App', mode: 0o644 }] }, [{ ...file, path: 'App' }]), /E_WITNESS_PROOF/);
});

test('payload inventory binds bytes, paths, modes and safe relative links', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'np-inventory-'));
  try {
    fs.writeFileSync(path.join(dir, 'exe'), Buffer.from('cffaedfe00000000', 'hex'));
    fs.writeFileSync(path.join(dir, 'asset'), 'A');
    fs.symlinkSync('asset', path.join(dir, 'alias'));
    const a = inventory(dir);
    assert.equal(nativeFiles(dir, a)[0].path, 'exe');
    fs.writeFileSync(path.join(dir, 'asset'), 'B');
    const b = inventory(dir);
    assert.notEqual(a.sha256, b.sha256);
    assert.deepEqual(differences(a.files, b.files).map(x => x.path), ['asset']);
    fs.chmodSync(path.join(dir, 'exe'), 0o700);
    assert.notEqual(inventory(dir).sha256, b.sha256);
    fs.symlinkSync('../', path.join(dir, 'escape'));
    assert.throws(() => inventory(dir), /E_WITNESS_PROOF.*escaping/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('source, truncated and wrong magic bundles cannot masquerade as HBC', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'np-hbc-')), file = path.join(dir, 'main.jsbundle');
  try {
    for (const bytes of [Buffer.from('console.log("hello")'), Buffer.alloc(128), Buffer.from('c61fbc03c103191f62000000', 'hex')]) {
      fs.writeFileSync(file, bytes); assert.throws(() => hbc(file), /E_WITNESS_HERMES/);
    }
    const bytes = Buffer.alloc(128); Buffer.from('c61fbc03c103191f', 'hex').copy(bytes); bytes.writeUInt32LE(98, 8);
    fs.writeFileSync(file, bytes); assert.equal(hbc(file).version, 98);
    seal(path.join(dir, 'build.json'), { result: 'A' });
    assert.throws(() => seal(path.join(dir, 'build.json'), { result: 'B' }), /EEXIST/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
