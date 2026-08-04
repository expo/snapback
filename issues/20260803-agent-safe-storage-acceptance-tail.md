# Agent-safe storage acceptance tail

**Status:** Open
**Opened:** 2026-08-03 (Track B integrated implementation pass)
**Systems:** Storage, Sync, Auth, Effects, Migrations, Testing, Performance,
Agent experience
**Related:** LLP 0158, LLP 0162, LLP 0163, LLP 0164, LLP 0165;
`issues/20260803-0163-public-operation-identity-carrier.md`;
`issues/20260803-guide-gap-instance-forks.md`

Track B now has the step-0 baseline and OQ13 gate artifacts, the first
integrated implementation slices for LLP 0163-0165, F0b fleet dogfood, a clean
comparable candidate run, and a dated fork/promotion absolute run. This ticket
is the honest remainder against LLP 0162's single acceptance corpus. It does
not reopen implemented work and does not authorize capability publication.

## Remaining acceptance work

| LLP 0162 row | State on 2026-08-03 | Required closure |
| --- | --- | --- |
| 1 — atomic envelope | Partial | Carry authenticated issuance on the public ordinary-mutation path, activate a complete target manifest, and run its full crash-cut matrix. |
| 2 — retry settlement | Partial | Ship range issue/refresh plus atomic client range custody and finish restored-client, recreated-branch, delayed-delivery, host-retry, and exhaustion transport legs. |
| 3 — provenance/explanation | Partial | Expose authorized public/admin explanation, wire real policy evaluators and protected secret custody, and complete aggregate/non-row authorization-change corpus. |
| 4 — coverage honesty | Partial | Inventory every target writer and enforce the generated writer-token facade plus SQLite authorizer; finish specialized-lane and asymmetric-retention coverage fixtures. |
| 5 — fork isolation | Partial | F0b proves the first derived-deployment consumer; add the derived post-fork-parent-write invisibility fixture, then close the in-app product/runtime surface and full per-class isolation/credential matrix. |
| 6 — effect quarantine | Partial | Mediate every product host-egress family with bypass negatives; implement and prove `CaptureOnly` separately. |
| 7 — identity/authority | Partial | Wire production auth and complete revoked/stale authority plus later-effect-settlement fixtures for both fork classes. |
| 8 — resource containment | Partial | Add a digest-work limit plus replay-floor/envelope-window independent-clock corpus across reap/expiry and all declared resource limits. |
| 9 — exact fork diff | Partial | Compare journal-derived net diff against the independent oracle; add a separate attributed-sequence oracle, schema/system-field, multiple-commit, and full journal-completeness coverage. |
| 10 — strict promotion | Partial | Complete concurrent-writer fairness/crash cuts, exhausted-budget and identical-write/divergent-read-or-result re-seal negatives, conditional-progress terms, provisional/transitive effect chains, and production contention constants. |
| 11 — history/checkpoint | Partial | Project finite history policy from schema declarations; complete per-version auth/pagination/horizon corpus and protected-copy erasure obligations. |
| 12 — boundary proof | Partial | Promotion and checkpoint proof paths are integrated; add migration boundary integration and the remaining concurrent-writer/publication/receipt-only negative corpus. |
| 13 — performance | Partial | Rerun absolute fork/diff/promotion/reap latency against the final integrated hardening; run a genuinely paired/interleaved, baseline-digest-bound comparison with the public covered lane active; obtain dated RFC-author absolute-bound ratification; record p99 contention and every applicable crash/reopen gate. |
| 14 — identity lifecycle | Partial | Wire first-party host job/cron/migration callers and transport-level client exclusion, then finish capacity/purge/current-authority negative fixtures beyond the landed promotion-ticket lease. |

The detailed LLP 0163 public-carrier work remains in its existing focused
ticket. F1's operating guide and fork-aware acceptance-harness work remains in
the guide-gap ticket rather than being conflated with this implementation tail.

## Review and publication gates

- LLP 0163, LLP 0164, and LLP 0165 remain `Draft`. Their existing extraction
  reviews predate the final integrated implementation and are not fabricated
  into final implementation reviews.
- Independent review and the documents' named acceptance authority must be
  obtained before changing their status.
- A capability may move above `Missing` only for a named target/component whose
  applicable rows, including row 13, pass. Partial aggregate progress is not a
  substitute for per-component evidence.
- The closing pass must run `llp-maintain` reconciliation, `ref-check`, guide
  validation, generated-artifact/schema drift checks, and proportional
  own-correctness after the last `origin/main` reconciliation.

## Close when

Every applicable row above is either green with a dated artifact or explicitly
re-scoped by the LLP 0162 author in a dated revision; the extracted Specs have
completed their real review/acceptance loop; the target capability manifest is
updated only to the proved component states; and the Track B closing audit is
green.
