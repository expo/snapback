# Review artifact — LLP 0222 (Claude family)

**Round:** 1
**Date:** 2026-08-10
**Target:** llp/0222-connected-client-predicate.rfc.md (revision b, blob 6c660b6d004dcc6c31ea0b23e81222fdbc71d0a9)
**Capsule:** sha256-16 1b79f85dc33a33db (target + Related LLPs 0008/0013/0028/0045/0053/0143/0201 + benchmark record + issue ticket + guide/capabilities.md + guide/realtime/live-queries.md + code copies/excerpts; llp/reviews/* excluded)
**Reviewer runtime:** Claude family via Agent tool (subagent_type general-purpose), capsule-confined read-only instructions
**Verdict:** NOT READY

---

The review below is sealed verbatim as received.

---

I have read the target RFC and all capsule context (LLPs 0008, 0013, 0028, 0045, 0053, 0143, the pilot record, the issue ticket, both guide pages, and the four code excerpts). Review follows.

---

# Review — LLP 0222: Connected-client freshness predicate (round 1)

**Scope reviewed:** correctness, internal consistency, consistency with Related documents and code, completeness of the semantics contract, soundness of phasing, design hazards. Binding decisions (a)–(d) are respected and not relitigated.

**Overall:** The core design is sound and well-grounded. Option A is argued honestly against B/C/D, the C and D dismissals correctly apply LLP 0008's invalidation contract and LLP 0013's boundaries, the implementation sketch checks out against the excerpted code (the `last_use_ms` and `ConnectionRegistry`-membership non-sources are real and correctly reasoned; the `ctx.runtime.now()` exclusion matches LLP 0028's nominal-bound trusted clock; the grant-survives-close hazard is real in `src/server.rs`), and the capability-honesty posture (Missing on multi-instance, never silent-false) matches the corpus's established pattern. The remaining problems are compositional and contractual, not architectural.

## Concerns

**C1 — MATERIAL. Poll is the shipped default transport; the contract treats poll-only clients as an edge case when they are the default case.**
Passage: Semantics, "Poll-only clients count as `false` in v1; counting a recent HTTP request would silently mutate the contract into 'recently seen.'"
The cited authority (`guide/realtime/live-queries.md` §Subscribe) states plainly: "`transport: 'stream'` for durable WebSocket push (**`'poll'` is the default**, cadence `pollCadenceMs`, with `fallbackToPoll` when a stream can't be established)." A default-configured live-query client — and any stream client degraded through `fallbackToPoll` — therefore reads `false` forever. This bears directly on the motivating use case (the Clique push milestone), on Phase 4's validation (which will pass or fail depending on an unstated transport choice in the lane app), on OQ2's likelihood of firing, and on the differentiator claim. The managed-WebSocket-only contract itself is a recorded binding decision and is not the concern; the omission of the default-transport fact is.
**Minimal fix:** one sentence in Semantics (or OQ2) stating that `'poll'` is the shipped default transport and `fallbackToPoll` degradations also read `false`; require the Phase 3 guide recipe and the Phase 4 lane to pin `transport: 'stream'` explicitly.

**C2 — MATERIAL. The paved recipe does not compose with LLP 0143's deferred-grant audience restriction as written.**
Passage: Decision, "A mutation wanting conditional push transactionally enqueues an action; that action observes freshness immediately before `ctx.push.send`," and Phase 3's "enqueue-action-observe-send recipe cross-reference to LLP 0143."
LLP 0143 resolved implementation question 8: "Deferred grants admit **membership resolvers only**," and the D2/D3 implementation record confirms "raw principal arrays … refuse in this mode." So in exactly the trigger mode the recipe names (mode 3, deferred), per-recipient conditional push is inexpressible: the action cannot narrow the captured membership audience to the non-fresh principals, and cannot substitute a principal-array audience. What the recipe supports in deferred mode is whole-intent skip only (viable for 1:1 conversations where the mutation passes the sole recipient's principalId as job args); per-recipient filtering requires the cron/system lane's explicitly bounded principal arrays (0143 OQ8 mode 2) or the deferred Option B gate. The Option A tradeoff sentence ("callers of membership-audience push must resolve recipients themselves") implies a capability the deferred mode refuses.
**Minimal fix:** two sentences in the Decision (or the Phase 3 recipe item) pinning which trigger modes support per-recipient filtering in v1 (immediate and cron/system via bounded principal arrays; deferred = whole-intent skip only, per 0143's membership-resolver-only grants), and noting that this restriction is part of the demonstrated-need evidence the Option B gate watches.

**C3 — MATERIAL. Missing privacy posture for a globally addressable connectivity oracle.**
Omission: the Design detail section pins naming (`hasFreshClient`, no count, no `lastSeenAt`) against fingerprinting, but never records the privacy posture of the boolean itself. LLP 0013 §Authorization and privacy is normative for this class: "Online status is privacy-sensitive. Snapback should not expose global user presence by default. Presence should normally be scoped to the object where the user is actively collaborating." The RFC's own Option B text concedes B is "harder to misuse as an online-status oracle" — yet the chosen surface lets any action probe any `principalId` with no recorded caller-relationship posture, and nothing stops an app author from wrapping it in a client-callable `isUserOnline(userId)` action, rebuilding exactly the global-presence surface 0013 refuses. This is not a challenge to the primitive (binding decision (b) stands); it is a missing load-bearing commitment in the contract.
**Minimal fix:** one normative paragraph in Design detail (and the Phase 3 guide row): the observation is server-code-only routing input; re-exposing it as user-visible presence is off the paved path (scoped ephemeral presence per LLP 0013 remains the user-facing presence answer); state explicitly that v1 imposes no caller↔subject authorization and why that is judged acceptable at this surface.

**C4 — MINOR. Summary misattributes client-kit constants as server-held state.**
Passage: Summary, "the server already holds … managed-WebSocket liveness with a published freshness budget (`LIVE_HEARTBEAT_INTERVAL_MS = 5_000`, `LIVE_FRESHNESS_BUDGET_MS = 15_000` …)." Those are the **client stream manager's** defaults (guide §Connection state an author can observe; LLP 0008 pins the server side as event-driven with a defensive 30 s heartbeat). The design's own justification for `connected_clients.rs` is that the server holds no such witness today. The Semantics section gets this right ("matching the shipped client default"); the Summary should say the server holds the raw material (authenticated grants, client-originated frames) and the *client* default supplies the published budget the server-side witness mirrors.

**C5 — MINOR. "Three-way tie" misdescribes 58/58/55.**
Passage: Summary. B7 is a two-way tie at 58 with Supabase at 55 (the phrase is inherited from the evidence ticket, but the RFC need not repeat it). The pilot record also marks B-scores as builder self-assessments, calibration-only. Reword to "58/58/55 — effectively undifferentiated" or similar.

**C6 — MINOR. Codegen emission gate diverges from the precedent it cites.**
Passage: Implementation sketch, "emitted … beside the existing conditional `GeneratedPush` slot **only when the selected target reports the capability**." The `GeneratedPush` precedent (index.mjs `hasPushSend`) gates on the *app declaration*, not on target capability; there is no declaration for this ambient predicate, so the proposed gate makes generated type artifacts target-dependent, which has determinism/custody implications for digest-verified codegen outputs. Clarify the emission input: target-manifest-conditional (and say so, with its custody consequence) or always-emit with the runtime refusal stub carrying availability (the `ctx.jobs` pattern the same bullet cites).

**C7 — MINOR. Non-sessions auth-mode posture is implied but not pinned.**
"Session-mode" appears in the Decision and the anonymous/service exclusion, but the RFC never states what a dev-auth-mode (impersonation) target reports — Missing capability and stable refusal, or always-`false`? Given "`false` is never a silent capability fallback" and that demos/acceptance largely run dev mode, add one sentence (and a Phase 2 proof leg) pinning that non-sessions modes report the capability absent and refuse with the unavailable diagnostic.

**C8 — MINOR. Citation tightening.**
(a) LLP 0070 is cited in the Decision ("cron plus durable-job work execute as actions … LLP 0070") but absent from the Related header; add it. (b) "grants deliberately survive ordinary socket close (LLP 0053)" — the survival fact lives in the `ConnectionRegistry` docstring whose grant-ownership @ref is LLP 0031; LLP 0053 owns the issuer/generation binding. Cite LLP 0031 (or both) for the survival fact.

**C9 — MINOR (altitude). Unnamed stable codes and unstated index bound.**
The refusal-stub and unavailable diagnostics are promised "a stable `SNAPBACK_*` code" without naming it, and "bounded" witness-index memory has no stated bound (Phase 1's proof list covers both). Sibling RFCs (0143) pin diagnostic codes as contract; naming them here would be customary but deferring to Phase 1/2 is a defensible altitude choice. No action strictly required.

## AUTHOR-DECISION

None. The four recorded decisions were applied as binding and nothing surfaced that warrants reopening any of them at rethink scale.

## Verdict

Three MATERIAL concerns (C1, C2, C3) require author action — each has a small, local fix that leaves the architecture, the primitive, and the recorded gates untouched.

VERDICT: NOT READY

---

# Review artifact — LLP 0222 (Claude family), round 2

**Round:** 2
**Date:** 2026-08-10
**Target:** llp/0222-connected-client-predicate.rfc.md (revision c, blob 4bed1062982c1782b7f4387389de5602f5e42e12)
**Capsule:** sha256-16 1813d3ced3a62c9e (target rev c + Related LLPs 0008/0013/0028/0031/0045/0053/0070/0143/0201 + benchmark record + issue ticket incl. 2026-08-10 author ruling + guide pages + code copies/excerpts; llp/reviews/* excluded)
**Reviewer runtime:** Claude family via Agent tool (subagent_type general-purpose), capsule-confined read-only instructions, blind to round 1
**Verdict:** NOT READY

---

The review below is sealed verbatim as received.

---

Review complete. I read the instructions, the target RFC (revision c), and the capsule context: LLPs 0008, 0013, 0028, 0031, 0045, 0053, 0070, 0143, 0201; the P2 pilot benchmark record; the evidence ticket; the live-queries guide page and capability index; and the code copies/excerpts (`ctx.d.mts`, `index.mjs.excerpt.txt`, `ctx-bootstrap.js`, `server.rs.excerpt.txt`, `runtime.rs.excerpt.txt`).

# Review — LLP 0222 `Connected-client freshness predicate` (revision c), round 2

## Verification summary

The document's factual spine checks out against the capsule. Verified: B7 58/58/55 with the calibration-only caveat (benchmark record, builder self-assessment note); `LIVE_HEARTBEAT_INTERVAL_MS = 5_000` / `LIVE_FRESHNESS_BUDGET_MS = 15_000` published on the client side in `guide/realtime/live-queries.md` §"Connection state an author can observe"; `'poll'` as the shipped default transport with `fallbackToPoll` (§Subscribe); `app.reset` leaving the socket connected and re-snapshotting (LLP 0008 §Resync sentinels, ENG-23333); connection grants surviving ordinary socket close (LLP 0031 §Connection capability grants: "The socket-close disconnect does not revoke the grant"); LLP 0053 generation identity; adapter-owned lifecycle (LLP 0008 §Dated constraints 2026-07-23); cron's trusted clock bound to nominal/due time (LLP 0028); deferred grants admitting membership resolvers only while raw principal arrays refuse (LLP 0143 §Implementation question 8 — the trigger-mode composition paragraph reads that section correctly); global online status privacy posture (LLP 0013 §Authorization and privacy); the `ctx.jobs` mode-gated stub pattern with `SNAPBACK_JOB_ENQUEUE_UNAVAILABLE` (`ctx-bootstrap.js` ~lines 896–916); `ActionContextBase` and the conditional `GeneratedPush` slot (`ctx.d.mts`, codegen excerpt); `IbexActionHost` and the detached action host (`runtime.rs` excerpt); `DeliveryNotifier::register_bound`, `ConnectionRegistry`, and the polluted `last_use_ms` (`server.rs` excerpt). No citation I could check was wrong.

## Concerns

**C1 — MATERIAL, PRE-EXISTING (with IN-DELTA reinforcements). The RFC contradicts the recorded author ruling in its own cited evidence ticket, and Phase 3 would close that ticket with the ruling unabsorbed.**
`issues/20260809-connected-client-predicate.md` — which the RFC cites in Related as "(evidence ticket)" and closes in Phase 3 — carries an "Author ruling — 2026-08-10": proceed at full scope, enabled by default, no conservative v1 fence; **OQ1** — attempt the hosted/multi-instance aggregation story rather than marking the capability Missing; **OQ2** — widen the transport contract where needed for the predicate to be truthful for real clients (with `semanticsVersion` discipline); **OQ3** — add the normative note to LLP 0045 **now**. The ticket states explicitly: "the loop should fold this ruling into the RFC." Revision c does the opposite on each point:

- OQ1: "Until answered the capability stays Missing there" and the capability-row bullet's "Multi-instance/hosted targets report **Missing** until…" (pre-existing);
- OQ2: managed-WebSocket-only stays the v1 contract, and the delta *strengthens* the narrow posture — the poll bullet's "Only `transport: 'stream'` clients produce witnesses; the Phase 3 recipe and Phase 4 lane pin that," Phase 3's `transport: 'stream'` pin, and Phase 4's "clients pinned to `transport: 'stream'`" are all IN-DELTA. Since `'poll'` is the shipped default transport (a fact the delta itself honestly records), the ruling's "truthful for real clients" clause bears directly on this;
- OQ3: still phrased as an open question ("is that boundary worth a normative note in 0045 now or at its next revision?") that the ruling has already answered.

Why it matters: accepting revision c as-is pins postures the author has overruled, and Phase 3 closing the ticket would bury the ruling. Minimal fix (refine, not redesign — the binding decisions in the instructions are untouched by the ruling, which stays action-only, transport-attested, advisory, and leaves the Option B gate intact): add a dated "Author ruling (2026-08-10)" absorption — restate the full-scope/on-by-default posture; convert OQ3 to resolved-now and move the normative-note task into Phase 3; reframe OQ1 from "stays Missing" to "design the aggregation (single principal-routing authority vs. shared index) as in-scope work," keeping Missing only as the honest interim report while unbuilt; reframe OQ2 as an active v1-truthfulness decision under `semanticsVersion` discipline rather than a deferred widening; and revisit the Phase 3/Phase 4 `transport: 'stream'` pins (or record them as an explicitly interim slice under the maximal order).

**C2 — MINOR, PRE-EXISTING. Anonymous/service-principal exclusion doesn't pin the observable.**
Semantics: "Anonymous and service principals are excluded (session-mode only)." Unstated whether probing a service or anonymous principal id returns `false` (no witness can exist) or refuses with a diagnostic. The capability row pins mode-level refusal ("`false` is never a silent capability fallback") but this bullet is principal-level within sessions mode, and Phase 1's "anonymous/service exclusion" proof can't be written unambiguously. Minimal fix: one parenthetical pinning the observable (e.g. "such principals can never hold a witness; the probe answers `false`" — or refuses, whichever is intended).

**C3 — MINOR, IN-DELTA. Privacy section's trust argument slightly overreaches.**
"a relationship check would be theater against code that also holds `ctx.push.send`" — the predicate is ambient (the codegen bullet says "there is no app declaration for this ambient predicate"), so actions in apps with no push seam hold the predicate without holding `ctx.push.send`. The conclusion survives on the trusted-server-code ground alone. Minimal fix: reword to rest on trust level rather than literal co-possession, e.g. "at the same trust level as server code that could declare and hold `ctx.push.send`."

**C4 — MINOR, IN-DELTA. "Rebinding generation-safely" is undefined.**
`app.reset` bullet: "the witness survives, rebinding generation-safely if reset rotates socket identity." Given the witness is keyed by exact `(connectionId, grantId, socketGeneration)`, "rebinding" presumably means the rotated socket's authenticated attach registers a fresh witness and supersession removes the old — but as written it could be misread as freshness transferring across identities. Minimal fix: one clause, e.g. "(a rotated identity registers a fresh witness at its authenticated attach; freshness never transfers between socket identities)."

**C5 — MINOR, PRE-EXISTING. Option B citation points at the wrong LLP 0143 section.**
"an Expo seam explicitly designed to be absorbed later by first-class notifications (LLP 0143 §D2; LLP 0045)" — the absorption design lives in LLP 0143 §D0 ("scoped to be absorbed") and §D6 ("Absorption into LLP 0045"); §D2 is the send lane where `suppressWhenFreshClient` would sit. Minimal fix: cite §D0/§D6 (or both: §D2 for the integration point, §D6 for absorption).

## Pre-existing text

**Pre-existing text is not clean.** One MATERIAL concern (C1) sits primarily in pre-existing text — the Open questions section and the hosted-Missing posture — though the conflict arises from capsule context (the recorded author ruling in the cited evidence ticket) rather than from an internal error in the round-1 prose, and the delta reinforced the conflicting posture rather than resolving it. Apart from C1, the pre-existing text carries no MATERIAL concerns: the options analysis, the A-vs-B record and gate, the pinned semantics core, the implementation sketch, and the compatibility section are accurate against the capsule and consistently at RFC altitude.

## AUTHOR-DECISION

None. Nothing here relitigates the binding decisions (action-only transport-backed predicate; not principal data/not presence-derived/not user-writable; advisory fixed budget with non-promises; Option B deferred behind the gate) — the author's own 2026-08-10 ruling coexists with all four, and C1 asks only that the document absorb a decision already made.

VERDICT: NOT READY
