# Panel: LLP 1016 — The administrative plane (Muse Spark (Meta), served id `muse-spark`)

**Reviewed:** `llp/1016-administrative-plane.rfc.md` as landed at `6d3d09c6f`, in a read-only capsule exported from that commit (`~/projects/snapback-1016-panel/capsule-muse`), with the engine, owner, compiler, evaluator, templates, the design RFCs it extends, the control-plane RFC beside it, the briefs, and the rules.
**Family:** Muse Spark (Meta), served id `muse-spark`; self-reported as "Muse Code powered by Meta Muse Spark"
**Provider/runtime:** Muse Code 1.0.3 (`muse exec --prompt-file <prompt> --workspace <capsule> --reasoning-effort ultra --approval-mode never --disable-write`)
**Date:** 2026-09-05
**Redacted:** No — the panelist read the in-repo documents and sources directly in its own capsule; no content left the local machine beyond the model serving the CLI.
**Method:** Round 1, mutually blind, on the identical brief preserved at `llp/reviews/1016-administrative-plane.panel.brief.md`. The panelist's sandbox refused the write to the requested output path (its closing line says so); the review below is its final message, verbatim. The orchestrating session authored LLP 1016 and is not a reviewer; it verified the engine claims below against the tree before the synthesis (`1016-administrative-plane.panel.synthesis.md`).

---

## Round 1 review (verbatim)

Reviewer: Muse Code powered by Meta Muse Spark · Date: 2026-09-05 · Method: blind round-1, read-only capsule at 6d3d09c6f

# LLP 1016 review: the administrative plane

## 1. Verdict: NOT READY

The direction is right and I would not trade it: a driver over certified chunks with no path outside the language is the only option that preserves what makes Snapback 2 worth building, and it answers the paragraph honestly at the level of the property (a bound on a *transaction*, not a *task*). An unbounded operator mode would reintroduce exactly the uncertified writes the corpus refuses (`certificate.rs:20-40`, ceilings 10,240/2,048/1M steps; `registry.rs:762`, ad hoc still certifies); a product boundary (host cron + external worker) is Snapback 1's hosted-lifecycle shape again and strands the M7 backfill, M5 expiry, and M8 digest/scale work outside receipts. But three findings below block commissioning in this form: the `_commits` scrub contradicts the append-only ledger, the single-`erased` scrub is not a complete erasure cover (unique collisions, refs, json-embedded ids), and D1's exactly-once cursor claim rests on an engine write the certificate does not account for. Fix those three and this becomes READY WITH EDITS; the rest is material but not directional. What would make me abandon the direction: evidence that per-chunk OCC/invalidation/trace overhead misses the §8 budgets by an order of magnitude on the 100k-row M7/M8 shapes, or that the structural authority proof (D2) cannot be made sound without an SMT-sized project — then I would fall back to a smaller RFC (jobs + row-timers only, erasure as authored jobs).

## 2. Blocking findings

**B1 — The derived erasure job deletes ledger rows, contradicting the append-only ledger and receipt⊆trace⊆certificate.**
RFC claim (D6): "The derived job's last stage deletes the principal's rows from `_commits` and the receipt says so."
Evidence: `_commits` exists as a system table (`snapback2/crates/snapback2-core/src/store.rs:172`); the only `DELETE FROM _commits` in the tree is the reset path (`store.rs:818`); the control plane ledger is append-only by design (`llp/1015-control-plane.rfc.md:186-230`, D4; ledger rows of kind deploy/rollback/operator at `:415`). The engine's whole story is receipts-as-subset-of-trace (`llp/1001` §2 as cited; `E_TRACE_SUBSET` enforced at `certificate.rs:811,868` and tested in `crates/snapback2-core/tests/rbac_cases/adversarial.rs:245`).
Why it blocks: D4/D10/D11 make the operator ledger the attribution root for every job, schedule firing, and ad hoc run. A job that deletes the rows `trace` walks (D5 adds `CommitRecord.job` precisely so `trace` can walk chunks) destroys the auditability erasure most needs, and turns "who ran this" into a row that erasure can remove. I also could not verify the RFC's premise that `_commits` is "bounded to 10,000 rows and trimmed" — I found the table and the reset delete but no trim/prune in `store.rs` or `retention.rs`.
Resolve: never delete from `_commits`. Scrub payload-carrying columns only (or retain with tombstone + erasure-receipt reference to seqs), and flip §9.5's recommendation to the document-residue alternative with the receipt naming seq ranges rather than removing them.

