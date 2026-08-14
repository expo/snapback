# Codex (GPT family) reviews — LLP 0255 (tiny data surface v1 API)

Review artifacts for `llp/0255-tiny-data-surface-v1-api.spec.md` from the
GPT family, one dated section per round, bodies verbatim. Codex
(`gpt-5.6-sol`) is also the lead author of the entering draft; loop
reviews come from fresh blind instances, per the run journal's
role-separation record.

## Round 1 — 2026-08-13

- **Runtime:** Codex CLI 0.147.0, model `gpt-5.6-sol`,
  `model_reasoning_effort=xhigh`, read-only sandbox,
  `--skip-git-repo-check`, launched blind in the round-1 capsule by the
  orchestrating session (launch 1).
- **Revision reviewed:** r1, SHA-256
  `8d7d63ff8459e9e8fcca086e5fb4ea280423d6ef011135fe4435321a2db69358`
  (64,741 bytes); verified in-capsule.
- **Capsule inventory SHA-256:**
  `73d50b7ca674cfc14f86b0d80fdb481bfd89526f937c6d8c5b6d2282849f4b30`;
  instruction SHA-256
  `6ba2498e8e4f1a3e460a54417d807bd2740b21534b53c32d057557b780c72593`.
- **Verdict:** NOT READY (6 MATERIAL; direction retained). Disclosed
  deviations: the pre-instruction harness skill-file read, and a
  `strings` invocation whose Apple tooling attempted (and failed)
  OS-cache accesses outside the capsule; no review or repository
  content obtained. Counted with disclosure.

---

# Independent review — LLP 0255 r1

- Reviewer: OpenAI Codex, GPT-5 family; exact serving variant not exposed
- Runtime: managed read-only macOS/zsh workspace
- Date: 2026-08-13
- Target: `llp/0255-tiny-data-surface-v1-api.spec.md`
- Verified identity: SHA-256 `8d7d63ff8459e9e8fcca086e5fb4ea280423d6ef011135fe4435321a2db69358`; 64,741 bytes. Both match the recorded revision.
- Notable capsule files read or searched: `REVIEW_INSTRUCTIONS.md`; LLP 0255 and binding LLP 0254 in full; LLPs 0252, 0253, 0065, 0218, 0043, 0238, 0241, 0242, 0243, 0157, and 0059; relevant code under `packages/snapback-codegen`, `packages/snapback-client`, `packages/snapback-react`, `guide/`, and `src/`.
- Non-capsule file read, disclosed below: `/Users/ccheever/.codex/skills/llp-review/SKILL.md`.

## Overall assessment

The proposed direction is strong and substantially honors LLP 0254: `.data` remains terminal and small; owner assignment is derived; query shapes are bounded and statically catalogued; scans and client-side policy execution are excluded; prediction, custody, settlement, and presentation remain distinct; synthesized operations are intended to become ordinary function slots; and the `/data` doorway does not claim new runtime owners. The sole-candidate index amendment is notably precise, and the document generally distinguishes proposed amendments from existing law.

The revision is not yet sufficient as implementation authority. Several identity and protocol definitions are cyclic or incomplete. In particular, a synthesized query cannot obtain the identity from which its own name is derived, neither query nor multi-operation transaction admission has a closed carrier, and the online-only ambiguity rule includes targets that lack the ledger required to resolve ambiguity. The bounded implementer probe therefore cannot produce all required artifacts and capability facts or state the complete server pipeline.

## Concerns

### 1. MATERIAL — Synthesized query identity is self-referential

**Target:** S4.1, S4.3, S6.2.

`normalizedDataQueryId` is the hash of the entire normalized query core (`llp/0255-tiny-data-surface-v1-api.spec.md:375-378`). That core includes `resolution.functionId` and `resolution.exportedName` (`:513-542`). For a no-match query, however, the exported name is `<resource>.query_<prefix of normalizedDataQueryId>` and the stable function id incorporates that name (`:846-857`).

Thus the identifier requires the synthesized name, while the synthesized name requires the identifier. No generation order or guaranteed fixed-point construction exists. This blocks every no-match query, not merely collision handling. LLP 0253 already demonstrates the repository’s preferred solution to self-reference: hash a bootstrap projection before inserting fields derived from that hash.

**Resolution:** Define an acyclic pre-resolution query-template witness that excludes synthesized resolution. Derive the synthesized exported name from that witness, construct the ordinary function reference, and then either:

- retain the template witness as `normalizedDataQueryId`; or
- define a separately named post-resolution artifact identity.

Freeze the exact domains and construction order in the schema and golden fixtures.

### 2. MATERIAL — The query descriptor and admission boundary are not a closed protocol

**Target:** S4.3, S5.1–S5.4, S6.3.

Several contract-bearing types are referenced but never defined as closed schemas: `DataFilterTemplateV1`, `DataCursorV1`, and `DataQueryExplainV1` (`llp/0255-tiny-data-surface-v1-api.spec.md:519,553,556`). The prose list for explain at `:814-821` does not define field names, variants, nullability, or redaction encodings. The cursor is only described as opaque. Runtime values become “numbered slots” (`:508-510`), while `DataQueryV1.arguments` is merely `readonly unknown[]` (`:551`); there is no canonical slot-assignment algorithm, slot schema, cursor binding, or mapping into the ordinary function’s named argument contract.

The server is required to admit an exact active witness and independently rebuild the plan and policy (`:702-709`), yet the request carrier is unspecified. The shipped query carrier posts only `args`, `auth`, `read_set`, and optional generation to `/query/<name>` (`packages/snapback-client/index.mjs:6296-6318`). The Spec does not choose whether the server binds a query through a new witness field, a unique active-catalog mapping from the ordinary route, an ordinary generated argument, or another versioned carrier. Consequently, “the server rejects a missing witness” (`llp/0255-tiny-data-surface-v1-api.spec.md:864-869`) is not implementable as written.

This is a security-boundary defect: client validation cannot substitute for a deterministic server admission contract.

**Resolution:** Add generated schemas for all referenced query types and define:

1. canonical filter/slot numbering and value-to-slot mapping;
2. exact ordinary argument object construction;
3. cursor bytes, integrity/authentication, scope, version, and cross-target golden representation;
4. static-catalog source roots and reachability;
5. the exact request carrier or unique route-to-catalog lookup;
6. ordered server validation, recomputation, equality checks, refusal precedence, QMK creation, materialization ownership, and first-row/snapshot delivery.

### 3. MATERIAL — Multi-chunk transactions have no authoritative execution carrier

**Target:** S4.4, S7.1–S7.4.

The transaction core records per-chunk function identities and a `functionReferences` array (`llp/0255-tiny-data-surface-v1-api.spec.md:575-624`), while S7 requires 1–16 chunks to execute as one authoritative transaction (`:900-905`). It never defines a whole-transaction ordinary function reference, route, generated plan, server admission record, or wire envelope. `canonicalArguments: readonly unknown[]` likewise has no chunk/slot mapping.

The shipped client mutation API invokes exactly one `Mutation` reference and one argument object (`packages/snapback-client/index.mjs:9027-9061`; `packages/snapback-client/index.d.mts:1666-1697`). Its wire request contains one mutation’s arguments and one `clientMutationId` (`packages/snapback-client/index.mjs:9143-9163`). There is no current carrier through which multiple references can become one server transaction, and capsule-wide searches found no non-LLP `DataTransactionV1` implementation.

Calling existing mutation endpoints sequentially would violate the promised atomicity. Inventing an unversioned batch endpoint or client-owned plan interpreter would violate LLP 0254’s single-runtime-owner and ordinary-function requirements.

**Resolution:** Select and specify one carrier. Suitable choices include:

- statically synthesizing an ordinary Mutation for each normalized transaction shape; or
- a versioned batch envelope admitted by an existing canonical server transaction owner.

In either case, freeze the whole-transaction identity, reference/route, argument and result tuple schemas, plan hash, server reconstruction, atomic execution, refusal ordering, one outbox/settlement identity, and result-position mapping.

### 4. MATERIAL — Online-only ambiguity requires a ledger that one admitted reason says is absent

**Target:** S3.2, S7.2–S7.4.

The proposed custody amendment says a possibly-crossed online-only intent remains durably pending and polls the server settlement ledger until committed, refused, or proven unaccepted (`llp/0255-tiny-data-surface-v1-api.spec.md:302-323`). Yet S7.2 explicitly converts a transaction to online-only when the target lacks the exact settlement-ledger/replay capability, assigning `target-no-settlement-ledger` (`:943-949`). Such an intent cannot perform the mandatory recovery the amendment requires. S7.4’s general statement that missing target capability refuses before transport (`:1003-1009`) does not reconcile this explicit online-only case.

The amendment also changes LLP 0043’s current refusal contract without defining the replacement server transition. LLP 0043 states that a typed server refusal has no server settlement to collect (`llp/0043-offline-replay-retention.rfc.md:374-377`), whereas LLP 0255 requires ledger-authoritative terminal refusal. An explicit amendment is present, but it does not specify creation, atomicity, retention, capacity, or acknowledgement of refusal ledger entries.

Finally, S3.2 projects the canonical existing identifier as `clientMutationId` (`llp/0255-tiny-data-surface-v1-api.spec.md:317-320`), while `DataTransactionV1` and every public transaction state use `intentId` (`:612-630,957-989`). No exact equality or translation rule is stated. The shipped optimistic and settlement owner keys layers by `clientMutationId` (`packages/snapback-client/generated-mutation-ir.mjs:87-89,130-137`).

**Resolution:** Require an ambiguity-resolution ledger for every target on which online-only dispatch may cross the transport boundary. A target without it must refuse before dispatch; absence of offline replay may still independently produce online-only custody. Extend the LLP 0043 amendment with refusal-ledger atomicity, retention/capacity, polling, and ACK rules. State that `intentId` is exactly the canonical `clientMutationId`, including its grammar, minting owner, wire field, and settlement key—or define one explicit lossless versioned mapping.

