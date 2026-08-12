# Round 1 review — Reviewer B

## Provenance

- **Reviewer:** B
- **Model:** GPT-5.6-sol
- **Effort:** xhigh
- **Family:** Codex
- **Round:** 1
- **Lens:** skeptical implementer
- **Evidence boundary:** isolated capsule `/tmp/snapback-llp-super-refine-r1-min.0oZ7sZ`; no live-workspace source or sibling review artifact was inspected
- **Capsule SHA-256 (review instructions excluded):** `683c25563bf5e966871fe8d8ec150b88a9230e87e9876b0aab8c81d39a598c20`
- **Target SHA-256 vector:**
  - LLP 0235: `fd16424a1120161071d158a5d89c9d7fab92604588dd506fd2e80c4d7167e730`
  - LLP 0236: `6bbe63bde02cfd0df78af3810b29b2459e20a7327f30cdc997755803415e2cd2`
  - LLP 0237: `1d0415cae8ee169ef4a06d76e180cc351f2d74b7ab4d403027959f0a02828808`
  - LLP 0238: `b39f0eeb832c874b81bb818b06b4980fa754ca10f474250035a56b3dfc511d21`
  - LLP 0239: `c94f027ad96369182aed5095ccff631abad025831f89bf223d21b61391f99d8e`
  - LLP 0240: `7af931953fbf8da27bd32fc0261b337064c292847812c55e93de26337ad13c6a`
  - LLP 0241: `626942dbca8cc8a44fc9bb3c01375e37e64028823eae7fa5644f49a20ab15d91`

## LLP 0235 — Bounded handler modules

### Concise summary

The RFC admits a Snapback-resolved, statically closed relative-ESM helper graph while retaining inline operation declarations, explicit capabilities, fresh-per-invocation evaluation, bounded graph/source/bundle sizes, fail-closed generation, and generated runtime-profile diagnostics. The separation between executable identity and source evidence is directionally coherent with the rest of the set.

### MATERIAL concerns

None.

### MINOR concerns

1. D3 uses “bounded integer expression” for array indexing without saying whether the bound is a static numeric range, a runtime checked integer, or merely the closed expression grammar. This can be frozen in the implementation Spec/profile artifact, but the resulting diagnostic and cross-target corpus should make the choice explicit.
2. D2 is clear about top-level constants but does not explicitly state the admission result for ESM import cycles or mutually recursive helper declarations. A versioned refusal/admission rule would keep two codegen implementations from acquiring accidental differences.
3. The migration section has both an app-level capability flag and later automatic profile selection. The generated manifest should record why the profile was selected (`explicit` versus `required-by-import`) so rollback and diagnostics do not depend on hidden CLI state.

### Author-decision questions

1. Is direct `.ts` custody deliberately out of v1, leaving emitted `.js`/`.mjs` as the only accepted boundary?
2. Should the 64-file/16-depth envelope be accepted as the v1 compatibility contract, or accepted only as a target-profile default that an app may narrow but not widen?

VERDICT: READY

## LLP 0236 — Explicit client lifecycles

### Concise summary

The RFC replaces ambiguous client naming with nominal reference kinds and explicit verbs for one-shot reads, live watches, mutation dispatch/settlement, actions, tasks, auth projection, and presence. It also unifies continuing objects around an observable-handle grammar and canonicalizes resource identity by semantic inputs rather than object identity.

### MATERIAL concerns

1. **The headless watch contract does not define the `refresh` operation that acceptance requires.**
   - **Underdetermined decision:** Whether `WatchHandle` has an imperative refresh, what it returns, whether it preserves handle/resource identity, and how refresh interacts with reconnect, resnapshot, disposal, and generation fencing.
   - **Evidence:** D3’s complete shown `ObservableHandle` has only `snapshot`, `subscribe`, and `dispose`; D2 merely says `watch()` returns `WatchHandle`; D4 gives the React hook a `refresh`; Acceptance says a headless watch has “snapshot, subscribe, refresh, and dispose” all typed.
   - **Consequence:** Two reasonable clients can expose different public APIs and lifecycle behavior. An adapter that recreates the watch on refresh can also rotate connection/subscription identity where another implementation performs a fenced resnapshot in place.
   - **Concrete repair:** Define `WatchHandle` explicitly, including `refresh()`’s return/result, coalescing, authority/resnapshot behavior, and post-dispose refusal, or remove headless refresh from acceptance and state that callers dispose/recreate. Reconcile it with the existing `started`/`settled` ownership seam rather than leaving adapters to guess.

