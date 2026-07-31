// The persisted runtime readiness receipt (LLP 0115 CV-3).
//
// CV-2 (`snapback runtime-qualify`, landed 814acd77) made handler-VM
// qualification a bootstrap fact; this module makes it a *persistent* one.
// A receipt binds the qualified binary's digest, the Hermes framework
// artifact digests it was qualified against, and the qualification verdict
// into one document stored beside the binary it certifies. Doctor, bootstrap,
// the demo harness, and verify-local-proof all trust and re-verify the same
// artifact instead of each holding a private, unpersisted opinion.
//
// Custody: the receipt lives at `<binary>.runtime-readiness.json`, so it is
// created and destroyed with the binary it describes (cargo clean removes
// both). Trust never derives from the file's presence or location alone —
// consumption always recomputes the binary digest and the current framework
// artifact digests and compares. A framework refresh after issuance therefore
// invalidates the receipt (framework-drift) without any bookkeeping, and a
// tampered or hand-written receipt fails digest coherence.
//
// @ref LLP 0010#native-runtime-bootstrap — every refusal here carries the one
// stable code `SNAPBACK_IBEX_RUNTIME_RECEIPT_INVALID` (with the machine
// classification in `details.reason`), extending the CV-2 vocabulary rather
// than inventing a parallel one.

