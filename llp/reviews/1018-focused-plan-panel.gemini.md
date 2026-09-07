# LLP 1018 focused-plan panel — Gemini

**Reviewer family:** Gemini
**Provider / runtime:** Antigravity CLI, `gemini-3.8-flash-high`, effort `high`
**Date:** 2026-09-07
**Redacted:** No; selected repository context contained no credentials
**Method:** CLI runner; independent initial response, instruction-based blindness
**Targets:** LLP 1018 §12, LLP 1018.001 and LLP 1018.002 at `cc0616af4`
**Context:** Concurrent architecture record at `2cae5d9a2`; governing rules and authorization/replay excerpts; existing evolution/count diagnostic
**Round 1 prompt SHA-256:** `930a76cbc47e16371c3841f6cfce8f4f35cd48847f3ba3a5cfa60a0338464a89`
**Authority:** Charlie requested this panel and delegated plan revisions; feedback is advisory, not acceptance.

## Round 1 — 2026-09-07 (verbatim)

### 1. Strongest Independent Thesis

Snapback 2 is suffering from **anticipatory apparatus accretion**: speculative edge cases are driving complex distributed protocols and fragile graph-analysis schemes, while demonstrated, score-critical primitives are relegated to open-ended "investigations."

Specifically:
- `LLP 1018.002` attempts to construct a static transitive policy-dependency closure to prevent harmless schema migrations from conflicting queued offline writes. This risks severe authorization leakage across cyclic/transitive rules to solve an operational scenario that the diagnostic proved is already safe and recoverable.
- The follower-forwarding architecture in `LLP 1018.000` §8 introduces distributed multi-tab consensus, 4-state mutation results (`admission-unknown`), opaque recovery tokens, and 256 durable receipts—ballooning runtime size past the 66,000-byte ceiling to 82,000 bytes gzip.
- Meanwhile, the typed direct compiler has already been built and proven in lane `2cae5d9a2` (net deleting 7,663 production lines), yet is treated in `LLP 1018.001` as an unaccepted draft requiring new RFC scrutiny; and the **zero-count read-evidence gap**—which actively breaks offline cap prediction in real code—languishes as an unstaffed umbrella investigation.

The architecture must be simplified: accept the compiler win, preserve the safe whole-schema hash, kill multi-tab forwarding in favor of the landed follower lock-takeover, and make the sparse-aggregate absence receipt a concrete engine fix.

---

### 2. Five Concrete Recommended Changes

#### 1. Shelve `LLP 1018.002` (Dependency-Scoped Invalidation); Retain Whole-Schema Hash with Clear Client Re-intent Recovery
- **Mechanism & Evidence**: Under `LLP 1001`, binding rule verdicts to `Schema::rule_hash` provides a mathematical one-level disclosure bound that prevents authority leakage across cyclic rule graphs. The 2026-09-07 pending-client diagnostic proved that when an optional column invalidates an offline intent's rule hash, system behavior is completely safe: the intent settles as `E_OFFLINE_CONFLICT`, the outbox preserves the envelope bytes, and newly minted intents commit cleanly once refreshed. Constructing a transitive policy closure graph across dynamic schemas and rule expressions requires massive compiler and certifier machinery with immense risk of authorization escape.
- **What would change my mind**: Demonstrating that queued offline intent conflicts during DDL migrations cause measurable score loss in Clique M7, or a formal proof that a sub-schema policy digest has zero runtime overhead and provably prevents leakage under cyclic rules.

#### 2. Promote "Read Evidence for Zero-Count" from an Investigation to an Immediate Engine Fix in the Sparse Aggregate Model
- **Mechanism & Evidence**: In `issues/20260907-snapback2-public-zero-count-does-not-enable-offline-cap-prediction.md`, a public query for an empty group returns `data: 0` with an empty receipt (`absences: []`). Consequently, the twin cannot distinguish a proven count of 0 from unheld data, suppressing offline cap prediction entirely. Since `LLP 1018.000` §5 already adopted a canonical sparse representation (count/sum rows exist only when non-zero), the engine's scalar aggregate fast-path should emit an explicit **absence receipt** for missing aggregate target rows. This proves absence to the twin without inventing unheld state or modifying OCC semantics.
- **What would change my mind**: If emitting absence proofs for zero-count sparse rows bloats wire receipt size beyond transport budgets for wide group-by queries.