### MINOR concerns

1. “Immediately schedules or delivers” the first subscription notification leaves observable ordering deliberately loose. The frozen external-store convention should be named precisely in the generated lifecycle manifest so tests do not accept both synchronous reentrancy and later microtask delivery accidentally.
2. D5 names authority partition and options as resource-key ingredients, but the compatibility treatment of newly added defaulted options should be explicit: normalize defaults before hashing and version the normalization grammar.
3. `useSnapbackRead` still leaves cache lifetime, refresh ownership, and suspense behavior open. That can remain a later hook-level decision if the first release does not claim one canonical reactive cache.

### Author-decision questions

1. Does `watch.refresh()` exist in v1, and if so is it an in-place fresh-snapshot request or a successor handle?
2. Is `useSnapbackRead` part of the initial canonical surface, or should v1 ship only the headless `read` verb until its React ownership semantics are frozen?

VERDICT: NOT READY

## LLP 0237 — Asset collections and the media field

### Concise summary

The RFC introduces a distinguished optional media field, a bounded generated asset relation, a multi-upload-and-commit command, policy-aware sharing, and a common media projection. It correctly keeps authority-bearing asset references out of opaque structured values and composes with existing attachment, grant, URL issuance, and cleanup machinery.

### MATERIAL concerns

1. **The multi-media command drops the load-bearing mutation-ambiguity and retry identity contract.**
   - **Underdetermined decision:** What happens when the parent/attachment/grant transaction commits but its response is lost, which mutation identity a retry uses, what `.done` resolves to, and what cancellation means after `committing` begins.
   - **Evidence:** D3 lists phases ending in `ready`, describes commit failure and upload-item retry, but defines no `ambiguous` command outcome or stable mutation-attempt reuse. LLP 0180’s existing command contract makes this distinction explicit precisely to prevent duplicate sends. Open question 4 still asks whether this is a specialization of that command builder or a separate generated composition.
   - **Consequence:** One implementation may mint a fresh parent mutation on retry and duplicate the owning row/collection/grants; another may reuse an identity or strand the task. These differ on durable identity and application semantics.
   - **Concrete repair:** Make `mediaCommand` an explicit specialization of the existing `CommandTask`/`CommandOutcome` contract (or define an equivalent complete state machine): allocate and persist one mutation attempt identity before commit, retain `ambiguous`, reuse that identity for reconciliation/retry, freeze predecessor/successor `.done` semantics, define cancellation during commit, and expose multi-asset residue/cleanup provenance.
2. **The promised stable collection item identity is not defined across generated mutations.**
   - **Underdetermined decision:** When `itemId` is allocated, whether `replace` preserves ids for retained assets, whether remove permanently retires ids, and how migration assigns them.
   - **Evidence:** D2 says records are addressable by stable item id and exposes generated `replace`, `append`, `remove`, and `reorder`, but supplies no identity transition rules. Collection reads expose item identity to clients.
   - **Consequence:** Two implementations can rotate every item id on `replace` versus reconcile existing occurrences. That changes durable identity, React list stability, cursor references, audit records, and compatibility despite identical asset/order content.
   - **Concrete repair:** Freeze item identity: allocation domain and non-reuse, `append` allocation, `reorder` preservation, `remove` retirement, and an exact `replace` reconciliation rule (for example explicit item ids or asset-id matching while duplicates remain forbidden), plus deterministic migration behavior.

### MINOR concerns

1. D1 leaves `MediaRef.kind`’s wire carrier to an implementation Spec. The Spec must ensure an offline/generated result cannot claim an exact `K` by performing an undeclared metadata lookup, and that forged client `kind` remains non-authoritative.
2. Parent deletion and scope migration should explicitly inherit the generated bounded-child lifecycle, including collection-row deletion and attachment/GC changes in the same transaction.
3. “Playable video” is used as an acceptance-level happy path while mandatory renditions remain open question 5. The first capability claim should name a minimal rendition contract rather than imply every admitted video is playable on both web and native.

### Author-decision questions

1. Is `defineMediaCommand` normatively an existing command specialization, preserving all `ambiguous`/retry semantics?
2. What exact identity-preserving behavior does `replace` use?
3. Which rendition is the minimum cross-platform `video` contract for v1?