**B2 — Scrub-to-one-`erased` is not a complete cover: unique collisions, refs, and json-embedded ids.**
RFC claim (D6): "`scrub { patch }` writes the patch … and points every principal column naming the erased principal at the reserved `erased` principal"; "refuse-until-declared" plus `E_ERASE_UNREACHABLE` (index prefix reaches the principal column) is the completeness story.
Evidence: only `system` is a reserved principal today (`snapback2/crates/snapback2-core/src/identity.rs:16-17,56-57,105`; no `erased`); uniqueness is enforced at succession (`successor.rs`, `E_SUCCESSOR_UNIQUE` family); columns include `Json`/`List` types that can carry ids with no index prefix (`certificate.rs`/`schema.rs` column types; guide `quarry.md` bounds section).
Why it blocks: (a) two erased users collide on any unique principal column the moment both point at one `erased` value — the second erasure parks mid-sweep on a constraint, leaving a half-erased principal, and "constraints still bind" (stated for `delete`) has no scrub answer; (b) `ref` columns to principal-bearing tables, ids inside `json`/`[type]` columns, and maintained aggregates over erased rows are outside every prefix index, so `E_ERASE_UNREACHABLE` passes while residue remains — the derived job cannot be certified complete, and the `erasure-closure` derived test as specified (assert no row names the principal) will fail on exactly these shapes. Assets shared across rows/forks have the same issue against zero-grace release (`llp/1006-assets.rfc.md:874-881`, grace from `max(created_at, released_at)`; liveness-buys-space).
Resolve: either per-subject tombstones (`erased:<id>`, exempt from uniqueness or non-unique by construction) instead of one reserved value, plus a coverage analysis that includes refs/json/maintains (or an explicit residual list per table the author signs), or downgrade D6 to "erasure is an ordinary authored job + `check`-verified coverage" (the question the brief explicitly licenses) and keep the three words as the coverage declaration, not a derivation source.

