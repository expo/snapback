# Author decision sitting #2 — 2026-08-03 (sitting record)

**Status:** Closed (provenance record, 2026-08-04). This file is the
provenance record for the 2026-08-03 author decision sitting #2 (Charlie
Cheever, with Claude Fable 5 recording and propagating). Every ruling's
amendment, ticket update, and commission landed in one commit with this
record; the propagation map at the bottom says where each ruling lives.
Modeled on `issues/closed/20260802-author-decision-packet.md`. Closure
criterion met 2026-08-04: both commissions it opened have owners underway
— the 0146 D1–D3 tranche landed its D1 slice (38792274d) with the D2/D3
program scoped in `issues/20260803-0146-d1-d3-tranche.md`, and the 0043
sessions-custody design pass completed and was ratified at sitting #3
(`issues/closed/20260804-author-decision-sitting-3.md`).

Sibling landing, same sitting: the **promotion batch** — LLP 0144, the
0094–0114 stack, and the 0079/0086 status flips — was ruled **"accept
all that verify"** and is landing separately via a sibling commit by the
concurrent status-flip session; it is cited here and deliberately not
propagated by this file's commit.

## Rulings, 2026-08-03

1. **LLP 0074 (Convex-competitive strategy): PARKED — Draft → Shelved.**
   Revival is tied to LLP 0075's recorded reopening condition (the
   author recommissions the timed comparison). Its six open author OQs —
   including OQ8 (anchor customer/application profile) and OQ9 (program
   owner) — are deliberately not ruled until then. Context: 0075 was
   shelved 2026-08-01 with exactly this reopening condition, and 0074's
   competitive claims are gated on the comparison 0075 owns; ruling the
   anchor-profile and owner questions now would decide a program nobody
   is running. Shelved mirrors 0075's decision style (RFC statuses admit
   Shelved), with the parking note in §Status and authority.

2. **LLP 0146 (agentic affordances): D1–D3 first tranche RATIFIED for
   implementation.** OQ1 ruled: D1 strict mode is **opt-in** for newly
   generated apps. OQ8 ruled: Cloudflare fan-out stays **conservative
   widening** for now — no hosted claim gated on precision. Context: the
   tranche is the smallest, highest-leverage slice of the seven
   decisions and its motivating failure classes are already observable;
   the strict-mode default honors LLP 0127 decision 6's posture for
   existing apps without making new apps a breaking surface; precision
   recovery is real work with no claim currently waiting on it.
   Commissioned as `issues/20260803-0146-d1-d3-tranche.md`. OQ7
   (CV-14 custody trigger) was **not** ruled — implementation must not
   claim CV-14 custody satisfaction without the custody owner's
   ratification.

3. **LLP 0087 (facets hosted adoption): PARKED pending EAS Phase 0
   results.** Workers-for-Platforms dispatch namespaces may supersede
   the DO-Facets primitive; re-evaluate when EAS Phase 0 reports. The
   door-2 re-ratification explicitly waits with it. Context: WfP was
   purchased 2026-08-03 and the dispatch-namespace probe now succeeds,
   so the substrate question 0087 assumed away is genuinely open; no
   owner, reviewer, or timebox is named while parked. Status stays
   Draft.

4. **LLP 0129 OQ7 RULED: the Phase-0 evidence gate SPLITS.** The
   Node/file half is recorded as landed; the browser React+server
   witness remains an explicit open remainder
   (`issues/20260801-guide-gap-js-arm-browser-indexeddb-proof.md`).
   SD-5's self-advancing rule keys off the split reading. Context: the
   whole-gate-open reading would hold a landed, tested lane hostage to
   a witness with its own ticket; the split reading keeps SD-5 honest
   on both halves.

5. **LLP 0156 multi-rejection fingerprint authority RULED: FIRST
   ordered rejection.** The fingerprint authority for a multi-rejection
   handler terminal is the first ordered rejection; the full ordered
   rejection carrier is retained as facts on the failure record — no
   separate groups per rejection, no aggregate grammar. Context: the
   singular observation/group schema stands (no data-model change);
   first-ordered is deterministic under the Ibex queue's stable drain
   order, and no truth is dropped because the ordered carrier rides the
   record. The E0/E1 raw-only fail-safe lifts once implemented.
   Ticket flipped author-gated → implementable (stays Open):
   `issues/20260803-multiple-unhandled-error-grouping-authority.md`.

