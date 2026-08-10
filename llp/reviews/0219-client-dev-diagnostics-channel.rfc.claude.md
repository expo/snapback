# Review artifact: LLP 0219 — Claude family

**Round:** 1
**Date:** 2026-08-10
**Target blob:** 9277f99ae371ec859442f9cd2b211dc32ca29fc7 (revision b)
**Capsule sha256-16:** 598297d5af5f3cae
**Reviewer runtime/mechanism:** Claude family via Agent tool (general-purpose
subagent), capsule-confined read-only instructions; mutually blind from the
GPT-family reviewer
**Verdict:** NOT READY

Review text follows verbatim.

---

# Review — LLP 0219: Client dev diagnostics channel (round 1)

I read the RFC in full, the cited contract excerpts (LLP 0010 §Diagnostic Shape, LLP 0012 §Diagnostic Schema/§React and Expo Requirements, LLP 0043 §Raw settlement facts + settlement lifecycle, LLP 0107, LLP 0156 E0–E3, LLP 0193), LLP 0218 and 0208 in full, the pilot record, all three issue tickets, the four code excerpts, and the diagnostics guide page. Line-number and factual claims check out against the capsule: `QUEUED_MUTATION_WEDGE_WARNING_MS` at `index.mjs:57`, the direct warns at ~1010/1034, the 64-entry ring at 309/409, `__outboxDiagnostics` at `snapback-client/index.mjs:2122`, `severity: 'error'` frozen at `index.d.mts:9` and `index.mjs:111`, and both existing queued/wedged codes present in the registry. The scope boundaries (LLP 0156 E3 out, LLP 0043 facts-not-settlement, LLP 0193 floor with the OQ6 no-rival-`remediations` guard) are correctly drawn, and the acceptance bar is honest about the already-landed content-keyed fix (the P3 repro deliberately uses genuinely-changing args). The concerns below are almost all on the LLP 0218 seam.

## Concerns

1. **MATERIAL — §Consumers and compatibility: `outboxStatus()` extension contradicts LLP 0218 §4.1.** LLP 0218 P1 owns and specifies the extension as "`outboxStatus()` gains `oldestPendingAt`, drain phase, last attempt, next retry, and a payload-free blocked reason"; this RFC independently specifies "`outboxStatus()` gains payload-safe `oldestPendingAtMs` + head metadata" — a different spelling and a different field enumeration for the same surface, in two sibling Review RFCs an implementer is told to build against together. In a corpus that treats spellings as frozen registrations (LLP 0012), this is a real divergence, not polish. **Smallest fix:** one edit — defer to LLP 0218 §4.1's enumeration (and its spelling, or agree the `…Ms` convention in both docs), and state explicitly that 0218's P1 lands the extension while this RFC only consumes it.

2. **MATERIAL — §Producers (outbox queued/wedged): trigger ownership overlaps LLP 0218 §4.4.** LLP 0218 §4.4 states "this RFC owns the trigger and payload" and defines the trigger as "the *first* silently queued mutation in a session"; this RFC specifies "emit `SNAPBACK_REACT_MUTATION_QUEUED` synchronously when enqueue commits" — i.e., every commit. The reconciliation is obvious (channel receives every committed-enqueue event; 0218's first-occurrence loudness is the default reporter's dedup policy; the queued payload fields follow 0218 §4.4) but neither document states it, so an implementer of the pair must guess which cardinality and which payload spec governs. **Smallest fix:** one or two sentences in §Producers drawing the boundary exactly that way.