VERDICT: NOT READY

## LLP 0238 — Application authority profiles

### Concise summary

The RFC compiles one scoped app roster and finite role relation into a portable authority IR used by transition operations, visibility, invalidation, search, assets, and inspection. It also creates an honest online-only lane for policies that cannot compile to that finite IR.

### MATERIAL concerns

1. **The owner/admin bootstrap and last-holder invariant has two conflicting sources.**
   - **Underdetermined decision:** Whether `rooms.ownerId` must have a `roomMembers` row, whether `owner` is an effective role outside the declared `member | admin` lattice, which subject satisfies the “administrator” invariant, and how ownership/leave/remove/promotion transitions preserve it.
   - **Evidence:** D1’s example maps the parent `ownerId` to role `owner`; the profile role values contain only `member` and `admin`; transition spelling says `admin-not-last-owner`; admission alternates between “owner/bootstrap” and “no administrator”; D3 exposes role/removal operations without an ownership-transfer operation.
   - **Consequence:** Implementations can disagree about whether the owner is also a roster member, whether the last admin may leave, and whether changing `ownerId` changes authority atomically. That can strand a scope without an administrator or recreate two authority facts that diverge.
   - **Concrete repair:** Define one closed state machine and vocabulary: either include owner in the profile lattice/row and state the bootstrap and transfer transitions, or define the parent owner as a separate mapped holder with a mandatory corresponding row/effective-role rule. Pin last-holder checks for promote/demote/leave/remove/owner transfer under concurrency.
2. **Custom policy declarations can claim complete invalidation while undeclared authority inputs remain warning-only.**
   - **Underdetermined decision:** Whether `authorization.custom(... sync: "reauthorize-on-change")` is admitted only under enforced complete inputs, or whether it runs with a conservative all-change invalidation fallback.
   - **Evidence:** D4 says declaring inputs clears warnings for the claim that backing inputs are complete, then says captured undeclared authority reads “emit or refuse according to the app’s strictness setting.” LLP 0146 makes strict declarations optional; an emitted warning is not a completeness proof.
   - **Consequence:** If the declared list drives live invalidation, a conditional undeclared policy read can change without waking reauthorization, leaving protected data visible. If every change wakes, the advertised completeness/precision claim is false. Two implementations can make opposite safety/cost choices.
   - **Concrete repair:** Require enforced strict input completeness for the precise `reauthorize-on-change` claim. Otherwise compile an explicitly `coarse-global` online-only lane that reauthorizes on every relevant app/authority change and does not clear the completeness warning. An observed undeclared authority read must unconditionally refuse precise activation or downgrade it before any value release.

### MINOR concerns

1. Open question 1 appears broader than D1: the decision selects an app-table-backed profile while compatibility also allows a system-machine projection. The first advertised profile should name which source-of-truth mode actually ships.
2. Transition receipts include predecessor/successor but do not say how unauthorized callers see a nonexistent scope/member versus a denied one. Existing non-enumeration rules should be inherited explicitly by the generated roster surface.
3. The plan command reports roster/seat divergence, although the destination says no second seat ledger. Label that comparison as migration-only legacy evidence so it cannot become permanent dual-state health machinery.

### Author-decision questions

1. Is owner a profile role, a mandatory profile row with a derived effective role, or a separate parent invariant?
2. Does v1 ship app-table-owned profiles only, leaving system-machine projections as compatibility/migration work?
3. Is non-strict custom authority always coarse-global for live invalidation?

VERDICT: NOT READY

## LLP 0239 — Semantic artifact generations

### Concise summary

The RFC separates semantic, executable, evidence, and bundle identities; packages them into an application generation; classifies semantic diffs; activates through a server-authoritative pointer; and coordinates safe-boundary reload and unified status across long-running custodians. The objective is sound, but several identity and retirement rules currently contradict each other.

### MATERIAL concerns

1. **Evidence-only generations collide in the proposed content-addressed directory.**
   - **Underdetermined/defective decision:** The immutable envelope is keyed only by `semanticId`, even though multiple evidence/bundle cuts intentionally share that id.
   - **Evidence:** D2 writes `.snapback/generations/<semanticId>/` and says generation directories are complete/content-addressed and never mutate. D1 and D3 say evidence-only changes keep semantic/executable ids unchanged while rotating evidence/bundle ids. D4 allows the evidence/bundle pointer to advance without changing the server semantic nonce.
   - **Consequence:** A comment-only generation must overwrite the old directory, be refused as an address collision, or silently alias two different `generation.json`/integrity graphs. Predecessor custody, rollback, and bundle verification then have no unique address.
   - **Concrete repair:** Give every immutable cut a `generationId` (normally a domain-separated root over semantic, executable-set, evidence, and bundle identities) and key the directory/pointer by it, or nest immutable bundle/evidence cuts under the semantic id. Keep `semanticId` as a comparison field/index, never the sole generation address.
