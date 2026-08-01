# A6 sweep guide-gap: jobs admin custody (secret-read lease) and enqueue vocabulary undocumented

**Opened:** 2026-08-01
**Systems:** Guide, Jobs (jobs_one_off_v1), Admin custody
**Related:** LLP 0137 (A6 arm), issues/20260730-move3-jobs-slice-0070.md
(owns the missing jobs guide page),
demos/improvement-sweep/arms/a6-snapback-web/findings/0137-a6-f2-guide-gap-secret-read-lease-custody.json

`GET /_snapback/api/jobs/{id}` refuses with
`SNAPBACK_ADMIN_SECRET_READ_REQUIRED`. Nothing in the guide or the
capability-index row (which documents the drain route) mentions:

- the secret-read lease, its mint route
  (`/_snapback/api/admin-secret-read/mint`), or the
  `x-snapback-secret-read-lease` header;
- the first-class CLI that owns the proof:
  `snapback secret-read-mint --ready-file <ready> --token <admin> --admin-inspect`
  (ready-file-only because the proof root is local operator authority);
- the enqueue options vocabulary (`delayMs`, `idempotencyKey`,
  `maxAttempts`) or the drain input (`{nowMs}`).

The A6 arm walked the discovery ladder 401
`SNAPBACK_ADMIN_SECRET_READ_REQUIRED` → mint 403 `..._PROOF_INVALID` →
CLI 401 `SNAPBACK_ADMIN_TOKEN_REQUIRED` → success, with binary-string
reads in between (SecretReadMintEnvelope/SecretReadMintProof structs,
domain `snapback/admin-secret-read/mint-proof/v1`).

Adjacent trap, same page: the capability row and define.d.ts say
defineJobStatusQuery "requires the experimental jobs_one_off_v1 target
capability, acknowledged by codegen" — but naming it in
`defineSchema(..., { requiredCapabilities: ['jobs_one_off_v1'] })`
refuses as *unknown required target capability*. The acknowledgment is
emitted BY codegen; the sentence should say so.

The custody design itself is good (operator-minted, ready-file-bound,
scoped/budgeted leases; the admin token deliberately cannot read
secrets alone) — this ticket is exclusively about writing it down where
the already-owed jobs guide page will live.

---

**Status:** Resolved (2026-08-01, 0137 between-arms fix lane)

**Resolution.** The jobs guide page now exists: `guide/backend/jobs.md`
(id `backend.jobs`, capability `backend.jobs-one-off`, maturity partial,
local target), with CI-transcluded authoring snippets from
`packages/snapback-codegen/jobs-authoring.test.mjs`. It covers everything
this ticket names:

- the full enqueue options vocabulary (`delayMs` + 30-day horizon,
  `idempotencyKey` semantics with all three refusal codes, `maxAttempts`
  1..8) plus the paved default-queue limits and the
  enqueue-admission/callee-class refusals;
- the drain seam (`POST /_snapback/api/jobs/drain` `{nowMs, maxWaves}`,
  `AdminClient.drainJobs`, `SNAPBACK_JOBS_DISABLED`);
- the admin custody lane: the secret-read lease, the mint route
  (`/_snapback/api/admin-secret-read/mint`), the
  `x-snapback-secret-read-lease` header, the first-class
  `snapback secret-read-mint --ready-file ... --admin-inspect` CLI with
  every scope/budget flag, why minting is ready-file-only, and the exact
  discovery-ladder codes this arm walked
  (`SNAPBACK_ADMIN_SECRET_READ_REQUIRED` →
  `SNAPBACK_ADMIN_SECRET_READ_PROOF_INVALID` →
  `SNAPBACK_ADMIN_TOKEN_REQUIRED`), with the sessions-mode-only scoping
  stated precisely (dev mode takes the admin credential alone).

The adjacent trap is fixed at its source: define.d.ts and define.mjs now
say codegen itself emits both the `jobs_one_off_v1` requirement and the
acknowledgment, and explicitly warn that
`defineSchema(..., { requiredCapabilities: ['jobs_one_off_v1'] })` refuses
(verified against the define-time allowlist). The capability-index row's
GAP cell now points at the page; the index nav lists it;
`node scripts/check-guide.mjs` is green (46 pages, 124 snippets).