import {
  closeSync,
  existsSync,
  fstatSync,
  openSync,
  readFileSync,
  readSync,
  realpathSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { qualifyRuntimeBinary } from './runtime-recovery.mjs';

export const RUNTIME_READINESS_SCHEMA_VERSION = 'snapback.runtime-readiness.v1';
export const RUNTIME_READINESS_INVALID_CODE = 'SNAPBACK_IBEX_RUNTIME_RECEIPT_INVALID';

const HASH_CHUNK_BYTES = 1024 * 1024;

/// The receipt is a sibling of the binary it certifies, so it shares the
/// binary's lifecycle (built together, cleaned together) and every consumer
/// can derive its location from the one fact they already hold.
export function runtimeReadinessReceiptPath(binaryPath) {
  return `${resolve(binaryPath)}.runtime-readiness.json`;
}

/// The Hermes runtime artifacts a built binary is qualified against — the
/// same candidate set the runtime-link probe records as
/// `producerInputs.nativeArtifacts`, so the receipt and the recovery record
/// speak one digest vocabulary.
export function runtimeArtifactCandidates(root, { platform = process.platform } = {}) {
  return platform === 'darwin'
    ? [
        join(root, 'vendor/ibex/ios/Frameworks/hermes-headers/hermes/hermes.h'),
        join(root, 'vendor/ibex/ios/Frameworks/hermesvm.framework/hermesvm'),
        join(root, 'vendor/ibex/ios/Frameworks/hermes.framework/hermes'),
      ]
    : [
        join(root, 'vendor/ibex/linux/hermes-headers/hermes/hermes.h'),
        join(root, 'vendor/ibex/linux/lib/libhermesvm.so'),
      ];
}

function sha256File(path) {
  let descriptor;
  try {
    descriptor = openSync(path, 'r');
    const metadata = fstatSync(descriptor);
    if (!metadata.isFile()) return null;
    const hash = createHash('sha256');
    const chunk = Buffer.allocUnsafe(Math.min(HASH_CHUNK_BYTES, Math.max(metadata.size, 1)));
    let consumed = 0;
    while (consumed < metadata.size) {
      const count = readSync(
        descriptor,
        chunk,
        0,
        Math.min(chunk.byteLength, metadata.size - consumed),
        null,
      );
      if (count === 0) break;
      hash.update(chunk.subarray(0, count));
      consumed += count;
    }
    if (consumed !== metadata.size) return null;
    return { bytes: metadata.size, sha256: hash.digest('hex') };
  } catch {
    return null;
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

/// Digest the existing runtime artifacts, keyed by root-relative path so a
/// receipt stays coherent when a checkout moves but incoherent when an
/// artifact's bytes change.
export function digestRuntimeArtifacts(root, {
  platform = process.platform,
  candidates = null,
} = {}) {
  root = resolve(root);
  const paths = candidates ?? runtimeArtifactCandidates(root, { platform });
  const artifacts = [];
  for (const path of paths) {
    const absolute = isAbsolute(path) ? path : resolve(root, path);
    const digest = sha256File(absolute);
    if (digest) {
      artifacts.push({ path: relative(root, absolute), bytes: digest.bytes, sha256: digest.sha256 });
    }
  }
  return artifacts;
}

/// Issue a readiness receipt for a binary whose qualification verdict is OK.
/// Refuses to issue anything else: a receipt asserts readiness, never records
/// a failure (failures ride the runtime-recovery record).
export function issueRuntimeReadinessReceipt({
  root,
  binaryPath,
  qualification,
  issuer = 'unknown',
  platform = process.platform,
  artifacts = null,
}) {
  root = resolve(root);
  binaryPath = resolve(binaryPath);
  if (qualification?.ok !== true) {
    const error = new Error(
      'a runtime readiness receipt may only be issued for an OK qualification verdict',
    );
    error.code = RUNTIME_READINESS_INVALID_CODE;
    throw error;
  }
  const binaryDigest = sha256File(binaryPath);
  if (!binaryDigest) {
    const error = new Error(`the qualified binary does not exist or is unreadable: ${binaryPath}`);
    error.code = RUNTIME_READINESS_INVALID_CODE;
    throw error;
  }
  const receipt = {
    schemaVersion: RUNTIME_READINESS_SCHEMA_VERSION,
    issuedAt: new Date().toISOString(),
    issuer,
    platform: `${platform}-${process.arch}`,
    binary: { bytes: binaryDigest.bytes, sha256: binaryDigest.sha256 },
    buildIdentity: qualification.report?.binary ?? null,
    artifacts: artifacts ?? digestRuntimeArtifacts(root, { platform }),
    qualification: {
      probe: qualification.probe ?? 'restricted-no-eval-handler-vm',
      ok: true,
      report: qualification.report ?? null,
    },
  };
  const receiptPath = runtimeReadinessReceiptPath(binaryPath);
  const temporary = `${receiptPath}.${randomUUID()}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(receipt, null, 2)}\n`);
  renameSync(temporary, receiptPath);
  return { receipt, receiptPath };
}

function refusal(reason, message, { receiptPath, binaryPath, root, details = {} }) {
  return {
    ok: false,
    reason,
    receipt: null,
    receiptPath,
    diagnostic: {
      code: RUNTIME_READINESS_INVALID_CODE,
      severity: 'error',
      subsystem: 'runtime-readiness',
      message,
      details: {
        reason,
        receiptPath,
        binaryPath,
        ...details,
        repairCommand: `${join(root, 'scripts/bootstrap-ibex-runtime')}`,
        requalifyCommand:
          `node ${join(root, 'packages/snapback-cli/runtime-readiness.mjs')} issue --binary ${binaryPath}`,
      },
    },
  };
}

/// Read-only digest-coherence verification of a binary's persisted readiness
/// receipt. Never writes; never runs the binary. `reason` classifies:
/// `coherent` (ok), `absent`, `malformed`, `unqualified`, `binary-missing`,
/// `binary-drift`, `framework-drift`. Every refusal carries the one shared
/// `SNAPBACK_IBEX_RUNTIME_RECEIPT_INVALID` diagnostic.
export function verifyRuntimeReadinessReceipt({
  root,
  binaryPath,
  platform = process.platform,
  artifacts = null,
}) {
  root = resolve(root);
  binaryPath = resolve(binaryPath);
  const receiptPath = runtimeReadinessReceiptPath(binaryPath);
  const context = { receiptPath, binaryPath, root };
  if (!existsSync(binaryPath)) {
    return refusal('binary-missing', `the selected runtime binary does not exist: ${binaryPath}`, context);
  }
  if (!existsSync(receiptPath)) {
    return refusal(
      'absent',
      `no persisted runtime readiness receipt exists for ${binaryPath}; the binary has not been handler-VM qualified since it was built`,
      context,
    );
  }
  let receipt;
  try {
    receipt = JSON.parse(readFileSync(receiptPath, 'utf8'));
  } catch (error) {
    return refusal('malformed', `the runtime readiness receipt is not valid JSON: ${error.message}`, context);
  }
  if (
    receipt?.schemaVersion !== RUNTIME_READINESS_SCHEMA_VERSION
    || typeof receipt.binary?.sha256 !== 'string'
    || !Array.isArray(receipt.artifacts)
  ) {
    return refusal('malformed', 'the runtime readiness receipt does not carry the snapback.runtime-readiness.v1 shape', context);
  }
  if (receipt.qualification?.ok !== true) {
    return refusal('unqualified', 'the runtime readiness receipt does not carry an OK qualification verdict', context);
  }
  const binaryDigest = sha256File(binaryPath);
  if (!binaryDigest || binaryDigest.sha256 !== receipt.binary.sha256) {
    return refusal(
      'binary-drift',
      `the served binary's digest does not match its readiness receipt (the binary was rebuilt or replaced after qualification): ${binaryPath}`,
      { ...context, details: { expectedSha256: receipt.binary.sha256, actualSha256: binaryDigest?.sha256 ?? null } },
    );
  }
  const current = artifacts ?? digestRuntimeArtifacts(root, { platform });
  const recorded = receipt.artifacts;
  const describe = (list) => list
    .map((artifact) => `${artifact.path}:${artifact.sha256}`)
    .sort()
    .join(', ');
  if (describe(current) !== describe(recorded)) {
    return refusal(
      'framework-drift',
      'the Hermes runtime artifacts changed after this receipt was issued (framework refresh or swap); the qualification no longer describes the pairing that would serve',
      { ...context, details: { recordedArtifacts: recorded, currentArtifacts: current } },
    );
  }
  return { ok: true, reason: 'coherent', receipt, receiptPath, diagnostic: null };
}

function parseArgs(argv) {
  const options = { command: argv[0] };
  for (let index = 1; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--binary') options.binary = argv[++index];
    else if (arg === '--root') options.root = argv[++index];
    else if (arg === '--issuer') options.issuer = argv[++index];
    else if (arg === '--json') options.json = true;
    else throw new Error(`unknown argument: ${arg}`);
  }
  if (options.command !== 'issue' && options.command !== 'verify') {
    throw new Error('usage: runtime-readiness.mjs <issue|verify> --binary <path> [--root <path>] [--issuer <name>] [--json]');
  }
  if (!options.binary) throw new Error('--binary is required');
  return options;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const root = resolve(options.root ?? process.cwd());
  const binaryPath = resolve(root, options.binary);
  if (options.command === 'issue') {
    const qualification = qualifyRuntimeBinary(binaryPath, process.env);
    if (!qualification.ok) {
      const diagnostic = {
        code: 'SNAPBACK_IBEX_RUNTIME_VM_CREATE_FAILED',
        severity: 'error',
        subsystem: 'runtime-readiness',
        message: `the binary could not create its restricted no-eval handler VM, so no readiness receipt was issued: ${qualification.reason}`,
        details: { qualification: { probe: 'restricted-no-eval-handler-vm', ok: false, report: qualification.report } },
      };
      process.stdout.write(options.json
        ? `${JSON.stringify({ ok: false, diagnostic })}\n`
        : `[runtime-readiness] ${diagnostic.code}: ${diagnostic.message}\n`);
      process.exitCode = 1;
      return;
    }
    const { receiptPath } = issueRuntimeReadinessReceipt({
      root,
      binaryPath,
      qualification: { probe: 'restricted-no-eval-handler-vm', ok: true, report: qualification.report },
      issuer: options.issuer ?? 'runtime-readiness-cli',
    });
    process.stdout.write(options.json
      ? `${JSON.stringify({ ok: true, receiptPath })}\n`
      : `[runtime-readiness] issued ${receiptPath}\n`);
    return;
  }
  const verdict = verifyRuntimeReadinessReceipt({ root, binaryPath });
  if (options.json) {
    process.stdout.write(`${JSON.stringify(verdict)}\n`);
  } else if (verdict.ok) {
    process.stdout.write(`[runtime-readiness] coherent: ${verdict.receiptPath}\n`);
  } else {
    process.stdout.write(`[runtime-readiness] ${verdict.diagnostic.code} (${verdict.reason}): ${verdict.diagnostic.message}\n`);
  }
  if (!verdict.ok) process.exitCode = 1;
}

if (
  process.argv[1]
  && realpathSync(resolve(process.argv[1])) === realpathSync(fileURLToPath(import.meta.url))
) {
  main();
}
