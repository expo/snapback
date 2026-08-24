# Review artifact — LLP 0307, family: codex

## Round 1 — 2026-08-24

- Model: codex gpt-5.6-sol, reasoning effort **ultra** (verified in run log
  header), read-only sandbox, cwd = capsule (full repository access;
  instructed exclusion of llp/reviews/0306-*/0307-*).
- Target revision: r1, sha256
  `94121eb8cce46821125322d65f2b0da63fa6a03a88f3632b06c8741318cef68f`.
- Capsule: detached worktree at `c26bb9729` + r1 overlay; structurally
  blind (no 0306/0307 review artifacts existed).
- Received: 2026-08-24, exit 0.
- Verdict: **NOT READY** (7 MATERIAL concerns; rulings OQ1/OQ3 explicitly
  cleared, OQ5 packaging cleared with cross-ownership repair).
- Orchestrator verification note (post-receipt): finding 1's factual claim
  was independently confirmed against the code — `renderAppBindingAlias`
  (`packages/snapback-codegen/index.mjs:16625-16632`) embeds the
  digest-named specifier and `app.binding.mjs` is rewritten on every
  generation (`:21866`), so the r1/ticket claim that the alias bytes stay
  stable is false.

### Verbatim body

The RFC is not ready. Its routing frame is useful, but several tracks rely on incorrect evidence or cross established ownership boundaries.

1. **Verification table / Track T1 — the asserted Metro mechanism is false.**

   **Defect:** The RFC says the stable alias’s bytes never change while its import target rotates, then proposes making codegen rewrite those bytes. At the cited commit, `packages/snapback-codegen/index.mjs` already derives the binding identity from the descriptor, embeds the resulting digest-named target in `app.binding.mjs`, and rewrites that alias on every generation (`8210–8242`, `16625–16632`, `21864–21868`). The ticket’s proposed smallest repair is therefore already implemented.

   **Why material:** T1 gates the next full pin, yet its stated repair cannot resolve the observed symptom. Implementing around this false diagnosis could also weaken the atomic generated-graph publication boundary without fixing Metro.

   **Fix direction:** Remove the claimed root cause from the RFC and ticket. Reproduce under supervised Metro while comparing alias bytes/mtime against the served bundle, then distinguish directory-swap watcher behavior from transform/module-cache invalidation. Preserve atomic graph publication in the eventual repair.

2. **Track Q — the probe cannot qualify LLP 0302 or the canonical URL-first path.**

   **Defect:** Track Q runs exclusively through supervised `snapback dev --expo` but requires bindings to survive “via the 0302 standing gate.” LLP 0302 §4 says a completed supervised rendezvous wins and `url` is ignored; its no-expiry standing gate applies only when rendezvous is absent and `declared-dev` is selected. The proposed probe therefore exercises LLP 0299’s supervised binding and refresh behavior, not LLP 0302’s declared-dev behavior. It also never exercises LLP 0300/0301’s canonical caller-owned Expo lifecycle.

   **Why material:** The highest-priority qualification cannot substantiate the closure claim it is supposed to gate, and its blanket failure routing to LLPs 0299/0301/0302 would misassign defects.

   **Fix direction:** Split Q into two probes: a canonical `snapback dev` plus caller-owned `expo start` journey for LLPs 0301/0302, and a supervised `--expo` probe for LLP 0299. Route failures according to the binding source actually selected.

3. **Track E3 — it converts underdetermined Research into implementation and merges two separate defects.**

   **Defect:** LLP 0297 explicitly does not authorize implementation and distinguishes:

   - generated artifact/catalog identity using a 4,096-node default despite a 65,536-node artifact profile; and
   - admitted result snapshots later re-canonicalized at 4,096 nodes for equality, with consumer exceptions silently swallowed.

   E3 calls this one “Option E close-out” and supplies only the generated-app blank-boot ticket as acceptance. That fixture proves neither result delivery nor no-silent-drop behavior, and the two branches belong to different owner chains.

   **Why material:** This silently crosses LLPs 0114/0179/0155/0200 and could “fix” artifact boot while leaving result delivery observably broken.

   **Fix direction:** Split E3. Route artifact identity through LLPs 0114/0179 with the blank-boot fixture. Route result equality and diagnostics through the result/live-query owners with a distinct delivery fixture. Keep underdetermined equality work in Track S until its owning decision is accepted.

4. **Summary / current state / E4 / sequencing — the execution baseline is stale and E4 exceeds LLP 0281’s authority.**

   **Defect:** Move 5 is not at zero implementation: LLP 0295 records per-milestone token metering landed at `59894588b`, including enforcement, and the instrument ticket says the `0.3.3-m8` R2-gating observability slice is implemented. Conversely, LLP 0295 still lists work under moves 1 and 3, contradicting “moves 1–4 are landed.” E4 then reassigns landed metering to the instrument bump and adds milestone session splits or compaction changes. LLP 0201 normatively requires one continuous M1–M6/M8 session because context accumulation is part of the experiment; LLP 0281 owns instrument work only.

   **Why material:** The RFC can duplicate landed work, gate on already-satisfied conditions, omit genuinely open work, and alter the benchmark’s experimental treatment under the wrong owner, breaking comparability.

   **Fix direction:** Reconcile the status section directly with LLP 0295’s execution table. Treat metering and the existing bump as landed behavior to validate, enumerate the exact remaining LLP 0281 scope, and route any session-shape change through an explicit LLP 0201 protocol amendment.

