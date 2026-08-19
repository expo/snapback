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
  'acceptance-network-profile',
  'acceptance-protocol-hardening',
  'acceptance-reset-atomic',
  'acceptance-rqs',
  'acceptance-secrets',
  'acceptance-security-hardening',
  'acceptance-storage-layout',
  'acceptance-wire-shapes',
  'acceptance-wire-version',
  'action-denial-witness',
  'config-set',
  'cron-utils',
  'outbound-destination',
  'route-outage-witness-tests',
  'target-admission',
  'deploy-script',
  'deployment-identity',
  'index-scaling',
  'idle-evidence',
  'proof-runtime-preflight',
  'wire-schema-gate',
]);

export const EXPECTED_LOCAL_SUITE_CHECKS = 30;

export const LOCAL_SUITES = Object.freeze([
  { id: 'compatibility', file: 'scripts/cf-check-compat', runtime: 'direct' },
  {
    id: 'acceptance-core',
    file: 'cloudflare/test/acceptance.mjs',
    evidence: ['"expectedChecks":53', '"ok":true'],
  },
  {
    id: 'acceptance-action-timeout',
    file: 'cloudflare/test/acceptance.action-timeout.mjs',
    evidence: ['cloudflare action-reset acceptance: reset abandons active action'],
  },
  {
    id: 'acceptance-all-aboard',
    file: 'cloudflare/test/acceptance.all-aboard.mjs',
    evidence: ['all-aboard cloudflare acceptance: 20/20 checks passed'],
  },
  {
    id: 'acceptance-built-client',
    file: 'cloudflare/test/acceptance.built-client.all-aboard.mjs',
    evidence: ['all-aboard built-client acceptance: 16/16 checks passed'],
  },
  {
    id: 'acceptance-cron',
    file: 'cloudflare/test/acceptance.cron.mjs',
    evidence: ['cloudflare cron acceptance: 13/13 checks passed'],
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
    evidence: ['cloudflare egress acceptance: 31/31 checks passed'],
  },
  {
    id: 'acceptance-live-and-diagnostics-hardening',
    file: 'cloudflare/test/acceptance.live-and-diagnostics-hardening.mjs',
    evidence: [
      'cloudflare live/diagnostics hardening acceptance: bounded frames, recoverable fan-out, and private cron diagnostics passed',
    ],
  },
  {
    id: 'acceptance-network-profile',
    file: 'cloudflare/test/acceptance.network-profile.mjs',
    evidence: [
      'cloudflare network-profile acceptance: classification, ceilings, action refusals, runtime lifecycle, two-phase deadlines, admission, and the test/primary/derived/missing/contradictory matrix passed',
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
    evidence: ['cloudflare rqs acceptance: 43/43 checks passed'],
  },
  {
    id: 'acceptance-secrets',
    file: 'cloudflare/test/acceptance.secrets.mjs',
    evidence: ['cloudflare secrets acceptance: 16/16 checks passed'],
  },
  {
    id: 'acceptance-security-hardening',
    file: 'cloudflare/test/acceptance.security-hardening.mjs',
    evidence: ['cloudflare proof-surface hardening: 25/25 checks passed'],
  },
  {
    id: 'acceptance-storage-layout',
    file: 'cloudflare/test/acceptance.storage-layout.mjs',
    evidence: ['cloudflare storage-layout acceptance: index reconciliation'],
  },
  {
    id: 'acceptance-wire-shapes',
    file: 'cloudflare/test/acceptance.wire-shapes.mjs',
    evidence: ['cloudflare wire-shape acceptance: 33/33 checks passed'],
  },
  {
    id: 'acceptance-wire-version',
    file: 'cloudflare/test/acceptance.wire-version.mjs',
    evidence: ['cloudflare wire-version acceptance: 24/24 checks passed'],
  },
  {
    // 0137 a4-f5 hosted mirror (issues/20260801-hosted-action-denial-
    // witness-parity.md): the four action_denial_witness_v0.rs cases over
    // the JS record/restore seams.
    id: 'action-denial-witness',
    file: 'cloudflare/test/action-denial-witness.mjs',
    evidence: [
      'cloudflare action-denial-witness tests: typed surface-through, forged stays untyped, caught-then-fail keeps own failure, caught-then-recover succeeds',
    ],
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
    // LLP 0251 destination-floor parity: the JS port classifies the same
    // literal forms and refuses the same authority/hop-by-hop header names
    // as the Rust outbound_policy floor.
    id: 'outbound-destination',
    file: 'cloudflare/test/outbound-destination.mjs',
    evidence: [
      'cloudflare outbound-destination tests: https-only, compact IPv4, IPv6 transition ranges, and header refusal parity passed',
    ],
  },
  {
    // Author decision 2026-08-01 (all-aboard routeEstimate outage
    // fragility, finding 2): the remote directions check may record-and-skip
    // only on a worker-egress-proven ORS outage; this suite pins the
    // classifier's proven-skip / our-bug-fail / ambiguous-fail behavior.
    id: 'route-outage-witness-tests',
    file: 'cloudflare/test/route-outage-witness-tests.mjs',
    evidence: ['cloudflare route-outage-witness tests: proven-outage skip, our-bug fail, ambiguous fail'],
  },
  {
    id: 'target-admission',
    file: 'cloudflare/test/target-admission.mjs',
    evidence: ['cloudflare target-admission tests: 3/3 strict-refusal/default/local-admission scenarios passed'],
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
    // grammar parity, and all four served kit-socket reply variants.
    id: 'wire-schema-gate',
    file: 'cloudflare/test/wire-schema-gate.mjs',
    evidence: ['cloudflare wire-schema gate: 20/20 checks passed'],
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
  ['acceptance.network-profile.mjs', 'gate'],
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
  ['action-denial-witness.mjs', 'gate'],
  ['billing-windows.mjs', 'remote-credentialed'],
  ['config-set.mjs', 'gate'],
  ['cron-utils.mjs', 'gate'],
  ['deploy-script.mjs', 'gate'],
  ['deployment-identity.mjs', 'gate'],
  ['harness.mjs', 'helper'],
  ['index-scaling.mjs', 'gate'],
  ['measure.mjs', 'benchmark-non-gating'],
  ['measure.remote.mjs', 'remote-credentialed'],
  ['outbound-destination.mjs', 'gate'],
  ['proof-runtime.mjs', 'helper'],
  ['route-outage-witness.mjs', 'helper'],
  ['route-outage-witness-tests.mjs', 'gate'],
  ['target-admission.mjs', 'gate'],
  ['proof-runtime-preflight.mjs', 'gate'],
  ['twin-engine.mjs', 'protocol-child-of-cargo-twin'],
  ['validate-idle-measurement.mjs', 'gate'],
  ['wire-schema-gate.mjs', 'gate'],
]);
