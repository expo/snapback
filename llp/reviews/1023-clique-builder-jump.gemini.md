**Reviewer family:** Gemini
**Provider / runtime:** Pi via OpenRouter, requested google/gemini-3.1-pro-preview high
**Date:** 2026-09-12
**Redacted:** no; repository design/source excerpts only
**Method:** Independent frozen-packet review, then a panel discussion supplied with all four actual reviews and proposed root dispositions. No author acceptance is inferred from a reviewer verdict.

# LLP 1023 panel — gemini

Scope: LLP 1023, its three children, and residual research LLP 1018.008.009. Source inspected in the packet: `3b7f51564a`. Implementation reconciles the newer base `27d8d7e9dd98`.

## Round 1 — independent review

Packet SHA-256: `b7c0a76d5f4943aa84a8721b8b376bbd77e52347c4178ef74e7823a23cd1f474`. CLI exit: 0. Requested model is recorded above; no unreported served-model identity is inferred.

**Verdict: DIRECTIONALLY READY**

The user’s instruction explicitly delegates implementation, upgrading this program from an RFC to an active, commissioned execution plan. The architectural boundaries, isolation of already-landed fixes, and strict adherence to the local-first constraints are exceptionally well-reasoned. The plans successfully diagnose root causes (e.g., distinguishing React route unmounts from durable client teardowns, and separating missing absence authority from a simple zero value) rather than relying on auxiliary clients, arbitrary caches, or benchmark-gaming. 

The direction is solid and can be handed to the agents. However, there are physical constraints and minor architectural gaps that will cause the agents to thrash if not explicitly bounded before coding begins.

### Prioritized Actionable Concerns

**1. The 89,999-Byte Headroom Crisis (Dangerous Ambiguity)**  
The twin runtime currently measures 89,999 gzip bytes against a hard 90,000-byte ceiling. You have exactly one byte of headroom. The plans correctly state, "Fund added runtime bytes through deletion/simplification." However, if an autonomous agent is instructed to implement the new draft custody, refresh paths, and media redactions, it will write the feature *first*, instantly fail the blocking `caps` byte-size check in CI, and burn its 3-round loop budget blindly trying to guess what to delete.  
*Actionable fix:* Before any functional coding begins, mandate a dedicated "Byte Funding" phase. The agent must identify and remove ~500 bytes of obsolete mechanisms, legacy diagnostic strings, or verbose TS helpers, and commit that breathing room before touching the 1023 features.

**2. Hub Search 1,000-Lane Exhaustion Fallback (Dangerous Ambiguity)**  
LLP 1023.001 correctly audits the fixture to require covering 1,000 chat memberships for global search, rather than capping it to 100. It requires the agent to find a compiling form or "retain the gap." An autonomous agent may interpret a refusal here as a hard failure and waste cycles attempting to rewrite the Quarry merge engine or bypass the certifier's retention budget.  
*Actionable fix:* Explicitly define "done" for this track: if the engine legitimately refuses a 1,000-lane composition under current limits, documenting the structural gap, printing the accurate `check --cost` diagnostic, and landing the failing consumer test *is* a successful exit for the program. Do not permit the agent to invent a new global top-K sort outside the database.

**3. G7 Draft State Custody vs. Authorization (Material Wrong Turn)**  
LLP 1018.008.009 identifies the loss of edit drafts during transient page shifts (e.g., "Load older messages") because the draft lives in the row component's state. The proposed fix is to lift the draft to `[account, messageId]` outside the row. If this is implemented as a global standalone map, it risks a data leak: if the user loses authorization to the message (e.g., they are removed from the group), a globally stored draft might keep a ghost UI mounted or leak intent.  
*Actionable fix:* The draft state must be lifted into the query's existing `defineItems` or page resource cache. This ensures that the draft is strictly bound to the query's authorized `items` array; if the row is evicted or revoked by the server, the draft is safely garbage collected alongside it.