5. **Open question 2 — the Familiar M8 scoring ruling is wrong.**

   **Defect:** LLP 0252 forbids profile mixing within one application, while LLP 0253 routes `defineCron` to the Explicit profile. “Allow the documented leave” therefore means a whole-application migration, not an in-profile escape. LLP 0252’s scorecard explicitly distinguishes intra-application extensions from forced whole-application migrations. Moreover, the specified `snapback author profile migrate --to explicit` path is not implemented.

   **Why material:** Recording Explicit-authored M8 work as Familiar would corrupt profile attribution and hide the exact expressiveness boundary being measured. If the ruling instead means mixing builders, it is infeasible under the current profile contract.

   **Fix direction:** If the real-user path is desired, rule a whole-application Familiar→Explicit migration, score it as the separate forced-migration class, and segment attribution after the switch. Gate it on an executable migration path. Otherwise retain N/A or an explicit capability-boundary result.

6. **Open question 4 — `v.json<T>()` is an unsafe cross-profile contract change routed to the wrong owner.**

   **Defect:** The `defineAuth` export ruling is sound, but `v.json<T>()` is not equivalent to a local caller cast. Runtime `v.json()` validates only generic JSON bounds, while `InferValidator` propagates the chosen `T` into generated arguments, results, references, and clients. It would make an unchecked assertion appear to be a Snapback-validated contract. Canonical `v` is shared by both profiles; LLP 0253 does not own a Familiar-specific validator vocabulary, and the cited guide-gap ticket concerns only `defineAuth`.

   **Why material:** This weakens contract honesty across the platform and silently expands a profile-local repair into canonical argument/result semantics.

   **Fix direction:** Split the ruling. Keep `defineAuth` under LLP 0253 and its fixture. Reject or defer `v.json<T>()`; any unchecked convenience must be designed by the canonical validator/result/argument owners, with an explicitly unsafe/assertive spelling that cannot masquerade as runtime validation.

7. **S1 / open question 5 — the selected public package has an omitted existing owner.**

   **Defect:** S1 assigns replay semantics to LLP 0043 and calls LLP 0201 the first consumer, but the chosen `@expo/snapback-acceptance` root API is already governed by LLP 0275 D9. That ruling owns its public compatibility boundary, platform lifecycle, session minting, retries, receipts, and cleanup. Pacing, actor pools, replay identity, and a CLI wrapper extend that existing public contract.

   **Why material:** Letting S1 bind the package contract independently would create two owners for one supported public API and could blur LLP 0275’s platform-versus-application responsibility boundary.

   **Fix direction:** Make S1 cross-owned: LLP 0043 owns replay/custody semantics; LLP 0275 D9 owns the acceptance-package API, lifecycle, and compatibility contract; the CLI owner governs the verb; LLP 0201 remains consumer and evidence source. The helper-first packaging choice can otherwise stand.

Rulings 1 and 3 have no material defect.

VERDICT: NOT READY
## Round 2 — 2026-08-24 (combined: 0307 r2 delta + 0307.000 r1 fresh)

- Same model/config as round 1 (ultra verified in log); capsule = worktree
  + r2/0307.000/companion tickets overlaid. Target hashes: 0307 r2
  `e594e38ea12a92d2e78f527e5e8355d5f1b57e02afb2c6071481a72f6a4efa24`,
  0307.000 r1
  `458c06f01d467223b649d14e3090cb8cdabcd6a85885d36fdc9039e79b5dbf90`.