### 5. MATERIAL — The operation contracts and capability facts are not fully frozen

**Target:** S1.1–S2, S4.2, S5.4.

The Spec promises that arguments, results, refusals, retention, custody, capabilities, and identities are frozen (`llp/0255-tiny-data-surface-v1-api.spec.md:245-250`), but it does not state the complete owner CRUD result contracts or per-operation refusal sets. Current lowering makes list/get document arrays and create/update documents, while delete has no return declaration (`packages/snapback-codegen/standard-patterns.mjs:315-360`). The current contract extractor consequently falls back to `{kind:"unknown"}` for delete (`packages/snapback-codegen/result-contracts.mjs:851-914`). That is insufficient for the promised exact `DataTransactionV1` result tuple.

Capability derivation is also incomplete. `DataResourceV1` includes identity-bearing `retained` and `offlineCustody` booleans (`llp/0255-tiny-data-surface-v1-api.spec.md:470-482`), but no deterministic table derives them for the ordinary Todo case. Accepted LLP 0065 says generated queries claim no retained/offline capability by default (`llp/0065-generated-data-pattern-soundness.rfc.md:292-307`), and LLP 0243 requires explicit `maxOfflineMs` opt-in (`llp/0243-policy-aware-protected-retention.rfc.md:81-114`). LLP 0255 has no retention declaration but says sync opt-out “removes” retained capability (`llp/0255-tiny-data-surface-v1-api.spec.md:217-222`). An implementer can therefore plausibly emit different core bytes while following different portions of the corpus.

**Resolution:** Add a normative per-operation table covering exact argument schema, result schema, auth, reach, prediction, custody, retention, and refusal codes for owner and public-read resources. Give delete a closed result contract. Add an intrinsic-versus-target-served capability derivation table. If owner Todo retention remains false under LLP 0065/0243, say so explicitly; if `.data` introduces protected retention by default, add the required dated amendments, duration, exclusions, lease behavior, and evidence.

### 6. MATERIAL — The LLP 0238 reconciliation is incomplete and silently changes handle grammar

**Target:** S3.3, S5.4, S7.3, S8.

Accepted LLP 0238 defines the observable grammar as `subscribe(listener: () => void)` with consumers reading `snapshot()` (`llp/0238-explicit-client-lifecycles.rfc.md:194-241`). `DataTransactionHandleV1` instead invokes a state-bearing listener (`llp/0255-tiny-data-surface-v1-api.spec.md:957-965`). S3.3 proposes only a D4 query-state amendment; it does not amend D3’s handle grammar. This is a silent amendment.

The D4 reconciliation also says refresh moves from React state to the owning query handle/facade (`llp/0255-tiny-data-surface-v1-api.spec.md:332-346`). `db.watch` exposes refresh, but `db.useQuery` returns only `QueryState & {pendingWrites}` (`:796-805,1013-1024`). No React data handle, `db.refresh(descriptor)`, or other callable facade action is defined. Thus the amendment removes LLP 0238’s React `refresh` field (`llp/0238-explicit-client-lifecycles.rfc.md:247-279`) without providing the promised replacement.

**Resolution:** Make transaction subscription conform to the no-argument LLP 0238 grammar, or propose a complete dated D3 amendment. Define the exact React refresh action/facade and its lifecycle, coalescing, refusal, and disposal behavior. Clarify that the process-local `settled` promise is convenience only and that recovered observation remains the canonical authority.

## Implementer probe

### A. Owner Todo declaration and generated surface

The complete tiny declaration is determinable:

```ts
export const todos = defineTable({
  title: v.string(),
  completed: v.boolean(),
  ownerId: v.principal(),
  createdAt: v.integer(),
})
  .index("by_owner_created", ["ownerId", "createdAt"])
  .visibility({ kind: "owner", field: "ownerId" })
  .data({
    createDefaults: { createdAt: "now" },
    immutable: ["createdAt"],
  });
```

With policy omission, sync is enabled. The following are determinable:

- Operations: `todos.list`, `todos.get`, `todos.create`, `todos.update`, `todos.delete`.
- Stable ids: `{appId}:todos.list`, `{appId}:todos.get`, `{appId}:todos.create`, `{appId}:todos.update`, `{appId}:todos.delete`.
- Kinds: list/get `LiveQuery`; create/update/delete `Mutation`.
- Arguments: list `{}`; get/delete `{id}`; create `{title, completed}`; update `{id, title, completed}`.
- Owner is server-derived; `createdAt` is a trusted runtime default and immutable.
- Generated categories: `DataResourceV1`, five ordinary function-manifest members/references, `schemaManifest.dataResources`, `semanticInput.dataSurface`, generated `data.mjs`/`data.d.ts`, data package projections, and generation/bundle membership.
- Client surface: `db.todos` query typestate, `db.tx.todos` mutation chunks, `db.useQuery/watch/read/explain`, `db.transact`, and transaction recovery.
- The Appendix A query should resolve to the existing `todos.list` operation rather than require synthesis.

The exact result/refusal contracts and the `retained`/`offlineCustody` capability facts remain **UNDERDETERMINED** for the reasons in Concern 5. A no-match query’s synthesized identity is impossible under Concern 1, and the transaction invocation cannot be mapped to an authoritative carrier under Concern 3.

### B. Server admission from `db.useQuery` to first delivery

The intended outline can be inferred: construct and validate the static descriptor; resolve an exact existing or synthesized ordinary reference; bind slots/cursor; check generation and target capabilities; admit the active catalog witness; rebuild plan, policy, contracts, bounds, and resolution; authenticate and capture the authority partition; derive the canonical materialization key; install the existing materialization owner; execute the bounded index plan; and publish the first authoritative snapshot.

The complete pipeline is **UNDERDETERMINED**. The descriptor/witness carrier, slot mapping, cursor contract, route-to-catalog binding, precise server validation order, equality comparisons, refusal precedence, and handoff into first delivery are not specified. Current `/query/<name>` requests do not carry the described witness. Concern 2 must be resolved before two independent implementations can produce the same admission behavior.

## Direction assessment

Direction retained. The four-concept surface, static bounded queries, derived authority, ordinary-function lowering, distinct package doorway, and canonical lifecycle-owner strategy are sound. The concerns require contract closure and a few corrections, not a different product direction. No `DIRECTION-DISSENT` is warranted.

## Self-attestation

I did not read or search the contents of any file matching `llp/reviews/0255*`; a capsule-local existence check found none. I did not use the network, solicit another reviewer, or infer this round’s other reviews. All target-specific evidence came from files inside the capsule.

One confinement deviation occurred: developer-level skill rules required me to read `/Users/ccheever/.codex/skills/llp-review/SKILL.md` after the request triggered that skill. It was outside the capsule and contained only generic review-workflow instructions, with no LLP 0255, capsule, or other-reviewer content. A later attempt to run the system `strings` executable on the in-capsule `packages/snapback-react/implementation.mjs` caused Apple tooling to attempt access to OS temporary/cache paths outside the capsule; those cache operations failed, and they yielded no out-of-capsule review or repository content. I intentionally read no other out-of-capsule user or repository file.

My harness also injected, without my request, system/developer policies, tool and skill metadata, model/runtime and filesystem metadata, and the user-supplied AGENTS.md/environment context. None contained another review of LLP 0255.

VERDICT: NOT READY


## Round 2 — 2026-08-13 (delta round)

- **Runtime:** same as round 1 (Codex CLI 0.147.0, `gpt-5.6-sol`,
  `model_reasoning_effort=xhigh`, read-only sandbox), launched blind in
  the round-2 capsule (launch 2).
- **Revision reviewed:** r2, SHA-256
  `3c532efdc4ac7edafcd4f71153e34ad36dc093dd8bcdd155e3b633ebf7dcfdf2`
  (77,400 bytes); verified in-capsule.
- **Capsule inventory SHA-256:**
  `108098949a3764c4ec243124ca81b3d4a2b372d7d37f3f1a1a2bdfbe5e4402bf`;
  instruction SHA-256
  `128c3cc314a3f414c25d73ade5e54462fd99fb65cc00546dfa5081e7779d7e5f`.
- **Verdict:** NOT READY (7 MATERIAL, 1 DETAIL — all IN-DELTA; zero
  PRE-EXISTING MATERIAL; direction retained; both implementer probes
  rated failed pending the MATERIAL fixes). Disclosed deviation: the
  pre-instruction harness skill-file reads. Counted with disclosure.

---

# LLP 0255 r2 Independent Review

- **Model/runtime:** OpenAI Codex, GPT-5-family model, local shell/filesystem runtime
- **Review date:** 2026-08-13
- **Revision:** r2
- **Verified SHA-256:** `3c532efdc4ac7edafcd4f71153e34ad36dc093dd8bcdd155e3b633ebf7dcfdf2`
- **Verified size:** 77,400 bytes
- **Notable files:** `llp/0255-tiny-data-surface-v1-api.spec.md`, `llp/0254-tiny-ordinary-data-surface.rfc.md`, `llp/0043-offline-replay-retention.rfc.md`, `llp/0059-session-projection-and-client-barrier.spec.md`, `llp/0065-generated-data-pattern-soundness.rfc.md`, `llp/0243-policy-aware-protected-retention.rfc.md`, `src/manifest.rs`, `src/value_expr.rs`, `src/storage.rs`, `packages/snapback-codegen/index.mjs`, `packages/snapback-codegen/standard-patterns.mjs`, and `packages/snapback-client/outbox-shared.d.mts`

## Overall assessment

