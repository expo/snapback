// Cloudflare local proof runtime preflight (ENG-24454).
//
// @ref LLP 0040#proof-runtime-preflight-2026-07-14-eng-24454 — the Miniflare
// loopback proof is validated only on the pinned Node major; an unsupported
// major (observed on Node 25.9.0) intermittently resets the first real-loopback
// action request (`read ECONNRESET`). This constrains the supported runtime and
// fails closed with an actionable diagnostic; it does not fix the underlying
// Node 25 transport-lifecycle race, which is upstream-shaped.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../..');

export const PROOF_NODE_UNSUPPORTED_CODE = 'SNAPBACK_CLOUDFLARE_PROOF_NODE_UNSUPPORTED';

// Parse the leading `major.minor.patch` of a Node version string ("v24.18.0",
// "25.9.0", "24.14.0"). Throws on anything that is not an exact semver core so
// a malformed authority cannot silently pass the major comparison.
export function parseNodeMajor(version, label = 'Node version') {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(String(version ?? '').trim());
  if (!match) {
    throw new Error(`${label} is not an exact semver: ${JSON.stringify(version)}`);
  }
  return Number(match[1]);
}

// Pure, injectable comparison — the unit test drives this directly with
// synthetic version strings so the logic is validated independent of the Node
// the test itself runs under. Support is major-equality against the
// `.node-version` authority (ENG-24513); patch/minor drift is out of scope here
// and is separately asserted by scripts/check-toolchain-authority.mjs.
export function evaluateProofNodeSupport({ activeVersion, pinnedVersion }) {
  const activeMajor = parseNodeMajor(activeVersion, 'active Node version');
  const pinnedMajor = parseNodeMajor(pinnedVersion, 'pinned .node-version Node');
  return {
    supported: activeMajor === pinnedMajor,
    activeMajor,
    pinnedMajor,
    activeVersion: String(activeVersion).trim().replace(/^v/, ''),
    pinnedVersion: String(pinnedVersion).trim().replace(/^v/, ''),
  };
}

export function formatUnsupportedNodeDiagnostic(evaluation) {
  const { activeVersion, activeMajor, pinnedVersion, pinnedMajor } = evaluation;
  return [
    `${PROOF_NODE_UNSUPPORTED_CODE}: active Node v${activeVersion} (major ${activeMajor}) is not the`,
    `supported Cloudflare proof runtime. The Miniflare loopback proof is validated only on`,
    `Node ${pinnedMajor}.x, pinned to v${pinnedVersion} in .node-version (ENG-24513). On unsupported`,
    `majors the first real-loopback action request intermittently fails with \`read ECONNRESET\``,
    `(observed on Node 25.9.0, ENG-24454) — a Miniflare/Node transport-lifecycle race, not an`,
    `action-semantic failure. This preflight constrains the supported runtime; it does not fix`,
    `the Node ${activeMajor} transport (upstream-shaped) and no action retry hides it. Switch to the`,
    `pinned Node before running the proof, e.g. \`volta install node@${pinnedVersion}\`,`,
    `\`fnm use\`, or \`nvm install ${pinnedVersion} && nvm use\` (each reads .node-version).`,
  ].join(' ');
}

export function readPinnedNodeVersion() {
  return fs.readFileSync(path.join(repoRoot, '.node-version'), 'utf8').trim();
}

// Fail closed unless the active Node major matches the pinned authority. Returns
// the evaluation on success; throws an Error carrying `.code` on an unsupported
// major so callers and test output can attribute the refusal unambiguously.
export function assertProofRuntimeNode({
  activeVersion = process.versions.node,
  pinnedVersion = readPinnedNodeVersion(),
} = {}) {
  const evaluation = evaluateProofNodeSupport({ activeVersion, pinnedVersion });
  if (!evaluation.supported) {
    const error = new Error(formatUnsupportedNodeDiagnostic(evaluation));
    error.code = PROOF_NODE_UNSUPPORTED_CODE;
    throw error;
  }
  return evaluation;
}