2. **Source-path identity contradicts both LLP 0235 and this RFC’s own acceptance/open question.**
   - **Underdetermined decision:** Whether moving an imported helper changes semantic/executable identity.
   - **Evidence:** D1 says source paths do not enter semantic or executable identity; Acceptance says source relocation with stable canonical source preserves both; open question 2 says v1 may rotate on graph-edge changes. LLP 0235 D2/D4 binds normalized root-relative graph targets/edges into implementation identity.
   - **Consequence:** Two generators can disagree about stale-ref compatibility for the same file move. Worse, stripping paths from identity while executable resolution semantics still depend on graph edges can alias distinct graphs.
   - **Concrete repair:** Freeze the v1 rule and align both RFCs. The conservative repair is: comments/spans/source maps are evidence-only, but normalized module edges and root-relative targets are semantic/executable inputs, so a cross-module move rotates identity; narrow the acceptance example to relocation that leaves the canonical executable graph unchanged.
3. **“Exactly one” reload class conflicts with per-consumer mixed dispositions.**
   - **Underdetermined decision:** How a generation with, for example, a migration obligation, a client refresh, and a server restart requirement obtains one class and which prerequisite gates pointer activation.
   - **Evidence:** D3 requires exactly one of seven classes, then says classification includes per-consumer dispositions and gives a mixed server/client example. D4 asks the server to return “the same reload/disposition class,” while D6 exposes one status plus affected consumers/next operations.
   - **Consequence:** Implementations can choose different global labels and activate under different prerequisites. A lossy “most severe” choice can also hide an incomparable obligation that remains required.
   - **Concrete repair:** Make the per-consumer disposition map authoritative and freeze a reduction: either a total severity/join table whose global class is the join while `next[]` retains every prerequisite, or remove the exactly-one global claim. Define activation as the conjunction of all disposition obligations, not the selected display label.
4. **There is no v1 retirement outcome for a predecessor generation held by a long task.**
   - **Underdetermined decision:** How long predecessor executable objects remain, and whether an over-bound invocation/task is cancelled, allowed to finish, persisted elsewhere, or blocks successor activation.
   - **Evidence:** D5 keeps old objects until owners release them; Risks require a bounded retirement registry; open question 4 asks both the bound and task outcome. The RFC’s central safe-reload claim depends on this boundary.
   - **Consequence:** One implementation leaks generations indefinitely, another terminates durable work, and another starves activation. These differ on task semantics and availability; silently retargeting is correctly forbidden but no compliant remaining behavior is selected.
   - **Concrete repair:** Freeze a v1 drain/retirement policy per owner class. For owners that cannot finish within the residency bound, require a typed `restart-required`/manual disposition before activation or define an exact-generation durable executor handoff. State the task outcome and forbid both retargeting and unreported cancellation.

### MINOR concerns

1. The third-party “stale deadline” is named but not bounded or carried in the envelope/status schema. It should be an explicit compatibility fact, not a documentation promise.
2. `client-reload-compatible` needs a conservative v1 compatibility definition. Open question 5 should resolve before this class can activate automatically; exact contracts are the safer first slice.
3. Exact runtime bytes cannot exclude source paths if source URLs/maps are embedded in those bytes. The executable/evidence packaging layout should ensure runtime bytes and source maps are physically separate before evidence-only activation is claimed.

### Author-decision questions

1. Is immutable `generationId` equal to `bundleId`, or a separate root that can name target-specific executable sets beneath one semantic generation?
2. Does v1 conservatively rotate semantic/executable identity on every normalized helper graph-edge change?
3. What is the global-class reduction over per-consumer dispositions?
4. Must a non-drainable task block activation, or is there an exact-generation executor handoff in v1?

VERDICT: NOT READY

## LLP 0240 — Bounded query composition

### Concise summary