- Verdicts: **0307 NOT READY** — six of seven dispositions confirmed
  substantively correct; one MATERIAL PRE-EXISTING disposition error (E4
  retains "handoff self-containment", owned by the M7-handoff ticket under
  LLP 0201/0277, outside LLP 0281's instrument authority) + 2 non-blocking.
  **0307.000 NOT READY** (5 MATERIAL: no viable custody cut for
  exactly-once incl. authority mismatch on re-mint; receipts cannot
  reconstruct dependent actions; 'none' auto-re-execute is not
  at-most-once; 256-ack window unsafe by retained bytes (8 MiB/auth, 128
  max results); detached mode infeasible for closure-bearing definitions).

### Verbatim body

Applying the LLP review altitude rule, only contract, ownership, feasibility, and safety defects affect verdicts. I did not open prohibited review artifacts.

## Target A — LLP 0307 r2

Six dispositions are substantively correct: Metro diagnosis, Q split, E3 routing, OQ2, `v.json<T>()`, and S1 ownership. Finding 4 is only partially dispositioned.

- **MATERIAL — PRE-EXISTING disposition error:** E4 still assigns “handoff self-containment” to the “[LLP 0281 — instrument scope only]” bump ([0307:246](/private/tmp/claude-501/-Users-ccheever-projects-snapback/2236b7d9-696c-481f-a128-5496fa28e998/scratchpad/sr0307-capsule/llp/0307-paved-loop-cost-chipaway-round.rfc.md:246)). LLP 0306 separately routes M7 handoff relocatability to its own ticket ([0306:523](/private/tmp/claude-501/-Users-ccheever-projects-snapback/2236b7d9-696c-481f-a128-5496fa28e998/scratchpad/sr0307-capsule/llp/0306-published-0125-clique-cost-sources.research.md:523)); that ticket changes replay-path custody under LLP 0201/0277 ([ticket:22](/private/tmp/claude-501/-Users-ccheever-projects-snapback/2236b7d9-696c-481f-a128-5496fa28e998/scratchpad/sr0307-capsule/issues/20260822-m7-handoff-not-self-contained.md:22)), while LLP 0281 expressly owns only instrument work ([0281:32](/private/tmp/claude-501/-Users-ccheever-projects-snapback/2236b7d9-696c-481f-a128-5496fa28e998/scratchpad/sr0307-capsule/llp/0281-benchmark-instrument-observability-closure.plan.md:32)). Remove or reroute the retained item.

Nonblocking cleanup:

- **IN-DELTA:** The node/HUD verification row still points to E3/E4 even though E3 is routing-only and E4 contains no node/HUD work ([0307:122](/private/tmp/claude-501/-Users-ccheever-projects-snapback/2236b7d9-696c-481f-a128-5496fa28e998/scratchpad/sr0307-capsule/llp/0307-paved-loop-cost-chipaway-round.rfc.md:122)).
- **IN-DELTA:** The `defineAuth` companion ticket retains its old either/or ruling despite r2 making it documentation-only and routing export through LLP 0253 ([ticket:37](/private/tmp/claude-501/-Users-ccheever-projects-snapback/2236b7d9-696c-481f-a128-5496fa28e998/scratchpad/sr0307-capsule/issues/20260824-guide-gap-familiar-defineauth-spelling.md:37)).

No other MATERIAL concern was found in admissible pre-existing text.

## Target B — LLP 0307.000 r1

The packaging and ownership split is coherent with LLP 0275 D9, the parent, and LLP 0201. Five MATERIAL contract defects remain:

1. **Exactly-once resume has no viable custody cut.** Transport IDs are persisted only in terminal receipts, so a crash after dispatch but before receipt flush leaves no ID for D7 to resend ([D3:132](/private/tmp/claude-501/-Users-ccheever-projects-snapback/2236b7d9-696c-481f-a128-5496fa28e998/scratchpad/sr0307-capsule/llp/0307.000-headless-replay-surface.spec.md:132), [D6:216](/private/tmp/claude-501/-Users-ccheever-projects-snapback/2236b7d9-696c-481f-a128-5496fa28e998/scratchpad/sr0307-capsule/llp/0307.000-headless-replay-surface.spec.md:216)). Moreover, default bearers are cached only for the run; re-minting creates a new session and authority, while settlement lookup rejects auth or authority mismatch as `SNAPBACK_AUTH_STALE_RESULT` ([settlement.rs:634](/private/tmp/claude-501/-Users-ccheever-projects-snapback/2236b7d9-696c-481f-a128-5496fa28e998/scratchpad/sr0307-capsule/crates/snapback-kernel/src/storage/settlement.rs:634)). LLP 0043 explicitly provides no exactly-once bridge across authorities.

2. **The durable receipt cannot reconstruct dependent actions.** It records neither mutation result/projection nor a canonical action/args digest, yet promises resumed `ctx.settled(intent)` resolution and prefix verification. The cited loader actually derives runtime IDs from `response.result.ids` ([loader:323](/private/tmp/claude-501/-Users-ccheever-projects-snapback/2236b7d9-696c-481f-a128-5496fa28e998/scratchpad/sr0307-capsule/demos/zerobugs/control/scripts/load-fixture.mts:323)).

3. **`transportCustody: 'none'` is not at-most-once.** D7 automatically re-executes a crash-ambiguous action; if its first execution committed, effects can occur twice. The contract must either stop on ambiguity or explicitly require idempotency and name duplicate-possible semantics.

4. **The 256-result ACK window is unsafe.** The per-auth ceiling is 1,024 records but only 8 MiB—128 maximum-sized results—and admission counts complete retained-row bytes ([storage.rs:626](/private/tmp/claude-501/-Users-ccheever-projects-snapback/2236b7d9-696c-481f-a128-5496fa28e998/scratchpad/sr0307-capsule/crates/snapback-kernel/src/storage.rs:626)). Thus `<1024` is not safe “by construction”; byte-aware/global outstanding custody is required.

5. **Detached programmatic mode is infeasible for legal definitions.** D5 permits closures, mapper functions, async iterables, and an `AbortSignal`, while D8 promises an independent spawned process. Those values cannot be transferred to a new Node process. Detached mode needs a serializable/importable definition boundary or must be CLI-only.

The exact LLP 0201 checkpoint/action-grammar adapter remains a nonblocking implementation obligation.

VERDICT 0307: NOT READY
VERDICT 0307.000: NOT READY