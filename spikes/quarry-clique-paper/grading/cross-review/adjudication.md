# Cross-review adjudication (orchestrator)

## codex reviews grok (13 findings)

| # | Severity claimed | Verdict | Notes |
|---|---|---|---|
| 1 | CRITICAL | **CONFIRMED** | The NULL trap, reinvented: `next.historyThru = old.historyThru` with both absent is *false* under the spec's absence-propagation rule, so the members update rule refuses ordinary DM/group sends (send patches other members' preview/unread). Breaks acceptance 1 and 4 as written. Root cause is equal parts design and spec: the absence semantics recreate SQL's `NULL = NULL`, and the missing per-field grant vocabulary forced a hand-written field-unchanged matrix where the trap lives. Spec verdicts: an `unchanged(f)` primitive or defined absent-equality, plus v1's `immutable`/`immutableExcept`. |
| 2 | CRITICAL | RUNTIME-DEPENDENT | `#lastSeq + 1` duplicates only if two sends' maintained reads don't conflict. Under v1 semantics (the trace is the OCC set) they conflict and serialize — sound. But the one-pager never states the OCC/trace contract, so the reviewer is right *per the document*, and the declarative backstop (`unique conv, seq`) is correct practice. Spec verdict: the runtime contract needs a paragraph. |
| 3 | MATERIAL | **CONFIRMED** | Forgeable-forward watermark (independently found by the orchestrator pre-review — agreement datum). |
| 4 | MATERIAL | **CONFIRMED** | Cross-client intent-time comparison: `joinedAt <= message.at` compares two different clients' intent clocks for recipient-set semantics. The clock typing guards clock-vs-column, not stored-intent-vs-stored-intent. Missed by the orchestrator. Spec verdict: engine-issued epochs/sequences for order-bearing semantics; codex's incarnation-id design is structurally immune. |
| 5 | MATERIAL | CONFIRMED (self-disclosed) | 1-member groups possible; grok's own notes flagged "cannot: min 2 on an empty people list." Spec verdict: list args need a `min`. |
| 6 | MATERIAL | CONFIRMED (known) | Composite-cursor gap; both lanes had already flagged it. |
| 7 | MATERIAL | **REFUTED — artifact** | The exercise preamble grants "any query result may be subscribed"; the cross-review prompt omitted the preamble (orchestrator assembly error). Residual spec verdict: the spec itself should state the live-query default in one sentence. |
| 8 | MATERIAL | **CONFIRMED** | Undeclared disclosure: tombstoned ex-members can read the conversation row and receive `#memberCount` over active member rows they cannot read, with no `(readable:)`. The spec's own disclosure rule makes this checkable — the strict language caught a real leak. |
| 9 | MATERIAL | CONFIRMED (minor-leaning) | `unread: 0` wholesale vs page-scoped watermark: transient badge inaccuracy under racing sends. |
| 10 | MATERIAL | **CONFIRMED** | `ensureMessage` branches `none` on a restricted table into an insert — the hidden-vs-absent existence oracle the spec explicitly forbids; the first ruling-2-family commit anywhere in the app-scale exercise. |
| 11 | MATERIAL | RUNTIME-DEPENDENT | Racy 50-cap: benign under trace-OCC, unsound as-declared. The declarative fix is v1's `cap()` constraint — the already-recorded vocabulary gap. |
| 12 | MINOR | CONFIRMED | Concurrent get-or-create refuses one caller instead of returning the winner; v1's `insertIfAbsent`/`already_acted` is the missing primitive (elided from the one-pager). |
| 13 | MINOR | CONFIRMED | Channel kind has `ttl` but no delivery-latency term; the oracle's ephemeral config carries `dispatchMs`. |

Net: 9 confirmed (1 critical), 2 runtime-dependent (both pointing at the
same one-pager omission: the OCC/trace contract), 1 known-convergent, 1
refuted by prompt-assembly error. The review found two real defect classes
the orchestrator's grading missed (findings 1 and 4) — the blind
cross-family review earns its cost.

## grok reviews codex (15 findings)