3. **MINOR — §Design detail / §Decision: channel scope wording.** Option 2 says "provider/process-local", the Decision says "process-local", and `observeSnapbackDiagnostics(provider, listener)` implies per-provider projection over a per-client channel. Per-client-instance is the natural reading given the module lives in `packages/snapback-client`, but one sentence pinning it (channel owned per client instance; hook/observer project the bound client's channel) would remove the only real guess in the channel semantics.

4. **MINOR — §Channel semantics, redaction bullet: the "only" allow-list is narrower than the wedged payload.** "Generated references, hook kinds, sequence numbers, hashed canonical-input identities, and a dev-only captured call site … only" strictly excludes queue depth, oldest-pending age, transport provenance, and transition count/timing, which the producers section requires. Rescope the allow-list to argument/value-derived material (with payload-safe scalar facts permitted) so the two sections don't strictly contradict.

5. **MINOR — §Channel semantics, versioned evolution: only severity is named.** Adding `subsystem` and occurrence metadata to the frozen `snapback.client-diagnostic.v1` shape is also an evolution of a closed carrier; a clause saying the new fields ride the same v2/compat-decoder evolution as the severity widening closes the gap.

6. **MINOR (altitude) — §Decision: `positiveDevelopmentEnvironment()` is currently defined in `packages/snapback-react/index.mjs:83` while the channel and default reporter live in `packages/snapback-client`.** The seam must be hoisted or shared for headless/Expo parity; a parenthetical noting that is enough at RFC altitude.

7. **MINOR — Summary: "Snapback's weakest builder dimension alongside auth."** B10 = 55 ties with B4 (offline) and B6 (search) in the pilot record; "tied-weakest alongside auth's 48" (or similar) would be exact.

8. **MINOR — §Phases P4: hook-churn semantics are routed to an LLP 0107 amendment,** but `useSnapbackQuery` subscription semantics belong to the LLP 0114 surface per the code's own `@ref`s (0107 covers presence/optimistic and the queued warnings). Confirm the owner doc for the subscription-churn detector's semantics (0114 or both) so the P4 amendment lands in the right contract.

9. **MINOR — §Producers, wedged condition: "clears on replay or terminal disposition."** A replay *attempt* can fail with the head unmoved; say "clears when the durable queue head advances (successful replay/drain) or reaches terminal disposition, and re-arms otherwise" for precision.

## AUTHOR-DECISION items

None. All binding decisions look right-sized against the evidence, and nothing here challenges them.

## Assessment

This is a well-grounded RFC: the evidence chain from pilot to design is tight, every code citation verifies, the contract boundaries (0043/0107/0156/0193) are correctly and carefully drawn, and the phases carry testable proofs. The only thing keeping it in Review is the unreconciled seam with its sibling LLP 0218 — two small contradictions (concerns 1 and 2) that would leave an implementer of the pair guessing at a frozen spelling and an event trigger. Both are one-to-two-sentence fixes.

VERDICT: NOT READY

---

# Review artifact: LLP 0219 — Claude family, round 2

**Round:** 2
**Date:** 2026-08-10
**Target blob:** d3d88634ee2b52ebc975f7b49af6e318e4702fd6 (revision c)
**Capsule sha256-16:** ed4e549782adfd6a
**Reviewer runtime/mechanism:** Claude family via Agent tool (general-purpose
subagent), capsule-confined read-only instructions; mutually blind from the
GPT-family reviewer
**Verdict:** READY (pre-existing text clean of MATERIAL concerns)

Review text follows verbatim.

---

Reviewed from the capsule: the target RFC (revision c), LLP 0218 (Accepted) in full with close attention to §4.1/§4.4/§4.5, the LLP 0010/0012/0043/0114/0156/0193/0201/0208 materials, LLP 0107 in full, both issue tickets plus the closed resubscribe ticket, the pilot record, the guide pages, and all four code excerpts (every cited line anchor was checked against the excerpts).

Seam verification results before concerns: the two round-1 MATERIAL seams are genuinely reconciled. The `outboxStatus()` extension is now stated as owned and landed by 0218 P1 with 0219 consuming only (matches 0218 §4.1's "`oldestPendingAtMs` (LLP 0219's field name), drain phase, last attempt, next retry, payload-free blocked reason" verbatim); the queued-emit cadence is pinned to the relinquishment-to-queued transition with 0218 §4.4 owning trigger/payload and 0219 owning delivery/formatting/coalescing, exactly the split 0218 §4.4 declares and the amendment it schedules. Code anchors all verified: `positiveDevelopmentEnvironment()` at react `index.mjs:83`, carrier freeze at `index.mjs:111` and `severity: 'error'` at client `index.d.mts:9`, `QUEUED_MUTATION_WEDGE_WARNING_MS` at `:57`, direct warns at ~1000–1040, 64-entry ring at 309/409, `__outboxDiagnostics` at client `index.mjs:2139`, `useSnapbackOutbox`/`observeSnapbackOutbox` at the `:3562` region. The pilot-score wording ("55 — tied with offline (B4) and search (B6) … above auth's 48") is exactly right against the run record's B-table. The two producer codes are correctly absent from the 2,932-code registry (new registrations, P1). The P4 owner split (0114 = subscription surface, 0107 = presence + queue conditions) matches what each Spec actually owns.

## Concerns

1. **MINOR, IN-DELTA** — Producers, outbox bullet ("The condition clears when the durable queue head advances (successful replay/drain) or reaches terminal disposition, and re-arms otherwise"). Under 0218 §4.1, `resultGone` is a *terminal* disposition that **holds its successor fence** until an explicit acknowledge cut — so a head reaching terminal disposition can leave the queue still blocked, and a literal reading lets an implementer clear the wedged condition permanently in exactly the still-wedged state this RFC exists to make loud. "Re-arms otherwise" plausibly covers it (the successor becomes the pending head and re-crosses the 30 s threshold), but that is carrying a lot of weight, and the condition's stated recovery path (`replay()` / drain) is also wrong for a fence-held head, whose recovery is the acknowledge cut surfaced via the blocked reason. Smallest fix: one clause — the clear is per-head; if the queue does not actually advance (fence-holding terminal head, per the `outboxStatus()` blocked reason), the condition re-arms against the still-pending successor with the then-current recovery path.

2. **MINOR, IN-DELTA** — P1 ("versioned severity evolution") vs Channel semantics as revised, where the versioned evolution now covers *every* carrier-shape addition (`subsystem`, occurrence metadata), not just severity. P1's phase line still names only severity. Smallest fix: P1 → "versioned carrier evolution (severity widening + new fields)".

3. **MINOR, IN-DELTA** (the per-client-instance sentence is the delta; the scheduler clause is entering text it now sits beside) — Channel semantics: "one **provider**-owned deadline scheduler for wedge-class conditions" now coexists with "the channel is owned **per client instance**" in a client-package module. Ambiguous whether the wedge scheduler lives in the client channel (available to headless/Expo hosts, as the Decision's hoist parenthetical implies) or in the React provider (where today's timer lives). Smallest fix: name the owner once — e.g. "one channel-owner-owned deadline scheduler".

4. **MINOR, PRE-EXISTING** — Cross-code duplication of the queued event: P1 bridges `__outboxDiagnostics` (which records `SNAPBACK_OFFLINE_MUTATION_QUEUED` per 0218 §4.4) and P2's producer emits `SNAPBACK_REACT_MUTATION_QUEUED` for the same relinquishment. Coalescing is specified as per-code/per-site, so the default reporter would print both lines for one transition. Smallest fix: a sentence assigning cross-code dedup of the queued pair to the default reporter's policy (which already realizes 0218's first-occurrence promotion).

5. **MINOR, IN-DELTA** — "every relinquishment, not every durable insertion, since ordinary online dispatch commits the durable record before delivery": 0218 §4.1 and LLP 0043 M2 scope that pre-commit to an **explicit-id** online delivery. Smallest fix: add "explicit-id" so the rationale quotes the contract exactly.

6. **MINOR, PRE-EXISTING** — Churn detector: "tunable from stress fixtures without changing the code" is ambiguous between "thresholds are configuration, not hardcoded" and "tuning never changes the `SNAPBACK_*` code". Smallest fix: reword to whichever is meant (OQ1 suggests the former).

7. **MINOR, PRE-EXISTING** — Consumers: rerouting the optimistic-replay advisory (`SNAPBACK_REACT_OPTIMISTIC_REPLAY_DIVERGENT`) changes a delivery surface LLP 0107 pins normatively ("one `console.warn` per (mutation, query) pair per provider", with package fixtures), yet P4's LLP 0107 amendment scope names only presence-churn + queue-condition semantics. Smallest fix: fold the advisory reroute into the P4 0107 amendment scope, or state the default reporter preserves the once-per-pair pin.

## AUTHOR-DECISION items

None. The binding decisions all held up against the capsule evidence; nothing rose to rethink scale.

## Pre-existing text statement

The PRE-EXISTING text is clean of MATERIAL concerns — the concerns found in entering text (4, 6, 7) are polish-grade, and the round-1 seam conflicts are genuinely resolved in revision c.

VERDICT: READY