**4. Unrelated Live Updates Destroying Unopened Assets (Missing User Outcome)**  
In LLP 1023.000, the plan for `once` media correctly states that "a new instance cannot reuse its allowance." However, if a live update arrives for *other* fields on the row (e.g., a reaction or a read receipt) while the asset is sitting unopened on the screen, the client merge might blindly wipe the viewing descriptor because it evaluates as a "new" snapshot.  
*Actionable fix:* Ensure the live twin merge preserves the existing unconsumed `once` media descriptor if the underlying asset ID and authorization have not changed. A background heartbeat must not destroy an unclicked image.

---

### Per-Child Assessment

**LLP 1018.008.009 (Residual gaps)**  
*Assessment: Excellent.*  
This document is a highly objective transition state. It cleanly separates the architectural victories of the four-plan work (e.g., stable identity and continuous visibility via the composition plan) from the remaining friction. Identifying the starter edit-draft loss as the sharpest remaining G1/G7 papercut provides immediate, measurable value.

**LLP 1023 (RFC Parent)**  
*Assessment: Strong Governance.*  
The parent frames the product requirements flawlessly: coherent reads, complete scale, and durable writes. It successfully bans the previous builder workarounds (like mounting a token-only auxiliary client just to bypass the outbox). The user's prompt successfully converts this from a theoretical RFC into an authorized, executable program.

**LLP 1023.000 (Reads)**  
*Assessment: Highly Accurate Diagnosis.*  
Recognizing that `seq === 0` is a valid sequence and that the real defect was the publication of unheld maintained totals is top-tier engineering. Reusing the landed `unavailable` / `partial` Insight fix rather than inventing a new client-side scalar cache is the simplest, best mechanism. The online/offline matrix for `once` media perfectly resolves the contradictions of earlier drafts.

**LLP 1023.001 (Scale)**  
*Assessment: Vital Clarification.*  
The audit of the benchmark brief—distinguishing `u0001` (1,000 memberships) from `u0500` (100 conversations)—prevents the agent from optimizing for the wrong metric. Prioritizing correct certifier accounting over forcing a grammar change ensures the data plane's integrity remains intact. 

**LLP 1023.002 (Writes)**  
*Assessment: Precise Architectural Fix.*  
Pinpointing that React route unmounts are incorrectly tearing down the provider-owned client is the exact right diagnosis for the web write failures. Using IndexedDB transaction commit as the strict admission boundary, and explicitly relegating `keepalive` to an optional transport optimization, avoids a massive and unstable Fetch API rewrite. 

---

### Phase Distinctions for the Agents

To prevent the agents from rebuilding what is already there, enforce this strict categorization during execution:

**1. Already-Landed Source Fixes (Do not rebuild)**
*   **Insights partial-twin zero withholding:** The logic that prevents an uncovered maintained point from publishing a fabricated scalar is already in `3b7f51564a`.
*   **Bounded multi-page transport & foreground admission:** The batches and atomic carrier groups from the acquisition plan are already landed.
*   **Page resource composition:** The SDK owner for raw pages, item pages, and history fallback is already implemented.

**2. New Implementation (Authorized for coding)**
*   **Byte Funding:** Deleting ~500 bytes of dead code to survive the 90,000-byte ceiling.
*   **Draft Custody Lift (G7):** Moving the edit draft state from the row component into the authorized page resource cache.
*   **Route vs. Provider Lifecycle (1023.002):** Decoupling the `SnapbackProvider` (durable client) from transient route unmounts in React.
*   **Offline Media Redaction (1023.000):** Ensuring live online `once` media remains visible until clicked, but is nulled offline, without unrelated live updates destroying the token.

**3. Qualification (Testing and Measurement)**
*   Executing the Hub-scale fixture to verify search pagination and digest completeness.
*   Running the exact offline-vote replay and route-unmount tests to prove write durability.
*   Validating the exact timed Insights screen for fresh loads without requiring an auxiliary token client.

---

### Smallest Changes/Decisions Needed Before Coding

Before handing this to Astra/the fleet, append these explicit instructions to the prompt:

1.  **"Execute a Byte Funding phase first."** Instruct the agent to identify and delete unused code to create at least 500 bytes of headroom below the 90,000-byte limit before starting any work on the 1023 plans.
2.  **"Bind edit drafts to the query cache."** Instruct the agent that the G7 draft fix must store the draft inside the `defineItems` or page resource, ensuring it is destroyed if the user loses authorization to the row.
3.  **"Accept documented limits for 1,000 lanes."** Instruct the agent that if the certifier legitimately refuses the 1,000-membership hub search, it must document the failure, land the diagnostic test, and exit successfully. It must not attempt to rewrite the merge engine.

## Round 2 — panel discussion

Packet SHA-256: `68452b6c2e8a2512331442351512fe583a4e6a006f88023158983af3fe46cb65`. CLI exit: 0. Requested model is recorded above; no unreported served-model identity is inferred.

The proposed dispositions successfully synthesize the round-1 reviews into a rigorous, executable boundary for the LLP 1023 program. By resolving the conflicting peer demands and discarding speculative scope, the dispositions leave no material reason to delay implementation.

First, accepting Astra’s three targeted amendments prevents dangerous edge-case failures. Astra correctly identified that bounding scheduled digest jobs is useless if authorization can expire between accumulation and final emission. Enforcing authorization and expiry checks at the final per-user emission point is the exact right safeguard. Astra’s requirements that refresh completion be measured by the *displayed* result and that the `plain()` fallback path be explicitly traced during restoration provide concrete boundaries for the agents, preventing accidental regressions in offline UI behavior and durable identity.

Second, the dispositions correctly rein in Gemini’s mistakes. Gemini demanded a blind, upfront 500-byte deletion phase before any functional coding could begin. This was a misguided mandate that would force an autonomous agent to arbitrarily gut existing mechanisms, risking platform stability. The disposition’s choice—integrated, measured byte funding tied to each net-growing runtime change with one lane integrator—is the correct, safe approach. Gemini also attempted to smuggle the G7 edit-draft custody fix into this program. As the dispositions rightly state, edit-draft loss is a row-state lifecycle issue entirely outside the 1023 query-and-scale commission. Implementing it here would violate the strict scope and risk data leaks.

Third, Grok’s demand to artificially archive an active, unrelated LLP simply to satisfy the 59-document cap was administrative overreach and is appropriately rejected. We must respect the cap, but not by deleting live context. However, Grok correctly warned against inventing new scale mechanisms. The disposition locks this down perfectly: agents must use existing sound single queries, followed by complete supported compositions (like cursor pages or chunked jobs). If three fix rounds fail, the program produces a recorded narrow gap. There will be no new read models, index grammars, or N-way client merge hacks. 

Finally, Muse and Gemini both risked conflating the performance targets. The dispositions rightly decouple the web lane's median admission targets from the separate 2–3-second full acquisition objective, keeping the web lane strictly focused on durable custody rather than bulk throughput. Retaining the three-round fix budget, separating the clocks, and demanding real browser custody evidence ensures that we are qualifying genuine product outcomes, not gaming a test runner.

The peer reviews surfaced critical risks but also introduced dangerous scope creep (Gemini on G7) and artificial process hurdles (Gemini on byte-funding, Grok on archiving). The root dispositions successfully strip these away. We now have a strictly defined, three-lane program with a single integrator, a zero-headroom byte trade rule, and a clear, safe exit condition for scale refusals.

The boundaries are closed, the benchmarks are frozen, and the acceptable API surface is locked. 

PROCEED.

## Orchestrator disposition

All four reviewers supported proceeding. The three Astra amendments were incorporated in the child plans; actual byte funding, one integrator and the existing-mechanism scale order were retained. G7 and the arbitrary 500-byte cleanup phase were rejected. A capability gap remains an unmet product outcome.

Policy correction after discussion: root supplied an incorrect claim that the working-set cap did not apply. Reading `rules/RULES.md` directly confirms its 59-link budget applies to 1000+ work. The panel replies above preserve that mistaken input faithfully. The completed LLP 1021 current link is archived; its Implemented document and evidence remain intact. No active proposal is removed.