**B3 — D1's exactly-once cursor rests on an engine write the "ordinary program" story does not certify.**
RFC claims (D1+D3): "Every chunk is an ordinary program" and simultaneously "The `_jobs` row (D3) is updated in the chunk's own transaction, so a crash between 'wrote the rows' and 'advanced the cursor' cannot exist … Exactly-once per chunk."
Evidence: chunk certification is described purely as the body's `for`-bound program (`certificate.rs` ceilings; `E_TRACE_SUBSET` at runtime); the twin section says jobs never run on the twin; `Emit`'s precedent shows engine-side writes *are* accounted (`runner_ops.rs:369` pushes `EmitRecord`, bumps `_outbox` write; twin consumes the id at `packages/evaluator/src/runner.ts:167`). The writer today is a single blocking loop with no job branch (`snapback2/crates/snapback2/src/writer.rs:430-470`, `run_writer` over `recv_timeout`).
Why it blocks: if the engine injects the `_jobs` cursor write into the chunk transaction, the chunk is not an ordinary program — it has `engineWrites` the certificate must carry (the design RFC's own `propagate` row, `llp/0329.014.004:249`, has `engineWrites` in the certificate for exactly this reason) and the twin/prediction story must account for it; if instead the cursor commits in a second transaction, the exactly-once claim is false and chunks are at-least-once with idempotent bodies required. Either is buildable, but the RFC claims both halves at once.
Resolve: add `engineWrites: [_jobs]` (+ `_timers` settle for D7) to the chunk certificate, count it in `write_sites`/budgets, and state the twin rule; or weaken to at-least-once with a per-chunk idempotency key and body constraints.

## 3. Material findings

**M1 — D2's structural authority test is stated too strongly for the lowered rule language.**
Claim: "a rule with no `system` disjunct does not [admit it]".
Evidence: lowered rules are `Public | Allow | Deny | Eq | Ne | And | Or | Not | Exists | Created` (`snapback2/crates/snapback2-core/src/schema.rs:269-295`); `system` is a reserved principal *value*, not a rule term (`identity.rs:16-17`); `Created` is transaction-local, `Exists` data-dependent.
Why change: `Not`, `Ne`, `Exists`, `Created` make "has a `system` disjunct" both unsound and incomplete — false refusals (e.g. exists-membership rules where `system` holds a membership row; `Allow`/`Public` edge cases) and a promised "red before chunk 1" that cannot be kept in general. The drive-by extension to `then` mutations ("today finds out at runtime") inherits the same proof obligation.
Resolve: formalize the decision procedure over `RuleExpr` with viewer:=system substitution (and say what happens to `Exists`/`Created`/`Not`), add corpus cases, or present D2 as conservative-admission (may false-refuse, never false-admits) with the escape documented.

**M2 — D8's "silent fifty" motivation is right but unverified as stated.**
Claim: the 51st member "gets no delivery row, and the commit is `committed` like any other" (§0); the fix delivers the rest "chunk by chunk … none silent."
Evidence: the recipe does fan out `first 50` (`snapback2/packages/snapback2/guide/quarry.md:263`; `followingFeed` admits "at most 50 follow rows" at `:142`); the engine distinguishes `Limit` vs `Exhausted` stops (`engine/runner.rs:1197`) and records capped/completeness in certificates.
What is missing: I did not verify that a `Limit`-stopped page *inside a mutation's write loop* commits silently rather than surfacing `capped`/`E_FANOUT`/refusal in the receipt — the file to check is the write-path accounting around `runner.rs:1197-1230` plus the mutation receipt shape. Also unverified: the `deliver` guard (`messages[messageId].authorId` per row) fits in `rule_probes: 10_240` at `first 500` (500 point reads + probes ≈ fits, but state it), and the sender-inline + job-scan overlap under concurrent membership insert (double delivery vs skip).
Resolve: cite the exact Limit-in-mutation behavior or soften "silent" to "bounded-drop the recipe documents"; add the probe budget line and the membership-changed-mid-job rule to the reference page.

**M3 — D3's starvation promise needs a number and a second knob.**
Claim: "Clients never wait on a chunk longer than one chunk, and a chunk is bounded"; "no pacing flag; add `--pace` only when §8 says missed."
Evidence: today's writer has no drain-pending branch and no job concept (`writer.rs:430-470`); the effects runner (the only tick precedent) wakes on commits + 1 s (`snapback2/crates/snapback2/src/effects.rs:3`; `llp/1003 §4`); §8 budgets a 500-row chunk at 25 ms and client p50 ≤ 2×.
Why change: 25 ms × back-to-back chunks with an always-nonempty job queue still doubles every send's latency at exactly the chat workload the loop bar protects; author-declared `first N` couples migration throughput to product latency with no operator override. Fine as a default, but name the second knob now (chunk cap or inter-chunk yield budget) even if unfitted, and specify the drain (non-blocking poll vs timeout) so "client actions first" is implementable in `run_writer`.

**M4 — D7 underspecifies re-arm, coalescing across successors, and job targets.**
Claim: `every` re-arms by its own firing; "missed firings during downtime fire once"; fire-and-settle is one commit with key `(schedule, row_id, at)`.
Evidence: `/control/clock` exists (`snapback2/crates/snapback2/src/control.rs:154`; `llp/1002:444-453`); `_timers (schedule, row_id, at, generation)` carries generation, good.
Why change: for `every` there is no `(row_id, at)` stability across a clock jump (what is `at` for a period?); "fire once" needs the re-arm rule written (next-from-fire vs next-from-schedule, DST/UTC handling for `at HH:MM UTC`); if targets include jobs, the idempotency key must extend to the enqueued job row or a crash between fire-commit and first-chunk duplicates work — B3's fix covers this, but D7 must say which. Also `maxLateness` "measured, not promised" is right (design RFC §2.2 row B) — keep.
Resolve: specify re-arm arithmetic, coalescing, succession behavior for system-owned rows, and whether v1 targets are mutations-only.

**M5 — D6's outbox/asset/`then`-write handling is incomplete.**
Claim: "delete `_outbox` rows still `queued` … scrub the `payload` of settled ones"; "release every asset owned by a deleted or scrubbed row with zero grace."
Evidence: outbox lifecycle with `then_pending` (`llp/1003 §2`); asset grace semantics (`llp/1006:874-881`); chat `notify` effect writes `notifications` via `then` (`guide/quarry.md` Effects/`send` recipe) — scrubbing settled outbox payloads does not scrub already-`then`-written rows.
Why change: settled effects with `then` writes (notifications, provider ids) and fork-shared assets survive the sweep silently; zero grace contradicts the liveness invariant for shared bytes.
Resolve: include `then`-derived tables in the erasure map (or name them as residue), and condition zero-grace release on unshared ownership.

**M6 — D4/D10/D11 footguns are under-priced.**
`--as system` admitted on `run, data, why` means any ordinary mutation can run as operator; the only guard is a later `E_RULE` naming `system`. Ad hoc hosted under `admin` over TLS ledgered by source hash is the right call, but needs a source-size cap and a `--dry-run`-first nudge in the verb help (the RFC's D12 scratchpad rule — dry-run first — should apply to the CLI too). MCP exclusion of ad hoc: agree, keep. No new verb: agree (verb-table rule at `rules/NOT-DOING.md:94-95`; fifteen rows at `llp/1002:57-58`, still present in `main.rs:72-85` with `persona`/`fork` intact) — but §9.8(b)'s "persona create is redundant" is load-bearing for the alternative and create-on-first-use should be cited precisely before anyone pays with it.

## 4. Minor findings

- 1002's title says "thirteen verbs" (`llp/1002-dev-loop.spec.md:1`) while the text and 1016 say fifteen (`:26,:57`) — pre-existing inconsistency; pick one.
- `E_TRACE_SUBSET` exists (`certificate.rs:811`); the `E_JOB_*`/`E_ERASE_*`/`E_SCHEDULE_*`/`E_ENQUEUE_*` codes are new and fine, but `E_JOB_GENERATION`'s resume-after-successor-fix path contradicts D3's auto-re-certify — say which parks survive re-certification.
- `run --env production` is LLP 1015's phrase (`1015:522`); 1016 should confirm the flag spelling exists on `run` today or mark it 1015-dependent.
- `trace timer:<id>` vs the D9 route table (`GET /control/timers` only) — add the per-timer route or drop the trace form.
- §9.8(a): executing 1007 §7's `fork` deletion while 1015 D1 still lists `POST /control/fork` as dev-only (`1015:139`) needs the amendment 1016 promises — file it as part of J1, not prose.

## 5. Answers to the thirteen questions

1. **Direction.** Endorse the RFC's driver-over-chunks; reject unbounded mode (destroys certificates) and full product boundary (strands M5/M7/M8 outside receipts). Abandon only on §8-budget failure at scale or D2-proof infeasibility. Evidence: ceilings (`certificate.rs:31-40`), `execute_adhoc` still certifies (`registry.rs:762`).
2. **Four hats.** All four are real at benchmark scale: M7 forces backfill (message counts over pre-existing conversations); M5 forces scheduled expiry (purge within 5 min, server time); M4/M5 force bulk delete semantics (tombstones, revocation + purge at next sync); M8 forces schedule + fan-out (per-user digest driven by schedule alone; celebrity write path). Missing from the four: import/export (M7 snapshot export exists ad hoc; 1015 D14 directory-deploy helps), index rebuilds after succession, effect re-run/repair (settled `then` writes), and support impersonation (rightly refused — personas never reach production, `1002:59-61`).
3. **D1.** Sound in shape (opaque cursors exist: `cursor.rs:1-12`; total-index requirement matches merge-index discipline in `parser.ts:810`); partial-job visibility (backfill half-done, erasure half-swept, fan-out half-delivered) is acceptable only with per-chunk receipts and the non-transaction disclaimer — keep the disclaimer, fix B3's atomicity accounting.
4. **D2.** Right authority placement (jobs under tables' rules, no seed exemption) but overstated proof; `Exists`/`Not`/`Created` defeat the structural test as specified. Conservative-admission + corpus is the fix; engine-authorized-writer (like seed/maintain) would be simpler but weaker — do not take it for user tables, consider it only for the derived erasure sweep (which already claims exemption via declaration).
5. **D5.** Narrowing admission is implementable (same walk as new-column validation; `successor.rs:143-186` plan computation); add/fill/drop is honest and matches "go straight to the ideal" better than a `migrate` block (no second semantics, three checks). Rename stays add/fill/drop in v1 — agree, with cost-revisit trigger as specified.
6. **D6.** Wrong shape as a *derived* job until B2 is fixed; right words, right refuse-until-declared (fires only on `run erase`, so the loop-bar template pays nothing — good). Coverage must be author-verified (`erasure-closure` test) even if the loop is derived. Residue naming (WAL/pages, prior snapshots, `_commits`) is exemplary — keep, minus the `_commits` deletion.
7. **D7.** Row-triggered `at` on the tick is right against the existing runner + dev clock (`effects.rs:3`, `control.rs:154`); mutation targets yes, job targets only after B3/M4; `every` does cross the "cron" line as a reasonable person reads `NOT-DOING.md:54-56` ("cron" in the not-building list vs "one `schedule` kind" in the feature list) — ship `at` in v1, gate `every` on the author's explicit line-reading; the external-trigger fallback is honest for v1 but is Snapback-1-shaped, so time-box it.
8. **D8.** `enqueue` as one write site shaped like `emit` is right (`runner_ops.rs:369`, twin `runner.ts:167` precedent); ten-commits delivery with per-chunk receipts is acceptable and matches live-query invalidation (`writer.rs` rerun path). Against 1010 A5/`propagate` (design `:249,348`): keep merge-at-read for feeds, continuations for must-exist-per-recipient rows — the RFC's rule is correct. The "silent fifty" needs the M2 citation fix.
9. **D3.** One-at-a-time + clients-first is the right default for one writer thread, but today's loop has no such branch (`writer.rs:430`) — specify the poll/drain mechanics; 500 as author-declared default is fine, but add an operator cap knob (unfitted) so chat p50 (M3 sends) is protected; resume-from-cursor + boundary-cancel + succession re-proof are all right, with B3's certificate fix.
10. **D4/D10/D11.** Right: ad hoc through `execute_adhoc`, `--as system` seat, flags on `run`, `trace` extended, hosted under 1015 tokens (`1015:238-248,307-317`), MCP reads-only. Footgun is `--as system` on ordinary mutations — mitigate with dry-run-first UX and explicit `E_RULE` rewrite (already planned); ad hoc jobs hosted: yes, keep, with size cap. No sixteenth verb: agree; do not pay with `persona` until create-on-first-use redundancy is proven.
11. **Agent-friendliness.** The M1–M8 walk is well paved: refusal→rewrite→`--plan`→`--dry-run`→`--wait`→receipt is exactly the P4/P5/done-as-receipt loop (0329.016 §5.1). First gap an agent hits: M7's backfill needs the fill-job paste *before* the loop bar if J0 is not landed — which is why §9.7's J0-early exception matters; second gap: `send`'s silent fifty has no `check`-time warning today, so the agent learns it from docs, not diagnostics.
12. **Surface/trade.** Delete candidates: `every` (defer to author ruling), `_commits` deletion (B1), single-`erased` derivation (B2 → coverage declaration), `--pace` (correctly deferred), console (correctly deferred). The §9.8(a) trade (execute `fork` adapter deletion, keep snapshot primitive for `--dry-run`) is the right counterweight provided 1015 D1 is amended in the same lane.
13. **Console.** Right to defer; agent-first posture does not need a human view sooner except one thing: the erasure map + running-job status already exist as `guide app` and `dev --status` fields — ship those read models (they are J0/J1 outputs anyway) and call that the minimal human view. No pixels before hosted.

## 6. Strengths (must not lose)

Driver-not-escape framing with per-transaction certificates; refuse-until-declared erasure that taxes the loop-bar template nothing; `--plan`/`--dry-run` on snapshots making rehearsal real; no-new-verb discipline with the `fork`-deletion counterweight; residue honestly named (devices, WAL, snapshots); `merge`-at-read vs continuation-per-recipient rule preserved; idempotency keys and fire-and-settle atomicity as the default mental model.

## 7. Open questions / §9 recommendations

Genuinely needed: the "cron" line reading (§9.1) and the `_commits` decision (§9.5) — recommend `at`-only v1 and never-delete-`_commits`. §9 one-liners: (1) `every`: NO in v1, `at` only, revisit with M8 evidence; (2) sixteenth verb: NO, flags on `run`; (3) concurrency: one-at-a-time, clients-first, add unfitted cap knob; (4) erasure default: refuse-until-declared, keep; (5) `_commits`: never delete, document residue; (6) ad hoc hosted: YES under `admin`/TLS, size-capped, off MCP; (7) sequencing: J0-early YES (narrowing + erasure map are `check`-only), rest after bar; (8) trade: (a) YES with 1015 amendment, (b) defer, (c) automatic; (9) rename: NO op in v1.

## 8. What I would build first (J1)

J0 first (it is `check`-only and unblocks M7's honest migration story), then the thinnest J1 that turns the silent fifty into a receipted ten-commit delivery: `job`/`chunk`/`enqueue` grammar, `E_JOB_AUTHORITY` conservative admission, `_jobs` with engine-writes-in-certificate (B3 fixed), `run --plan/--wait/--dry-run`, `trace <job>`, and the rewritten `send` — measured immediately against §8's chunk/client-p50 budgets on a 5k-member group before touching erasure or `every`.

*Coverage note: I read the RFC whole, RULES/NOT-DOING, 1000, the guide's Effects/send/refused sections, and the cited code paths above. I skimmed rather than fully read 0329.014.004 §§6/9, 1001 §§4–6, 1010/1011, 1014 §§3/6, and clique-pay.md; I did not run the tree. Every "could not verify" above uses those words' substance.*

File write to OUT was not performed: writes are disabled for this session.

---

## Round 2 response (2026-09-05, cross-read; verbatim)

**Method:** the same runner and capsule, on `1016-administrative-plane.panel.brief-r2.md` (the orchestrator's verification notes plus all three round-1 reviews). The sandbox again refused the file write; the text is the final message, verbatim.

Reviewer: Muse Code powered by Meta Muse Spark · Date: 2026-09-05 · Method: round-2 cross-read, read-only capsule at 6d3d09c6f

## Final verdict: NOT READY (unchanged)

The direction is right and I would not trade it: a driver over certified chunks with no path outside Quarry is the only option that preserves ceilings as bounds on a *transaction* (`certificate.rs:31-40`) while answering tasks that exceed one transaction. Unbounded operator mode and host-cron-plus-external-worker both spend the property that makes the rest trustworthy. But the RFC as written still commissions four products on one queue with an under-specified authority proof, an unexecutable derived erasure, and an idle-only scheduler. A thinner revision in this same direction — operator driver + narrowing + row timers with server-side recurrence, authored (not derived) erasure later, no `send` rewrite — becomes READY WITH EDITS. I could not verify any line estimates or §8 performance numbers; nothing in the RFC has running code behind it (per orchestrator).

## Agreements (one line each)

- Agree with grok B2 + codex B3: scrub-to-one-`erased` cannot execute on chat uniques/immutables (`templates/chat/snapback/schema.q:3-17,30-38`; `engine/runner_ops.rs:455-467`).
- Agree with codex B1 + grok B3: D2's "no `system` disjunct" test is neither sound nor complete for `RuleExpr` (`snapback2-core/src/schema.rs:~269-350`).
- Agree with grok B1/M7 + codex M1: idle-only chunks starve continuations and one chunk costs write plus reruns (`snapback2/src/writer.rs:439-480,1097-1133`).
- Agree with grok M9 + codex A5: M7 message-counts are already successor maintain rebuild (`successor.rs:648-672`), not a job customer.
- Agree with grok M4: M8 digest needs server-side recurrence (`benchmarks/briefs/social-messenger.md:757-760`); an external trigger strands bar work outside the product.
- Agree with codex B5: scrub does not reach retained/hidden pages (`packages/snapback2/src/store/range-store.ts:1080`; `writer_resume.rs:93,120`).
- Agree with grok M6 + codex A10: `--as system` needs a purpose-specific entry, never a persona (`identity.rs:69-71`; `engine/mod.rs:57-71`).
- Agree with grok M2 + codex M4: narrowing needs a new `Optional(T)->T` branch past `Drop::TypeChange` (`successor.rs:164-168,196-198`).
- Agree with all + verification (`engine/mod.rs:1381-1385`): the 10k trim premise was correct and my "could not verify a trim" is resolved, but never delete `_commits` — deletion breaks `trace`.
- Agree with grok M1 + codex M2/D8: §0 overstates hat 4 — Limit-in-mutation commits silently (`engine/mod.rs:708`) but the 51st member is unreachable in the template (`groups.q:16`; `social-messenger.md:489`).

## Disagreements argued

**Authority: against grok B3's engine-exempt declared jobs; for conservative admission (with codex).** Grok proposes declared jobs engine-authorized like seed/maintains (`registry.rs:803-808`; `runner_ops.rs:295-297`) to dodge D2's proof. That pattern fits seed because seed has no user rules to confuse. For user tables it creates the confused deputy grok itself exhibits: `deliveries.insert` is `exists memberships[.conversationId, viewer]` (`schema.q:87`), so one `or system` rewrite — a fortiori a blanket exemption — lets any system writer (other jobs, schedules, ad hoc, `then`) insert arbitrary delivery rows. Verification settles that a three-valued `Viewer:=system` eval is well-posed (`lower/schema.ts:364-365`; `Eq(Viewer,Literal(system))` true, stored-field-vs-`system` false, `Exists`/`Created` unknown, Kleene `Not`/`And`/`Or`, precedent `certificate_policy.rs`), so the cheaper fix is conservative admission (fail-closed on unknown, runtime checks retained, documented false-refusals) rather than surrendering table rules. Engine exemption, if ever, belongs to no v1 job.

**Recurrence: I move toward grok M4 and against codex's defer-`every` and my own round-1 `at`-only.** Codex's persisted next-digest row rearmed by its target is semantically recurrence by another spelling, and verification confirms M8 "requires no connected client" so lazy/external evaluation cannot satisfy it. Deferring the *word* `every` is fine; deferring server-side recurrence to host cron is not — it puts the bar's work outside receipts. v1 must ship row `at` plus minimal re-arm arithmetic (next-from-schedule vs next-from-fire, coalescing, succession, mutations-only targets).

**Hosted ad hoc: I hold YES with codex against grok's veto.** Grok M6 correctly prices RCE under an `admin` token, but the trust line is already crossed by ledgered deploy/seed and `execute_adhoc` still certifies (`registry.rs:762`); a purpose-specific system entry plus admin/TLS, source-size cap, full admission, `--plan`/`--dry-run`-first UX, durable executable custody, and off-MCP contains the same risk the control plane already accepts for deploys. Veto leaves hosted repairs with no story.

**Two mind-changes from verification and codex/grok evidence.** First, I abandon my round-1 "thinnest J1 rewrites `send`": the silent commit is real but unreachable under `GROUP_FULL`, so D8 must not touch `send` until the cap lifts — continuations are for sealed-recipient, unbounded fan-out with named completion, not the 50-cap chat path. Second, codex M3 convinces me snapshots alone are not rehearsal isolation (`store.rs:805` copy vs `owner.rs:218` effects + `writer_assets.rs:57` sweeps + `asset_gc.rs:16` shared blobs): `--dry-run` needs a specified rehearsal runtime, not just a copy.

## Ranked change list (each one line with section)

1. D6: replace derived erasure with authored job + `check` coverage (`E_ERASE_UNDECLARED` listing unwritten principal-bearing tables) — pick over per-subject tombstones because tombstones still need authored mapping for immutable/unique/refs/json/maintains and derivation permanently lags schema.
2. D2: rewrite authority as conservative three-valued `Viewer:=system` eval (unknown fail-closed, Kleene connectives, corpus cases, keep runtime checks, drop "red before chunk 1" universality) — pick over grok engine-exemption because exemption turns `schema.q:87` into a confused deputy for every system writer.
3. D1/D3: make the cursor engine-owned in the chunk txn with `engineWrites:[_jobs,_timers]` counted in `write_sites`/budgets (precedent `runner_ops.rs:363-374`, twin `runner.ts:167-171`) + sealed start watermark + stage identity/digest/args/state-types with park-on-semantic-change + persisted ad hoc content — B3 accounting and M3/codex concurrency are one commit shape.
4. D3: replace "only when idle" with bounded interleave (drain spec for `run_writer`, ≤64 timers then one chunk, round-robin across jobs, check clients between targets, unfitted operator chunk-cap) — starvation plus `after_commit` reruns otherwise doubles chat p50.
5. D8/§0: drop the `send`→`enqueue` rewrite in v1; keep `GROUP_FULL`, reserve continuations for sealed-recipient/unbounded fan-out with explicit ordering/completion/revoke-never-defers rules.
6. D6/§9.5: never delete from `_commits`; scrub payload columns only or tombstone + receipt naming seq ranges; state the `_commits.kind` widening as a store-format change the fence allows.
7. D7/§9.1: ship server-side recurrence in v1 (row `at` + minimal `every` re-arm/coalescing/succession semantics, mutations-only targets, `(schedule,row_id,at)` fire-and-settle; keep `maxLateness` measured-not-promised).
8. D5/J0: add the `Optional(T)->T` narrowing branch (not `TypeChange`), null-walk stored rows, amend all three admission paths, split static `check` from store preflight; J0 must not require erasure grammar.
9. D4/D10/D11: new purpose-specific system entry (not persona), `run --file/--wait/--plan/--dry-run` with size cap and dry-run-first help, admin/TLS ledgered by content hash, reads-only MCP.
10. D6/D9/D12: specify the erasure custody fence (durable erasing state disabling auth/recreation, `then`-derived tables, grants/slices/replay/outbox states, ownership-gated asset release, delivered-history revocation) and the rehearsal runtime (no effects, no autonomous jobs/timers, no shared-blob mutation, pinned clock, effect intents reported).

## Deletions

Delete: derived `erase` program, `erase by` clauses, and reserved `erased` as a login principal; the `_commits` deletion; the `send` fan-out rewrite and request-path `enqueue` in v1; `--pace`, job SSE, and `--cancel/--resume` as flags (subcommand if needed); cross-stage bindings until exercised; authority certificates on unrelated mutations and the universal proof claim; the large-group template rewrite; `every … at` sugar beyond the minimal recurrence in (7); the `fork` CLI adapter (keep `POST /control/fork` dev route, amend 1015 D1) plus `persona create`; any console before `run --plan`, job status, and `trace` read models exist.

## The nine author decisions (§9)

1. §9.1 `every`: ship minimal server-side recurrence (`at` + re-armed `every` semantics, mutations-only); external trigger is fallback only — splits panel (codex defers syntax, grok ships `every`; I moved to grok on semantics).
2. §9.2 sixteenth verb: NO, flags on `run` — panel agrees.
3. §9.3 concurrency: one-at-a-time with bounded interleave + unfitted operator cap, no `--pace` until measured — agrees on shape, minor split on cap-vs-fair-share wording.
4. §9.4 erasure default: refuse-until-declared, keep; no global `check` gate; authored jobs only — agrees on refuse, splits derived-vs-authored (I now side with codex/grok authored).
5. §9.5 `_commits`: never delete, document residue, receipt names seq ranges — panel agrees.
6. §9.6 ad hoc hosted: YES under admin/TLS/size-cap/dry-run-first/off-MCP with new system entry — splits panel (grok vetoes hosted; I hold YES with codex).
7. §9.7 sequencing: J0 check-only may precede the loop bar; J1/J3 after; J2/J4/`enqueue` only when a brief asks — panel agrees.
8. §9.8 trade: (a) YES drop `fork` adapter, keep route, amend 1015 D1 (also drop `persona create`); (b) defer; (c) automatic — agrees, and agrees it does not pay for J0–J4.
9. §9.9 rename: NO rename op in v1, add/fill/drop only with cost-revisit trigger — panel agrees.

## Closing paragraph

Author: keep the thesis and shrink the commission — the driver-over-certified-chunks with cursor-in-the-commit, conservative authority, and owner-local row timers is the ideal stated straight, and narrowing plus authored-erasure coverage are its honest companions; cut derived erasure, the `send` rewrite, and idle-only scheduling before they teach agents a completion story the engine cannot keep, and build first one declared single-stage fill with engine-owned cursor, `--plan/--dry-run/--wait`, and `trace`, measured against live sends, because that kernel either earns the rest of the plane or falsifies it early.

Note: file write to OUT was not performed — writes are disabled for this session.

