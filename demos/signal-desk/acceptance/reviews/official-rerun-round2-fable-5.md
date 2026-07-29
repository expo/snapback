# Backend bakeoff official rerun, round 2 — Fable 5

**Reviewer:** Claude Fable 5
**Model selector:** `claude-fable-5`
**Effort:** max
**Date:** 2026-07-28
**Reviewed revision:** `1a3b06acdd32ddfafddd1b14d16f2209f3790243`
**Reviewed receipt:** `backend-bakeoff-run.f2f6c876b2d6925e9e5f8eabff4f4c687a0266659b1f634e2b707f5b1c8998f8.v2.json`
**Method:** fresh read-only review in an isolated detached checkout; no web search
**CLI session:** `38dffd0d-d466-49d7-bfda-ceac2703e37f`
**Disposition:** terminal response retained verbatim

## Verbatim retained reviewer response

All provenance checks are done — I have full coverage of the diff range, the receipt and its bound artifacts, and the round-one blocking list. One verification caveat to disclose: this sandbox denied every hashing tool (`shasum`, `openssl`, `python3`, `node -e`), so cryptographic recomputation wasn't possible here; I verified the chain structurally and transitively instead, and I'll say exactly where that boundary is.

---

# Final independent review — backend-bakeoff green rerun at `1a3b06ac`

**Reviewer:** Claude Fable 5 (`claude-fable-5`) · read-only detached worktree at `1a3b06acdd32ddfafddd1b14d16f2209f3790243`, clean tree · 2026-07-28
**Scope:** the exact range `c10315b5..1a3b06ac` (three commits: `0a9b9125` browser-bounds qualification, `e8570c2f` competitor-check fixes + docs, `1a3b06ac` acceptance-only retention), the green receipt `demos/backend-bakeoff/acceptance/results/backend-bakeoff-run.f2f6c876b2d6925e9e5f8eabff4f4c687a0266659b1f634e2b707f5b1c8998f8.v2.json` and everything it binds, plus the round-one review, ticket, diary, and COMPARISON.md.

## Evidence verification and its honest limits

This session's sandbox denied every local hashing tool (`shasum`, `openssl`, `python3`, `node -e`; only git subcommands and file reads were permitted), so I could not cryptographically recompute digests the way round one did. What I verified instead:

- **Internal binding:** the receipt filename hex equals its `contentSha256`; every one of the 16 command-log entries and 3 evidence entries records a `sha256` identical to the hex embedded in its content-addressed filename; every referenced file exists in the tree at exactly those paths.
- **Manual byte checks where computable:** `typecheck` stdout records `storedBytes: 0` with the well-known SHA-256 of the empty string (`e3b0c442…b855`) — correct; the Convex/Supabase stderr logs are byte-for-byte `$ node tests/convex.mjs\n` (24 bytes) and `$ node tests/supabase.mjs\n` (26 bytes), matching their recorded sizes.
- **Transitive verification for reused artifacts:** all 10 logs the green receipt shares with the failed receipt `…87f23122….v2.json` (contract stdout/stderr, comparator stderr, extras stdout/stderr, react stderr, convex stderr, typecheck both, build stderr) were bound by that failed receipt, whose 18 artifacts round one recomputed with `shasum`; those bytes are untouched in this range. The content-addressed writer (`writeLog`, `scripts/bakeoff-runner-lib.mjs:305-323`) is unchanged except the one nonclaim line, confirmed by the diff and by `commandSetSha256`/`schemaSha256` being identical across both receipts while `runner.sha256` changed.
- **Time-chain consistency:** every command's `durationMs` equals `finishedAt − startedAt` (spot-checked all eight); commands are strictly sequential; run total 10,402 ms matches; both React child receipts' `generatedAt` (00:58:29.635Z, 00:58:31.058Z) fall inside the react command window, and the comparator receipt's epoch timestamps fall inside its window.
- **Provenance:** the receipt, all six new logs, and all three evidence projections were added in `1a3b06ac` and nothing else; `git status` is clean, so working tree = commit.

Not recomputed here: the six new log digests, three new evidence-projection digests, and the canonical-JSON `contentSha256` itself. `bun run bakeoff:verify -- acceptance/results/backend-bakeoff-run.f2f6c876….v2.json` performs that recomputation in one command in an unrestricted shell; the verifier code (`verifyReceipt`, `bakeoff-runner-lib.mjs:1004-1059`) is intact and unchanged in this range.