6. **LLP 0044 video location policy RULED: admit a
   `video: { location }` sibling block** (the ticket's option b).
   `image:` is untouched — its frozen `intentPolicyHash` spellings are
   preserved — and the split is documented. Context: renaming to
   `media:` would rotate policy identity for every existing app for a
   naming nicety; documenting `image:` alone leaves the video
   diagnostic permanently confusing; the sibling block fixes the
   authoring surface without moving any frozen hash.
   Ticket: `issues/20260801-0044-video-location-policy-under-image-block.md`.

7. **Sessions-mode asset lifecycle callback authority RULED: option
   (a)** — a per-app scoped LLP 0055-style service principal named
   **`asset-callbacks`**. Context: it reuses the audited grant
   vocabulary and keeps "who ran this" explicit in receipts, instead of
   counterfeiting a session or minting a new "server-scheduled as user
   X" authority class; `ctx.auth` projects the class explicitly
   (`actorKind`), and callback writes participate in commit-time
   validation like any mutation. The 0039/0055-side dated amendments
   the ticket prescribed are landed.
   Ticket: `issues/20260731-0044-sessions-callback-authority.md`
   (ruled/implementable, open).

8. **Asset intent identity RULED: extend `implementationHash` to the
   spliced helper closure**, carried through client, admission,
   generation, and finalization; metamorphic fixtures then pin it.
   Context: asset runtime source already splices the reachable helpers,
   so a helper-only authorizer change today alters what executes with
   no server-observable identity change — the ruling makes
   implementation identity the lifecycle carrier (the ticket's
   disposition 1) rather than blessing separate lifecycle semantics.
   This is the prerequisite disposition for LLP 0140 Stage 0.
   Ticket: `issues/20260801-asset-intent-implementation-hash-omits-helper-closure.md`
   (ruled/implementable, open).

9. **LLP 0136 live search: CONDITIONAL RELEASE.** The held
   implementation program resumes when the LLP 0166 implementation
   umbrella closes (carrier-exit evidence run + closing audit). Context:
   the 2026-08-02 hold was an explicit-release hold; this converts it to
   a recorded auto-release condition so the lane self-schedules as the
   next Track-A lane after umbrella close, with no fresh sitting
   needed. Recorded in `issues/20260802-wave1-0136-live-search.md` and
   sequenced in `issues/20260803-wave3-program.md`.

10. **LLP 0104 commercial direction RULED: Snapback ships a legible
    database write-unit meter as a named Charlie-facing line item** —
    not write-cost-in-margin. Context: the write-heavy cost coefficient
    (≈53× the request coefficient) makes hiding write cost inside other
    meters either lossy or dishonest; a named legible unit survives a
    storage-engine change and keeps pricing explainable. Final prices
    remain Gate-0 outputs pending the real-DO rerun; this ruling sets
    the shape only.

11. **LLP 0043 sessions-custody JS-arm queue: design pass
    COMMISSIONED** with capture-at-enqueue authority descriptors +
    strand-on-authority-change as the working hypothesis. The author
    ratifies the **recorded design, not the hypothesis**. Context: the
    hypothesis is the Contract arm's shipped discipline (LLP 0043 §Auth
    posture), but porting custody semantics by assumption would guess;
    the deliverable is a recorded design in LLP 0043 §Auth posture,
    then author ratification. Commission:
    `issues/20260803-0043-sessions-custody-design.md`; leg 2 of
    `issues/20260731-js-arm-lease-custody-and-sessions-outbox.md` is
    annotated to point at it.

