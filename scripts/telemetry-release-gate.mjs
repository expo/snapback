import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const defaultRepoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const refusalCode = 'SNAPBACK_TELEMETRY_RELEASE_GATE_REFUSED';

// @ref LLP 0154#amendment-2026-08-06-rolling-trailing-head-evidence — release
// and capability-promotion authority requires exact-current evidence at the
// frozen candidate revision, distinct from ordinary rolling-main acceptance.
// @ref LLP 0189#decision — this exact-commit strictness is the named D-7
// per-claim carve-out (LLP 0175 D2.4), not the repo default; do not copy it
// into new gates without an author ruling.
export function enforceTelemetryCurrentGate({
  repoRoot = defaultRepoRoot,
  candidateRevision,
  receiptPath = null,
  runVerifier = defaultRunVerifier,
}) {
  if (typeof candidateRevision !== 'string' || !/^[0-9a-f]{40}$/u.test(candidateRevision)) {
    refuse('candidate revision must be a 40-hex Git revision');
  }

  let result;
  try {
    result = runVerifier({ repoRoot, candidateRevision, receiptPath });
  } catch (error) {
    refuse(`verifier crashed: ${error?.message ?? String(error)}`);
  }

  const assessment = parseAssessment(result?.stdout);
  if (result?.status !== 0) {
    refuse(
      `verifier exited ${result?.status ?? result?.signal ?? 'without a status'}`
        + (assessment ? ` with ${assessment.state ?? 'unknown'} evidence` : ''),
    );
  }
  if (assessment === null) refuse('verifier emitted no parseable assessment');
  if (
    assessment.state !== 'CURRENT'
    || assessment.acceptedForReleaseOrCapabilityPromotion !== true
    || assessment.headRevision !== candidateRevision
  ) {
    refuse('assessment is not exact-current for the frozen candidate revision');
  }
  return assessment;
}

function defaultRunVerifier({ repoRoot, candidateRevision, receiptPath }) {
  const env = { ...process.env };
  if (receiptPath !== null) env.SNAPBACK_TELEMETRY_PHASE1_RECEIPT = receiptPath;
  return spawnSync(
    join(repoRoot, 'scripts', 'verify-telemetry-phase1-proof'),
    ['--require-current', candidateRevision],
    {
      cwd: repoRoot,
      encoding: 'utf8',
      env,
      maxBuffer: 8 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 120_000,
    },
  );
}

function parseAssessment(stdout) {
  if (typeof stdout !== 'string') return null;
  for (const line of stdout.split(/\r?\n/u)) {
    if (line.trim() === '') continue;
    try {
      const value = JSON.parse(line);
      if (
        value !== null
        && typeof value === 'object'
        && value.schemaVersion === 'snapback.telemetry-phase1-evidence-assessment.v1'
      ) return value;
    } catch {
      // Ignore non-JSON diagnostics; the caller refuses if no assessment exists.
    }
  }
  return null;
}

function refuse(reason) {
  throw new Error(`${refusalCode}: ${reason}`);
}
