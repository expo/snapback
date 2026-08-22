#!/usr/bin/env node

// @ref LLP 0175#d1--make-keep-going-dependency-aware — Phase 0 inventory guard.
// The canonical shell remains executable
// documentation, while this check makes its named dependency edges fail closed.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseProofTimeoutSeconds } from './lib/proof-timeout.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const CANONICAL_PROOF = 'scripts/verify-local-proof';
// @ref LLP 0109#166-the-manifest-is-an-executable-advertisement-gate — the
// dispatcher receipt and its quiet projection must preserve actionable
// producer failures, and Rust witnesses count only when libtest reports their
// exact test identities as executed.
const ANSI_ESCAPE = /\x1B\[[0-?]*[ -/]*[@-~]/gu;
const TYPED_ERROR = /^(?:[A-Za-z_$]*Error|[A-Za-z_$]*Exception)(?: \[[^\]]+\])?:/u;
const STACK_FRAME = /^at\s/u;
const NODE_FOOTER = /^(?:Node\.js v|\(Use `node --trace-uncaught)/u;
const NODE_NOISE = /^(?:node:internal\/|triggerUncaughtException\(|throw error;?$)/u;
const MAX_SUMMARY_LENGTH = 1_000;
const INAPPLICABILITY_PREDICATES = new Set([
  'cargo-clean-required',
  'ci-only',
  'exact-dependencies-sentinel-needed',
  'exact-surface-enabled',
  'linux-host',
  'swift-toolchain',
]);

function firstNonempty(values) {
  return values.find((value) => value !== undefined
    && value !== null
    && String(value).trim().length > 0);
}

function compactSummary(parts) {
  const summary = parts
    .map((part) => part.replace(/\s+/gu, ' ').trim())
    .filter(Boolean)
    .join(' | ');
  if (summary.length <= MAX_SUMMARY_LENGTH) return summary;
  return `${summary.slice(0, 700)} … ${summary.slice(-250)}`;
}

function isPointer(line) {
  return /^(?:\^+|~+)$/u.test(line);
}

function isUsefulFallback(line) {
  return !NODE_NOISE.test(line)
    && !NODE_FOOTER.test(line)
    && !STACK_FRAME.test(line)
    && !isPointer(line)
    && !/^\[?eval\]?:\d+/u.test(line);
}

function suiteFailureText(result) {
  const raw = firstNonempty([
    result.stderr,
    result.error?.message,
    result.stdout,
    result.signal,
    result.status,
  ]) ?? 'unknown failure';
  return String(raw);
}

export function suiteFailureDetail(result) {
  return `suite failed: ${suiteFailureText(result)}`;
}

export function summarizeSuiteFailure(result) {
  const lines = suiteFailureText(result)
    .replace(ANSI_ESCAPE, '')
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);

  const errorAt = lines.findIndex((line) => TYPED_ERROR.test(line));
  if (errorAt >= 0) {
    const message = [];
    for (const line of lines.slice(errorAt)) {
      if (message.length > 0 && (STACK_FRAME.test(line) || NODE_FOOTER.test(line))) break;
      message.push(line);
    }
    return compactSummary(message) || 'unknown failure';
  }

  const pointerAt = lines.findLastIndex(isPointer);
  if (pointerAt >= 0) {
    const thrown = [];
    for (const line of lines.slice(pointerAt + 1)) {
      if (NODE_FOOTER.test(line) || STACK_FRAME.test(line)) break;
      if (isUsefulFallback(line)) thrown.push(line);
    }
    if (thrown.length > 0) return compactSummary(thrown);
  }

  const stableDiagnostic = lines.find((line) => /\bSNAPBACK_[A-Z0-9_]+\b/u.test(line));
  const conventionalDiagnostic = lines.find((line) => /^(?:error|fatal|failed|panic):\s/iu.test(line));
  const fallback = stableDiagnostic
    ?? conventionalDiagnostic
    ?? lines.find(isUsefulFallback)
    ?? lines[0]
    ?? 'unknown failure';
  return compactSummary([fallback]);
}

export function suiteFailureDiagnostic(result) {
  return `suite failed: ${summarizeSuiteFailure(result)}`;
}

export function parseExecutedRustTests(output) {
  return [...String(output).matchAll(/^test (.+?) \.\.\. (ok|FAILED)$/gmu)]
    .map((match) => match[1]);
}

export function observeRustWitnesses(output, expectedWitnesses) {
  const executedTests = parseExecutedRustTests(output);
  const executedLeafNames = new Set(executedTests.map((name) => name.split('::').at(-1)));
  const executedWitnesses = expectedWitnesses.filter((name) => executedLeafNames.has(name));
  return {
    executedTests,
    executedWitnesses,
    missingWitnesses: expectedWitnesses.filter((name) => !executedLeafNames.has(name)),
  };
}

function unquote(value = '') {
  if ((value.startsWith('"') && value.endsWith('"'))
    || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

export function parseGateCalls(source) {
  const normalized = source.replace(/\\\n[ \t]*/gu, ' ');
  const callPattern = /^\s*run\s+([a-z0-9-]+)((?:\s+--(?:requires|timeout-seconds)\s+(?:"[^"]*"|'[^']*'|[^\s]+))*)\s+--\s+(.+)$/gmu;
  const optionPattern = /--(requires|timeout-seconds)\s+("[^"]*"|'[^']*'|[^\s]+)/gu;
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
        timeoutSeconds = parseProofTimeoutSeconds(value, {
          label: `gate ${match[1]} timeout`,
        });
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

export function parseInapplicabilityDeclarations(source) {
  const pattern = /^\s*proof_runner_declare_inapplicable\s+([a-z0-9-]+)\s+([a-z0-9-]+)\s*$/gmu;
  const declarations = [...source.matchAll(pattern)].map((match) => ({
    gateId: match[1],
    predicate: match[2],
  }));
  const sourceCount = [
    ...source.matchAll(/^\s*proof_runner_declare_inapplicable\s+/gmu),
  ].length;
  if (declarations.length !== sourceCount) {
    throw new Error(
      `local-proof applicability inventory parsed ${declarations.length} of ${sourceCount} declarations; every pair must use literal lowercase ids`,
    );
  }
  return declarations;
}

export function validateInapplicabilityDeclarations(calls, declarations) {
  const canonicalGates = new Set(calls.map(({ gateId }) => gateId));
  const pairs = new Set();
  const usedPredicates = new Set();
  const errors = [];
  for (const { gateId, predicate } of declarations) {
    const pair = `${gateId}/${predicate}`;
    if (pairs.has(pair)) errors.push(`duplicate inapplicability pair ${pair}`);
    pairs.add(pair);
    if (!canonicalGates.has(gateId)) {
      errors.push(`inapplicability declaration names unknown gate ${gateId}`);
    }
    if (!INAPPLICABILITY_PREDICATES.has(predicate)) {
      errors.push(`inapplicability declaration names unknown predicate ${predicate}`);
    }
    usedPredicates.add(predicate);
  }
  for (const predicate of INAPPLICABILITY_PREDICATES) {
    if (!usedPredicates.has(predicate)) errors.push(`unused inapplicability predicate ${predicate}`);
  }
  if (errors.length > 0) {
    throw new Error(`local-proof applicability inventory failed:\n- ${errors.join('\n- ')}`);
  }
  return { pairs, predicateCount: usedPredicates.size };
}

function evidenceHasExactKeys(evidence, keys) {
  return evidence && typeof evidence === 'object' && !Array.isArray(evidence)
    && JSON.stringify(Object.keys(evidence).sort()) === JSON.stringify([...keys].sort());
}

export function validateInapplicabilityEvidence(predicate, evidence) {
  switch (predicate) {
    case 'ci-only':
      if (!evidenceHasExactKeys(evidence, ['ci']) || evidence.ci !== false) {
        throw new Error('ci-only evidence must be exactly {"ci":false}');
      }
      break;
    case 'cargo-clean-required':
      if (!evidenceHasExactKeys(evidence, ['ci', 'cleanupDecision'])
        || evidence.ci !== true || evidence.cleanupDecision !== 'preserve') {
        throw new Error(
          'cargo-clean-required evidence must show CI with cleanupDecision preserve',
        );
      }
      break;
    case 'linux-host':
      if (!evidenceHasExactKeys(evidence, ['hostOs'])
        || typeof evidence.hostOs !== 'string'
        || !/^[a-z0-9._-]+$/u.test(evidence.hostOs)
        || evidence.hostOs === 'linux') {
        throw new Error('linux-host evidence must name a non-Linux host OS');
      }
      break;
    case 'swift-toolchain':
      if (!evidenceHasExactKeys(evidence, ['swiftAvailable'])
        || evidence.swiftAvailable !== false) {
        throw new Error('swift-toolchain evidence must be exactly {"swiftAvailable":false}');
      }
      break;
    case 'exact-surface-enabled':
    case 'exact-dependencies-sentinel-needed': {
      if (!evidenceHasExactKeys(evidence, ['verifyExact', 'exactAvailable'])
        || !['0', '1', 'auto'].includes(evidence.verifyExact)
        || (evidence.exactAvailable !== null && typeof evidence.exactAvailable !== 'boolean')
        || (evidence.verifyExact !== '0' && typeof evidence.exactAvailable !== 'boolean')) {
        throw new Error(`${predicate} evidence has an invalid Exact mode/availability fact`);
      }
      const applicable = predicate === 'exact-surface-enabled'
        ? evidence.verifyExact !== '0' && evidence.exactAvailable === true
        : evidence.verifyExact === '1' && evidence.exactAvailable === false;
      if (applicable) {
        throw new Error(`${predicate} evidence says the gate is applicable`);
      }
      break;
    }
    default:
      throw new Error(`unknown inapplicability predicate ${predicate}`);
  }
  return evidence;
}

export function validateInapplicabilityRecord(
  gateId,
  predicate,
  evidence,
  declarations,
) {
  if (!declarations.some((candidate) => (
    candidate.gateId === gateId && candidate.predicate === predicate
  ))) {
    throw new Error(`undeclared inapplicability pair ${gateId}/${predicate}`);
  }
  validateInapplicabilityEvidence(predicate, evidence);
  return { gateId, predicate, evidence };
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
  const calls = parseGateCalls(source);
  const declarations = parseInapplicabilityDeclarations(source);
  const result = validateGateCalls(calls, options);
  const applicability = validateInapplicabilityDeclarations(calls, declarations);
  return {
    ...result,
    inapplicabilityDeclarationCount: declarations.length,
    inapplicabilityPredicateCount: applicability.predicateCount,
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = checkLocalProof();
  process.stdout.write(
    `local-proof gate inventory: PASS (${result.gateCount} run declarations, ${result.uniqueGateCount} stable ids, ${result.inapplicabilityDeclarationCount} inapplicability pairs)\n`,
  );
}