12. **LLP 0151 residuals DEFERRED to the wave-4 kickoff**, context
    recorded so kickoff finds both:
    - **(a) Generated-domain passkeys tier** — production tier-1 with
      disclosure versus preview-only; the tethered-continuity risk is
      the crux (a passkey bound to a generated domain tethers the
      user's credential continuity to that domain's fate).
    - **(b) Expo-hosted shared email/SMS delivery for generated
      domains**, shadow-metered via LLP 0104 — decide beside the
      passkeys question; the 2026-08-02 broker rejection does not
      automatically extend to delivery.
    Recorded in LLP 0151 §Open questions (dated note) and as a wave-4
    line in `issues/20260803-wave3-program.md`.

13. **Standing dispositions re-affirmed** (recorded here only; no doc
    edits):
    - **Step-6 ratification of LLPs 0068–0072** stays parked per the
      wave-3 program, until Step 6 work resumes.
    - **The 0137 f7 reconnect loop** proceeds as delegated
      instrumentation-then-choose; the iOS-sim rerun is next.
    - **The 0112 register-eligibility seam** proceeds as the delegable
      option-2 fix (codegen narrows + dated LLP 0112 note) by the 0112
      owner.

14. **Promotion batch: "accept all that verify."** LLP 0144, the
    0094–0114 stack, and the 0079/0086 status flips promote wherever
    their verification bars pass. Landing separately in the same
    sitting via a sibling commit by the concurrent status-flip session
    (its file set — llp/0079, 0086, 0094, 0099, 0108–0114, 0144 and the
    relation-activity ticket — is disjoint from this one).

## Propagation map

| Ruling | Landed in |
| --- | --- |
| 1 (0074 park) | `llp/0074-convex-competitive-strategy.rfc.md` (Status → Shelved, Revised entry, §Status and authority note) |
| 2 (0146 tranche + OQ1/OQ8) | `llp/0146-agentic-authoring-affordances.rfc.md` (Revised entry, §Open questions ruling note, §Status note); new `issues/20260803-0146-d1-d3-tranche.md` |
| 3 (0087 park) | `llp/0087-facets-hosted-adoption.plan.md` (Revised entry, §Status park note) |
| 4 (0129 OQ7 split) | `llp/0129-local-first-program.plan.md` (Revised entry, OQ7 dated ruling) |
| 5 (0156 fingerprint authority) | `llp/0156-minimal-error-tracking.rfc.md` (Revised entry, §Amendment (2026-08-03): multi-rejection fingerprint authority); `issues/20260803-multiple-unhandled-error-grouping-authority.md` |
| 6 (0044 video location) | `llp/0044-asset-storage-pipeline.rfc.md` (Revised entry, §Video location policy dated decision); `issues/20260801-0044-video-location-policy-under-image-block.md` |
| 7 (asset-callbacks principal) | `llp/0039-auth-vertical-slice.rfc.md` + `llp/0055-agent-principals-and-scoped-grants.rfc.md` (dated amendments per the ticket's prescription); `issues/20260731-0044-sessions-callback-authority.md` |
| 8 (implementationHash helper closure) | `llp/0044-asset-storage-pipeline.rfc.md` (§Asset-intent implementation identity dated decision); `llp/0140-vite-rolldown-oxc-convergence.plan.md` (Revised entry + §D-1 dispositioned note); `issues/20260801-asset-intent-implementation-hash-omits-helper-closure.md` |
| 9 (0136 conditional release) | `issues/20260802-wave1-0136-live-search.md` (coordination log); `issues/20260803-wave3-program.md` (Track A sequencing) |
| 10 (0104 write-unit meter) | `llp/0104-expo-hosted-metering-and-commercial-contract.spec.md` (Revised entry, §Margin gate dated note) |
| 11 (0043 design commission) | new `issues/20260803-0043-sessions-custody-design.md`; `issues/20260731-js-arm-lease-custody-and-sessions-outbox.md` (leg-2 annotation) |
| 12 (0151 wave-4 deferrals) | `llp/0151-first-party-identity-integrations.rfc.md` (Revised entry, §Open questions dated note); `issues/20260803-wave3-program.md` (wave-4 line) |
| 13 (re-affirmations) | this record only |
| 14 (promotion batch) | sibling commit by the concurrent status-flip session (cited here, not propagated by this commit) |