The r2 direction remains consistent with Accepted LLP 0254: static catalogs, server-authoritative admission, ordinary generated-function carriers, bounded transactions, and ledger-backed settlement are appropriate choices. The query construction order is now genuinely acyclic, and moving app-scoped resolution records outside normalized cores is sound.

The revision is not ready, however. The new batch contract is not expressible by the shipped HostPlan result machinery, transaction witness portability is defeated by an undefined and currently app-scoped `operationHash`, and the query and replay contracts do not determine the exact bytes and identities required by the requested implementer probes. Several additional closed-type contradictions prevent conforming implementation.

The supplied 19-item delta accounts for the materially changed r2 sections identifiable in the capsule; I found no undisclosed material change. Because r1 is intentionally absent, this is a structural trace against the supplied enumeration, not a byte-level r1/r2 comparison. I found no separate PRE-EXISTING material concern.

## Concerns

1. **MATERIAL — IN-DELTA: the promised closed batch-result tuple is not expressible by the shipped HostPlan profile.**

   **Evidence:** S7.1b requires one HostPlan whose result is a closed tuple of all per-chunk results (`llp/0255-tiny-data-surface-v1-api.spec.md:1105-1118`). The shipped `MutationPlan` has one `return_value` (`src/manifest.rs:9467-9471`). `ReturnValue` can return one literal, binding, document, changed count, or expression (`src/manifest.rs:9566-9577`), while `ValueExpr` provides a dynamic record constructor but no array/tuple constructor (`src/manifest.rs:9587-9645`). A literal array cannot contain evaluated per-chunk expressions.

   The sequencing itself is plausible within the 64-step ceiling (`src/value_expr.rs:43-46`): an owner update/delete currently uses three steps (`packages/snapback-codegen/standard-patterns.mjs:342-360`). But returning each post-operation result requires stable per-chunk bindings or additional reads, and standard plans reuse internal names such as `__standardOwnedRow` and `__standardCreatedId` (`packages/snapback-codegen/standard-patterns.mjs:312-350`). Concatenation therefore also needs deterministic alpha-renaming and result capture that the Spec does not define.

   **Required resolution:** Either specify and review an Array/Tuple `ValueExpr` or `ReturnValue` extension, including server/client evaluator parity and bounds, or change the API result to an expressible closed record. Define deterministic renaming of internal bindings and prove the worst-case 16-chunk plan, result capture, serialized plan, and result all remain within the stated ceilings.

2. **MATERIAL — IN-DELTA: the supposedly app-neutral transaction witness contains an undefined identity whose shipped meaning is app-scoped.**

   **Evidence:** Each transaction chunk includes `operationHash` (`llp/0255-tiny-data-surface-v1-api.spec.md:692-708`), but the target gives that field no domain, preimage, or derivation. Its only normative appearance is the type field. The shipped generated-mutation `operationHash` hashes a descriptor containing `functionId`, `implementationHash`, activation, and `schemaIdentity.appId` (`packages/snapback-codegen/index.mjs:8080-8109`). Function implementation identity independently contains `app: appId` (`packages/snapback-codegen/index.mjs:9687-9741`). Reusing that hash therefore contradicts the claim that normalized transaction cores compare equally across deployments (`llp/0255-tiny-data-surface-v1-api.spec.md:750-766`).

   The core also does not state whether chunk positions are dense or whether they start at zero or one, although those positions become wire-visible argument names in S7.1b.

   **Required resolution:** Define a versioned, domain-separated, app-neutral operation-semantic hash with an exact canonical preimage, or replace `operationHash` with already specified app-neutral fields. Explicitly exclude generation, function ID, implementation hash, and app identity. Define chunk positions as a canonical dense sequence and use that same rule for hashing and `c<position>_<argName>` names.

3. **MATERIAL — IN-DELTA: the declared settlement key drops identity axes that LLP 0043 requires for safe duplicate settlement.**

   **Evidence:** `DataTransactionV1.settlementIdentity` contains only `intentId`, `generationId`, and `normalizedDataTransactionId`, and the prose calls those fields the settlement key (`llp/0255-tiny-data-surface-v1-api.spec.md:739-756`). Yet S3.2 says the durable record retains exact function identity, canonical arguments, and authority capture (`llp/0255-tiny-data-surface-v1-api.spec.md:333-337`). LLP 0043 requires lookup by the exact `(clientMutationId, function, input, auth fingerprint, authority instance)` tuple and refuses any changed component (`llp/0043-offline-replay-retention.rfc.md:414-425`).

   The narrow key could alias different synthesized functions, arguments, or authorities under one intent and transaction witness, contrary to the governing settlement contract.

   **Required resolution:** Make `settlementIdentity` preserve the complete canonical LLP 0043 identity: canonical `clientMutationId`, synthesized function identity, canonical input bytes/digest, authenticated authority fingerprint and instance, plus the original generation. `normalizedDataTransactionId` may be an additional assertion but cannot replace those axes.

4. **MATERIAL — IN-DELTA: `AuthorityCaptureV1` is not the durable LLP 0043 enqueue record claimed by the Spec.**

   **Evidence:** S4.4 uses `AuthorityCaptureV1` and says it is LLP 0043’s existing enqueue capture record “unchanged” (`llp/0255-tiny-data-surface-v1-api.spec.md:739-761`). LLP 0043 instead defines three durable records: `authorityDescriptor`, `principalScope`, and `custody`; it deliberately excludes `custodyRevision` (`llp/0043-offline-replay-retention.rfc.md:656-680`). The shipped outbox type has those three separate fields (`packages/snapback-client/outbox-shared.d.mts:15-41`).

   The corpus’s actual named `AuthorityCaptureV1` is the process fence capture `{authorityEpoch, custodyRevision, authorityKey}` (`llp/0059-session-projection-and-client-barrier.spec.md:1677-1681`), which is not the durable replay record and contains the axis LLP 0043 excludes.

   **Required resolution:** Define or reference a closed durable replay-authority type matching LLP 0043’s three records exactly. Keep the process-local fence capture separately named and specify which representation enters the transaction envelope, durable outbox bytes, replay request, and settlement identity.

5. **MATERIAL — IN-DELTA: the query contract does not determine the ordinary wire argument object.**

   **Evidence:** `DataQueryV1` stores runtime arguments only as `readonly unknown[]` (`llp/0255-tiny-data-surface-v1-api.spec.md:630-648`), and slot indices are assigned densely (`llp/0255-tiny-data-surface-v1-api.spec.md:676-684`). The wire rule then requires slot values “under generated parameter names” without specifying the parameter-name grammar or the slot-to-name mapping (`llp/0255-tiny-data-surface-v1-api.spec.md:847-856`). Consequently, two conforming implementations could emit different canonical argument bytes for the same witness.

   The new read profile also says list accepts optional `after` (`llp/0255-tiny-data-surface-v1-api.spec.md:247-250`) while its operation contract says `<table>.list` has no public arguments (`llp/0255-tiny-data-surface-v1-api.spec.md:258-263`).

   **Required resolution:** Specify the exact generated name for every slot, its ordering and canonical JSON construction, and whether absent `after` is omitted or encoded as null. Rewrite the list contract as “no domain arguments other than optional `after`,” or otherwise reconcile pagination with the no-argument claim.

6. **MATERIAL — IN-DELTA: target replay incapability produces an online-only state that the closed custody vocabulary cannot represent.**

   **Evidence:** `DataCustodyReasonV1` has only `operation-reach-online-only`, `result-contract-not-replayable`, and `authority-capture-not-replayable` (`llp/0255-tiny-data-surface-v1-api.spec.md:486-494`). S7.2 says a transaction is queue-eligible only if every chunk is queue-eligible **and the target has replay capability**; otherwise it becomes online-only and carries reasons from that same closed list (`llp/0255-tiny-data-surface-v1-api.spec.md:1158-1165`). None of the reasons denotes an otherwise replayable transaction served by a target lacking replay support.

   This also blurs S4.2’s distinction between intrinsic `offlineCustody` and target capability checked only at dispatch (`llp/0255-tiny-data-surface-v1-api.spec.md:586-594`).

   **Required resolution:** Either add a target-replay-capability reason and keep it in a target-specific dispatch disposition rather than the app-neutral core, or make replay capability mandatory and refuse such a target before transport, as r2 already does for a missing settlement ledger.

7. **MATERIAL — IN-DELTA: retention is both unconditionally absent and conditionally admitted.**

   **Evidence:** S4.2 states `retained` is unconditionally false in v1 because `.data` declares no `maxOfflineMs` (`llp/0255-tiny-data-surface-v1-api.spec.md:586-594`), and `DataQueryExplainV1` fixes `retained:false` (`llp/0255-tiny-data-surface-v1-api.spec.md:972-996`). S5.4 nevertheless says protected retention is admitted when LLP 0243 facts pass (`llp/0255-tiny-data-surface-v1-api.spec.md:965-970`), and Acceptance requires retained/offline transitions (`llp/0255-tiny-data-surface-v1-api.spec.md:1404-1408`). LLP 0065 expressly gives generated queries no v1 retained/offline capability (`llp/0065-generated-data-pattern-soundness.rfc.md:299-307`), while LLP 0243 requires explicit `maxOfflineMs` opt-in (`llp/0243-policy-aware-protected-retention.rfc.md:81-114`).

   **Required resolution:** For v1, remove conditional retention admission and require proof that data queries remain non-retained through lifecycle changes. Alternatively, add a real declaration/profile and revise the unconditional-false capability and explanation contracts through the governing amendments.