## Round-one release-blocking items — closure

**1. Non-vacuous nonce-bound Convex delivery and cleanup — CLOSED.**
`demos/backend-bakeoff/tests/convex.mjs` now creates a fresh incident titled `Bakeoff acceptance <uuid>`, subscribes to `api.incidents.comments` scoped to that incident (initial snapshot necessarily empty — a stale witness cannot satisfy it, even from a leaked prior incident, because the witness embeds the run's UUID), gates on a subscription-ready barrier, and only then mutates. The green log (`acceptance/logs/ce7c276b….log`) records the full timestamp chain: subscribed 00:58:32.087Z, mutation started .087, delivered .091 — genuine post-mutation push delivery, 4 ms on a local loopback deployment (the 153 ms command total is coherent only with loopback, corroborating the local environment class). Cleanup is a guarded server mutation (`convex/incidents.ts:235-263`, commander + `Bakeoff acceptance ` title prefix, deletes tasks/comments/activity/incident) run in `finally`; since a `finally` throw fails the process, the green exit code structurally implies cleanup succeeded.

**2. Supabase phase budgets and exactly one honest fresh-transport retry — CLOSED.**
`demos/backend-bakeoff/tests/supabase.mjs` replaces the shared 8s deadline with per-phase `withTimeout` (15s subscription, 15s delivery), and the delivery budget now starts only after the insert RPC resolves — the round-one timer bug is gone. `LIVE_ATTEMPT_LIMIT = 2` allows exactly one retry, and each attempt constructs a fresh `createClient` (new socket), fresh channel, and per-attempt witness `Supabase live witness <nonce>-<attempt>`; every attempt's timing JSON is written to stdout whether it passes or fails (the old code printed nothing on failure). The green run needed no retry: attempt 1 passed with subscribe 417 ms, insert 296 ms, delivery 455 ms after insert (`acceptance/logs/bec4c59e….log`) — honest remote-hosted latencies. Failure exhaustion raises an `AggregateError`; the runner itself retries nothing. Cleanup is complete: `bakeoff_comments`/`bakeoff_tasks`/`bakeoff_activity` all carry `on delete cascade` (`supabase/migrations/202607270001_signal_desk.sql:24,36,46`), so the admin incident delete removes the witness rows.

**3. One green retained matrix at one clean revision — CLOSED.**
The receipt reports `summary.status: "passed"`, 8/8 commands, `evidenceValid: true`; `source.revision = e8570c2f` with `cleanAtStart: true` and `unchangedAfterCommands: true`; the comparator runtime records `gitCommit: e8570c2f, gitDirty: false` (structurally enforced at `bakeoff-runner-lib.mjs:685-693`, closing the stale-binary class — the binary hash changed from the old receipt's, i.e., it was genuinely rebuilt); both React child receipts bind `sourceRevision: e8570c2f`. Retention at `1a3b06ac` (the immediate child, one minute after the run) touches only acceptance files. Exactly one green v2 receipt exists; the failed `…87f23122….v2.json` is retained unaltered as honest history.

**4. Explicit browser/public-package nonclaim — CLOSED.**
The receipt's `nonclaims` now include "This local matrix does not include the staged clean-install browser evidence required for public-package qualification" (`bakeoff-runner-lib.mjs:973`), alongside the pre-existing hosted/package and provisioning rows. Complementarily, `0a9b9125` *narrows* the packaged-lane browser proof claim (`bounded-before-allocation` → `bounded-before-allocation-after-host-return`, with the nine host collection APIs pinned in `scripts/snapback-publish-core.mjs` and enforced by `validateColdInstallBrowserEvidence`, documented in `llp/0041-packaged-dev-loop.rfc.md`). Direction is anti-overclaim throughout.

**5. Honest diary/ticket state — CLOSED, with one staleness to fix at closure time.**
`diaries/0022-backend-bakeoff.diary.md` (2026-07-28 entry) accurately narrates the red first matrix, the review's inverse-fairness finding, and both fixes without minimizing; `issues/20260727-bakeoff-first-rerun-corrections.md` gained the non-vacuity correction row and an accurate checkpoint, and correctly remains open pending this review. One sentence is now one commit stale: "The second green matrix and independent review remain outstanding" — the matrix exists at HEAD; only the review (this document) was outstanding. Fold the correction into ticket closure.

## New defects found

No new cleanup, timing, retry, vacuous-pass, evidence-binding, or overclaim defect rises to blocking. Verified specifically: the nonce predicates cannot be satisfied by stale or concurrent-run data on either competitor arm; postgres_changes cannot replay attempt‑1's insert into attempt 2's subscription; the Snapback arm's static witness is safe because its server is freshly spawned per run; receipt summary/status semantics, the postflight mutation allowlist, and the sanitizer are unchanged and coherent. Minor findings are listed below as follow-ups.

## Publication blockers (must land in/with the publication commit)

1. **`demos/backend-bakeoff/COMPARISON.md` has no rerun narration.** Last touched at `b1006fa2`; its "Evidence from this run" section still describes the pre-rerun baseline (182 modules / old Convex-check wording), and its own text promises "The full three-backend rerun later in this program owns the final revised ranking." Publishing the comparison as-is would present superseded evidence as current. Land the green-run narration/revised-ranking section (citing receipt `f2f6c876…` at `e8570c2f`) — and a short diary 0022 entry recording the green outcome — in the publication commit. This is the one round-one before-publication item not yet landed; note the round-one review demanded it "with" the green matrix and the retention commit deliberately stayed acceptance-only.
2. **Close `issues/20260727-bakeoff-first-rerun-corrections.md`:** record this final review, correct the stale "remain outstanding" sentence, and move to `issues/closed/` per repo convention. Its acceptance criteria are now met (corrections landed, matrix rerun and retained, independent final review = this document finding no material correctness, safety, evidence, or overclaim defect in the retained run).

## Follow-ups (non-blocking)

- **Recompute the nine uncomputed digests once outside this sandbox** (`bun run bakeoff:verify …f2f6c876….v2.json`) — expected to pass; this review's structural/transitive chain leaves only that mechanical step.
- **Supabase server-side filter removal is undocumented:** `tests/supabase.mjs` dropped the `filter: incident_id=eq.…` channel option in favor of client-side predicate matching. Non-vacuity is unaffected (exact incident + nonce witness match), and robustness improves in the competitor's favor, but the check no longer exercises server-side filtered delivery — worth one sentence in the COMPARISON narration.
- **Convex error-callback race window** (`tests/convex.mjs:64-69`): an `onUpdate` error arriving between readiness resolution and `resolveUpdate` assignment is dropped (`rejectUpdate?.()` no-ops), degrading a prompt diagnostic into a 15s timeout. Failure-path-only; cannot produce a false green.
- **Hard-kill residue:** a SIGKILLed run (e.g., runner timeout) leaks a `Bakeoff acceptance` incident on the reused Convex deployment / hosted Supabase project. Nonce scoping means leaks can never turn a later check green; a periodic prune would keep the shared state tidy.
- **Round-one high-value items still open, unchanged:** per-arm environment class recorded in the receipt (the logs corroborate local-Convex vs hosted-Supabase, but the receipt doesn't say it); retry policy codified in the runner schema; extras/react spawned-binary identity still "unpinned" (visible at the top of both logs); `unchangedAfterCommands` naming; HEAD-reachable revision binding for other retained receipts (cold-install).
- **Patience asymmetry is deliberate but code-only:** both competitor arms use `LIVE_PHASE_TIMEOUT_MS = 15_000` per phase, with the retry granted only to the remote arm; the diary/ticket state the rationale, but no receipt field records per-arm patience.

## Verdict

All five enumerated release-blocking classes from the round-one Fable review are closed in the retained green run, the evidence chain is internally and transitively sound at one clean revision, and the range introduces no new blocking defect. What remains is the publication act itself: the COMPARISON/diary green-run narration and ticket closure listed above must ride the publication commit — the ranking must not ship with the stale baseline evidence section.

**READY**

## Post-review disposition

The integrated security reviewer subsequently found that this receipt used one
Convex client for both the mutation and subscription despite the comparison's
cross-client claim, and that a failing cleanup mutation could skip client
closure. The receipt therefore remains valid evidence for its exact code but
is not the final publication receipt. The next correction uses distinct actor
and observer clients, bounded cleanup, and unconditional closure of both.
