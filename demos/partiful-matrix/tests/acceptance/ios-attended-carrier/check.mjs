#!/usr/bin/env node

// @ref LLP 0063#sequence — the replacement carrier is generated from
// project.yml and must remain buildable without committing XcodeGen output.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  cpSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..', '..', '..', '..');
const amendmentPath = join(
  repoRoot,
  'demos/partiful-matrix/acceptance/physical-ios-text-carrier-amendment.2026-07-28-v3.json',
);
const amendment = JSON.parse(readFileSync(amendmentPath, 'utf8'));
const swift = readFileSync(join(here, 'Tests/PartitimeAttendedUITests.swift'), 'utf8');
const swiftCode = swift
  .split('\n')
  .filter((line) => !line.trimStart().startsWith('//'))
  .join('\n');
const project = readFileSync(join(here, 'project.yml'), 'utf8');

assert.equal(
  amendment.amendmentId,
  'partitime-step4-physical-ios-carrier-v3-2026-07-28',
);
assert.equal(amendment.status, 'proposed-pending-owner-ratification');
assert.equal(amendment.implementationStatus.qualifyingRun, 'forbidden-before-ratification');
assert.match(amendment.replacement.physical.browser, /ordinary Mobile Safari observed by XCUITest/);
assert.match(amendment.replacement.physical.browser, /no SafariDriver session exists/);
assert.match(swift, /XCUIApplication\(bundleIdentifier: "com\.apple\.mobilesafari"\)/);
assert.match(swift, /going\.typeText\(" "\)/);
assert.doesNotMatch(swiftCode, /safaridriver|WebDriver/i);
assert.match(project, /randomExecutionOrder: false/);
assert.match(project, /parallelizable: false/);

const report = {
  schemaVersion: 'partitime.ios-attended-carrier-check.v1',
  ok: true,
  amendmentId: amendment.amendmentId,
  ratificationStatus: amendment.status,
  generatedProjectCommitted: false,
  buildVerified: false,
};

if (process.argv.includes('--build')) {
  const scratch = mkdtempSync(join(tmpdir(), 'partitime-ios-attended-carrier-'));
  try {
    for (const entry of ['project.yml', 'Sources', 'Tests']) {
      cpSync(join(here, entry), join(scratch, basename(entry)), { recursive: true });
    }
    run('xcodegen', ['generate', '--spec', 'project.yml'], scratch);
    run('xcodebuild', [
      'build-for-testing',
      '-project', 'PartitimeAttendedCarrier.xcodeproj',
      '-scheme', 'PartitimeAttendedCarrier',
      '-sdk', 'iphonesimulator',
      '-derivedDataPath', join(scratch, 'DerivedData'),
      'CODE_SIGNING_ALLOWED=NO',
    ], scratch);
    report.buildVerified = true;
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

console.log(JSON.stringify(report, null, 2));

function run(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.status !== 0) {
    throw new Error([
      `${command} failed with status ${result.status}`,
      result.stdout,
      result.stderr,
    ].filter(Boolean).join('\n'));
  }
}