#### 3. Revert Follower-Write Forwarding (`1018.000` §8) to the Landed Read-Only Follower Contract
- **Mechanism & Evidence**: `LLP 1018` §3 and §9 unanimously established that a second tab is a follower: it reads live, refuses writes with `E_OFFLINE_FOLLOWER`, and inherits the durable queue when the writer tab closes. `LLP 1018.000` §8 overrode this by adding BroadcastChannel forwarding, an `admission-unknown` mutation state, recovery tokens, and durable receipt caches. This added ~11kB gzip (contributing to blowing the 66kB gzip ceiling to 79.2kB/82kB) and added a complex distributed consensus protocol across browser tabs. In local-first client architecture, multi-tab offline concurrent writing is an edge case; lock inheritance on tab close is sufficient, robust, and costs zero extra bytes.
- **What would change my mind**: An explicit requirement in the Clique messenger brief requiring simultaneous disconnected multi-tab offline sending where `E_OFFLINE_FOLLOWER` is penalized.

#### 4. Convert `LLP 1018.001` into a Terminal Verification Checklist for `2cae5d9a2`, Not an Open RFC
- **Mechanism & Evidence**: The direct typed compiler is already implemented in `llp-ship` branch `2cae5d9a2`. It eliminated the TypeScript lowering layer, bypassed 9,124 lines, and delivered a net reduction of 7,663 compiler production lines while passing 27 of 32 frozen repair checks. Writing a discursive RFC (`1018.001`) with open questions invites competing implementations and spec churn. Treat the candidate as the reference: audit the 5 remaining repair checks, verify authored diagnostic source sites, run the product loop (`snapback2 check` ≤ 1s), and land it.
- **What would change my mind**: Discovery of semantic divergence in `2cae5d9a2` where left-to-right evaluation order or page provenance in Rust certification fails without TypeScript AST assistance.

#### 5. Cancel the "Public Extension Points" Investigation and Absorb "Query Lifecycle" into `client.observe`
- **Mechanism & Evidence**: `rules/NOT-DOING.md` explicitly forbids public plan algebras, JS data-plane handlers, and custom plugin frameworks. Snapback 2 is an opinionated, closed-stack framework with an explicit pre-promotion deletion policy ("Delete; don't deprecate. Every publish is `0.0.x`"). Running an investigation to survey external consumers of internal seams is unnecessary process. Concurrently, query lifecycle ownership is already resolved by `1018.000` §4 (`client.observe` via `useSyncExternalStore`), which eliminates duplicate reducers in React/Expo.
- **What would change my mind**: Evidence that the Expo native carrier or `snapback2-effects` requires hooks that cannot be satisfied by `client.observe`.

---

### 3. Worthwhile 1–2 Day Slice & What to Explicitly Defer

#### Next 1–2 Day Slice
1. **Fix Zero-Count Absence Evidence**: Modify the engine's sparse aggregate reader to return a structured absence receipt when a maintained count row does not exist. Verify in `real-owner.test.ts` that a public count of 0 enables multi-principal offline cap prediction.
2. **Close and Land the Typed Direct Compiler (`2cae5d9a2`)**: Run the warm `snapback2 check` benchmark to confirm subsecond latency, verify that diagnostics point to Quarry source sites, and merge the 7.6k-line compiler deletion to main.
3. **Resolve Retained-Projection Unsend Defect**: Fix the known browser client bug noted in `1018.000` §10 (inbox navigation disappearing after unsend due to conservative eviction nulling unproven projected literals).

#### What to Explicitly Defer
1. **`LLP 1018.002` (Dependency-Scoped Invalidation)**: Defer indefinitely. The broad schema hash protects authorization determinism; queued conflict recovery via re-intent is acceptable for pre-promotion milestones.
2. **Follower-Write Forwarding & Recovery Tokens**: Defer BroadcastChannel forwarding and `admission-unknown`. Retain the clean `E_OFFLINE_FOLLOWER` refusal and Web Lock takeover.
3. **Public Extension Points Investigation**: Defer/delete entirely under `NOT-DOING.md`.

---

### 4. Most Important Counterargument to My Recommendation

The strongest counterargument is that **deferring `1018.002` and rejecting follower forwarding leaves two visible user/developer papercuts in place**:
1. *Downtime-free Schema Evolution*: If an operator adds an optional column or non-breaking index while mobile/offline clients have queued writes, those clients will receive `E_OFFLINE_CONFLICT` upon reconnecting and must re-run their mutation logic against fresh data. If the app author did not implement automatic retry from raw draft state, end-user writes may be dropped.
2. *Multi-Tab Web UX*: In web apps, users frequently open multiple tabs. A user typing in a second tab during an offline period will see immediate `E_OFFLINE_FOLLOWER` refusals rather than a smooth, seamless background queuing experience.

