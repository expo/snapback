#!/usr/bin/env node

// @ref LLP 0276#crates--the-rust-workspace — Cargo construction prevents
// absent edges; this fail-closed projection checks the allowed matrix,
// external confinement, ownership assignment, and publish posture.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(import.meta.dirname, '..');
const MATRIX_PATH = resolve(ROOT, 'crates/allowed-dependencies.v1.json');
const DIAGNOSTIC = 'SNAPBACK_WORKSPACE_GRAPH_VIOLATION';

const EXPECTED_CRATES = [
  ['snapback-types', 'shared-contract-types-leaf', 0, []],
  ['snapback-kernel', 'storage-migration-kernel', 1, ['snapback-types']],
  ['snapback-auth', 'auth-substrate', 2, ['snapback-kernel', 'snapback-types']],
  ['snapback-activation', 'generation-activation-coordinator', 3, ['snapback-auth', 'snapback-kernel', 'snapback-types']],
  ['snapback-runtime', 'js-execution', 3, ['snapback-types']],
  ['snapback-services', 'background-services', 3, ['snapback-auth', 'snapback-kernel', 'snapback-types']],
  ['snapback-sync', 'sync-realtime-engine', 3, ['snapback-auth', 'snapback-kernel', 'snapback-types']],
  ['snapback-engine', 'engine-coordinator', 4, ['snapback-activation', 'snapback-auth', 'snapback-kernel', 'snapback-runtime', 'snapback-services', 'snapback-sync', 'snapback-types']],
  ['snapback-server', 'transport-adapters', 5, ['snapback-activation', 'snapback-auth', 'snapback-engine', 'snapback-kernel', 'snapback-runtime', 'snapback-services', 'snapback-sync', 'snapback-types']],
  ['snapback-cli', 'transport-adapters', 6, ['snapback-activation', 'snapback-auth', 'snapback-engine', 'snapback-kernel', 'snapback-runtime', 'snapback-server', 'snapback-services', 'snapback-sync', 'snapback-types']],
  ['snapback', 'embed-facade', 7, ['snapback-activation', 'snapback-auth', 'snapback-cli', 'snapback-engine', 'snapback-kernel', 'snapback-runtime', 'snapback-server', 'snapback-services', 'snapback-sync', 'snapback-types']],
  ['snapback-conformance', 'proof-harness', 7, ['snapback-auth', 'snapback-engine', 'snapback-kernel', 'snapback-server', 'snapback-types']],
  ['snapback-tools', 'dev-tools', 7, ['snapback-activation', 'snapback-auth', 'snapback-cli', 'snapback-engine', 'snapback-kernel', 'snapback-runtime', 'snapback-server', 'snapback-services', 'snapback-sync', 'snapback-types']],
].map(([name, owner, rank, allowedWorkspaceDependencies]) => ({ name, owner, rank, allowedWorkspaceDependencies }));

const EXPECTED_CONFINEMENT = [
  ['axum', ['snapback-server']],
  ['celld-ltx', ['snapback-services']],
  ['clap', ['snapback-cli']],
  ['ibex-runtime', ['snapback-runtime']],
  ['rusqlite', ['snapback-kernel', 'snapback-services']],
].map(([dependency, allowedMembers]) => ({ dependency, allowedMembers }));

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sortedUniqueStrings(values, label) {
  assert(Array.isArray(values), `${label} must be an array`);
  assert(values.every((value) => typeof value === 'string' && value.length > 0), `${label} must contain strings`);
  assert(new Set(values).size === values.length, `${label} contains duplicates`);
  assert(JSON.stringify(values) === JSON.stringify([...values].sort()), `${label} must be sorted`);
}

export function validateArtifactAndMetadata(artifact, metadata) {
  assert(artifact?.schemaVersion === 'snapback.allowed-dependencies.v1', 'matrix schemaVersion is invalid');
  assert(JSON.stringify(artifact.crates) === JSON.stringify(EXPECTED_CRATES), 'matrix crate rows drifted from LLP 0276');
  assert(JSON.stringify(artifact.externalConfinement) === JSON.stringify(EXPECTED_CONFINEMENT), 'external confinement drifted from LLP 0276');
  assert(Array.isArray(artifact.membershipExceptions), 'membershipExceptions must be an array');
  const matrix = new Map(artifact.crates.map((entry) => [entry.name, entry]));
  assert(matrix.size === artifact.crates.length, 'matrix contains duplicate crate names');
  for (const entry of artifact.crates) {
    sortedUniqueStrings(entry.allowedWorkspaceDependencies, `${entry.name}.allowedWorkspaceDependencies`);
    for (const dependency of entry.allowedWorkspaceDependencies) {
      const target = matrix.get(dependency);
      assert(target, `${entry.name} allows unknown workspace dependency ${dependency}`);
      assert(entry.rank > target.rank, `${entry.name} -> ${dependency} is not strictly downward`);
    }
  }

  const packagesById = new Map((metadata?.packages ?? []).map((entry) => [entry.id, entry]));
  const members = (metadata?.workspace_members ?? []).map((id) => packagesById.get(id));
  assert(members.length > 0 && members.every(Boolean), 'cargo metadata returned missing or zero workspace members');
  const memberNames = new Set(members.map((entry) => entry.name));
  assert(memberNames.size === members.length, 'workspace contains duplicate package names');
  const remainder = artifact.remainderConfinementExemption;
  assert(remainder?.member === 'snapback', 'Phase 1 requires the named snapback remainder-confinement exemption');
  sortedUniqueStrings(remainder.dependencies, 'remainderConfinementExemption.dependencies');

  for (const member of members) {
    const row = matrix.get(member.name);
    assert(row, `workspace member ${member.name} has no owner/rank assignment`);
    assert(Array.isArray(member.publish) && member.publish.length === 0, `${member.name} must set publish = false`);
    const dependencies = new Set((member.dependencies ?? []).map((entry) => entry.name));
    for (const dependency of dependencies) {
      if (memberNames.has(dependency)) {
        assert(row.allowedWorkspaceDependencies.includes(dependency), `${member.name} may not depend on workspace member ${dependency}`);
      }
    }
    for (const rule of artifact.externalConfinement) {
      if (!dependencies.has(rule.dependency) || rule.allowedMembers.includes(member.name)) continue;
      const exempt = remainder.member === member.name && remainder.dependencies.includes(rule.dependency);
      assert(exempt, `${member.name} may not depend on confined external ${rule.dependency}`);
    }
  }
  return { members: [...memberNames].sort(), plannedCrates: matrix.size };
}

function main() {
  try {
    const artifact = JSON.parse(readFileSync(MATRIX_PATH, 'utf8'));
    const metadata = JSON.parse(execFileSync(
      'cargo',
      ['metadata', '--format-version', '1', '--no-deps'],
      { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
    ));
    const result = validateArtifactAndMetadata(artifact, metadata);
    process.stdout.write(`[workspace-graph] PASS: ${result.members.length} members (${result.members.join(', ')}); ${result.plannedCrates} planned matrix rows\n`);
  } catch (error) {
    process.stderr.write(`${DIAGNOSTIC}: ${error.message}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
