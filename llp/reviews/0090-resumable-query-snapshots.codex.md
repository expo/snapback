**Reviewer family:** Codex (OpenAI)
**Provider / runtime:** codex-cli 0.145.0 (`codex exec`, read-only sandbox), invoked from the orchestrating /llp-super-refine Claude session; the orchestrating session authored the draft but the Codex run had a fresh context and no access to the concurrent Fable-family round or to llp/reviews/
**Date:** 2026-07-24
**Redacted:** no — repo-local review; reviewer instructed not to read credential files or llp/reviews/
**Method:** cli-runner (fresh context per round; prompt pinned the document sha256 and repo HEAD)

# LLP 0090 reviews — Codex (OpenAI) family

## Round 1 — 2026-07-24

**Revision under review:** `llp/0090-resumable-query-snapshots.rfc.md`, sha256 `ac01c4698d01fc88c11b7122fe4b5ad0d14bdc2acdf7469e8f591e61e328071d` (untracked working-tree file at HEAD `4d2f02e4`; both MATCH per the reviewer's own revision check).
**Runtime detail:** 164,697 tokens used.
**Verdict:** NOT READY

### Review body (verbatim)

## 1. Revision check

- Document SHA-256: `ac01c4698d01fc88c11b7122fe4b5ad0d14bdc2acdf7469e8f591e61e328071d` — **MATCH**
- Repository HEAD: `4d2f02e4` — **MATCH**
- `llp/0090-resumable-query-snapshots.rfc.md` is untracked at that HEAD, as expected.

## 2. Overall assessment

The product direction is strong: snapshot-first boot, persistent retained views, and bundled finite reads plausibly belong to one client-facing abstraction. Separating “data SSR” from server-rendered views is particularly useful.

The proposed primitive is not yet sufficient to implement its central guarantee, however. A commit version alone neither identifies the lifetime of the version stream nor gives the server the prior query membership needed to reconstruct historical query-result deltas. The RFC also contradicts LLP 0011’s ratified requirement that every non-live auth-scoped resume obtain a fresh authorized snapshot. Those are foundational protocol and security issues, not rollout details.

Repository verification found:

- `LiveReplace`, `LiveDelta`, `ResyncRequired`, and authorization-invalidation snapshots have substantially the shapes described. `snapshotVersion` also appears in receipts, although receipts do not themselves establish resumability.
- LLP 0008 explicitly says reconnect is currently fresh-subscribe and that version-based delta resume remains future work. Its DK-3 delta path covers only analyzable unordered queries.
- The React demo does await `health()` and `ensureApp()` before mounting, and its HTML is an empty shell.
- The external store defaults to empty rows but already accepts `initialRows`; `getServerSnapshot()` returns the same store snapshot and is not the mechanism used by the demo’s client-only `createRoot` render.
- The Cloudflare gateway serves assets through `env.ASSETS.fetch`, but it does not itself read query results. Query execution and subscription registration occur in the coordinator.
- LLP 0031 supports classifying a snapshot endpoint as root-level app data, but requires explicit credential, invocation-authority, response-sensitivity, and cache-control treatment.
- Keeping full HTML SSR as a later consumer is compatible with LLP 0063, though its no-duplicate-subscription and no-stale-flash acceptance obligations still apply.
- LLP 0076 supports the statement that the current Workerd arm is deploy-time compiled. The broader statement that deployed Workers forbid dynamic evaluation is contradicted by LLP 0083’s discussion of Worker Loader and Durable Object Facets.
- The prior-art table is reasonably hedged in places, especially the InstantDB row, but its external claims were not verified for this review. Absolute market claims should therefore remain explicitly survey-bounded.

## 3. Strengths (cite sections and line numbers)

- The unification is product-coherent: the RFC clearly presents one intended abstraction across inline boot, durable local retention, and finite bundle fetches (§Summary, lines 20–36).
- It correctly separates data delivery from server-side view rendering, preventing SEO-oriented HTML SSR from blocking the more generally useful snapshot work (§Summary, lines 38–40; §D5, lines 202–213).
- The design retains a safe fallback rather than requiring indefinite history retention (§D1, lines 122–128; §Scalability notes, lines 221–225).
- It recognizes that snapshots are authorization-scoped retained data, including identity partitioning, eviction, and purge behavior on invalidation (§D3, lines 180–185). The security mechanism is incomplete, but the risk is visible.
- It explicitly recognizes that authenticated HTML cannot use ordinary shared caching (§D2, lines 167–169).
- Bundling queries at one shared commit is the right consistency target and avoids Convex-style mutually inconsistent preload results (§D1, lines 136–145; §Open questions Q5, lines 245–248).
- The RFC identifies several genuine design decisions rather than hiding them: manifest ownership, argument parameterization, miss behavior, at-rest posture, bundle consistency, and anonymous caching (§Open questions, lines 227–252).
- The rollout includes outcome-oriented acceptance ideas, especially proving that inlined rows render before a WebSocket frame and that retained launch avoids a full refetch (§Rollout sketch, lines 254–266).

## 4. Concerns (numbered; each with severity Major/Moderate/Minor and a concrete resolution that would clear it)

1. **Major — `{function, args, rows, version}` is not sufficient to reconstruct historical query deltas.**

   The core contract says a new subscription carrying only `resumeFromVersion` receives the query’s `LiveDelta` frames since that version (§D1, lines 116–135). DK-3 currently computes changes for an active analyzable query using its prior membership. A newly resumed server subscription does not know the row set held by the client. The journal contains post-images and deletes, but an update that moves a row out of a predicate requires knowledge that the row was previously a member. A commit cursor alone provides no such knowledge.

   Moreover, DK-3 is limited to analyzable unordered queries; ordered, limited, opaque, and other ineligible queries use `LiveReplace`. The RFC currently presents resumability as applying to every query result.

   **Resolution:** Specify the exact replay architecture and eligibility contract. Viable shapes include a durable server-side client-view record keyed by a stable subscription identity, a signed resume token that refers to retained server membership, or a bounded client-provided member-set/digest protocol with a defined reconciliation step. Define behavior for replace-only queries. Include an atomic subscribe/replay/tail algorithm that prevents a commit from falling between journal replay and live registration, with concurrent-write acceptance tests.

2. **Major — Channel B contradicts the ratified auth-resume contract.**

   The RFC says a persisted auth-scoped snapshot can render and then resume deltas, relying on `AuthorizationInvalidationSnapshot` or `ResyncRequired` to purge it (§D1, lines 122–128; §D3, lines 171–185). An offline client can miss those frames. LLP 0011 explicitly requires that reconnect and every non-live auth-scoped resume obtain a fresh snapshot; authorization-epoch equality is insufficient. LLP 0008 repeats that constraint. The implemented client also has an authorization descriptor and signed-lease retained-read protocol that this RFC does not integrate.

   Encryption-at-rest Q4 does not address whether retained bytes may be rendered under current authority.

   **Resolution:** Either restrict delta resume to authority-independent/public queries, or explicitly amend LLP 0011/0053 through their own review process with a new proof that safely authorizes retained presentation and incremental release. Integrate the existing authority descriptor, authorization lease, quarantine, expiry, user-switch wipe, and fresh-reauthorization behavior. A per-identity storage key alone is not sufficient.

3. **Major — A bare numeric version is unsafe across reset or stream replacement.**

   Channel B mentions app/schema identity (§D3, lines 173–175), but the primitive and wire addition carry only `version` (§D1, lines 116–135). Local reset clears the journal and resets the commit counter to zero. A client retaining version 10 can therefore reconnect after reset to a new stream whose head is lower or later reaches 10. Active clients may receive `ResyncRequired`, but an offline client will not.

   Schema identity is also not necessarily a reset identity: an app can reset and reload the same schema.

   **Resolution:** Define a first-class cursor namespace, such as `{storageIncarnation, version}`, with reset/restore/replacement rotating the incarnation. Specify rejection of future, unknown, and mismatched cursors. Bind resume state additionally to app identity, query artifact identity, canonical arguments, and the applicable authority partition.

4. **Major — The shared-commit bundle guarantee has no executable cross-target mechanism yet.**

   D1 promises that a set of queries is evaluated at one consistent commit (§D1, lines 136–141), while Q5 leaves open whether the local arm can do so (§Open questions, lines 245–248). This is foundational to Channels A and C. Executing multiple arbitrary handlers sequentially does not by itself prove one read snapshot, particularly across asynchronous host calls, permission reads, errors, or a concurrent mutation.

   Bundle failure and admission semantics are also absent: atomic failure versus partial results, maximum query count, duplicate queries, maximum rows/bytes, time budget, and whether callers may submit arbitrary `(function, args)` sets.

   **Resolution:** Resolve Q5 before acceptance. Specify one pinned read transaction or equivalent coordinator cut across all query evaluations and authorization checks, plus deterministic whole-bundle or per-entry error semantics. Add hard query-count, execution, row, and byte limits. Test a mutation racing between bundle queries on both local and Cloudflare arms.

5. **Major — Authenticated HTML inlining lacks a navigation credential and safe embedding contract.**

   The RFC says the gateway evaluates under the requester’s identity and emits per-identity HTML (§D2, lines 149–169). Snapback’s current sessions routes use bearer/session and connection authority; a top-level browser navigation to a static asset does not automatically carry a JavaScript-held bearer. The gateway currently forwards API routes and otherwise calls `env.ASSETS.fetch`.

   Raw JSON in `<script type="application/json">` is also unsafe unless HTML-significant sequences are escaped: attacker-controlled row data containing `</script>` can terminate the script element despite its MIME type. Cache isolation needs more than “uncacheable”: authenticated bytes must never enter shared caches or be reused across identities.

   **Resolution:** Either scope Channel A initially to anonymous/public manifests or define the server-authenticated navigation credential model. Specify a safe serializer that escapes `<`, script terminators, and relevant Unicode separators; CSP behavior; response-size limits; `Cache-Control: private, no-store`; and identity-isolation tests through CDN/browser-cache paths. Include an adversarial `</script>` row fixture.

6. **Moderate — The proposed React boot seam is inaccurately described.**

   The RFC calls `getServerSnapshot` a stub and proposes replacing it with the embedded feed (§Motivation, lines 49–56; §D2, lines 152–155). The store already supports `initialRows`, and `getServerSnapshot()` returns its current snapshot. More importantly, the demo uses `createRoot`, not `hydrateRoot`; `useSyncExternalStore`’s server snapshot function is not the primary client-only preload mechanism. Updating only `getServerSnapshot` would not hydrate the store before the first client render or propagate the resume cursor.

   **Resolution:** Define an explicit registry preload API keyed by the existing canonical external-store identity, including rows, version/cursor, authority partition, and freshness state. Populate it before `createRoot`. Reserve `getServerSnapshot` for actual SSR/hydration and test Strict Mode, same-key sharing, authority rotation, and stale preload disposal.

7. **Moderate — `health()` and `ensureApp()` cannot simply be piggybacked under ordinary requester authority.**

   Lines 155–156 promise that both results piggyback on the HTML response. Under LLP 0031, compare-only app attestation and provisioning are distinct: provisioning requires privileged startup/admin authority. The demo’s current `ensureApp({schema})` boot behavior is a development workflow, not an operation that authenticated page serving should silently perform.

   **Resolution:** Separate production and development boot. A deployed gateway may embed public build/instance attestation facts or rely on deploy-time provisioning, but it must not provision from an ordinary page request. State which existing health/attestation facts the client can omit after a trusted response and how mismatch/refusal is surfaced.

8. **Moderate — Cloudflare and dynamic-code characterizations need narrowing.**

   The gateway does not “read query results synchronously”; it forwards requests to the coordinator (§D2, lines 163–166). The current arm is deploy-time compiled, as LLP 0076 records, but LLP 0083 explicitly says the platform-wide “Workers forbid dynamic evaluation” fact is stale because Worker Loader and Durable Object Facets now exist.

   **Resolution:** State that the current selected Snapback Cloudflare profile is deploy-time compiled and that snapshot evaluation occurs in the coordinator under its serialization mechanism. Treat manifest delivery under future loader/facet profiles as a separate topology question rather than a platform prohibition.

9. **Moderate — The scalability claims are too absolute.**

   Channel A is described as “strictly cheaper” (§Scalability notes, lines 217–220). It performs application queries for bots, abandoned navigations, disabled-JavaScript visits, and users who never subscribe; authenticated HTML also sacrifices static shared-cache hits. Catch-up replay can be more expensive than a fresh query after a long or high-write gap. Channel B only shifts load if replay is admitted and cheaper than replacement.

   **Resolution:** Replace “strictly cheaper” with a conditional hypothesis and define measurement gates: page-query CPU, HTML/bundle bytes, static-cache hit loss, journal read cost, replay-op count, bounce traffic, resume-hit rate, and a server-selected replay-versus-replace threshold.

10. **Moderate — The rollout omits prerequisites needed by its own later steps.**

    The rollout starts protocol and endpoint work while the cursor shape, manifest format, authorization rules, consistency mechanism, and replay membership model remain unresolved (§Rollout sketch, lines 254–266). It also expects “wire shows only deltas” without limiting the fixture to DK-3-eligible queries.

    **Resolution:** Add prerequisite decisions and schemas before implementation: cursor/incarnation contract; replay eligibility and algorithm; auth disposition; manifest artifact schema and freshness binding; endpoint route-policy entry; bundle transaction and limits; safe HTML serialization. Expand acceptance to include concurrent snapshot/subscribe writes, replay below retention, reset/version reuse, auth revocation while offline, replace-only queries, corrupt persisted state, cache isolation, and malicious embedded JSON.

## 5. Suggestions (non-blocking)

- Name the durable object a “resume token” or structured cursor rather than equating it with the numeric commit version.
- Prefer Channel C requests that name a deployed manifest entry plus validated route parameters over accepting arbitrary query arrays.
- Define canonical query identity using the generated function artifact ID, canonical args, authority partition, and deployment/schema identity; a function name alone is too weak across deployments.
- Specify whether a bundle is consumed once, retained, or merged with a newer persisted snapshot when both Channels A and B are available.
- Treat the push-carried-delta idea as a separate follow-on. Unreliable delivery, payload limits, credential binding, ordering, and sensitive-data exposure are additional protocol concerns.
- Preserve the prior-art table’s provenance per row and soften “none” or “every neighboring system” to “none found in this dated survey.” I did not verify those claims externally.
- Include route matching, `basePath`, SPA fallback, encoded path parameters, and manifest freshness in Channel A acceptance.
- Record observability requirements: resume attempted/admitted/refused, refusal reason, journal distance, replacement bytes avoided, and first-useful-paint timing.

## 6. Open questions for the author

1. Is resumability intended only for DK-3-eligible unordered queries, or is the RFC committing to a new replay mechanism for ordered, limited, opaque, and handler-defined queries?
2. What state tells the server which rows the client held at `resumeFromVersion`: a durable client-view record, a signed server token, client-supplied membership, or something else?
3. Is the author proposing to amend LLP 0011/0053’s unconditional fresh-snapshot rule for non-live auth-scoped resume? If not, which channels and query classes remain resumable?
4. What event rotates the cursor namespace: reset, restore, schema activation, handler deployment, authorization-program deployment, or all of them?
5. How does a normal browser navigation authenticate an identity-scoped inline boot response without exposing a bearer in the URL or giving static asset serving ambient authority?
6. Must all bundle entries succeed atomically, or may a bundle contain per-query failures alongside successful snapshots?
7. Does the manifest authorize only preload selection, or does its presence also attest that each query is resumable, bounded, safe to inline, and compatible with anonymous caching?
8. On a replay miss, is a fresh `LiveReplace` semantically acceptable for every client state, including optimistic layers and an already-rendered retained snapshot?

## 7. Verdict

NOT READY

The central resume protocol is under-specified and currently conflicts with the repository’s ratified authorization and version-lifetime contracts.

## Round 2 — 2026-07-24

**Revision under review:** `llp/0090-resumable-query-snapshots.rfc.md` v0.1, sha256 `2d9316c58993e7959e1d1e914e1261965711139d1eb811013bbc2ce9211df39c` (untracked working-tree file at HEAD `4d2f02e4`; both MATCH per the reviewer's own revision check).
**Runtime detail:** 214,028 tokens used; fresh context, no access to round 1 or llp/reviews/.
**Verdict:** NOT READY

### Review body (verbatim)

## 1. Revision check

- Document SHA-256: `2d9316c58993e7959e1d1e914e1261965711139d1eb811013bbc2ce9211df39c` — **MATCH**
- Repository HEAD: `4d2f02e4` — **MATCH**
- Reviewed the untracked on-disk document at the pinned revision.

## 2. Overall assessment

This is a substantially improved and well-grounded RFC. Its descriptions of DK-3 eligibility, auth-scoped non-live resumption, offline-outbox ordering, schema-governed wire changes, route classification, production-web requirements, Cloudflare deployment topology, and prior Snapback research are broadly accurate. In particular, it correctly respects LLP 0053 instead of treating equal authorization epochs as resume proof, and it accurately treats delta replay as an optimization rather than a prerequisite for useful preload channels.

Repository inspection confirmed the current bare-shell boot, `health()`/`ensureApp()` waterfall, external-store initialization from empty rows, fresh `subscribe_live` reconnect behavior, Cloudflare asset fallback, durable commit versions, post-image journal, pruning floor, and DK-3 restrictions. The cited descriptions of LLPs 0008, 0011, 0022, 0031, 0034, 0043, 0051, 0053, 0063, 0076, 0082, and 0083 are generally consistent with those documents.

However, several correctness and security contracts remain underspecified. Most importantly, the resume token does not bind the retained snapshot’s content, the `CurrentAsOf` handoff lacks an explicit atomic registration rule, authenticated Channel C conflicts with the v1 prohibition on auth-scoped resume, and the required HTML escaping is accidentally specified as a no-op.

I did not externally verify the competitive prior-art table. Its dated-survey qualification and explicit uncertainty labels are appropriate, and it is internally consistent with LLPs 0022, 0082, and 0083.

## 3. Strengths (cite sections and line numbers)

- The authorization scope is unusually clear: v1 resume is limited to explicitly authority-independent queries, while auth-scoped retained display remains under LLP 0043/0053 leases and fences (§Authorization scope, lines 44–66). This accurately preserves LLP 0053’s mandatory fresh snapshot for every non-live auth-scoped resume.
- The token recognizes both deployment and storage ABA hazards through `generation` and `incarnation`, rather than treating a bare commit version as globally meaningful (§D1, lines 153–177).
- Bundle semantics specify a single commit cut, atomic failure, resource limits, and caller-derived authority (§D1.2, lines 199–214). These are the right prerequisites for a coherent multi-query bootstrap.
- The replay ladder is honest about current capabilities: DK-3 covers only a constrained unordered subset, post-images cannot reconstruct prior membership, and replacement remains the universal fallback (§D1.3, lines 216–243).
- The manifest is selection authority rather than data authority, and its argument mapping is constrained rather than arbitrary server-side view execution (§D1.4, lines 245–254).
- The client integration correctly identifies a preload registry keyed by external-store identity—not `getServerSnapshot()`—as the present client-only rendering seam (§D2, lines 272–277).
- The Cloudflare/local handshake distinction is accurate: deployed Workerd instances can attest their compiled identity, while local development must retain client-driven provisioning (§D2, lines 279–287).
- The outbox rule correctly preserves LLP 0043’s full-resync-before-replay milestone and defers resume-with-pending-mutations (§D3, lines 315–320).
- Scalability statements are framed as measurable hypotheses with explicit counters and gates rather than guarantees (§Scalability, lines 366–387).
- The rollout includes adversarial serialization, corruption, reset-incarnation, auth leakage, outbox, and handoff-race cases (§Rollout sketch, lines 418–447).

## 4. Concerns (numbered; each with severity Major/Moderate/Minor and a concrete resolution that would clear it)

1. **Major — The token does not bind the snapshot it purports to resume.**  
   The token contains app/generation/incarnation/version but no canonical query identity or snapshot-content commitment (§D1, lines 153–177). Yet Channel B treats persisted state as untrusted (§D3, lines 328–329), and rung 1 may return no rows (§D1.3, lines 226–230). A structurally valid but corrupted snapshot can therefore be rendered and permanently ratified by `CurrentAsOf`. Comparing only versions when Channels A and B collide has the same problem (§D3, lines 331–332).  
   **Resolution:** Define a server-authenticated token that binds the exact query artifact, canonical arguments, snapshot version, and a canonical snapshot or membership/content digest. Require clients to verify that binding before render or resume. Specify canonicalization, signing/MAC key rotation, token expiry/size, and failure-to-fresh-subscribe behavior.

2. **Major — Rung 1 lacks an atomic proof-to-registration handoff.**  
   Atomic replay/register/tail behavior is stated only for rung 2 (§D1.3, lines 231–236). A commit between an unchanged proof and live registration can be missed exactly as easily as a commit between replay and registration.  
   **Resolution:** Require all three rungs to establish their response and live registration under one arm-specific serialization cut. Specify the exact `CurrentAsOf` response shape, subscription identity, acknowledged head version, how the client advances its cursor without replacing rows, and a race test pausing before and after proof, registration, and response publication.

3. **Major — Authenticated Channel C has no coherent transition into live state under the stated v1 rules.**  
   V1 forbids `resumeFromToken` for auth-scoped queries and requires a fresh snapshot on every non-live resume (§Authorization scope, lines 53–61). Nevertheless, authenticated web boot is described as fetching a bundle and then replacing N subscriptions/handshakes (§D2, lines 289–297; §D4, lines 334–345). Ordinary live subscriptions must still be created, and under the stated rule each must fresh-snapshot again. That produces duplicate query work and leaves the no-stale-flash/no-duplicate-subscription seam required by LLP 0063 undefined.  
   **Resolution:** Define authenticated Channel C as an atomic fresh-snapshot-plus-multi-subscribe operation that returns registered subscription IDs and the complete LLP 0053 authorization scope/invalidation projections. Alternatively, explicitly accept subsequent duplicate fresh snapshots and narrow the claimed benefit, but then authenticated Channel C cannot claim to replace the per-query subscription work.

4. **Major — The mandatory HTML escaping rule currently specifies no escaping.**  
   The RFC says to escape “`<` as `<`” (§D2, lines 265–270), which is a byte-for-byte no-op and leaves the documented `</script>` injection viable.  
   **Resolution:** State the actual encoding, for example replacing every literal `<` with `\u003c` in serialized JSON, plus the chosen U+2028/U+2029 treatment. Pin exact serialized bytes for `</script>`, mixed case, escaped-slash, comment-opening, and Unicode payload fixtures.

5. **Moderate — The proposal does not reconcile the existing schema-governed `/live/{name}/resume` operation.**  
   The repository already exposes `POST /live/{name}/resume`, whose input resumes a server-retained subscription by `subscription_id`; it is distinct from the new cursor-based resume. D1.1 instead adds `resumeFromToken` to subscribe and describes the current client’s fresh-subscribe path (§D1.1, lines 187–197), without defining coexistence, naming, or migration.  
   **Resolution:** Add a protocol-relationship subsection choosing whether the existing operation remains “resume retained server subscription,” is renamed/deprecated, or absorbs the new semantics. Include both request/response schemas and client dispatch behavior in the LLP 0051 drift gates.

6. **Moderate — `generation` is ambiguous between schema identity, function-manifest identity, and executable deployment identity.**  
   The RFC calls it a “schema/deploy generation” and then equates it with functions-manifest identity (§D1, lines 162–177). Query behavior can change without a schema change, and safe resume requires invalidation whenever executable query semantics, relevant configuration, or generated authorization declarations change.  
   **Resolution:** Define the exact digest tuple—at minimum executable bundle/deployment identity plus schema and function artifact identity—and enumerate every rotation event. Use the same tuple in tokens, embedded attestation, bundle responses, and admission.

7. **Moderate — “Unchanged proof for all query classes” is too broad without a certified dependency requirement.**  
   Rung 1 claims savings for all query classes (§D1.3, lines 226–230), but opaque queries and incomplete/unknown dependency summaries cannot safely prove that no change could affect the result. LLP 0008 requires unknown dependencies to fall back conservatively.  
   **Resolution:** Restrict rung 1 to queries with a complete, server-certified dependency/table summary. Unknown, incomplete, dynamically unresolved, or unrecognized summaries must take rung 3. Add a negative acceptance fixture where an opaque query’s undeclared dependency changes.

8. **Moderate — The rollout ordering and acceptance criteria contradict the staged ladder.**  
   Step 0 requires the replay algorithm before the rollout that deliberately postpones rung 2; step 5 expects `CurrentAsOf`/deltas even though rung 2 lands only in step 6 (§Rollout sketch, lines 420–445). Also, `cursors-web` is primarily an ephemeral-room demo and is not presently a durable live-query snapshot proof (§Rollout sketch, lines 430–434).  
   **Resolution:** Move rung-2 algorithm/membership decisions to the rung-2 prerequisite, make step 5 expect only `CurrentAsOf` or replacement, and add delta-resume acceptance after step 6. Use `graffiti` or another demo with an actual durable live query unless `cursors-web` first gains one.

9. **Moderate — Resume request resource controls are incomplete.**  
   Bundle limits are required (§D1.2, lines 211–214), but resume admission can also force journal scans and accept held-membership material. Q7 calls the membership representation bounded without specifying enforceable limits (§Open questions, lines 408–412).  
   **Resolution:** Put maximum token bytes, membership keys/digest bytes, journal distance, replay CPU/time, and per-authority resume rate into the step-0 endpoint contract, with replacement or coded refusal behavior at every limit.

10. **Minor — The authorization wire terminology is inaccurate.**  
    `AuthorizationInvalidationSnapshot` is a nested snapshot structure, not an invalidation frame or independent semantic. The actual envelope is `LiveEnvelope::AuthorizationInvalidation`, carrying an obligation and optional resolution/snapshot (§Motivation, lines 100–102; §D1, lines 179–180).  
    **Resolution:** Refer to `AuthorizationInvalidation` as the level-triggered invalidation frame and to `AuthorizationInvalidationSnapshot` only as its optional snapshot payload.

## 5. Suggestions (non-blocking)

- Specify Channel A’s response mechanics around `Content-Length`, `ETag`, compression, CSP, SPA fallback, and cache headers when transforming `env.ASSETS.fetch()` output.
- Distinguish “resume token,” “database cursor,” “subscription ID,” and the existing server-retained resume operation consistently; “cursor token” may be clearer for the new primitive.
- Add a compact protocol state table covering preload source, initial rows, subscribe request, possible server answer, client cursor update, and resulting connection state.
- State whether a manifest entry is versioned with the deployment and whether route matching happens before or after `basePath`/SPA normalization.
- Preserve the prior-art section’s dated-survey and uncertainty language. Since I did not verify those external claims, it should not be strengthened without a fresh primary-source pass.
- When implementation begins, update the relevant demo diary and run the required guide/LLP reference checks alongside the protocol-schema gates.

## 6. Open questions for the author

- Is authenticated Channel C intended to create live subscriptions as part of the bundle request, or is the duplicate fresh-subscribe cost intentional?
- Is the resume token meant to be opaque/authenticated, or does “structured” mean caller-editable JSON? What prevents valid-looking persisted corruption from being ratified by `CurrentAsOf`?
- Does `generation` include the executable bundle hash and relevant configuration, or only schema/function-manifest structure?
- Is `CurrentAsOf` an HTTP subscribe response mode, a durable `LiveEnvelope`, or both? What exact version and subscription identity does it carry?
- Which existing proof certifies a query’s dependency set as complete enough for rung 1?
- How will the new subscribe-from-token operation coexist with the existing `/live/{name}/resume` route and its clients?
- If Q7 chooses a digest or sketch rather than raw row keys, what source reconstructs prior membership sufficiently to emit exact removes without server-held CVR state?
- What is the canonical snapshot serialization used for content binding across Rust, JavaScript, IndexedDB, and native stores?

## 7. Verdict

NOT READY

The primitive is promising and well aligned with the governing LLPs, but the snapshot-integrity, atomic unchanged-handoff, authenticated Channel C, and HTML-injection contracts require resolution before implementation.

## Round 3 — 2026-07-24

**Revision under review:** `llp/0090-resumable-query-snapshots.rfc.md` v0.2, sha256 `81ea647eab3d9eb1db17ac68889de46e4870ead078de15423cd9541fd24ae51f` (untracked working-tree file at HEAD `4d2f02e4`; both MATCH per the reviewer's own revision check).
**Runtime detail:** 183,904 tokens used; fresh context, no access to prior rounds or llp/reviews/.
**Verdict:** NOT READY

### Review body (verbatim)

## 1. Revision check

- Document SHA-256: `81ea647eab3d9eb1db17ac68889de46e4870ead078de15423cd9541fd24ae51f` — **MATCH**
- Repository HEAD: `4d2f02e4` — **MATCH**
- The document is an untracked working-tree file, as expected.
- Reviewed revision: v0.2, dated 2026-07-24.

## 2. Overall assessment

The RFC identifies a valuable primitive and is unusually candid about the limits of the existing delta machinery. Its repository characterizations are generally accurate:

- `src/live_wire.rs` defines `LiveReplace`, `LiveDelta`, `AuthorizationInvalidation`, and `ResyncRequired`; durable snapshots and deltas carry global commit versions, while receipts expose `snapshotVersion`.
- The React adapter defaults to empty rows, while the external store accepts `initialRows` but has no preload registry or SSR pipeline.
- The cursors React surface performs `health()` and `ensureApp()` before mounting.
- The Cloudflare gateway serves assets through `env.ASSETS.fetch`, while app-data requests go to the coordinator Durable Object.
- LLP 0008’s DK-3 limitations, LLP 0043’s full-resync-before-outbox-replay rule, LLP 0053’s mandatory fresh snapshot for auth-scoped non-live resume, LLP 0051’s schema governance, LLP 0031’s route taxonomy, LLP 0063’s hydration requirements, and LLP 0083’s Worker Loader/Facet correction are represented substantially correctly.

The design is nevertheless not ready. Three load-bearing protocol boundaries remain underspecified: how resume tokens advance with live state, what makes a query safe for public inline delivery, and how register-mode bundles acquire and retain connection ownership under retries and response loss. These are not implementation details; the current text cannot satisfy its own integrity, cursor-advancement, and authenticated single-request claims without resolving them.

I did not externally verify the competitive prior-art table. Internally, its claims are appropriately dated and hedged and are broadly consistent with LLPs 0022, 0082, and 0083.

## 3. Strengths (cite sections and line numbers)

- The authorization boundary is explicit and conservative. The RFC correctly limits token resume to LLP 0053’s declared `authorityIndependent` functions and preserves mandatory fresh snapshots and lease-controlled display for auth-scoped data (§Authorization scope, lines 45–75). This avoids contradicting one of the repository’s strongest existing security decisions.

- The RFC accurately distinguishes retained-subscription reattachment from token-based reconstruction (§D1, lines 215–224). The existing `POST /live/{name}/resume` is indeed subscription-id based, contains no version cursor, and is not delta replay.

- The admission ladder is honest about DK-3. It limits replay to analyzable unordered queries, recognizes the prior-membership problem, retains `LiveReplace` as the universal fallback, and makes rung 2 optional rather than blocking initial value (§D1.3, lines 270–312). This matches LLP 0008’s actual single-table HostPlan eligibility and fail-closed exclusions for ordered, limited, opaque, and membership-gated queries.

- The all-rungs serialization-cut rule is a strong consistency invariant (§D1.3, lines 283–287). Requiring race tests around proof, registration, and publication is the right standard.

- Bundle consistency is treated as a prerequisite rather than assumed (§D1.2, lines 242–268). The single-commit requirement, atomic query failure, bounded resource contract, and local pinned-read prerequisite make the proposed advantage over independent preloads technically meaningful.

- The client boot-seam analysis is accurate (§Motivation, lines 81–95; §D2, lines 353–370). In particular, the RFC correctly avoids treating `getServerSnapshot` as the seam for today’s client-only `createRoot` path.

- The HTML embedding discussion recognizes a real parser boundary and requires byte-pinned adversarial fixtures (§D2, lines 342–351). Calling out `</script>`, comments, and Unicode separators is materially better than relying on MIME type.

- Channel B preserves LLP 0043’s pending-outbox boundary (§D3, lines 398–403) and explicitly covers corruption, reset incarnation, multi-tab ownership, auth invalidation, and user-switch cleanup (§D3, lines 405–425).

- Scalability claims are framed as hypotheses with measurement gates rather than guarantees (§Scalability, lines 463–490). The deploy invalidation cost, journal-retention tradeoff, and replay-versus-replace choice are all surfaced.

- The rollout is staged so that rungs 1 and 3 can deliver product value before membership replay (§Rollout sketch, lines 522–574). Naming graffiti instead of the ephemeral cursors demo corrects an important applicability error.

## 4. Concerns (numbered; each with severity Major/Moderate/Minor and a concrete resolution that would clear it)

1. **Major — The token cannot advance with the state it authenticates.**

   The token binds `version` and `contentDigest`, is opaque and server-MACed, and may not be edited by the client (§D1, lines 164–202). Yet `CurrentAsOf` carries only a subscription id and head version while claiming the client advances its token (§D1.3, lines 291–301), and replay consists only of existing `LiveDelta` frames (§D1.3, lines 302–304). Ordinary subsequent `LiveReplace` and `LiveDelta` deliveries likewise contain no replacement token.

   Consequently, after any live update the stored rows no longer match the original token’s digest. Persisting the new rows makes the required digest check fail; retaining the old rows and token defeats “last snapshot” persistence and the claimed cursor advancement. A `CurrentAsOf` version in clear metadata cannot update the MACed version. The phrase “one shared resume token set” also conflicts with a token body that binds exactly one `queryArtifact`, `argsHash`, and `contentDigest` (§D1.2, lines 244–248).

   **Resolution:** Specify a complete token-renewal protocol. Every response that changes rows or advances the resumable cursor—initial snapshot, `CurrentAsOf`, replay completion, live delta, and live replace—must deliver a newly server-authenticated per-query token or an equivalent authenticated checkpoint. Define how rows, digest, and token commit atomically in the client store; how interrupted delta sequences fall back; and how bundle responses map per-query snapshots to per-query tokens. State explicitly that auth-scoped register-mode entries receive registration state but no v1 resumable token. Add acceptance covering relaunch after live deltas, `CurrentAsOf`, interrupted replay, and token persistence failure.

2. **Major — `authorityIndependent` does not establish public/anonymous inline eligibility.**

   Channel A is described as anonymous/public-only, but its concrete admission rule rechecks only `authorityIndependent` (§Authorization scope, lines 54–64; §D1.4, lines 314–326). LLP 0053 defines that declaration as an assertion that results are invariant across caller-authority dimensions; it explicitly says the property is not inferred from anonymous invocation. It does not declare a function publicly invocable or its rows safe for a tokenless HTML response.

   LLP 0031 separately classifies live-query rows as caller-scoped application data and rejects a public/tokenless route that emits raw app-derived data. The current gateway also has no anonymous query-read authority merely because it is serving an asset. This creates a security gap between “same for every authorized caller” and “safe for every unauthenticated visitor and CDN.”

   **Resolution:** Add a separate, fail-closed public-preload declaration or route capability, with explicit anonymous invocation authority and response-sensitivity classification. Channel A admission must require both authority independence and public-inline eligibility. Specify how the gateway obtains anonymous invocation authority, whether function-level checks are permitted, and what cache-control/logging rules apply. Add negative acceptance fixtures for an authority-independent but authenticated-only query and for sensitive app data accidentally placed in a public manifest.

3. **Major — Register-mode bundles lack a connection-ownership and ambiguous-delivery contract.**

   Register mode creates subscriptions at the bundle cut and returns ids for later socket attachment (§D1.2, lines 262–268); authenticated web boot is then described as one bearer-authenticated bundle request with no second snapshot (§D4, lines 431–435). Existing live subscriptions, however, are bound to a connection id, connection grant, exact effect fence, and stream lifecycle. The RFC does not say whether the bundle request consumes an existing connection, atomically opens one, or creates unattached subscriptions under some new temporary owner.

   It also lacks response-loss semantics. If the server commits N registrations and the HTTP response is lost, retrying can create duplicate subscriptions and stranded server state. Atomicity across queries does not solve ambiguous publication, attach failure, or client abandonment.

   **Resolution:** Define the exact handshake and ownership model. Either require a pre-opened connection and acknowledge the extra round trip, or make register mode atomically mint the connection/grant and registrations under the existing custody rules. Add an idempotency key bound to authority, generation, manifest entry, and canonical args; retries must return the same registration set or atomically supersede it. Specify attachment deadlines, reaping, partial-attach behavior, sender-nonce/custody integration, and cleanup after lost responses. Add acceptance for lost response, duplicate retry, socket failure before attach, partial client installation, and authority transition during bundle evaluation.

4. **Moderate — The new `incarnation` axis is not reconciled precisely with the existing data `versionStream`.**

   The token introduces a “storage-incarnation nonce” and associates it with LLP 0053 (§D1, lines 183–188). LLP 0053’s incarnation is specifically an authorization-stream identity, while LLPs 0043 and 0053 already use a distinct opaque data `versionStream` alongside database and target identity. LLP 0043 explicitly rejects bare version numbers and requires the retained identity tuple.

   **Resolution:** Reuse the existing `versionStream` term and authority unless this RFC deliberately creates a new identity. If it is new, provide a crosswalk showing its relationship to `databaseId`, `versionStreamId`, authorization incarnation, reset/import/restore events, and target-profile identity. The Channel B stored tuple and admission tests should consume the existing DK-9/0043 identities rather than silently replacing them.

5. **Moderate — The table-set unchanged proof does not explicitly require complete journal coverage.**

   Rung 1 permits “no journal rows for the query’s read set” as proof (§D1.3, lines 295–301). Absence is proof only if every commit from the token version through head is represented or otherwise accounted for. A pruned journal can make “no rows found” indistinguishable from “history missing.” Rung 3 mentions floor misses later, but the proof obligation itself should be closed.

   **Resolution:** State that table-set proof requires `fromVersion` to be at or above the journal’s monotonic retained floor and requires a certified complete dependency summary for the token’s exact generation. Unknown coverage, pruned coverage, dependency-summary drift, or journal-read failure must select rung 3. Add boundary tests at `floor - 1`, `floor`, and concurrent pruning.

6. **Moderate — “Membership digest” overstates what a digest or sketch can reconstruct.**

   Rung 2 must emit exact removals for rows the client previously held (§D1.3, lines 272–281), but Q7 treats raw key sets, digests, and sketches as candidate formats (§Open questions, lines 511–516). A conventional digest cannot identify prior members, and an approximate sketch cannot safely produce exact removals without a reconciliation protocol.

   **Resolution:** Define the required semantic as an exact, bounded recoverable membership witness. If sketches or reconciliation structures remain candidates, specify that uncertainty or decode failure falls back to rung 3 and can never suppress a required removal. Rename “digest” where exact membership is required, and add adversarial collision/ambiguity tests.

7. **Moderate — The clear metadata does not provide the claimed pre-render integrity against coherent local tampering.**

   The client verifies rows against a clear `meta.contentDigest`, while only the server trusts the MACed body (§D1, lines 168–202). A corrupt writer that changes both persisted rows and clear metadata can pass the client check and render before server admission. This mechanism detects accidental or partial corruption; it is not a cryptographic client-side authenticity proof.

   **Resolution:** State the threat model precisely and narrow the claim to accidental/post-commit corruption detection plus server-side ratification prevention. If malicious local-store tampering must be prevented before render, add a client-verifiable trust anchor, such as a platform-protected key or trusted-store binding, and specify its lifecycle. Align the wording with LLP 0043’s explicit client/server verification-locus distinction.

8. **Moderate — The HTML serializer rule is too narrow if applied only to string values.**

   The serializer requires escaping literal `<` in “string values” (§D2, lines 342–351). JSON property names are strings too and can occur inside application-provided nested objects. A safe implementation should transform the completed JSON serialization or otherwise cover every JSON string token, not only values.

   **Resolution:** Require escaping every literal HTML-significant code point in the complete serialized JSON text, including object keys, and prohibit post-serialization transformations that can reintroduce them. Add fixtures with malicious property names and nested objects. Also remove the duplicated “fixtures for fixtures” wording at line 349.

9. **Moderate — The existing reattach route is characterized as universally available when its target coverage and schema status differ.**

   The local router exposes `POST /live/{name}/resume`, and its input/output schemas are already exported and drift-gated. Therefore lines 215–224 are correct about its semantics but inaccurate in saying step 0 will add those existing schemas to the drift gates. Separately, `cloudflare/src/gateway.js` forwards only `subscribe|unsubscribe` under its live POST regex; it does not expose the reattach route.

   **Resolution:** Correct the schema-history statement, describe the route as currently local-arm only unless coordinator/gateway evidence shows otherwise, and add the Cloudflare forwarding decision and acceptance test to the coexistence work. Distinguish modifications to the existing governed schemas from introduction of new token-resume schemas.

10. **Minor — Generation rotation is stated inconsistently.**

    D1 says generation rotates on deployments that can change query semantics (§D1, lines 176–182), while Scalability says every deploy rotates it (§Scalability, lines 474–480).

    **Resolution:** Choose one rule. Prefer an explicit digest of resume-relevant artifacts/configuration whose identity changes exactly when any bound component changes, and make the measurement language match it.

## 5. Suggestions (non-blocking)

- Specify whether resumed or persisted rows are exposed with a stale/retained status until `CurrentAsOf` or another authoritative answer arrives. LLP 0043 already requires this distinction for retained data.

- Give the bundle endpoint a provisional method, path, request envelope, and response skeleton. Step 0 can finalize details, but a concrete shape would expose collisions among manifest identity, connection identity, bundle mode, and per-query tokens earlier.

- Separate performance metrics for “first rows visible,” “rows proved current,” and “live registration attached.” Channel B can improve the first while regressing the latter two.

- Record per-rung refusal codes separately from generic limits so observability can distinguish stale generation, journal-floor miss, non-analyzable query, invalid membership witness, resource budget, and server policy choosing replacement.

- Add a deployment-skew test for a new gateway Worker talking briefly to an older coordinator Durable Object, as LLP 0083 specifically warns about this condition.

- Consider renaming `CurrentAsOf` to a wire-style name such as `live_current_as_of` in the schema while retaining `CurrentAsOf` as the Rust variant.

## 6. Open questions for the author

1. Is public inline eligibility intended to be a new function declaration, a route-manifest declaration, or a combination of both? What prevents a manifest author from exposing an authority-independent but confidential query?

2. Does Channel C register mode include connection opening and grant minting, or must a connection already exist? If it includes opening, how does it compose with sender-constrained browser custody and the first in-band nonce?

3. Is the intended resumable checkpoint renewed on every live delivery, only at explicit persistence points, or on demand before suspension? Which component mints it, and what is persisted atomically?

4. Is `incarnation` intended to be the existing data `versionStream`, the LLP 0053 authorization incarnation, or a third identity? Which existing authority owns its rotation rules?

5. For rung 2, is an exact client key set acceptable as the v1 format, or is the author requiring a compressed reconciliation structure? What false-positive or ambiguity behavior is permitted?

6. When a Channel A page is assembled at commit N but its HTML response is delayed while commits N+1…M occur, is the later subscribe guaranteed to use the token ladder without a visible stale-state classification, or should the preload registry initially mark the rows retained/stale?

7. For socket-less authenticated surfaces, what credential and secure-storage profile is assumed, and which existing client/store authority owns it?

## 7. Verdict

NOT READY

Three Major concerns remain: resumable tokens cannot currently advance with live state, Channel A lacks a distinct public-delivery authority, and register-mode bundles lack an executable connection-ownership and retry contract.

## Round 4 — 2026-07-24

**Revision under review:** `llp/0090-resumable-query-snapshots.rfc.md` v0.3, sha256 `18b934e0e404485e4b94c6a3ce96d404492a898cc384e8dd5568b66095cd10cc` (untracked working-tree file at HEAD `4d2f02e4`; both MATCH per the reviewer's own revision check).
**Runtime detail:** 240,671 tokens used; fresh context, no access to prior rounds or llp/reviews/.
**Verdict:** NOT READY

### Review body (verbatim)

## 1. Revision check

- Document SHA-256: `18b934e0e404485e4b94c6a3ce96d404492a898cc384e8dd5568b66095cd10cc` — **MATCH**
- Repository HEAD: `4d2f02e4` — **MATCH**
- Reviewed the untracked working-tree document at the pinned revision.
- I did not read anything under `llp/reviews/` or any credential file.

## 2. Overall assessment

This is a thoughtful, substantially repository-grounded RFC. Its account of the existing wire protocol, client boot path, Cloudflare gateway, schema drift gates, change-journal floor, DK-3 limits, existing subscription-id reattach route, and auth-scoped fresh-snapshot rule is mostly accurate. Its separation of public inline eligibility from authority independence is particularly important.

The three-channel primitive is coherent, and the fallback-first admission ladder avoids pretending universal delta replay already exists. The security treatment of inline JSON, auth-scoped retained data, bundle limits, atomic registration, and pending freshness is stronger than is typical for a proposal at this stage.

However, two parts of the core protocol remain mechanically incomplete: the proposed membership witness cannot support stateless incremental token refresh from the post-image-only journal, and the multiset digest is unsound for ordered results. In addition, authenticated register-mode boot contradicts the Active LLP 0031 hosted connection-session contract without explicitly amending it. These are design-level issues, not implementation details.

I did not externally verify the competitive prior-art table. Internally, it is appropriately dated and hedged, and its Electric, PowerSync, InstantDB, and Cloudflare characterizations are consistent with LLPs 0022, 0082, and 0083.

## 3. Strengths (cite sections and line numbers)

- **Accurate authorization boundary.** The RFC correctly preserves LLP 0053’s mandatory fresh snapshot for every non-live auth-scoped resume and limits resumable/render-before-resume behavior to declared `authorityIndependent` queries (§Authorization scope, lines 46–90). The distinct `publicInline` gate correctly recognizes that authority independence does not grant anonymous invocation authority (lines 62–77).

- **Repository-grounded motivation.** The description of the static shell, `health()`/`ensureApp()` boot, empty external store, absent preload pipeline, and Cloudflare asset fallback matches the inspected implementation (§The waterfall today, lines 94–116). The inventory of existing versioned envelopes, receipts, journal floor, and missing cursor consumer is also accurate (§Why now, lines 118–131).

- **Correct treatment of the existing `/resume` route.** The RFC accurately distinguishes subscription-id reattachment from the proposed token-based entry, and correctly notes that the existing schemas are exported/drift-gated while Cloudflare currently forwards only `subscribe|unsubscribe` (§Relationship to the existing reattach route, lines 254–268).

- **Honest replay ladder.** The RFC correctly restricts DK-3 replay to analyzable unordered HostPlan queries, acknowledges the prior-membership problem created by the post-image journal, and retains fresh replacement as the universal fallback (§D1.3, lines 341–402). The journal-floor and certified-dependency requirements for a table-set unchanged proof are appropriately fail-closed (lines 362–382).

- **Strong atomicity and resource posture.** Bundle single-commit consistency, atomic failure, hard limits, idempotency, attach grace, and answer-and-register linearization are all explicitly treated (§D1.2, lines 293–339; §D1.3, lines 354–358).

- **Good inline-data security analysis.** The serializer requirements cover keys as well as values and include exact byte-level adversarial fixtures (§D2, lines 434–446). The `no-store` v1 baseline makes the caching posture concrete rather than aspirational (lines 420–432).

- **Executable staging and observability.** Rung 2 is correctly deferred behind its own prerequisite instead of blocking Channels A–C (§D1.3, lines 400–402). The rollout names race, floor, corruption, permission, outbox, multi-tab, and serializer tests, while the scalability section separates first visibility, proved-current state, and live attachment (§Scalability, lines 562–595; §Rollout sketch, lines 629–695).

## 4. Concerns (numbered; each with severity Major/Moderate/Minor and a concrete resolution that would clear it)

1. **Major — The rung-2 witness cannot support the promised stateless, incremental fresh token.**

   The token binds a full-row `contentDigest`, and every replay must end with a fresh token at the new digest (§D1, lines 214–244; §D1.3, lines 383–394). But rung 2 asks the client for only a recoverable witness of row identity. The existing journal provides post-images for inserts/updates and no row body for deletes (`src/storage.rs`, lines 7249–7284; LLP 0053, lines 1574–1578). For an update or removal, a stateless server therefore lacks the old row hash it must subtract from the multiset digest. It also cannot prove that a syntactically valid identity witness corresponds to the MAC-bound snapshot.

   This breaks both the claimed `O(changed rows)` refresh and the server-ratification property. A wrong but well-formed witness can drive an incorrect replay unless the final state is independently checked before being marked authoritative.

   **Resolution:** Make the signed token and witness jointly verifiable. One viable contract is a witness containing exact `(rowId, oldRowHash)` entries whose aggregate must equal a MAC-bound membership/content root before replay. The server can then subtract old hashes and add post-image hashes. Alternatively, retain a server CVR or rerun the query to mint the final digest and state that cost honestly. In every design, require the client to verify the post-replay digest before treating replay completion as authoritative. Add negative tests for omitted, extra, substituted, duplicate, and correct-id/wrong-hash witness entries.

2. **Major — A commutative multiset digest is unsound for ordered query results.**

   `contentDigest` is described both as a digest of canonical snapshot serialization and as a commutative multiset digest (§D1, lines 214–218). A multiset digest cannot distinguish `[A, B]` from `[B, A]`. Yet the global `CurrentAsOf` proof applies to every query class, including ordered/limited queries (§D1.3, lines 362–382), and its arrival advances retained rows to authoritative without touching them (lines 229–244).

   Consequently, a persisted ordered result whose rows are permuted can pass the digest check and then be ratified by `CurrentAsOf`. This is a correctness failure even without a hostile client.

   **Resolution:** Define digest semantics by query shape. Use a sequence-sensitive digest for ordered/limited results and reserve the incrementally maintainable commutative digest for DK-3 unordered results. Since ordered queries already use `LiveReplace`, computing their digest over the full replacement is coherent. Revise the universal incremental-cost claim and add permutation/cursor-window corruption fixtures.

3. **Major — Register mode conflicts with the Active LLP 0031 hosted connection-session contract.**

   Register mode creates subscriptions before socket attachment and says it mints a grant “under the existing custody rules” (§D1.2, lines 322–339). Active LLP 0031 instead requires a current authenticated hosted socket session before an HTTP subscribe can persist demand and states that socketless HTTP cannot arm demand (LLP 0031, lines 792–804). Existing hosted rows are owned by that socket session, not merely by the durable grant.

   The RFC recognizes that today’s subscriptions die with the socket, but attach grace and idempotency do not by themselves define how pending registrations relate to the current-session invariant. This is central to authenticated Channel C, not an optional optimization.

   **Resolution:** Either make an explicit LLP 0031 amendment a prerequisite, defining a bounded pending-registration owner distinct from a socket session and its atomic handoff on attach, or change the protocol to attach/authenticate the socket before the bundle-register transaction. The amendment must cover grant custody, sender-constrained rotation, authority transition, retry after a lost response, overlapping sockets, attach/close races, and Cloudflare persistence/reaping. Acceptance should prove the old “socketless HTTP cannot arm ordinary demand” invariant remains true outside this new closed operation.

4. **Moderate — Authority-neutral server admission does not yet map to the authority-keyed client store.**

   Tokens are intentionally usable across anonymous and authenticated connections (§D1.1, lines 272–285), but Channel A populates a preload registry using the existing external-store identity, which includes authority (§D2, lines 448–455; `packages/snapback-client/external-store.mjs`, lines 93–95). An anonymous inline preload and the same authority-independent query opened after IndexedDB restores an authenticated user will have different current identities and need not meet in the registry.

   **Resolution:** Specify an authority-independent canonical client key or a checked promotion/alias rule for preloads. Add an acceptance case where a logged-in browser consumes an anonymously minted public-inline snapshot without creating an empty parallel store or duplicate subscription.

5. **Moderate — Auth-scoped bundle token behavior and the provisional response shape are inconsistent.**

   The authorization section says register-mode auth-scoped entries carry no resumable token (§Authorization scope, lines 78–85), while read mode is described unconditionally as “snapshots + tokens” (§D1.2, lines 320–321). The provisional response also omits the subscription ids and authorization projections that register mode promises in lines 322–325.

   **Resolution:** Specify a closed per-entry union. For example, authority-independent entries may carry `resume`, while auth-scoped entries carry `resume: null`; register entries additionally carry `subscriptionId`, authorization scope, and invalidation projection. State whether the no-token rule applies in both modes—it should, given v1 admission—and add schema parity fixtures.

6. **Minor — The waterfall paragraph overgeneralizes the cursors demo into a durable `LiveReplace` path.**

   `cursors-web` does prove the `health()` → `ensureApp()` → mount sequence, but its React surface opens an ephemeral room rather than `useSnapbackQuery` or a durable subscription. The RFC later correctly acknowledges this in rollout step 3 (lines 666–668).

   **Resolution:** Split the evidence: cite `cursors-web` for the boot handshake and ephemeral snapshot waterfall, and a durable-query demo such as graffiti for the final subscribe/`LiveReplace` leg.

## 5. Suggestions (non-blocking)

- Split rollout step 0 into named contract artifacts or exit gates. It currently combines token cryptography, canonical encoding, route taxonomy, connection ownership, dependency certification, bundle transactions, serialization, response rewriting, and LLP 0008 reconciliation.

- Give `CurrentAsOf` an explicit client transition table covering digest verification, persistence failure, optimistic layers, duplicate delivery, and lower/equal/higher versions.

- Add property-based cross-language tests for canonical JSON and digest parity, especially numeric edge cases, duplicate rows, Unicode normalization, and object-key ordering.

- Record first-row bytes and token bytes separately in scalability metrics; per-delta MAC/token overhead may dominate very small updates.

- Specify the bare-shell fallback when a route matches a manifest entry that is invalid, over limits, or not `publicInline`, so preload failure does not become page unavailability unless intentionally chosen.

## 6. Open questions for the author

- Is rung 2 intended to transmit old per-row hashes, retain server-side CVR state, or rerun the query to mint its final token? The current identity-only witness supports none of those completely.

- Is `contentDigest` intended to bind ordered presentation state or only unordered membership? If the former, what is the sequence-sensitive construction?

- Should authenticated register mode explicitly amend LLP 0031, or should socket attachment precede registration?

- What canonical client-store authority key should an authority-independent query use when an anonymous inline preload is consumed after authenticated authority restoration?

- Are auth-scoped read-mode bundles intentionally tokenless, and if so, should their response type make the absence mandatory rather than optional?

- Does the generation digest rotate on resume-key changes as well as executable/schema/config changes? If not, how does a client distinguish an expired/retired MAC key from deployment staleness for diagnostics?

## 7. Verdict

NOT READY

The stateless digest/witness mechanics, ordered-result integrity, and pre-attach register ownership contract leave Major correctness and lifecycle issues unresolved.

## Round 5 — 2026-07-24

**Revision under review:** `llp/0090-resumable-query-snapshots.rfc.md` v0.4, sha256 `6cbc60ca02236c7f899755117e322d4a8b3bf7605f0eea26b9599d65ee5c3535` (untracked working-tree file at HEAD `4d2f02e4`; both MATCH per the reviewer's own revision check).
**Runtime detail:** 288,182 tokens used; fresh context, no access to prior rounds or llp/reviews/.
**Verdict:** NOT READY

### Review body (verbatim)

## 1. Revision check

- Document SHA-256: `6cbc60ca02236c7f899755117e322d4a8b3bf7605f0eea26b9599d65ee5c3535` — **MATCH**
- Repository HEAD: `4d2f02e4` — **MATCH**
- The reviewed document is the pinned v0.4 working-tree revision.

## 2. Overall assessment

The RFC presents a coherent unifying primitive and is unusually careful about fallback behavior, authorization boundaries, atomic registration, schema governance, and measurable rollout gates. Its characterization of the current live wire protocol, client boot/subscribe path, cursors-web boot sequence, Cloudflare asset/query routing, existing `/live/{name}/resume` reattach route, and most cited LLP decisions is accurate.

Repository verification confirmed:

- `src/live_wire.rs` has the stated `LiveReplace`, `LiveDelta`, `ResyncRequired`, and `AuthorizationInvalidationSnapshot` shapes, capped version semantics, and `snapshotVersion` receipts.
- The React/external-store path begins from empty or caller-provided rows and opens an ordinary subscription; reconnect currently subscribes fresh.
- The cursors React surface performs health and ensure calls before rendering and has no durable initial query payload.
- The Cloudflare gateway serves static assets separately and forwards query reads to the coordinator.
- The existing POST resume route is subscription-ID reattachment, is schema/drift-gated, and is not currently forwarded by the Cloudflare live-route allowlist.
- The RFC correctly treats LLP 0008’s relaunch delta-resume scope, LLP 0031’s route taxonomy and connection ownership, LLP 0034’s lifecycle rules, LLP 0051’s schema-governed wire, LLP 0063’s hydration workstream, and LLP 0076/0083’s selected Workerd profile versus platform capabilities.

However, four load-bearing issues remain: the proposal contradicts the implemented auth-scoped retention contract, assumes a declaration combination rejected by current codegen, overstates what its membership witness proves, and does not define how local Channel A can intercept and transform HTML. These prevent the current rollout from being safely executable.

I did not externally verify the competitive prior-art table. Its claims were assessed only for internal consistency and appropriate hedging; the RFC’s explicit uncertainty language is appropriate.

## 3. Strengths (cite sections and line numbers)

- The authorization scope is explicit about separating resumability from invocation authority and retained-display authority (§Authorization scope, lines 46–96). In particular, tokens do not widen subscription authority, and auth-scoped non-live entry remains a fresh-snapshot path (§D1.1, lines 299–325).

- The token binds the important identities: application, deployment generation, data-stream incarnation, exact query artifact, canonical arguments, version, and result digest (§D1, lines 184–248). The distinction between `versionStream` and `AuthorizationVersion` is accurate and prevents accidental reuse of bare commit numbers across reset/import boundaries (lines 209–218).

- The shape-specific digest design correctly recognizes that an unordered incremental digest cannot authenticate ordered or windowed results (§D1, lines 225–247). The threat model also avoids claiming client-side authenticity against coherent local tampering.

- The replay ladder is conservative and preserves a universally correct fresh-replacement fallback (§D1.3, lines 397–470). The journal-floor requirement for absence proofs, generation-pinned dependency summaries, fail-closed handling of opaque plans, and atomic answer-and-register cut are all sound constraints (lines 410–438).

- The bundle endpoint is not an arbitrary query batching API. It is governed by a route-to-query manifest, has read and register modes, requires a single commit cut, and explicitly addresses pending-registration ownership and abandonment (§D1.2, lines 327–395). That aligns well with LLP 0031 and LLP 0063.

- The RFC correctly preserves LLP 0043’s full-resync-before-outbox-replay boundary (§D3, lines 574–579) and addresses multi-tab ownership, token identity conflicts, corruption fallback, and persistence invalidation (lines 581–603).

- Scalability claims are framed as hypotheses with separate measurements for first visible rows, proof of currency, and live attachment (§Scalability, lines 642–678). This is substantially stronger than relying on a single “time to data” metric.

- The rollout is decomposed into contract clusters, wire/schema work, corpus amendments, protocol stages, channel-specific acceptance tests, and a separately gated rung 2 (§Rollout sketch, lines 714–800). The explicit dated amendments to LLP 0008 and LLP 0031 are appropriate.

## 4. Concerns (numbered; each with severity Major/Moderate/Minor and a concrete resolution that would clear it)

1. **Major — “v1 does not persist auth-scoped snapshots” contradicts the implemented LLP 0043/0053 retention contract.**

   The RFC first says retained auth-scoped display remains governed by the existing signed-lease machinery, then states that v1 does not persist auth-scoped snapshots at all (§Authorization scope, lines 82–91; §D3, lines 569–572 and 591–600). LLP 0043 already specifies and reports implemented persistence of auth-scoped retained rows with `AuthorizedLease`, per-identity isolation, and user-switch deletion. LLP 0053 likewise preserves lease-valid retained bytes across ordinary restart while requiring a fresh authoritative snapshot before resumption.

   As written, the RFC either silently removes an implemented offline-retention capability or contradicts itself about which persisted data survives.

   **Resolution:** State that v1 persists no auth-scoped *RQS resume token or resumable metadata*, while existing LLP 0043/0053 lease-backed retained rows continue unchanged and remain ineligible for render-before-reauthorization or token resume. Add rollout tests proving that the existing retained-display path is preserved. If the intent really is to remove auth-scoped persistence, explicitly amend LLP 0043 and LLP 0053 and provide a migration plan.

2. **Major — The proposed `authorityIndependent`/`publicInline` model is incompatible with current codegen and manifest semantics.**

   The RFC treats “authority-independent but authenticated-only” as a valid negative fixture for Channel A and makes `publicInline` a separate grant of anonymous invocation authority (§Authorization scope, lines 62–81; §D1.4, lines 472–484; rollout lines 769–778). Current `packages/snapback-codegen/index.mjs:3021–3048`, however, accepts `authorityIndependent: true` only for a query whose auth requirement is already `public`. Therefore the authenticated-only combination cannot currently enter the served manifest, and `publicInline` is not actually separate from anonymous invocation under the existing model.

   The proposed server-side “re-check” also needs a source of truth independent of the route-manifest author; checking one declaration against another author-controlled declaration is not sufficient for the raised disclosure stakes.

   **Resolution:** Choose and document one model:

   - Amend the governing declaration/codegen contract, including LLP 0058, so authority independence can coexist with authenticated invocation, and define how the server independently proves both properties; or
   - Keep the present codegen invariant and redefine `publicInline` as a separate disclosure/HTML-embedding permission for an already-public query, removing the impossible authenticated-only fixture and the claim that it grants anonymous invocation.

   Include the codegen, served-manifest schema, and admission changes explicitly in rollout cluster 0C.

3. **Major — The membership witness does not bind row identities to their hashes as claimed.**

   Rung 2 requires `(rowId, oldRowHash)` pairs but says only that the aggregate of the old hashes must equal the token’s multiset digest (§D1.3, lines 439–459). Such an aggregate proves the multiset of hashes, not the mapping from each `rowId` to its hash. A witness can permute valid hashes among row IDs and retain the same root. The server can then subtract the wrong old hash for a changed or deleted ID. This contradicts the claims that token and witness are “jointly verifiable,” that a well-formed wrong witness fails the root check, and that all substituted entries are rejected.

   Client post-replay verification provides a useful final fail-closed check, but it does not make the server-side admission claim true or satisfy the stated acceptance fixtures.

   **Resolution:** Define the digest leaves as a commitment to keyed pairs, for example `H(canonicalRowId || rowHash)`, and aggregate those leaves. The witness root check must cover the exact identity-to-hash mapping, including duplicate-ID rejection. Add an explicit hash-permutation fixture alongside omitted, extra, substituted, and correct-ID/wrong-hash cases.

4. **Major — Channel A has no executable local-arm HTML serving seam.**

   D2 defines Channel A as transformation performed when a gateway serves `index.html`, and rollout step 3 schedules the first implementation on the local arm (§D2, lines 486–560; rollout lines 769–778). The inspected local React demo is served by Vite: `index.html` contains an empty root and module script, while `main.tsx` independently contacts the Snapback API. Snapback therefore does not currently own the HTML response it would need to transform.

   Cluster 0E specifies serialization and HTTP mechanics but not which local component intercepts HTML, how it receives the route manifest, or how it coordinates the pinned query evaluation with Vite’s SPA fallback and base path.

   **Resolution:** Define and test a concrete local serving architecture—such as a Snapback reverse proxy, a packaged Vite `transformIndexHtml` integration, or another explicit dev-server hook—with ownership of route matching, manifest lookup, origin handling, failure fallback, and response headers. Alternatively, move the first Channel A implementation to the Cloudflare gateway and treat local integration as a separate prerequisite.

5. **Moderate — Register-mode idempotency is not fully reconciled with sender-constrained credential and grant custody.**

   The RFC binds idempotency to authority, generation, manifest entry, and canonical arguments (§D1.2, lines 327–395). LLP 0077’s sender-constrained request model and LLP 0031’s connection-grant rules additionally make caller key identity, nonce progression, secret delivery, and an indeterminate lost response load-bearing. Retrying a lost request cannot simply replay a bearer-style response without specifying how the successor nonce and connection-grant secret are handled.

   **Resolution:** Add sender-key identity and credential incarnation to the idempotency scope; specify nonce consumption on first execution and retry; define whether and how the same grant secret may be returned again; and add lost-response fixtures for credential rotation, authority transition, and a different sender key presenting the same idempotency key.

6. **Moderate — Rung 2’s stated complexity omits witness verification cost.**

   The RFC says digest maintenance and token minting are `O(changed rows)` (§D1, lines 225–238; §D1.3, lines 446–450), but a stateless server receiving an exact witness must parse and aggregate the entire held result, making total admission work and request bytes at least `O(held rows + changed rows)`. The size cap bounds this cost but does not make the stated complexity accurate. The scalability gates measure journal work and replay operations but do not explicitly measure witness decoding, hashing, or bytes (§Scalability, lines 657–670).

   **Resolution:** State the full complexity, add witness bytes and verification CPU to the scalability gates, and use the result-size cap to bound both. If `O(changed rows)` total admission is required, a different authenticated proof or server-held state is necessary.

7. **Moderate — Channel C’s socketless native use cases lack a credential/custody contract.**

   The RFC names WidgetKit, watch complications, extensions, App Intents, and notification cold starts as read-mode consumers (§D4, lines 605–625), but does not specify which credentials those constrained processes possess, how they access shared auth state, whether sender-constrained keys are usable there, or how user-switch revocation propagates. This affects whether authenticated socketless bundles are implementable and whether they preserve LLP 0011/0053/0077 guarantees.

   **Resolution:** Either limit v1 socketless Channel C to public/authority-independent bundles, or add a prerequisite contract covering extension credential access, sender-key custody, authorization transition, shared-container isolation, and revocation. Demonstrate it in the widget-shaped rollout surface.

## 5. Suggestions (non-blocking)

- Give the new token-based operation a wire and route name distinct from the existing `resume` reattach operation, even if the user-facing concept remains “resume.” The current prose distinction is clear, but similar endpoint names will complicate diagnostics and SDK APIs.

- Clarify the sentence saying every envelope “that changes result state” carries a token while listing `CurrentAsOf`, whose purpose is specifically to advance the token without changing rows (§D1, lines 250–265).

- Specify whether refusal codes are wire-visible, log-only, or metrics labels. D1.1 currently says mismatches transparently return `LiveReplace` while also requiring per-cause coded refusals.

- Add manifest artifact size/version limits and deterministic route-precedence rules. Route parameters, SPA fallback, and `basePath` are mentioned, but ambiguous route matches should fail deployment rather than be resolved differently by local and Cloudflare arms.

- Add multi-version same-row journal cases to rung 2 acceptance: insert-update-delete, predicate enter-exit-enter, and repeated updates within one replay range.

- Record the chosen canonicalization and digest construction in a dedicated reviewed specification rather than leaving cryptographic details solely in rollout cluster 0A.

## 6. Open questions for the author

1. Does “v1 does not persist auth-scoped snapshots” intentionally retire LLP 0043’s implemented lease-backed retained rows, or was it meant only to prohibit resumable tokens and render-before-reauthorization for those rows?

2. Is an authenticated-only `authorityIndependent` query intended to become legal? If so, which amendment changes LLP 0058 and the current codegen validator?

3. What server-held fact independently validates `publicInline`, beyond trusting the declaration supplied by the route/functions author?

4. What concrete process owns and transforms the local-arm HTML response in rollout step 3?

5. Should the rung 2 root commit to keyed `(rowId, rowHash)` leaves, and if not, how is a permutation of valid hashes among IDs detected at server admission?

6. How are register-mode retries bound to a sender key and nonce sequence, and can the same connection-grant secret safely be returned after an indeterminate lost response?

7. Are authenticated WidgetKit/extensions part of v1 Channel C, or is the first native surface intentionally public/authority-independent only?

## 7. Verdict

NOT READY

The primitive is promising and much of the protocol work is well specified, but the auth-retention contradiction, manifest-model mismatch, unkeyed membership proof, and missing local HTML-serving seam are Major issues that must be resolved before implementation.

---

**Orchestrator close-out note (not a review), 2026-07-24:** the loop was stopped after round 5. A v0.5 revision (sha256 `4edf8528be8cfb9aebafd704273144c0ee09a6718d69abc61fc753bf7fb0ee92`) was applied addressing both round-5 reviews' concerns; **v0.5 is unreviewed by this loop**. Loop trajectory: R1 Fable NOT READY / Codex NOT READY → v0.1; R2 Fable READY / Codex NOT READY → v0.2; R3 both NOT READY (token-lifecycle gap introduced by v0.2 hardening) → v0.3; R4 Fable READY / Codex NOT READY → v0.4; R5 both NOT READY (closed-inputs purity gap; retention-contract wording; codegen model; witness keying; local serving seam) → v0.5. Status remains Draft; acceptance is the author's decision per LLP 0005.

## Round 6 — 2026-07-24 (targeted delta review of v0.5)

**Revision under review:** `llp/0090-resumable-query-snapshots.rfc.md` v0.5, sha256 `4edf8528be8cfb9aebafd704273144c0ee09a6718d69abc61fc753bf7fb0ee92` (untracked working-tree file at HEAD `4d2f02e4`; both MATCH per the reviewer's own revision check). Round format: targeted review of the v0.5 delta (items a–i) with an explicit pre-existing-text verdict feeding the loop's convergence stopping rule.
**Runtime detail:** 158,828 tokens used; fresh context, no access to prior rounds or llp/reviews/.
**Verdict:** NOT CLEAN (1 Major + 2 Moderate, all IN the v0.5 delta; **no Major/Moderate found in pre-existing text**)

### Review body (verbatim)

## 1. Revision check

- SHA-256: **MATCH** — `4edf8528be8cfb9aebafd704273144c0ee09a6718d69abc61fc753bf7fb0ee92`
- Repository HEAD: **MATCH** — `4d2f02e4`
- Working-tree status: **MATCH** — the RFC is untracked (`??`).

## 2. Delta verdict table

| item | fix sound? (YES/NO/PARTIAL) | one-line justification |
|---|---|---|
| a | PARTIAL | The closed-inputs rule matches LLP 0053, but unchanged bundle, Channel A/B, and rollout language still issues or persists RQS state based on authority independence alone. |
| b | YES | “No auth-scoped RQS resume state” cleanly preserves LLP 0043/0053 lease-backed retained rows while excluding tokens and resumable metadata. |
| c | YES | The disclosure-only model matches the codegen/server invariant that `authorityIndependent` requires a public HostPlan query; invocation authority remains with the query’s auth requirement. |
| d | NO | Keyed leaves and duplicate-ID rejection fix witness permutation, but the newly specified root-update algorithm subtracts the entire witness and thereby drops unchanged rows. |
| e | YES | `transformIndexHtml` is a coherent extension of LLP 0030’s Vite-owned app-serving seam, and the RFC honestly makes implementation part of 0E with Cloudflare-first fallback. |
| f | YES | Per-boot keys prevent two tabs from collapsing, while sender-key/credential binding and a mandatory LLP 0031 amendment correctly defer the nonce/grant-secret protocol details. |
| g | YES | Public-only socket-less bundles avoid inventing extension credential custody and revocation semantics absent from LLP 0031/0053/0077. |
| h | PARTIAL | The bounded budget and retained/pending presentation rule are sound, but “indefinitely” retained offline display conflicts with the new expiry-as-staleness-backstop claim. |
| i | PARTIAL | The smaller pins are mostly consistent, but token expiry cannot presently bound render-before-resume because expiry is absent from client-visible metadata and D3 permits indefinite offline display. |

## 3. Concerns

1. **Major — IN the v0.5 delta: rung-2 digest evolution deletes unchanged rows.** D1.3 says the server verifies the full exact witness, then “subtracts the witnessed old leaves and adds post-image leaves.” For a held result `{A, B}` where only `A` changes, that operation produces only `H(A || newHashA)` rather than `H(A || newHashA) ⊕ H(B || hashB)`. The next token therefore binds the wrong result and client post-replay verification fails every non-total replay—or, if implemented inconsistently, server and client can disagree about authority. **Resolution:** start from the verified old root and, for each journal-affected row ID only, subtract its witnessed old leaf when previously present, then add its new post-image leaf only when it remains in the result. State explicitly that untouched witness leaves remain in the accumulator, and add a fixture with multiple held rows where a strict subset changes.

2. **Moderate — IN the v0.5 delta: closed-inputs eligibility was not propagated through the RFC’s normative channel contracts.** The new Authorization-scope rule and D1.1 admission check are consistent with LLP 0053’s protected/retainable profile, but several unchanged passages still say otherwise: D1.2’s closed union says every authority-independent entry carries `resume`; D2 evaluates entries when all carry `publicInline`; D3 persists and renders authority-independent subscriptions without mentioning retainability/closure; and the Summary and rollout step 3 similarly imply that authority independence plus `publicInline` is sufficient. The current code also distinguishes `authorityIndependent` from `retainable`; the latter adds the complete-read-summary proof. Thus an implementer following D1.2/D3 can mint unusable tokens or persist/render a time-dependent query that Authorization scope says must not be persisted. **Resolution:** make one named `rqsEligible` served-manifest predicate—public/authority-independent as applicable plus the LLP 0053 closed-inputs/retainable proof—and reference it consistently in D1.2’s union, D2, D3, D4, the Summary, 0C, and rollout acceptance. Non-eligible bundle entries should return rows with `resume: null`, and Channel B must refuse persistence as well as resume.

3. **Moderate — IN the v0.5 delta: token expiry does not provide the claimed render-before-resume staleness bound.** D1 says expiry bounds how old a snapshot can be admitted for render-before-resume, but the displayed `tokenBody` and clear `meta` contain no issuance or expiry field, while D3 explicitly permits offline retained/pending display “indefinitely.” An offline client cannot ask the MAC keyring whether the opaque token has expired, so expiry currently bounds only later server admission. **Resolution:** choose one contract. Either narrow the claim to “server resume admission and key hygiene,” preserving indefinite clearly-stale offline display, or add authenticated `issuedAt`/`expiresAt` data plus a client-visible matching deadline and define the offline clock/rollback rule—ideally reusing LLP 0043’s durable high-water posture—then require delete-or-hide at expiry.

## 4. Suggestions

- Include `publicInline` explicitly in the parenthetical list of codegen-derived served-manifest facts used for the server re-check; the current list names auth requirement, authority independence, and closed inputs but omits the disclosure bit itself.
- Domain-separate and length-frame the rung-2 leaf encoding, for example `H("rqs-row-v1" || len(rowId) || canonicalRowId || rowHash)`, rather than leaving `canonicalRowId || rowHash` parsing implicit.
- Define whether “least-recently-resumed” means last successful authoritative resume, last attempt, or last access, and specify atomic timestamp/eviction bookkeeping.
- In 0F, map “sender-key identity” and “credential incarnation” to the exact LLP 0077 wire identities, including the thumbprint and sender replay epoch, to avoid a parallel incarnation vocabulary.
- Exercise old-decoder tolerance against an actual pre-RQS JS client and Rust `LiveEnvelope` decoder, not only schema fixtures.

## 5. Verdict

NOT CLEAN

A Major and two Moderate concerns remain in the v0.5 delta; no Major or Moderate concerns were found in PRE-EXISTING pre-v0.5 text independently of contradictions introduced by the delta.

---

**Orchestrator close-out note (round 6), 2026-07-24:** the loop closed under its convergence stopping rule after round 6 — both targeted delta reviews of v0.5 reported **no Major/Moderate concerns in pre-existing (pre-v0.5) text** (Fable: CLEAN; Codex: NOT CLEAN with all findings delta-confined), and an implementer-lens review (UNDERDETERMINED) contributed a 10-item spec-gap list. A v0.6 revision (sha256 `b37d337bdbc6153de15660d9f61c9b54c7d03355154caff1b4f9b63432ec1706`) applies every round-6 resolution: the corrected accumulator-update rule, the unified `rqsEligible` predicate, the self-describing token with `issuedAt`/widened `meta`, the named canonical encoding and framed leaves, register-mode credentialed-caller scoping, and the citation/naming/wording residues. **v0.6's edits are delta-confined fixes and are themselves unreviewed.** Status remains Draft; acceptance is the author's decision per LLP 0005.
