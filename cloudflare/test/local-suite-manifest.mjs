// Canonical local Cloudflare inventory. Every .mjs file in this directory is
// classified explicitly so a new, renamed, or deleted suite cannot silently
// disappear from CI. `gate` entries run in local-suite.mjs; the remaining
// classes document why they are intentionally outside the non-remote gate.

export const EXPECTED_LOCAL_SUITE_IDS = Object.freeze([
  'compatibility',
  'acceptance-core',
  'acceptance-action-timeout',
  'acceptance-all-aboard',
  'acceptance-built-client',
  'acceptance-cron',
  'acceptance-cron-recovery',
  'acceptance-egress',
  'acceptance-live-and-diagnostics-hardening',
  'acceptance-protocol-hardening',
  'acceptance-reset-atomic',
  'acceptance-rqs',
  'acceptance-secrets',
  'acceptance-security-hardening',
  'acceptance-storage-layout',
  'acceptance-wire-shapes',
  'acceptance-wire-version',
  'config-set',
  'cron-utils',
  'deploy-script',
  'deployment-identity',
  'index-scaling',
  'idle-evidence',
  'proof-runtime-preflight',
  'wire-schema-gate',
]);

export const EXPECTED_LOCAL_SUITE_CHECKS = 25;

export const LOCAL_SUITES = Object.freeze([
  { id: 'compatibility', file: 'scripts/cf-check-compat', runtime: 'direct' },
  {
    id: 'acceptance-core',
    file: 'cloudflare/test/acceptance.mjs',
    evidence: ['"expectedChecks":52', '"ok":true'],
  },
  {
    id: 'acceptance-action-timeout',
    file: 'cloudflare/test/acceptance.action-timeout.mjs',
    evidence: ['cloudflare action-reset acceptance: reset abandons active action'],
  },
  {
    id: 'acceptance-all-aboard',
    file: 'cloudflare/test/acceptance.all-aboard.mjs',
    evidence: ['all-aboard cloudflare acceptance: 19/19 checks passed'],
  },
  {
    id: 'acceptance-built-client',
    file: 'cloudflare/test/acceptance.built-client.all-aboard.mjs',
    evidence: ['all-aboard built-client acceptance: 16/16 checks passed'],
  },
  {
    id: 'acceptance-cron',
    file: 'cloudflare/test/acceptance.cron.mjs',
    evidence: ['cloudflare cron acceptance: 12/12 checks passed'],
  },
  {
    id: 'acceptance-cron-recovery',
    file: 'cloudflare/test/acceptance.cron-recovery.mjs',
    evidence: [
      'cloudflare cron-recovery acceptance: faults recover without double commit',
      'cloudflare cron atomic-finish acceptance: one app commit and one run record survive post-terminal fault',
      'cloudflare cron-reset acceptance: held scheduled and manual runs cannot recreate state after reset',
    ],
  },
  {
    id: 'acceptance-egress',
    file: 'cloudflare/test/acceptance.egress.mjs',
    evidence: ['cloudflare egress acceptance: 29/29 checks passed'],
  },
  {
    id: 'acceptance-live-and-diagnostics-hardening',
    file: 'cloudflare/test/acceptance.live-and-diagnostics-hardening.mjs',
    evidence: [
      'cloudflare live/diagnostics hardening acceptance: bounded frames, recoverable fan-out, and private cron diagnostics passed',
    ],
  },
  {
    id: 'acceptance-protocol-hardening',
    file: 'cloudflare/test/acceptance.protocol-hardening.mjs',
    evidence: ['cloudflare function-kind acceptance: 40 proof/kit/live/cron/nested cross-product cases passed'],
  },
  {
    id: 'acceptance-reset-atomic',
    file: 'cloudflare/test/acceptance.reset-atomic.mjs',
    evidence: ['cloudflare reset-atomic acceptance: SQL faults roll back'],
  },
  {
    id: 'acceptance-rqs',
    file: 'cloudflare/test/acceptance.rqs.mjs',
    evidence: ['cloudflare rqs acceptance: 39/39 checks passed'],
  },
  {
    id: 'acceptance-secrets',
    file: 'cloudflare/test/acceptance.secrets.mjs',
    evidence: ['cloudflare secrets acceptance: 16/16 checks passed'],
  },
  {
    id: 'acceptance-security-hardening',
    file: 'cloudflare/test/acceptance.security-hardening.mjs',
    evidence: ['cloudflare security-hardening acceptance: seed, actions, grants, redaction'],
  },
  {
    id: 'acceptance-storage-layout',
    file: 'cloudflare/test/acceptance.storage-layout.mjs',
    evidence: ['cloudflare storage-layout acceptance: index reconciliation'],
  },
  {
    id: 'acceptance-wire-shapes',
    file: 'cloudflare/test/acceptance.wire-shapes.mjs',
    evidence: ['cloudflare wire-shape acceptance: 32/32 checks passed'],
  },
  {
    id: 'acceptance-wire-version',
    file: 'cloudflare/test/acceptance.wire-version.mjs',
    evidence: ['cloudflare wire-version acceptance: 23/23 checks passed'],
  },
  {
    id: 'config-set',
    file: 'cloudflare/test/config-set.mjs',
    evidence: ['cloudflare config-set tests: locked Wrangler, bounded stdin apply, and deadline-bound attestation passed'],
  },
  {
    id: 'cron-utils',
    file: 'cloudflare/test/cron-utils.mjs',
    evidence: ['cloudflare cron-utils tests: strict-next arithmetic'],
  },
  {
    id: 'deploy-script',
    file: 'cloudflare/test/deploy-script.mjs',
    evidence: ['cloudflare deploy-script acceptance: mixed bootstrap, rollback, and admin-secret states passed'],
  },
  {
    id: 'deployment-identity',
    file: 'cloudflare/test/deployment-identity.mjs',
    evidence: ['cloudflare deployment-identity tests: handler, schema, compat, and Wrangler drift passed'],
  },
  {
    id: 'index-scaling',
    file: 'cloudflare/test/index-scaling.mjs',
    evidence: ['"benchmark": "cloudflare-index-scaling-v1"'],
  },
  {
    id: 'idle-evidence',
    file: 'cloudflare/test/validate-idle-measurement.mjs',
    evidence: ['validate-idle-measurement: ok —'],
  },
  {
    id: 'proof-runtime-preflight',
    file: 'cloudflare/test/proof-runtime-preflight.mjs',
    evidence: ['cloudflare proof-runtime preflight: node-major gate and diagnostic verified'],
  },
  {
    // LLP 0094 §0F items 1–3: hosted served bytes vs the committed schemas —
    // kit-route responses, captured marker envelopes, kit-socket request
    // grammar parity. Known-divergent emitters ride the suite's
    // KNOWN_DIVERGENT allowlist (§0C.6 convergence ticket shrinks it).
    id: 'wire-schema-gate',
    file: 'cloudflare/test/wire-schema-gate.mjs',
    evidence: ['cloudflare wire-schema gate: 15/15 checks passed'],
  },
]);