8. **DETAIL — IN-DELTA: the asserted fail-closed no-drop table is not actually enumerated.**

   **Evidence:** S2 promises an explicit disposition for every canonical generated-function field (`llp/0255-tiny-data-surface-v1-api.spec.md:277-287`), but S4.2’s operation record lists only a subset (`llp/0255-tiny-data-surface-v1-api.spec.md:532-549`) and provides no field-by-field mapping to envelope/reference/forbidden destinations. The shipped canonical record includes additional fields such as handler form, full contracts, required capabilities, auth requirement, retention declarations, and refusal families (`packages/snapback-codegen/index.mjs:9730-9755`).

   **Disposition:** Add the promised explicit mapping table and a generation assertion over the actual canonical record schema. Blanket preservation through `FunctionReference` is acceptable only if the Spec names and tests that exact disposition.

## Implementer-probe result

### A. One `db.useQuery` admission and wire path

The Spec determines this much:

1. The compiler extracts the static fluent chain into `dataQueryCatalog`, replaces runtime values with dense slots, hashes the pre-resolution template core, and resolves it to an exact existing data-lowered query or `data.q_<witness-prefix>` synthesized member.
2. Runtime constructs the envelope with the active generation, exact function reference, slot-value array, optional cursor, canonical-argument digest, authority partition, QMK, and explanation.
3. `db.useQuery` admits only when sync, live delivery, local materialization, and target support are present.
4. The client invokes the resolved ordinary query route. No witness is transmitted. The semantic payload is one canonical argument object containing the slot values and optional `after`.
5. The server binds the route to the active generation’s catalogued member and therefore to its frozen plan, policy, contracts, bounds, and witness-derived synthesized name.

The path is not complete from the document alone: it never maps slot indices to generated parameter names or defines absent-`after` encoding, so the canonical argument bytes cannot be stated. The list contract also simultaneously has no arguments and an optional cursor argument. Probe A therefore fails.

### B. Three-chunk `db.transact` identity and replay

For a three-chunk template, the intended story is:

1. The static ordered chunk shapes produce one app-neutral normalized transaction witness.
2. Codegen emits one ordinary generated Mutation named `data.tx_<first 16 lowercase hex digits of normalizedDataTransactionId>`, with stable ID `{appId}:{exportedName}` and one `FunctionReference`.
3. The member contains the three chunk plans sequenced into one HostPlan. Runtime values are placed under `c<position>_<argName>` keys. Its result is intended to be `[chunk0Result, chunk1Result, chunk2Result]`.
4. Dispatch uses one canonical `clientMutationId`, exactly equal to `intentId`, and one ordinary mutation carrier. Prediction is one atomic layer or none.
5. If every chunk is intrinsically queue-eligible and the target supports replay, one outbox record retains the exact synthesized function, canonical arguments, original generation, authority capture, prediction claims, sequence, and transaction identity. Replay invokes that one mutation under the original generation; there is no per-chunk replay. A ledger-bearing server deduplicates and republishes the terminal result.
6. Otherwise the transaction is online-only, still ledger-gated, with durable ambiguity observation after the possibly-crossed boundary.

The story cannot be completed conformingly: the operation hash and position base are undefined; the closed result tuple is not representable by current HostPlan; internal plan bindings are not renamed; the named authority capture is the wrong artifact; the settlement identity omits LLP 0043 axes; and target replay absence lacks a custody reason. Probe B therefore fails.

## Direction assessment

**DIRECTION-DISSENT: none.** The acyclic witness construction, app-neutral-core objective, route-to-catalog carrier, one-function atomic transaction model, and mandatory settlement ledger are sound continuations of LLP 0254. The concerns are contract-closure and shipped-machinery feasibility defects, not objections to the chosen product direction.

Self-attestation: I did not access any file matching `llp/reviews/0255*`, use the network, or communicate with another reviewer. I used only capsule files as substantive review evidence. Deviation: before substantive review, system-mandated skill handling caused me to read the external `llp-review` and `llp-orient` `SKILL.md` workflow files under `/Users/ccheever/.codex/skills`; they affected only review procedure and orientation and contained no target or reviewer evidence. No other deviation occurred.

VERDICT: NOT READY


## Round 3 — 2026-08-13 (delta round)

- **Runtime:** same as rounds 1–2 (Codex CLI 0.147.0, `gpt-5.6-sol`,
  `model_reasoning_effort=xhigh`, read-only sandbox), launched blind in
  the round-3 capsule (launch 3).
- **Revision reviewed:** r3, SHA-256
  `2d5476688b623745f53182cbb1b3831822777a7244144d3935085d6a00d14be4`
  (85,877 bytes); verified in-capsule.
- **Capsule inventory SHA-256:**
  `ffc057c71d318f19ca155905bdbb4aa5902518be0771f58eb75b7760f6502065`;
  instruction SHA-256
  `2a3226c2f5324ebffcbb51a959eadec1bcf8503487a65719942ab33aca5e5637`.
- **Verdict:** NOT READY (4 MATERIAL, all IN-DELTA; zero PRE-EXISTING
  MATERIAL; direction retained; probe A determinate to exact wire bytes
  except cursor authenticity, probe B determinate except the settlement
  and target-capability blockers). No deviations reported.

---

# Independent review — LLP 0255 r3

**Model/runtime:** OpenAI Codex, GPT-5 runtime  
**Date:** 2026-08-13  
**Revision:** `2d5476688b623745f53182cbb1b3831822777a7244144d3935085d6a00d14be4`  
**Identity verification:** Verified SHA-256 and 85,877-byte size.  
**Notable files:** `REVIEW_INSTRUCTIONS.md`; `llp/0255-tiny-data-surface-v1-api.spec.md`; LLPs 0004, 0043, 0059, 0065, 0133, 0157, 0218, 0238, 0241, and 0254; `src/manifest.rs`; `src/rqs.rs`; `src/storage.rs`; `src/value_expr.rs`; `packages/snapback-client/generated-mutation-ir.mjs`; `packages/snapback-codegen/standard-patterns.mjs`.

## Overall assessment

R3 substantially improves the Spec: the `documents`/facade split is coherent, the record-return batch construction is supported by the shipped `ReturnValue::Expr(ValueExpr::Record)` machinery, the slot grammar is closed, and the three-chunk lowering is bounded and implementable.

All 13 enumerated delta items are present in r3. Because the capsule intentionally contains no r2, I could verify their presence and internal consequences but could not independently prove that the enumeration contains every textual r2→r3 change.

Four IN-DELTA material defects remain. The most serious are an incomplete and conflicting settlement identity, an unrepresentable target-capability split, and a remediation that would dispatch online-only writes without the durable ambiguity record the Spec itself requires.

## Concerns

1. **MATERIAL — IN-DELTA: `settlementIdentity` is neither LLP 0043’s complete duplicate identity nor compatible with the shipped field of that name.**

   The new record contains `canonicalArgsDigest` and then calls it LLP 0043’s complete “canonical input digest” (`llp/0255-tiny-data-surface-v1-api.spec.md:809-817`, `llp/0255-tiny-data-surface-v1-api.spec.md:841-845`). The canonical identity is broader: the shipped input fingerprint covers `{args, readSet, ctxLedger}`, and LLP 0133 further binds lane, implementation/activation claims, claim set, and bounded-skew declaration (`llp/0133-local-settlement.spec.md:272-300`). R3 places `predictionClaims` and `createdAtClaim` outside `settlementIdentity`, and carries no read-set identity there, so two submissions with the same intent/function/arguments but different captured IDs, clock, read baseline, or settlement lane are not distinguished by the specified record.

   The name also collides with an existing mutation-request field: shipped generated IR emits `settlementIdentity:{implementationHash,activation}` (`packages/snapback-client/generated-mutation-ir.mjs:137-145`), and the ordinary mutation carrier serializes that field (`packages/snapback-client/index.mjs:9249`). Replacing it with r3’s record would change LLP 0133’s wire contract; keeping it only in the facade leaves r3’s claimed server settlement key unenforceable.

   **Resolution:** Preserve the existing LLP 0133 `settlementIdentity` request field unchanged. Define a distinctly named projection of the server-derived `ClientMutationIdentity`, including its canonical input fingerprint and all LLP 0133 extensions. State whether `generationId` and `normalizedDataTransactionId` are client-side assertions or owner-ratified ledger identity inputs; they must not silently alter the canonical ledger key.

2. **MATERIAL — IN-DELTA: the `ledger-bearing` but replay-incapable target required by `targetCustody` cannot be represented by the shipped capability registry.**

   R3 distinguishes “replay-capable” from “ledger-bearing” and allows a ledger-bearing target without `offline_mutation_replay` to dispatch with `targetCustody:"online-only-target-no-replay"` (`llp/0255-tiny-data-surface-v1-api.spec.md:390-418`, `llp/0255-tiny-data-surface-v1-api.spec.md:1281-1293`). No separate settlement-ledger advertisement exists. The registry defines `offline_mutation_replay` as the capability that says the target atomically retains settlements (`src/manifest.rs:10744-10749`), and support is exactly `client_mutation_settlement_ledger_registered` (`src/manifest.rs:11129-11135`). `TargetCapabilityId::ALL` contains no independent ledger capability (`src/manifest.rs:10826-10870`).

   Thus, under shipped capability semantics, a ledger-bearing target advertises `offline_mutation_replay`; a target lacking it supplies no positive ledger evidence and must refuse. The new degradation branch is unreachable without another owner change.

   **Resolution:** Either add and owner-ratify a distinct positive settlement-ledger capability, specifying how `offline_mutation_replay` depends on it, or require `offline_mutation_replay` for every v1 data write and remove `online-only-target-no-replay`. Do not infer ledger support from ordinary mutation success.

