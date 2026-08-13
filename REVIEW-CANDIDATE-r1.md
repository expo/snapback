# Candidate review — llp0237-0243 authoring wave

## Provenance

- **Model:** OpenAI Codex, GPT-5.6-sol, xhigh reasoning
- **Review date:** 2026-08-12
- **Candidate HEAD:** `febdafcca0d20940780879a79e9aae3ce768aeaa`
- **Base:** `9a8edc9494c52a7d6041e04142cbfdb54df6e891`
- **Blindness:** Fresh independent reviewer. I wrote none of the candidate code and did not use sibling-worktree implementation reports as authority; conclusions below come from the candidate tree, its binding documents, and direct verification.

## Scope actually reviewed

I verified the exact candidate HEAD, reviewed the complete `base..HEAD` commit log and diff, and read the binding LLP 0236 research, accepted LLPs 0237–0243, accepted Spec 0244, and Round-3 review artifacts. I traced the changed source and tests for:

- LLP 0237's runtime-profile/preflight and same-file graph records, including byte parity and the canonical-versus-raw digest split;
- LLP 0238's nominal generated references and every client call-site kind gate;
- LLP 0239 D5 and the `v.media()` field/result-contract half, including the headless media store and React projection;
- LLP 0240 R1 authority-profile lowering onto the existing membership/table-policy IR and its unsupported-composition refusals;
- LLP 0241 R1 semantic, executable, evidence, bundle, and generation identities and immutable-envelope emission;
- LLP 0244's JS provenance handoff, staged proof lifecycle, OCC-before-egress materialization, finalized-media projection, settlement format epoch/seal/recovery, RQS/action exclusions, and dormant class-M boundary;
- authored guide/capability claims and the relevant schema changes. Regenerated flats, registries, reference projections, and `artifacts.json` leaves were treated as gate-generated as directed by the charter.

Direct verification included 30 focused Node tests across codegen, client, React, harness, preflight, semantic rotation, media authoring, and authority-profile lowering; 2 Rust media-provenance tests; 6 Rust media/OCC/settlement acceptance tests; `node scripts/check-guide.mjs`; and `./ref-check --verbose`. All passed. A direct skew probe additionally demonstrated that an object reference with `kind: "FutureQuery"` performs one transport request.

## Findings

### MATERIAL 1 — unknown or missing object reference kinds bypass the pre-transport refusal

**Anchor:** `packages/snapback-client/reference-kinds.mjs:12-16,38-47`; coverage gap at `packages/snapback-client/reference-kind.test.mjs:69-91`.

**Issue:** `receivedReferenceKind()` returns `null` both when an object has no recognized kind and when there is no discriminant, and `assertClientReferenceKind()` treats that `null` as accepted. The only compatibility exception promised by LLP 0238 D1 and by the nearby `@ref` comment is a legacy string. Consequently a JavaScript or skewed-package object such as `{ artifactKind: "functionReference", kind: "FutureQuery", name: "fixtureFuture" }` passes the kind boundary and reaches `fetch`; the direct probe observed `transports: 1`. The current test covers all pairs among the five known kinds but never covers an unknown or absent object kind. This contradicts D1's before-transport failure contract and changes public failure/transport semantics.

**Fix shape:** Preserve the compatibility return only for `typeof reference === "string"`. For every non-string reference object, distinguish recognized kinds from absent/unknown/malformed discriminants and throw `SNAPBACK_CLIENT_REFERENCE_KIND_MISMATCH` before name validation or transport. Extend the payload-safe diagnostic for an unknown kind (including an upgrade/skew repair when no correct verb is knowable), and add missing-kind, future-kind, and malformed-object cases for every transport-capable verb with an asserted transport count of zero.

### MATERIAL 2 — the staged media proof is take-once but is not bound to the invocation/request authority required by Spec 0244

**Anchor:** `src/runtime.rs:396-438,2067-2098`; `src/local.rs:11728-11760`; `src/storage.rs:3836-3868,4046-4052,4357-4379`.

**Issue:** `StagedMediaProjectionProofV1` contains only the projection plan, `result_contract_hash`, and shared take-once occurrences. It does not record the process/invocation identity, prepared principal or authority instance, function/artifact generation, or request identity. The storage boundary validates only occurrence-to-read-dependency facts and then consumes the proof; it has no expected invocation binding to compare. Preview also receives a cloned proof handle rather than a borrow, albeit with shared take-once state. This leaves a host-side carrier/payload mix-up undetectable and can re-establish source lineage under the wrong request authority. It directly omits Spec 0244 D1's required sidecar scope and the authoritative commit check against prepared invocation, payload, function generation, and request identity. The current tests prove structural-copy refusal and shared take-once consumption, but not cross-principal/function/generation/request swaps.

**Fix shape:** Mint a closed proof-binding record from the prepared invocation and request carrier, including process epoch/invocation nonce, principal and authority instance, function/artifact generation, result-contract hash, pinned snapshot, and request/client-mutation identity. Carry the independently trusted expected binding to the single storage commit boundary and compare it before OCC admission or egress. Make dry-run preview borrow the carrier rather than clone its handle, retain take-once consumption for the authoritative attempt, and add adversarial cross-request, cross-principal, cross-function/generation, retry, cancellation, and same-id-winner tests.

### MATERIAL 3 — settlement acknowledgement leaks retained-byte quota

**Anchor:** insertion accounting at `src/storage.rs:15960-16076,16145-16155`; restart scan at `src/storage.rs:15624-15641`; acknowledgement accounting at `src/storage/settlement.rs:216-237,264-285`.

**Issue:** New settlement insertion charges `settlement_format`, a logical eight-byte record sequence, and `settlement_projection_seal_json` in addition to the prior seven fields. The startup scan and per-id acknowledgement query still measure only the prior seven fields. A normal acknowledgement therefore deletes the row but subtracts fewer bytes than insertion charged—every new plain row leaks its format/sequence charge, and each media row additionally leaks its seal charge. The persisted global and per-authority counters monotonically overstate retained data, eventually causing `SNAPBACK_CLIENT_MUTATION_RETENTION_FULL` even after clients collect their settlements. This is a durable retry/admission failure-semantics regression, and there is no mixed-format insert/ack/rebuild test covering the accounting invariant.

**Fix shape:** Define one versioned logical retained-row byte formula and use it identically for insertion admission, counter reconstruction, individual acknowledgement, and authority-wide collection. Either include the three new carrier fields everywhere (with one exact logical representation for the integer) or exclude them everywhere, with an explicit migration/rebuild rule for existing counters. Add legacy/plain/media mixed rows and assert insert-then-ack returns both global and per-authority counters to their exact predecessor values across reopen/rebuild.

VERDICT: MATERIAL FINDINGS