| # | Severity claimed | Verdict | Notes |
|---|---|---|---|
| 1 | CRITICAL | RUNTIME-DEPENDENT + minor | Racy 50-cap (same class as codex-#11 against grok: sound under trace-OCC, unsound as declared — the one-pager states no OCC contract). The compound nit is real: the `first 50` fan-out never checks `.more`, so an over-cap roster would be silently truncated; both lanes guarded their own M2 fan-outs with `.more` checks but codex omitted it in M3. |
| 2 | CRITICAL → MATERIAL | CONFIRMED AS AMBIGUITY | `seedMessagingDemo`'s nested `match` with a bare-expression arm mid-body: the spec never defines match-as-expression vs statement mid-body, and there is no `return`. Under the statement reading the program is correct (arm value discarded, group still created); under the early-return reading the seed gate commits with the group never created. The defect is the *spec's* — control-flow yield semantics must be pinned. |
| 3 | MATERIAL | CONFIRMED (symmetric) | Concurrent get-or-create refuses the loser — the mirror of codex-#12 against grok; both lanes need the elided `insertIfAbsent`. The rule-level `lo < hi` canonicalization nit is fair defense-in-depth (v1: constraints bind every writer). |
| 4 | MATERIAL | **CONFIRMED** | LWW activity rewind: no `next.at >= old.at` guard on `conversationActivity`/`conversationStates`, and `at` is client intent time — skewed clocks reorder the inbox and desync preview from history. The mirror of codex-#4 against grok: BOTH lanes committed a member of the cross-client intent-clock family. Missed by the orchestrator. |
| 5 | MATERIAL | CONFIRMED (known) | Composite-cursor gap, third independent confirmation. |
| 6 | MATERIAL | **CONFIRMED** | Last admin leaves → permanently adminless group; add/remove/promote impossible. The brief's "anyone can leave" makes it a product ambiguity, but an unhandled one. Missed by the orchestrator. |
| 7 | MATERIAL | CONFIRMED (spec gap) | The `maintain … where` binder is undefined in the spec; codex wrote `r.` unbound. Charitable parse obvious; undefined nonetheless. |
| 8 | MATERIAL → MINOR | CONFIRMED (spec wording) | Spec shows only `merge(...) last N`; codex wrote `first N`. Trivially intended, formally absent. |
| 9 | MATERIAL | **CONFIRMED** | Batch `markDelivered`/`markRead` abort wholesale on one stale receipt id (leave/rejoin, live-query lag) — v1's per-row-outcome vocabulary (`insertSoft`-family) is the elided fix. Missed by the orchestrator. |
| 10 | MATERIAL → MINOR | PARTIALLY REFUTED | sent→read jump: the group aggregate is a min over the ladder, so a member at `read` satisfies `delivered`; codex's boundary block declares the client driver calls `markDelivered` on fetch. Residual: per-member double-check transiently unobservable. |
| 11 | MINOR | **CONFIRMED** | `NOT_MEMBER` vs `CONVERSATION_NOT_FOUND` asymmetry = an existence oracle through refusal detail — the v1 corpus's flow-claims family (dimension L), reproduced blind at app scale. |
| 12 | MINOR | CONFIRMED | Empty group name accepted; `require name != ''` was available (grok used it in its own M1) — codex under-used the tools it had. |
| 13 | MINOR | CONFIRMED (design-choice weakness) | Pre-removal history as undeclared client cache fails a fresh-device re-query; grok's own server-side `historyThru` reading is the stronger answer — the fork the exercise made visible. |
| 14 | MINOR | CONFIRMED | Duplicate ids in the member list abort `createGroup` with no stable code — per-row outcomes again. |
| 15 | MINOR | CONFIRMED (symmetric) | Channel kind lacks latency/stop terms — mirror of codex-#13. |

Net: 10 confirmed (4 missed by the orchestrator's grading), 1 runtime-
dependent, 1 spec ambiguity upgraded to a spec verdict, 1 partially
refuted, 2 symmetric-known. **Both cross-reviews caught real defects the
orchestrator missed, and three finding families (cross-client clocks,
get-or-create, racy-caps-without-an-OCC-contract) were found symmetrically
by both reviewers against both designs** — the two-blind-family pattern
earns its cost, and the reviewers wrote adversarial-grade analysis in a
notation that did not exist for them two days ago.

## Correction to lane-notes

The pre-review claim "no semantic defect found" for codex M3 is revised:
grok's #4, #6, #9, #11 stand. codex M3 remains the stronger of the two
designs (grok M3 carries the CONFIRMED-CRITICAL NULL-trap refusal), but
neither is defect-free, and roughly half of all confirmed findings trace to
one-pager elisions of facilities the v1 RFC already has.