The RFC defines a closed projection IR for children, aggregates, activity unions, and fan-in feeds, with generated bounds, indexes, authority, result contracts, live dependencies, explain output, and separate local/retained eligibility. The shallow algebra is appropriately narrower than SQL, but aggregate work/result semantics and feed pagination are not yet implementable without incompatible choices.

### MATERIAL concerns

1. **Aggregate exactness and work-overflow semantics are not selected.**
   - **Underdetermined decision:** Whether an aggregate is exact over a statically bounded domain, exact-or-refuse at an examined-entry ceiling, capped/marked, partial with a snapshot cursor, or maintained exact.
   - **Evidence:** The global constraint says every plan enforces bounds, but D3’s source example has no `take`, examined-entry ceiling, or result marker. D3 allows on-demand or maintained execution as an implementation choice while claiming unchanged semantics. D8 mentions runtime resource-limit refusals without specifying their threshold or aggregate result contract. LLP 0120 explicitly establishes that these variants have different public semantics and are not implementation details.
   - **Consequence:** An on-demand implementation can scan an unbounded group, refuse at a target-specific hidden threshold, or return a cap while a maintained implementation returns an exact total. Availability, exactness, overflow behavior, and protected-row noninterference diverge.
   - **Concrete repair:** Select and encode one v1 variant. A conservative callable choice is explicit `maxExamined` exact-or-sealed-refuse, counting invisible examined entries as work without revealing which caused overflow; maintained exact must define integer overflow, empty-group representation, rebuild/activation, and identical refusal/result semantics. Put the bound and exactness marker in `ProjectionPlanV1` and generated types.
2. **The feed’s per-scope candidate bound cannot produce a correct global page as written.**
   - **Underdetermined/defective decision:** How the merge retrieves enough candidates and represents per-scope frontiers when `perScopeTake` is smaller than global `take`.
   - **Evidence:** D5 allows 20 candidates per scope per page and a 50-item result. If one followed scope owns the highest 50 items, reading only its first 20 either returns a short page despite available rows or emits lower-ranked rows from other scopes before the undiscovered 21st item. A single global cursor containing only the selected row frontier cannot repair already misordered output.
   - **Consequence:** Implementations will skip, duplicate, shorten, or globally misorder feed pages, especially across continuation and scope-generation changes. This is public cursor compatibility, not a planner detail.
   - **Concrete repair:** Define a correct bounded top-k merge: require per-scope lookahead at least global page size, or allow iterative bounded refill with a total examined-entry ceiling and return a sealed resource refusal if exact top-k cannot be proven. Bind a frontier/exhaustion witness for every scope into the cursor and freeze insert/delete/snapshot semantics.

### MINOR concerns

1. D4’s “authorization-equivalent” one-to-one lookup needs a generated proof predicate; otherwise it risks becoming an informal waiver for a second visibility policy. Open question 1 can simply exclude it from the first slice.
2. Multiple child collections have independent cursors, but D2’s example/result does not show how those cursors are named and supplied. The result/argument grammar should freeze independent continuation without rereading unrelated children.
3. Target profiles may advertise lower feed limits, but the minimum required to claim `projection.feed.v1` is open. Freeze a portable floor or version target-specific limit identities into the ref so package-to-target skew refuses before execution.

### Author-decision questions

1. Which exact aggregate overflow/result variant is v1?
2. Is feed v1 permitted to issue iterative index reads inside one invocation, and what cumulative examined-entry ceiling applies?
3. Should the activity payload lookup be excluded until its equivalence proof is specified?

VERDICT: NOT READY

## LLP 0241 — Policy-aware protected retention

### Concise summary

The RFC admits exact query-scoped protected projections with content-addressed descriptors, server-issued bounded leases, pre-storage exclusion, authority-partitioned real client stores, fail-closed startup validation, explicit retained freshness, and mandatory reauthorization/fresh snapshot on reconnect. It is a suitably narrow answer to private offline reads, but one lease-verification claim conflicts with the accepted authorization protocol.

### MATERIAL concerns