3. **MATERIAL — IN-DELTA: the missing-store remediation contradicts mandatory durable recovery for online-only dispatch.**

   S3.2 requires the client-store owner to persist a non-replayable observation before online-only dispatch, atomically mark the possibly-crossed boundary, and retain durable pending state through crash/response loss (`llp/0255-tiny-data-surface-v1-api.spec.md:367-380`). Nevertheless, S12 tells a caller lacking a durable client store to “use a declared online-only operation” (`llp/0255-tiny-data-surface-v1-api.spec.md:1524`). S7.4 likewise names inability to persist only queue-eligible custody as a pre-transport refusal (`llp/0255-tiny-data-surface-v1-api.spec.md:1354-1362`).

   Following the documented next action would remove the only durable evidence needed to distinguish `not-crossed` from `possibly-crossed`, recreating the ambiguous-outcome loss that S3.2 was added to prevent.

   **Resolution:** Require a durable client store for both replayable outbox custody and online-only non-replayable observations. Update S7.4 and S12 accordingly. If a no-store online mode is desired, it requires a separately reviewed, explicitly nonrecoverable contract rather than being presented as remediation for this v1 surface.

4. **MATERIAL — IN-DELTA: `DataCursorV1` cannot enforce the claimed server-minted boundary.**

   S3.4 calls the continuation server-minted (`llp/0255-tiny-data-surface-v1-api.spec.md:457-473`), but the closed wire format is only `dc1.` plus base64url-encoded JCS containing public binding fields and `lastKey`; it has no MAC, signature, or other mint proof (`llp/0255-tiny-data-surface-v1-api.spec.md:1000-1008`). A caller can decode a valid cursor, retain its app/generation/plan/argument/authority digests, replace `lastKey`, and re-encode it. All specified byte-binding checks still pass, turning the statically catalogued query into an arbitrary caller-selected range start.

   This is weaker than the existing standard-pattern cursor, whose per-instance binding and HMAC are explicit (`src/rqs.rs:115-177`), and contradicts the “server-minted” rather than caller-authored continuation decision.

   **Resolution:** Add a versioned authenticity and target/data-instance binding contract—preferably reusing the established cursor-key authority—or explicitly admit caller-authored range boundaries and re-review the query grammar and security posture. The Spec must also state the mint-failure disposition and how signing-key retention composes with its no-wall-clock-expiry promise.

## Implementer probe

### A. Appendix A1 Todo pagination

The template has no filter slots and exactly matches the generated `todos.list` member: same resource, `by_owner_created` index, ascending `createdAt` order, limit 100, policy, contracts, and optional `after` argument. Its stable function ID is `{appId}:todos.list`.

- Page 1 argument bytes are exactly UTF-8/JCS `{}` (`7b 7d`).
- Let `C1` be the exact `DataCursorV1` returned by page 1. Page 2 argument bytes are exactly the ASCII concatenation `{"after":"` + `C1` + `"}`. No owner, limit, index, order, or witness travels in the argument object.
- `DataQueryV1.arguments` is `[]` on both pages because `after` is not a positional slot. The cursor’s internal `argsDigest` is the digest of the empty non-cursor argument object; the invocation/QMK canonical arguments differ on page 2 because they include `after`.

The runtime cursor value cannot be written as a literal before page 1 because it binds runtime app/generation/plan/authority and the last returned key. Apart from Concern 4’s missing mint authenticity, the wire object is determinate.

### B. Three-chunk `db.transact`

For three statically catalogued chunks, positions are exactly 0, 1, and 2. Resolution emits one ordinary mutation named:

```text
data.tx_<first 16 lowercase hex digits of normalizedDataTransactionId>
```

with stable ID `{appId}:data.tx_<prefix>`. One ordinary mutation request carries one `clientMutationId` equal to `intentId` and one argument object whose keys are `c0_<argName>`, `c1_<argName>`, and `c2_<argName>`. There is no batch endpoint or per-chunk dispatch.

The authoritative return is the closed record:

```text
{ c0: <post-write row or null>,
  c1: <post-write row or null>,
  c2: <post-write row or null> }
```

Create and update positions contain their post-write documents; delete positions contain `null`. It is produced by `ReturnValue::Expr(ValueExpr::Record)` over renamed post-write `Get` bindings, then projected by the client to positional tuple `[c0,c1,c2]`.

For `c` creates, `u` updates, and `d` deletes where `c+u+d=3`:

- plan steps are at most `2c + 4u + 3d`, hence at most 12 of 64;
- declared reads are at most `c + 2u + d`, hence at most 6 of 32;
- writes are exactly 3, within 16;
- resources are at most 3, within 8;
- chunks are 3, within 16;
- the generated plan and descriptor must each fit their 65,536-byte bounds;
- the durable record must fit 262,144 bytes;
- the result must fit 65,536 bytes.

Any exceeded bound refuses at generation; the transaction is never split.

Intrinsic custody is queue-eligible only if all three chunks are queue-eligible. Prediction is generated-exact only if all three chunks are locally executable with current required rows and authority; otherwise the whole batch has no prediction. On a replay-capable, ledger-bearing target, the client durably records the single intent and authority triple, dispatches/replays the synthesized mutation atomically under its original generation, stores one settlement record, projects the result record to the tuple, and completes the existing acknowledgement lifecycle. Intrinsically online-only dispatch instead records the non-replayable boundary observation and resolves ambiguity by the same intent identity.

The complete identity/target story is not yet determinate: Concern 1 leaves the canonical ledger input identity incomplete and conflicts with the shipped `settlementIdentity` field, while Concern 2 leaves the ledger-bearing/no-replay target state unrepresentable. Those are specification blockers, not implementation choices.

## Direction assessment

**DIRECTION-ASSENT.** The generated-resource, bounded-query, single-HostPlan transaction, and truthful lifecycle direction remains consistent with LLP 0254. The concerns require contract repairs and owner amendments, not a fundamental redesign.

Self-attestation: I worked only from files inside this capsule; I did not access the network, read any `llp/reviews/0255*` file, or consult another reviewer. Deviation: none. The capsule contains no r2, so delta completeness was assessed against the supplied enumeration as `REVIEW_INSTRUCTIONS.md` directs.

VERDICT: NOT READY


## Round 4 — 2026-08-13 (verification delta round)

- **Runtime:** same as prior rounds (Codex CLI 0.147.0, `gpt-5.6-sol`,
  `model_reasoning_effort=xhigh`, read-only sandbox), launched blind in
  the round-4 capsule (launch 4).
- **Revision reviewed:** r4, SHA-256
  `66bc954966e29f57efc4914538100a65581dafd18b7673e423f1ffda2794a7a8`
  (90,194 bytes); verified in-capsule.
- **Capsule inventory SHA-256:**
  `6dd25b345c207d7960950735b198035b79898574c9de876928912046feb56150`;
  instruction SHA-256
  `7000adbe7597200633a507d2f08a04411534453f75f18d71064e4e3e6cd99354`.
- **Verdict:** NOT READY (3 MATERIAL, all IN-DELTA; zero PRE-EXISTING
  MATERIAL; direction retained; probe (a) determinate, probe (b)
  failed on the fingerprint/name/issuance gaps). Disclosed deviation:
  the pre-instruction harness skill-file read. Counted with disclosure.

---

# Independent review — LLP 0255 r4

**Model/runtime:** OpenAI Codex, GPT-5 runtime  
**Date:** 2026-08-13  
**Revision:** SHA-256 `66bc954966e29f57efc4914538100a65581dafd18b7673e423f1ffda2794a7a8`, independently verified; 90,194 bytes, 1,777 lines.  
**Notable files:** `llp/0255-tiny-data-surface-v1-api.spec.md`, LLPs 0254, 0043, 0058, 0133, and 0163; `src/manifest.rs`, `src/storage.rs`, `src/local.rs`, `src/contract_types.rs`, and `packages/snapback-codegen/index.mjs`.

## Overall assessment

Not ready. The r4 text contains all twelve enumerated delta manifestations; because r3 is intentionally absent, this verifies the list against r4 rather than reproducing a byte diff.

Several repairs are correct:

- The single target predicate exactly matches the shipped registry: `offline_mutation_replay` is derived directly from `client_mutation_settlement_ledger_registered` (`src/manifest.rs:11128-11135`; `llp/0058-shared-invocation-authority-and-staged-auth-mode-protocol.spec.md:413-420`).
- `ledgerIdentity` no longer collides with the shipped wire field `settlementIdentity`.
- `DataPageV1`, canonical `documents`, and `QueryOutput` are used consistently as facade, result contract, and executor envelope respectively.
- The binary target disposition and durable-store requirement are clear.

Three IN-DELTA material defects remain.

## Concerns

1. **MATERIAL — IN-DELTA: `ledgerIdentity` is not a complete or implementable projection of the shipped settlement identity.**

   The Spec declares a client-side tuple containing `functionId`, `inputFingerprintDigest`, `authorityFingerprint`, and `authorityInstance` (`llp/0255-tiny-data-surface-v1-api.spec.md:833-842`) and calls it the complete server-derived duplicate-settlement tuple (`llp/0255-tiny-data-surface-v1-api.spec.md:869-879`). The shipped contract differs or leaves necessary derivations unspecified:

   - The server compares the invocation `name`, not the `{appId}:{exportedName}` stable function id: it constructs `ClientMutationIdentity` with `name.to_owned()` (`src/local.rs:11549-11555`).
   - `authorityFingerprint` has no stated client source. The server derives it from canonical `AuthInput`, including principal, session id, and user id (`src/manifest.rs:10503-10516`); LLP 0043’s durable descriptor/principal/custody records are not themselves that fingerprint.
   - The exact input-fingerprint algorithm is not pinned. Shipped code conditionally hashes either `{args, readSet, ctxLedger}` or that object plus a nested `settlement` record, using its existing canonical-JSON serialization and no domain prefix (`src/storage.rs:15990-16014`). Saying that the digest “covers” those facts does not determine interoperable bytes.
   - The accepted issuance-bearing path additionally compares optional artifact-generation and operation-issuance facts (`src/storage.rs:839-853`; `src/local.rs:11502-11531`; `llp/0163-operation-identity-and-commit-envelope.spec.md:338-345`). LLP 0255 neither includes them nor explicitly forbids `operationIdentityProtocol:1` for data writes.
   - The assertion that original generation participates in the “settlement key” (`llp/0255-tiny-data-surface-v1-api.spec.md:853-855`) conflicts with the later statement that `generationId` never alters the canonical ledger key (`llp/0255-tiny-data-surface-v1-api.spec.md:877-879`). The physical key is the mutation id; function, input, auth, authority, and optional issuance facts are compared identity.

   **Resolution:** Define the exact server identity field-for-field: `clientMutationId`, wire/exported function name, server auth fingerprint, authority-instance id, exact input-fingerprint preimage and hashing algorithm, and the disposition of artifact generation and operation issuance. Either make this a post-server projection, or separately name the pre-dispatch client assertions and stop describing them as the server-derived tuple. Explicitly fix whether data calls forbid or support the issuance-bearing carrier.