**Rebuttal**:
Both concerns prioritize speculative UX polish over platform correctness and simplicity. Broad schema hashing is the bedrock of Snapback's authorization model; a bug in fine-grained transitive policy closure could silently leak private data across tenants. Furthermore, multi-tab forwarding requires a full distributed transaction log between tabs (incarnations, timeouts, 4th-state recovery tokens) that bloats the client runtime past its strict budget. The landed contracts—clean `E_OFFLINE_CONFLICT` requiring a fresh intent, and clean `E_OFFLINE_FOLLOWER` with lock inheritance on close—are robust, predictable, explainable, and preserve the engine's core guarantees.


## Round 2 — 2026-09-07 (verbatim discussion)

All initial responses, author positions and evidence corrections were shared.
Prompt SHA-256: `17a00d8c72214ed74ddc1ff3fe9a53243999c9df26a6981d3d17fcb5160b7cfa`. This discusses provisional decisions, not the final edited document bytes.

### 1. Most Important Disagreement

The central disagreement is the **disposition of separately commissioned runtime expansions**—specifically Follower-Write Forwarding (`1018.000` §8) and Incremental Rerun (§3). 

The panelists (Gemini, Muse) unanimously pushed to cancel or icebox these tracks immediately to protect the strict 82kB gzip runtime ceiling and avoid distributed multi-tab protocol states (`admission-unknown`, recovery tokens). Conversely, Author Provisional Decision #6 explicitly declined blanket cancellation, arguing that separately commissioned work must be evaluated on integrated code rather than preemptively vetoed by panel fiat. 

This disagreement reflects two competing priorities: enforcing strict architectural minimalism before integration versus respecting commissioning boundaries and measuring residual complexity empirically.

---

### 2. Corrections of Unsupported Claims (Including Prior Claims)

* **Gemini’s Runtime Attribution**: My prior claim that follower forwarding added ~11kB gzip and introduced general multi-tab distributed consensus was unsupported. The 79,207-byte measurement is a five-root bundle with no isolated causal delta proving forwarding contributed 11kB. Furthermore, Web Lock maintains single-admission authority, meaning forwarding is not general distributed consensus.
* **Gemini’s Compiler Status**: My prior assertion that 5 repair checks remain undisposed in `2cae5d9a2` is incorrect. All 32 dispositions are formally settled (27 CLOSED, 4 OUTSIDE-Q, 1 RETAIN, 0 PENDING), with direct compiler tests advancing to 208 pass / 0 fail at commit `8bea2c347`.
* **Gemini & Muse’s Lifecycle Diagnosis**: Citing "missing inbox navigation from unproven projected literals" as the active unsend bug is obsolete. Lane witness `301e59bb6` proved the active defect is an unsend count 2 regression to capped seq7/count3.
* **Grok’s Call for an Invalidation Autopsy**: Calling for a fresh autopsy to determine why queued writes conflicted is redundant. The 2026-09-07 diagnostic report already established that `Schema::rule_hash` complete-schema binding caused the conflict, not row-digest mismatch.

---

### 3. Improvement to the Synthesis

**Ground the "Authority-Established Facts" principle into a single Evidence-Preservation Witness.**

The synthesis rightly notes that facts should be consumed at the authority that established them rather than reconstructed downstream (compiler types, policy closures, absence proofs). To turn this into an executable plan slice:

Combine the **Expo consumer type-check** (`0c1a538ae`), the **zero-count absence receipt**, and the **unsend regression** (`301e59bb6`) into a single end-to-end verification scenario. Direct lowering must emit typed sparse-aggregate queries whose absent rows yield justified absence proofs to the twin, preserving cap prediction across cold reopen while passing the real Expo consumer test (`skipLibCheck: true`). 

This replaces disparate sub-investigations with one concrete end-to-end qualification path.

---

### 4. Material Reason to Reverse an Author Decision

**Reverse Author Decision #1: Demote `LLP 1018.001` from a Draft Child RFC to a Terminal Closeout Checklist.**

* **Decision #1**: *"Keep the two Draft children, but make 1018.001 a finite reconciliation/closeout of the existing compiler..."*
* **Material Reason to Reverse**: Maintaining `1018.001` as an active RFC creates a shadow governance structure over work that is already practically finished. With all 32 repair items formally disposed in `2cae5d9a2` and upstream tests at 208/0 pass (`8bea2c347`), there are no unresolved architectural design questions requiring an RFC lifecycle. The only remaining requirements are verifying Quarry source sites, running the subsecond check, and validating the `0c1a538ae` Expo negative type check. 

Keeping `1018.001` as an open RFC document risks specification churn and delays merging a proven net deletion of 7,663 production lines. It should be converted immediately into a terminal integration checklist in the primary architecture record.

