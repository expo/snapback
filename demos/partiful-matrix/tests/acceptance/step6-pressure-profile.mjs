#!/usr/bin/env node

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// @ref LLP 0063#workstream-7--complete-the-application-platform
// @ref LLP 0063#next-application-pressure-tests
//
// The cumulative manifest froze all three Step 6 verticals as mandatory.
// This executable status witness refuses to confuse an existing demo, a
// Draft RFC, or a local stub with the admitted hosted product profile.

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..', '..', '..');
const option = (name, fallback = null) => {
  const at = process.argv.indexOf(`--${name}`);
  return at < 0 ? fallback : process.argv[at + 1];
};
const profile = option('profile');
const requirePass = process.argv.includes('--require-pass');
const profiles = {
  chat: {
    claimId: 'STEP6.CHAT',
    admittedProfile: 'team-chat-trusted-single-tenant.v1',
    authorities: [
      'llp/0014-cloudflare-strategy.rfc.md',
      'llp/0044-asset-storage-pipeline.rfc.md',
      'llp/0045-notifications-outbox.rfc.md',
      'llp/0070-durable-background-work.rfc.md',
      'llp/0071-application-abuse-moderation-and-audit.rfc.md',
      'llp/0072-trusted-single-tenant-control-plane.rfc.md',
      'llp/0073-portable-full-text-search.rfc.md',
    ],
    requiredPressures: [
      'high-fan-out protected rooms', 'unread counts', 'cursor pagination',
      'authorized full-text search', 'attachments', 'notifications',
      'moderation and audit', 'membership changes',
    ],
    adjacentEvidence: 'demos/chat-matrix/tests/acceptance/results-loop.json',
    adjacentEvidenceFinding: 'The retained 5/5 receipt is an AI-conversation four-backend loop, not the protected team-chat product profile.',
  },
  documents: {
    claimId: 'STEP6.DOCUMENTS',
    admittedProfile: 'collaborative-documents-trusted-single-tenant.v1',
    authorities: [
      'llp/0014-cloudflare-strategy.rfc.md',
      'llp/0044-asset-storage-pipeline.rfc.md',
      'llp/0068-collaborative-document-convergence.rfc.md',
      'llp/0070-durable-background-work.rfc.md',
      'llp/0071-application-abuse-moderation-and-audit.rfc.md',
      'llp/0072-trusted-single-tenant-control-plane.rfc.md',
      'llp/0073-portable-full-text-search.rfc.md',
    ],
    requiredPressures: [
      'structured editing', 'offline operation', 'deterministic conflict convergence',
      'history and comments', 'granular sharing', 'large documents',
    ],
  },
  commerce: {
    claimId: 'STEP6.COMMERCE',
    admittedProfile: 'commerce-payments-v1+trusted-single-tenant-app-complete.v1',
    authorities: [
      'llp/0014-cloudflare-strategy.rfc.md',
      'llp/0069-payment-provider-boundary.rfc.md',
      'llp/0070-durable-background-work.rfc.md',
      'llp/0071-application-abuse-moderation-and-audit.rfc.md',
      'llp/0072-trusted-single-tenant-control-plane.rfc.md',
    ],
    requiredPressures: [
      'anonymous and SEO rendering', 'inventory contention', 'real sandbox payments',
      'signed idempotent webhooks', 'durable jobs', 'caching', 'auditability',
    ],
  },
};
assert.ok(profiles[profile], `--profile must be one of ${Object.keys(profiles).join(', ')}`);
const selected = profiles[profile];
const output = resolve(repoRoot, option(
  'out',
  `demos/partiful-matrix/acceptance/results/step6-${profile}-entry-status.json`,
));
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const identity = (path) => ({ path, sha256: sha256(readFileSync(resolve(repoRoot, path))) });
const authority = (path) => {
  const bytes = readFileSync(resolve(repoRoot, path));
  const text = bytes.toString('utf8');
  const status = /^\*\*Status:\*\*\s+(.+)$/m.exec(text)?.[1]?.trim() ?? null;
  assert.ok(status, `${path} has no status`);
  return {
    path,
    sha256: sha256(bytes),
    status,
    acceptedForGate: ['Accepted', 'Implemented'].includes(status),
  };
};

const authorities = selected.authorities.map(authority);
const authorityGatePass = authorities.every(({ acceptedForGate }) => acceptedForGate);
const adjacentEvidence = selected.adjacentEvidence && existsSync(resolve(repoRoot, selected.adjacentEvidence))
  ? {
      ...identity(selected.adjacentEvidence),
      qualifiesForClaim: false,
      finding: selected.adjacentEvidenceFinding,
    }
  : null;
const productReceipt = null;
const hostedMinimumReceipt = null;
const gatePass = authorityGatePass && productReceipt !== null && hostedMinimumReceipt !== null;
const report = {
  schemaVersion: 'partitime.step6-pressure-profile-entry-status.v1',
  claimId: selected.claimId,
  profile,
  admittedProfile: selected.admittedProfile,
  ok: gatePass,
  disposition: gatePass ? 'pass' : 'entry-blocked',
  claimStatus: gatePass ? 'passing' : 'pending',
  authorityGatePass,
  authorities,
  requiredPressures: selected.requiredPressures.map((pressure) => ({ pressure, witnessed: false })),
  evidence: {
    adjacentEvidence,
    productReceipt,
    hostedMinimumReceipt,
  },
  blockers: [
    ...authorities.filter(({ acceptedForGate }) => !acceptedForGate).map(({ path, status }) => ({
      kind: 'authority-not-ratified', path, status,
    })),
    { kind: 'missing-admitted-product-receipt', profile: selected.admittedProfile },
    { kind: 'missing-hosted-minimum-receipt', profile: 'trusted-single-tenant-app-complete.v1' },
  ],
  rule: 'Draft authorities, adjacent demos, local stubs, and documentation are never promoted to production-vertical evidence.',
};
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report));
if (requirePass && !gatePass) process.exitCode = 1;
