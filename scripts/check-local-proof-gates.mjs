#!/usr/bin/env node

// @ref LLP 0175#d1--make-keep-going-dependency-aware — Phase 0 inventory guard.
// The canonical shell remains executable
// documentation, while this check makes its named dependency edges fail closed.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(import.meta.dirname, '..');
const CANONICAL_PROOF = 'scripts/verify-local-proof';

function unquote(value = '') {
  if ((value.startsWith('"') && value.endsWith('"'))
    || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

export function parseGateCalls(source) {
  const normalized = source.replace(/\\\n[ \t]*/gu, ' ');
  const callPattern = /^\s*run\s+([a-z0-9-]+)((?:\s+--(?:requires|timeout-seconds)\s+(?:"[^"]+"|'[^']+'|[^\s]+))*)\s+--\s+(.+)$/gmu;
  const optionPattern = /--(requires|timeout-seconds)\s+("[^"]+"|'[^']+'|[^\s]+)/gu;
  const calls = [];
  for (const match of normalized.matchAll(callPattern)) {
    let prerequisites = [];
    let timeoutSeconds;
    const seenOptions = new Set();
    for (const option of match[2].matchAll(optionPattern)) {
      const name = option[1];
      const value = unquote(option[2]);
      if (seenOptions.has(name)) throw new Error(`duplicate ${name} option for gate ${match[1]}`);
      seenOptions.add(name);
      if (name === 'requires') {
        prerequisites = value.split(',').filter(Boolean);
      } else {
        timeoutSeconds = Number(value);
        if (!Number.isSafeInteger(timeoutSeconds) || timeoutSeconds <= 0) {
          throw new Error(`gate ${match[1]} timeout must be a positive integer`);
        }
      }
    }
    const call = {
      gateId: match[1],
      prerequisites,
      command: match[3],
    };
    if (timeoutSeconds !== undefined) call.timeoutSeconds = timeoutSeconds;
    calls.push(call);
  }
  const sourceCallCount = [...normalized.matchAll(/^\s*run\s+/gmu)].length;
  if (calls.length !== sourceCallCount) {
    throw new Error(
      `local-proof gate inventory parsed ${calls.length} of ${sourceCallCount} run declarations; every command needs a stable gate id and -- separator`,
    );
  }
  return calls;
}

export function commandSourcePaths(command) {
  return [...command.matchAll(/(?:^|\s)((?:demos|tests|packages|scripts)\/[A-Za-z0-9_./-]+\.(?:mjs|js))/gu)]
    .map((match) => match[1]);
}

export function validateGateCalls(calls, {
  readSource = (path) => readFileSync(resolve(ROOT, path), 'utf8'),
} = {}) {
  const errors = [];
  const byId = new Map();
  for (const call of calls) {
    const siblings = byId.get(call.gateId) ?? [];
    siblings.push(call);
    byId.set(call.gateId, siblings);
  }
  for (const [gateId, duplicates] of byId) {
    if (duplicates.length > 1 && gateId !== 'cargo-test-profile-clean') {
      errors.push(`duplicate gate id ${gateId}`);
    }
  }

  const requiredEdges = new Map([
    ['native-runtime-bootstrap', ['toolchain-authority']],
    ['publication-script-fixtures', ['toolchain-authority']],
    ['ibex-doctor', ['native-runtime-bootstrap']],
    ['current-binary-build', ['native-runtime-bootstrap']],
    ['current-binary-readiness', ['current-binary-build']],
    ['file-drop-browser-relay', ['current-binary-readiness', 'browser-availability']],
    ['admin-acceptance', ['browser-availability']],
  ]);
  for (const [gateId, prerequisites] of requiredEdges) {
    const call = byId.get(gateId)?.[0];
    if (!call) {
      errors.push(`missing required producer/dependent gate ${gateId}`);
      continue;
    }
    for (const prerequisite of prerequisites) {
      if (!call.prerequisites.includes(prerequisite)) {
        errors.push(`gate ${gateId} must require ${prerequisite}`);
      }
    }
  }

  for (const call of calls) {
    for (const path of commandSourcePaths(call.command)) {
      let source;
      try {
        source = readSource(path);
      } catch {
        continue;
      }
      if (!/\bstartServer\s*\(/u.test(source)) continue;
      if (/\s--check(?:\s|$)/u.test(call.command)) continue;
      if (!call.prerequisites.includes('current-binary-readiness')) {
        errors.push(
          `real-server gate ${call.gateId} (${path}) must require current-binary-readiness`,
        );
      }
    }
  }

  if (errors.length > 0) {
    throw new Error(`local-proof dependency inventory failed:\n- ${errors.join('\n- ')}`);
  }
  return { gateCount: calls.length, uniqueGateCount: byId.size };
}

export function checkLocalProof(source = readFileSync(resolve(ROOT, CANONICAL_PROOF), 'utf8'), options) {
  return validateGateCalls(parseGateCalls(source), options);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = checkLocalProof();
  process.stdout.write(
    `local-proof gate inventory: PASS (${result.gateCount} declarations, ${result.uniqueGateCount} stable ids)\n`,
  );
}