1. **The RFC reintroduces client-side lease-signature verification that LLP 0053 expressly disclaims.**
   - **Underdetermined/contradictory decision:** Whether the client possesses verifier material and can authenticate the server lease while offline.
   - **Evidence:** D2/D3 bind a server-issued lease and target signing identity; D5 says the client validates “lease/signature/time”; D3 says a corrupt signature deletes before read. Accepted LLP 0053’s verification-locus amendment says the client cannot verify the MAC: it validates structure, binding, clamps/duration, expiry/rollback, and a stored unkeyed hash, while keyed MAC verification and unknown-key refusal occur only server-side.
   - **Consequence:** One implementation may falsely claim an altered but canonically shaped MAC is detected at cold offline boot; another may invent public-key distribution and rotation, creating an unreviewed protocol/capability break. Capability truth and acceptance differ materially.
   - **Concrete repair:** Preserve LLP 0053 v1 explicitly: offline client validation covers closed-envelope structure, exact stored-byte/hash binding, identity/witness equality, derived client deadline, and durable clock high-water; keyed MAC/signature verification occurs only on server presentation. Remove “corrupt signature before read” from client acceptance, or separately specify and negotiate a new asymmetric `AuthorizedRetentionLeaseV2` with verifier-key custody and rotation.

### MINOR concerns

1. The store key is written as containing canonical args. Use the canonical-args hash (with collision-safe equality material inside the opaque record) rather than plaintext arguments in index keys, or state why query arguments cannot contain sensitive values.
2. D1 permits proven JS handlers in principle while rollout says v1 may begin with generated plans only. The first capability should freeze generated-plan-only eligibility; otherwise two carriers can advertise the same profile with materially different proof prerequisites.
3. Deterministic LRU across IndexedDB tabs and native processes needs one durable ordering owner. This is Spec-level work, but acceptance should test crash/concurrent eviction without treating wall-clock order as deterministic.
4. Physical backup/restore is correctly left open, but until decided capability manifests should say the protected namespace is omitted rather than leaving each carrier to copy ciphertext/bytes opportunistically.

### Author-decision questions

1. Does v1 retain LLP 0053’s server-only MAC verification, with no offline signature-authentication claim?
2. Is first-release eligibility generated plans only?
3. What default lease below the 24-hour ceiling is product policy, and is zero the generated default unless the app opts in?

VERDICT: NOT READY

## Set-level consistency and implementation sequence

### MATERIAL set concerns

1. LLP 0235 and LLP 0239 disagree on whether normalized helper module paths/edges affect executable identity. This must be one shared canonicalization rule before either profile can be activated.
2. LLP 0236’s common task grammar and LLP 0237’s media task are not yet one lifecycle: retry, ambiguous commit, predecessor/successor identity, and refresh/disposal must come from one generated manifest rather than parallel task vocabularies.
3. LLP 0237 and LLP 0238 have a mutual composition edge (media commands consume authority profiles; authority profiles advertise media sharing). It is not an unavoidable architecture cycle if the composition class remains generation-refused until both capabilities exist, but the rollout should state that order explicitly.
4. LLP 0241 correctly depends on closed authority and projection proofs from LLP 0238/0240. It must not activate based on the warning-only custom-policy lane, and its descriptor identity must use LLP 0239’s repaired unique generation address.

### Coherent landing sequence

After the materials above are repaired, a main-honest sequence is possible:

1. Land LLP 0239’s dual identity emission and uniquely addressed immutable envelope without automatic activation.
2. Land LLP 0235’s profile artifact/preflight and LLP 0236’s nominal references/common handles as independently gated surfaces.
3. Land LLP 0238’s profile IR and generated roster without asset-profile composition.
4. Land LLP 0240 node-by-node, with aggregate exactness and feed cursor rules frozen before their capability rows turn positive.
5. Land LLP 0237’s media field/collection first, then media-command task semantics, then the authority-profile sharing composition only after both sides qualify.
6. Land LLP 0241 last, initially for generated plans and closed authority profiles on each real store carrier, with no opaque/custom-authority retention claim.
7. Enable LLP 0239 automatic reload classes consumer by consumer only after each predecessor-retirement behavior has its own proof.

This order leaves old primitives usable and lets every intermediate `main` advertise only qualified capability subrows. It does not require a quiet branch or a complete-proof-at-HEAD loop.

### Overall assessment

The seven decisions form a plausible product direction and mostly use compatible vocabulary: explicit authority, exact generated contracts, fail-closed admission, semantic identity, observable client lifecycles, bounded plans, and retained-versus-current freshness reinforce each other. The current blockers are not requests for implementation-detail Specs. They are decisions where reasonable implementations would diverge on duplicate commits, administrator custody, content addresses, stale-ref identity, query exactness/order, or offline lease verification.

SET VERDICT: NOT READY