2. **MATERIAL — IN-DELTA: the revised no-drop table still loses shipped `FunctionDefinition` facts and points to a nonexistent projection field.**

   The Spec promises a field-complete disposition and claims generation will fail for any undisposed shipped field (`llp/0255-tiny-data-surface-v1-api.spec.md:290-329`). It does not satisfy that promise:

   - The table says read requirements occupy core `requiredCapabilities` (`llp/0255-tiny-data-surface-v1-api.spec.md:314`), but `NormalizedDataResourceV1.operations` has no such member (`llp/0255-tiny-data-surface-v1-api.spec.md:621-638`). `FunctionReference` does not carry it either (`packages/snapback-codegen/index.mjs:12986-13029`). The transaction core likewise does not record the universal write requirement `offline_mutation_replay`.
   - The canonical `EffectCeilingV1` contains version, basis, indexed read access, exact write operations, host operations, and authorization inputs (`src/contract_types.rs:1431-1471`). The projection replaces that record with only `"read" | "write"` (`llp/0255-tiny-data-surface-v1-api.spec.md:629-632`), despite claiming ceiling data is copied from the canonical owner (`llp/0255-tiny-data-surface-v1-api.spec.md:668-670`).
   - `readSetSummary` and `writeSetSummary` contain `primaryTable`, `tables`, `mode`, and `authScopeField` (`src/contract_types.rs:1644-1654`). The table disposes only tables/reach and `authScopeField`, leaving `mode` and `primaryTable` unaccounted for.
   - A top-level schema iterator cannot detect future subfield loss once `effectCeiling` or a dependency summary is nominally considered disposed.

   **Resolution:** Carry the exact canonical `requiredCapabilities`, `EffectCeilingV1`, `readSetSummary`, and `writeSetSummary`, or define a lossless derivation whose parity gate recursively compares every member. Pin `offline_mutation_replay` in every write function/transaction’s required-capability facts rather than treating intrinsic custody as a substitute.

3. **MATERIAL — IN-DELTA: the no-MAC cursor argument relies on a false equivalence.**

   S3.4 correctly says strict continuation over `(orderField, _id)` is inexpressible in the closed conjunctive filter grammar (`llp/0255-tiny-data-surface-v1-api.spec.md:486-489`). S5.3 then says a forged `lastKey` is equivalent to a range filter that grammar already admits (`llp/0255-tiny-data-surface-v1-api.spec.md:1055-1061`). Those statements cannot both be true.

   For a non-unique ordering key, strict continuation requires a disjunction such as `(order > value) OR (order = value AND _id > id)`—with direction adjustments. The shipped keyset lowerer does exactly this (`src/storage.rs:5243-5312`), while the tiny grammar admits only contiguous equality plus one range/`in` position and no authored `_id` tie-break predicate (`llp/0255-tiny-data-surface-v1-api.spec.md:985-1016`).

   The desired security conclusion may still hold, but it needs a different proof: an arbitrary well-typed boundary selects only a suffix of the same bounded, policy-composed total order. For owner policy, the seek must remain inside the authenticated owner prefix; for public-read, all selected rows are already public. That must be explicit and tested, particularly with another owner’s boundary, nonexistent tuples, duplicate/null ordering values, and both directions.

   **Resolution:** Replace the range-filter claim with that suffix/non-widening proof and add the named negative cases, or require a MAC. Do not ratify the no-MAC posture on the present contradictory argument.

## Implementer probe

### (a) V1 target-capability story

This part is determinate:

- Reads do not take custody. `db.read` needs bounded-read support; `db.useQuery` and `db.watch` additionally need app sync, live delivery, local materialization, and corresponding target support.
- Every data write requires a durable client store before transport.
- Intrinsically queue-eligible transactions are served only by a target advertising `offline_mutation_replay`; they use a durable outbox and report `targetCustody:"queue-served"`.
- Intrinsically online-only transactions require that same advertisement, use a durable non-replayable observation, and report `targetCustody:null`.
- An online-only observation advances atomically from `not-crossed` to `possibly-crossed`; ambiguity after the latter remains pending and polls the settlement ledger by stable intent identity.
- A target lacking `offline_mutation_replay`, or a client unable to persist the appropriate record, refuses every data write before transport with `SNAPBACK_DATA_CUSTODY_UNAVAILABLE`.
- Prediction is independent of custody and does not change these target rules.

### (b) Three-chunk ledger identity

The document determines that three chunks resolve to one synthesized mutation named `data.tx_<first-16-hex-of-normalizedDataTransactionId>`. Positions are `0`, `1`, and `2`; wire arguments are the single named object using `c0_<argName>`, `c1_<argName>`, and `c2_<argName>`. `canonicalArguments[]` is the same values in chunk-major argument-contract order, while `canonicalArgsDigest` hashes only the named wire object.

The declared `ledgerIdentity` then contains:

- `intentId`: the stable `clientMutationId`;
- `functionId`: apparently the synthesized stable function id, although the server ledger actually compares the exported route name;
- `canonicalArgsDigest`: the separate domain-separated JCS witness;
- `inputFingerprintDigest`: intended to cover wire args, `readSet`, `ctxLedger`, lane, implementation/activation claims, claim set, and bounded-skew declaration;
- `authorityFingerprint`: intended to match the server-derived auth fingerprint;
- `authorityInstance`: the durable authority descriptor’s instance;
- `generationId`: original generation assertion;
- `normalizedDataTransactionId`: the three-chunk template witness.

The server should first validate the authority descriptor, then use `intentId` to locate the ledger row and exact-compare function, input fingerprint, auth fingerprint, authority instance, and any applicable issuance facts. Exact agreement republishes the retained settlement; divergence refuses without execution.

**Probe result:** failed. The exact source/preimage for three fields, the function-name versus function-id mapping, and issuance-bearing identity are not determined by the Spec, so an implementer cannot construct the promised complete ledger tuple from the document alone.

## Direction assessment

No direction dissent. The tiny, generated, profile-neutral surface remains consistent with LLP 0254’s direction. The defects concern contract completeness and security justification, not the four-concept product hypothesis or the decision to reuse canonical runtime owners.

**Self-attestation:** Deviation from capsule confinement: before substantive review I read `/Users/ccheever/.codex/skills/llp-review/SKILL.md` because higher-priority runtime instructions required loading the applicable skill. It contained generic LLP review procedure and no LLP 0255 or project-review content. Otherwise I read only files inside the capsule, made no network calls, read no `llp/reviews/0255*` file (none existed), used no other reviewer output, and made no writes.

VERDICT: NOT READY


## Round 5 — 2026-08-13 (verification delta round)

- **Runtime:** same as prior rounds (Codex CLI 0.147.0, `gpt-5.6-sol`,
  `model_reasoning_effort=xhigh`, read-only sandbox), launched blind in
  the round-5 capsule (launch 5).
- **Revision reviewed:** r5, SHA-256
  `02afe7cfa8fd784c1741b7d8f0ea040d99c265c0348100f6c279a27e6ce8ea1b`
  (93,254 bytes); verified in-capsule.
- **Capsule inventory SHA-256:**
  `3c94f040d3002ab70a7dbd21fd7b04de127cbe7663eb37e3a77e4ef3106cc3dd`;
  instruction SHA-256
  `e791e6890d26320160de34fd637abdf0ae6dcecf47062fe781a6958b7eb87176`.
- **Verdict:** NOT READY (3 MATERIAL, 1 DETAIL — all IN-DELTA; zero
  PRE-EXISTING MATERIAL; direction retained; the suffix/non-widening
  cursor proof verified sound; the probe's six-step settlement
  procedure determinate modulo its concern 2). Disclosed deviation: the
  pre-instruction harness skill-file read. Counted with disclosure.

---

# Independent review — LLP 0255 r5

- **Model/runtime:** OpenAI Codex (GPT-5), capsule-local shell runtime
- **Date:** 2026-08-13
- **Revision:** r5
- **Verified identity:** SHA-256 `02afe7cfa8fd784c1741b7d8f0ea040d99c265c0348100f6c279a27e6ce8ea1b`; 93,254 bytes; 1,814 lines
- **Notable files:** `llp/0255-tiny-data-surface-v1-api.spec.md`, `llp/0254-tiny-ordinary-data-surface.rfc.md`, `llp/0133-local-settlement.spec.md`, `llp/0043-offline-replay-retention.rfc.md`, `src/storage.rs`, `src/storage/settlement.rs`, `src/manifest.rs`, `src/contract_types.rs`, `src/local.rs`, `packages/snapback-client/index.mjs`, `packages/snapback-codegen/index.mjs`, `packages/snapback-codegen/result-contracts.mjs`, `packages/snapback-codegen/standard-patterns.mjs`