export const TEST_FILE_CLASSIFICATIONS = Object.freeze([
  ['acceptance.action-timeout.mjs', 'gate'],
  ['acceptance.all-aboard.mjs', 'gate'],
  ['acceptance.built-client.all-aboard.mjs', 'gate'],
  ['acceptance.cron-recovery.mjs', 'gate'],
  ['acceptance.cron.mjs', 'gate'],
  ['acceptance.egress.mjs', 'gate'],
  ['acceptance.live-and-diagnostics-hardening.mjs', 'gate'],
  ['acceptance.mjs', 'gate'],
  ['acceptance.protocol-hardening.mjs', 'gate'],
  ['acceptance.remote.all-aboard.mjs', 'remote-credentialed'],
  ['acceptance.remote.mjs', 'remote-credentialed'],
  ['acceptance.reset-atomic.mjs', 'gate'],
  ['acceptance.rqs.mjs', 'gate'],
  ['acceptance.secrets.mjs', 'gate'],
  ['acceptance.security-hardening.mjs', 'gate'],
  ['acceptance.storage-layout.mjs', 'gate'],
  ['acceptance.wire-shapes.mjs', 'gate'],
  ['acceptance.wire-version.mjs', 'gate'],
  ['billing-windows.mjs', 'remote-credentialed'],
  ['config-set.mjs', 'gate'],
  ['cron-utils.mjs', 'gate'],
  ['deploy-script.mjs', 'gate'],
  ['deployment-identity.mjs', 'gate'],
  ['harness.mjs', 'helper'],
  ['index-scaling.mjs', 'gate'],
  ['measure.mjs', 'benchmark-non-gating'],
  ['measure.remote.mjs', 'remote-credentialed'],
  ['proof-runtime.mjs', 'helper'],
  ['proof-runtime-preflight.mjs', 'gate'],
  ['twin-engine.mjs', 'protocol-child-of-cargo-twin'],
  ['validate-idle-measurement.mjs', 'gate'],
  ['wire-schema-gate.mjs', 'gate'],
]);