## Overall assessment

The r5 delta is honest to the extent verifiable without r4: all ten enumerated changes are present, `ledgerIdentity` is gone, and no residual old spelling contradicts the listed renames. The server-rebuilt identity direction, replay-key separation, cursor suffix proof, and recursive no-drop rule are materially improved. The suffix/non-widening argument is sound as specified: authorization precedes the seek, the seek remains inside the authorized index prefix, and the named negative cases cover the important boundary constructions.

The revision is nevertheless not ready. The new capability disposition changes deployment semantics despite claiming a dispatch-only gate; the settlement section contradicts its own default-carrier pin; and the re-kinded result contracts remain underdetermined against the shipped grammar.

## Concerns

1. **[MATERIAL][IN-DELTA] `requiredCapabilities` turns the stated dispatch gate into an artifact-wide deployment gate.**

   LLP 0255 says every generated write’s canonical `requiredCapabilities` includes `offline_mutation_replay` (`llp/0255-tiny-data-surface-v1-api.spec.md:320`), while later stating target support is checked only at dispatch (`llp/0255-tiny-data-surface-v1-api.spec.md:1381`) and that Cloudflare-deployed applications remain read-capable but serve zero tiny writes (`llp/0255-tiny-data-surface-v1-api.spec.md:445`).

   Shipped semantics do not permit that combination. Codegen unions every function’s `requiredCapabilities` into the target artifact requirement (`packages/snapback-codegen/index.mjs:5769`), and activation requires every function requirement before installing the artifact (`src/local.rs:4308`). An owner data resource containing generated writes would therefore fail generation/deployment on Cloudflare; it would not deploy successfully and refuse only writes at dispatch.

   **Resolution:** Separate data-facade dispatch requirements from canonical `FunctionDefinition.requiredCapabilities`—for example, an explicitly named `dispatchRequiredCapabilities` projection checked by the client—or amend the canonical capability owner to support operation-scoped dormant requirements. Alternatively, explicitly choose artifact-wide undeployability and revise S3.2, S7.2, S9, and the D9 target assumptions. The current text cannot claim both behaviors.

2. **[MATERIAL][IN-DELTA] Default `MutationSettlement` and the claimed `settlementIdentity` carrier are mutually exclusive.**

   The Spec pins every v1 data write to the default `MutationSettlement`, therefore omitting `settlement` from `mutation_input_fingerprint` (`llp/0255-tiny-data-surface-v1-api.spec.md:893`). It immediately says `settlementIdentity:{implementationHash,activation}` “continues to carry original-generation pinning into the fingerprint’s claims” (`llp/0255-tiny-data-surface-v1-api.spec.md:901`).

   In the shipped grammar, `settlementIdentity` is a member of `MutationSettlement`; its default is absent (`src/manifest.rs:10180`). The fingerprint omits the settlement record only when that entire value equals the default (`src/storage.rs:15990`). Sending `settlementIdentity` makes it non-default and includes the settlement record in the fingerprint.

   **Resolution:** Keep the stated v1 default pin and say explicitly that data writes omit `settlementIdentity`; original generation remains an outbox/replay and `expectedGeneration` concern, not part of the settled-row duplicate identity. If `settlementIdentity` must travel, remove the default-settlement pin and specify its exact fingerprint contribution instead.

3. **[MATERIAL][IN-DELTA] The re-kinded result contracts are not yet exact at the shipped grammar boundary.**

   The Spec calls get’s hashed result contract canonical `documents` “constrained to zero-or-one row” (`llp/0255-tiny-data-surface-v1-api.spec.md:280`). Shipped `documents` has only `table` and `document`; row bounds exist only on `records` (`src/contract_types.rs:1358`, `packages/snapback-contract/result-contract-validator.mjs:452`). Thus the hashed `documents` contract cannot encode the stated cardinality.

   The same section says mutations reuse CRUD contracts unchanged (`llp/0255-tiny-data-surface-v1-api.spec.md:260`) but later requires delete to acquire an explicit `{kind:"value",value:Null}` contract (`llp/0255-tiny-data-surface-v1-api.spec.md:290`). The shipped CRUD helper leaves delete undeclared (`packages/snapback-codegen/standard-patterns.mjs:352`), so this is necessarily a lowering change.

   **Resolution:** Choose one exact get representation: ordinary `documents` with zero-or-one explicitly identified as a plan invariant outside the result-contract hash, or `records` with `{minItems:0,maxItems:1}`. Also specify whether Phase 1 extends `defineOwnedCrud` or applies a reviewed data-lowering specialization for delete, and retract “unchanged” where appropriate.

4. **[DETAIL][IN-DELTA] The authority-instance source conflates the durable artifact path with the mutation wire path.**

   LLP 0255 locates the value at `authority.authorityDescriptor` while describing the ordinary mutation request (`llp/0255-tiny-data-surface-v1-api.spec.md:881`). That is the `DataTransactionV1`/durable-record path. On the wire, `MutationRequest` carries top-level `authorityDescriptor` (`src/manifest.rs:10275`), and the generated client writes `body.authorityDescriptor` (`packages/snapback-client/index.mjs:9163`). The server then compares that descriptor with the prepared authority and constructs the identity from the server-derived expected authority instance.

   **Disposition:** State both mappings explicitly: durable artifact `authority.authorityDescriptor.authorityInstanceId` → wire `authorityDescriptor.authorityInstanceId` → server-derived expected `authority_instance_id`. This is textual but necessary for the bounded implementer probe.

## Implementer probe

### Three-chunk duplicate settlement

A three-chunk batch resolves to one generated mutation named `data.tx_<first-16-hex-of-normalizedDataTransactionId>` and one ordinary mutation request.

The duplicate-settlement procedure is:

1. Look up the settlement row by request-body `clientMutationId`, byte-equal to `intentId`.
2. Exact-compare the stored function with the route’s exported mutation name, not `{appId}:{exportedName}`.
3. Exact-compare the stored `auth_fingerprint` with the server-computed fingerprint of the prepared canonical `AuthInput` fields `principal`, `session_id`, and `user_id`. No client-provided fingerprint is authoritative.
4. Exact-compare the stored authority instance with the server-derived expected authority instance after validating the request’s top-level `authorityDescriptor`; the durable source was `authority.authorityDescriptor`.
5. Exact-compare `mutation_input_fingerprint`, computed as SHA-256 with no domain prefix over recursively key-sorted canonical JSON of:
   - `args`: the request’s batch argument object using `c0_<arg>`, `c1_<arg>`, and `c2_<arg>` keys;
   - `readSet`: the ordinary request `read_set`, persisted with the outbox record;
   - `ctxLedger`: the ordinary request `ctx_ledger`, likewise persisted.
6. Under the stated default-`MutationSettlement` pin, omit `settlement` entirely. `operationIssuance` and its artifact-generation comparison are absent in v1. `replayKey` and `canonicalArgsDigest` are client-only and are not compared.

That procedure is determinate only after resolving Concern 2: a present `settlementIdentity` would make the settlement non-default and change the fingerprint preimage.

### Pagination and target capabilities

- **A1 pagination:** No semantic change. R5 replaces the cursor justification with the stronger suffix/non-widening proof and adds negative cases; the `.after(cursor)` grammar, page identity, QMK separation, and A1 first-page behavior remain as previously determinate.
- **Target capabilities:** The intended binary story is unchanged—every data write requires the single `offline_mutation_replay` advertisement, with no downgrade cell. As written, however, the new mapping into canonical function `requiredCapabilities` changes the behavior from dispatch refusal to artifact-wide deployment refusal. Concern 1 must be resolved for the prior story actually to stand.

## Direction assessment

The direction remains sound. There is no `DIRECTION-DISSENT`: server-rebuilt settlement identity, client-only replay keys, policy-preceding cursor seeks, representable canonical result kinds, and recursive projection parity are the correct architecture. The blocking issues are contract-placement and carrier inconsistencies within that direction.

Self-attestation: I did not read any `llp/reviews/0255*` file; none existed. I used no network and received no other reviewer’s work. Due mandatory runtime skill activation, I read `/Users/ccheever/.codex/skills/llp-review/SKILL.md` outside the capsule; it contained procedural LLP-review instructions and no LLP 0255 content. This was the sole confinement deviation.

VERDICT: NOT READY


## Round 6 — 2026-08-13 (final verification delta round)

- **Runtime:** same as prior rounds (Codex CLI 0.147.0, `gpt-5.6-sol`,
  `model_reasoning_effort=xhigh`, read-only sandbox), launched blind in
  the round-6 capsule (launch 6).
- **Revision reviewed:** r6, SHA-256
  `6a75927becf51b8e02b494c0a033aa10a4df3bf088b7fc20646ce7ed801ad404`
  (95,344 bytes); verified in-capsule.
- **Capsule inventory SHA-256:**
  `902324a85775be28d59ca5421db734f29ad6bce57d87ca890accd6b17fb95acb`;
  instruction SHA-256
  `b7e3bc738a16d1736129f1a81b4be3d0ac2f1d2bd78ff2a3f7903253fb8e59ee`.
- **Verdict:** NOT READY (3 MATERIAL, all IN-DELTA; zero PRE-EXISTING
  MATERIAL; direction retained; both fingerprint preimages and the
  deployment story reproduced in the probe). Disclosed deviation: the
  pre-instruction harness skill-file read. Counted with disclosure.

---

# Independent review — LLP 0255 r6

**Reviewer:** OpenAI Codex, GPT-5 family; Codex API runtime  
**Date:** 2026-08-13  
**Revision:** `6a75927becf51b8e02b494c0a033aa10a4df3bf088b7fc20646ce7ed801ad404`  
**Identity verification:** SHA-256 and size verified: 95,344 bytes, 1,840 lines.  
**Notable files:** `llp/0255-tiny-data-surface-v1-api.spec.md`, `llp/0254-tiny-ordinary-data-surface.rfc.md`, `llp/0133-local-settlement.spec.md`, `llp/0043-offline-replay-retention.rfc.md`, `llp/0058-shared-invocation-authority-and-staged-auth-mode-protocol.spec.md`, `packages/snapback-codegen/standard-patterns.mjs`, `packages/snapback-codegen/result-contracts.mjs`, `packages/snapback-client/generated-mutation-ir.mjs`, `packages/snapback-client/index.mjs`, `src/manifest.rs`, `src/storage.rs`, and `src/storage/settlement.rs`.

## Overall assessment

The direction remains faithful to Accepted LLP 0254: the surface is profile-neutral, policy-explicit, bounded, server-authoritative, lifecycle-honest, and layered over existing function, materialization, outbox, and settlement owners. The `dispatchRequiredCapabilities` separation correctly avoids contaminating canonical artifact deployment requirements, and the issuance exclusion and coverage-active deployment class match the shipped enforcement structure.

The r5→r6 delta is present in substance, but it leaves three contract-bearing inconsistencies. Two directly misstate hashed result or settlement preimages; the third leaves the new settlement branch selector ambiguous between static generation identity and runtime presentation. These must be resolved before implementation can derive byte-stable artifacts and replay identities confidently.

## Concerns

1. **MATERIAL — IN-DELTA: “prediction class” is not a well-defined settlement-branch selector.**

   The normalized transaction core hashes both per-chunk and aggregate `prediction` (`llp/0255-tiny-data-surface-v1-api.spec.md:822`, `llp/0255-tiny-data-surface-v1-api.spec.md:830`), and transaction resolution statically catalogs the chunk shape and derives the synthesized function name from that witness (`llp/0255-tiny-data-surface-v1-api.spec.md:1320`). But S7.2 says prediction becomes `none` when invocation-time authority, materialized rows, or local bounds are unavailable (`llp/0255-tiny-data-surface-v1-api.spec.md:1398`). The r6 settlement rule then selects default versus lane-L fingerprint bytes by that same prediction class (`llp/0255-tiny-data-surface-v1-api.spec.md:903`).

   Thus one static call-site template can apparently change its hashed core, synthesized name, and settlement fingerprint branch as local state changes. The document neither catalogs two variants nor separates intrinsic generated-prediction capability from whether a layer was installed for this dispatch.

   **Resolution:** Make normalized-core `prediction` a generation-stable capability and represent invocation-time installation separately as presentation/prediction state, with settlement branching on the persisted generation-stable class; or explicitly specify two catalogued variants and their deterministic pre-custody selection. The chosen branch must be frozen in durable custody before replay.

2. **MATERIAL — IN-DELTA: the lane-L fingerprint description does not match the shipped carrier’s omission rules.**

   S4.4 says generated-exact data writes carry IR `boundedSkew` and that the listed fields are emitted unconditionally (`llp/0255-tiny-data-surface-v1-api.spec.md:907`). But data members forbid `boundedSkew` (`llp/0255-tiny-data-surface-v1-api.spec.md:327`). The shipped generated IR therefore projects `boundedSkew:null` when absent (`packages/snapback-client/generated-mutation-ir.mjs:145`), the wire adds it only when non-null (`packages/snapback-client/index.mjs:9251`), and Rust omits `None` from the settlement object used by the fingerprint (`src/manifest.rs:10198`). Likewise, `settlementClaims.now` is optional and an empty `mints` array is omitted during server serialization (`src/manifest.rs:10153`).

   This matters because the spec expressly promises an exact byte-level pin. A literal implementer could hash `boundedSkew:null` or `mints:[]`, producing a different preimage from `mutation_input_fingerprint`.

   **Resolution:** State the precise typed-server serialization: lane L always includes `settlementLane`, `settlementIdentity`, and `settlementClaims.version`; `now` appears only when present, `mints` only when nonempty, and `boundedSkew` only when non-null. Under the current v1 data-member prohibition, explicitly say `boundedSkew` is absent. If data writes are meant to admit it, amend S2 and define multi-chunk composition first.

3. **MATERIAL — IN-DELTA: stale S2 prose still mandates the pre-r6 result contracts.**

   S2 first says read operations retain canonical `documents`, that no new result kind distinguishes data-resource reads, and that mutation contracts are unchanged (`llp/0255-tiny-data-surface-v1-api.spec.md:247`, `llp/0255-tiny-data-surface-v1-api.spec.md:255`, `llp/0255-tiny-data-surface-v1-api.spec.md:259`). The new normative mapping instead makes `get` a bounded `records` result and specializes delete to explicit null (`llp/0255-tiny-data-surface-v1-api.spec.md:283`).

   This is a real hash-level contradiction. Shipped ordinary HostPlan queries derive `documents` unless an authored result contract overrides them (`packages/snapback-codegen/result-contracts.mjs:874`), while shipped CRUD get and delete provide no such specializations (`packages/snapback-codegen/standard-patterns.mjs:327`, `packages/snapback-codegen/standard-patterns.mjs:352`).

   **Resolution:** Rewrite the earlier paragraph to say list retains `documents`; get specializes to `records` with `{minItems:0,maxItems:1}`; create/update retain `document`; and delete specializes from `unknown` to null-valued `value`. Remove “not a new result kind” and “contracts unchanged.”

## Implementer probe

### Generated-exact three-chunk batch

1. `normalizedDataTransactionId` hashes the domain plus JCS of the complete core: `format`, `surfaceProfile`, the three ordered chunk records—including position, resource/operation/export name, plan/argument/result/policy hashes, reach, prediction, and custody—then aggregate atomicity, authority partition, prediction, custody, result hash, reach, ceilings, refusal vocabulary, and guide anchor. Intent, runtime values, generation, authority instance, speculative IDs, and resolution are excluded.

2. `canonicalArgsDigest` hashes domain `"snapback:data-canonical-args:v1\n"` plus JCS of the single named batch argument object containing `c0_<argName>`, `c1_<argName>`, and `c2_<argName>` fields. `canonicalArguments[]`, intent, authority, settlement facts, and generation are excluded.

3. The shipped server `mutation_input_fingerprint` is undomained SHA-256 over recursively key-sorted canonical JSON of:

   ```text
   {
     args: { c0_<argName>: ..., c1_<argName>: ..., c2_<argName>: ... },
     readSet: <generated request read set>,
     ctxLedger: <generated request ctx ledger>,
     settlement: {
       settlementLane: "re-derive",
       settlementIdentity: {
         implementationHash: <synthesized batch implementation hash>,
         activation: <pinned activation>
       },
       settlementClaims: {
         version: 1,
         now: <only when present>,
         mints: [{claimed, site, occurrence}, ...] <only when nonempty>
       },
       boundedSkew: <only when non-null>
     }
   }
   ```

   Under the current v1 prohibition, `boundedSkew` is absent. The server separately exact-compares the synthesized invocation name, auth fingerprint over `principal`/`session_id`/`user_id`, authority-instance ID derived from the top-level wire `authorityDescriptor`, and retained-versus-proposed issuance. `clientMutationId` is the lookup key; issuance is absent on both sides. `replayKey`, `canonicalArgsDigest`, correlation, acknowledgements, wire version, and the remaining generation envelope do not enter `mutation_input_fingerprint`.

### Prediction-`none` single-chunk write

1. The normalized transaction witness hashes the same core fields with one chunk and aggregate/chunk prediction `none`.

2. `canonicalArgsDigest` hashes the ordinary unprefixed mutation argument object because one-chunk resolution uses the chunk mutation’s existing wire carrier.

3. `mutation_input_fingerprint` hashes exactly:

   ```text
   {
     args: <ordinary generated mutation argument object>,
     readSet: <persisted request read set>,
     ctxLedger: <persisted request ctx ledger>
   }
   ```

   The default `MutationSettlement` causes the entire `settlement` member to be omitted. Function, auth, authority-instance, and absent issuance remain separate exact-comparison members.

Concern 1 prevents the document from unambiguously selecting these branches when a statically prediction-capable transaction cannot install a prediction at runtime.

### Deployment result

Artifacts keep canonical `FunctionDefinition.requiredCapabilities` unchanged, so targets satisfying their ordinary read/runtime requirements can deploy and serve reads even without a settlement ledger.

- A durable client plus a target advertising `offline_mutation_replay`, with ordinary-mutation coverage inactive, serves both queue-eligible and intrinsically online-only data writes.
- A target lacking `offline_mutation_replay`, including today’s Cloudflare coordinator, is refused by the client before transport with `SNAPBACK_DATA_CUSTODY_UNAVAILABLE`.
- A non-durable Expo File/Directory adapter is refused before transport with the same data-custody diagnostic.
- A target whose active LLP 0162/0163 manifest covers the ordinary mutation lane deploys and serves reads, but data writes carry no issuance and are refused at the server’s pre-execution storage gate with `SNAPBACK_OPERATION_IDENTITY_REQUIRED`.

## Direction assessment

`DIRECTION-DISSENT: none.` The accepted tiny-surface direction remains sound. The concerns require contract clarification and byte-preimage repair, not a new product or architecture direction.

Self-attestation: I reviewed independently, used no network or web access, did not consult another reviewer, did not read the unrelated `REVIEW-CANDIDATE-r*.md` or `final-cli.log` files, and did not read any file matching `llp/reviews/0255*`; none existed. Deviation from capsule-only confinement: to comply with the active system skill rule, before substantive review I read `/Users/ccheever/.codex/skills/llp-review/SKILL.md`, outside the capsule. It contained only generic LLP review-process instructions and supplied no candidate or peer-review content. All substantive evidence cited above came from the capsule.

VERDICT: NOT READY
