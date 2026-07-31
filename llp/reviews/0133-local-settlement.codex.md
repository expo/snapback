# LLP 0133 local settlement review — Codex family


## Round 1 — 2026-07-31

**Reviewer family:** OpenAI Codex
**Provider / runtime:** codex-cli 0.146.0, `codex exec`, model `gpt-5.6-sol`
**Reasoning effort:** CLI default (`medium` per CLI banner)
**Date:** 2026-07-31
**Method:** fresh CLI runner, read-only sandbox, blind to this Spec's fable artifact
**Target SHA-256:** `05d9a000ac9db0ef0ca996ca5b3197977461ed84932b47dbb0c10e2e60101c0a`
**Status:** completed

## Verbatim review

## Overall assessment

LLP 0133 captures decision 10’s central policy faithfully, and its restatement of LLP 0008’s replay-environment pin is accurate with authority correctly disclaimed. However, it is not yet converged. Several normative claims are either unenforceable, unsound under divergence, inconsistent with shipped reconciliation behavior, or outside ledger row 1’s commission.

I did not read any `llp/reviews/0133-*.fable.md` file and made no repository changes.

## Strengths

- The commission is stated accurately: server re-derivation by default, captured values as labeled claims, bounded-skew acceptance only by declared per-field opt-in ([LLP 0133 §Summary](/Users/ccheever/projects/snapback/llp/0133-local-settlement.spec.md:11)).
- LLP 0008’s pin is restated faithfully: the wire carries `{generatedIds, now}` because divergence would corrupt replayed optimistic state ([LLP 0008](/Users/ccheever/projects/snapback/llp/0008-local-first-sync-and-realtime.rfc.md:331)). LLP 0133 correctly says changing that pin requires a dated LLP 0008 amendment ([LLP 0133](/Users/ccheever/projects/snapback/llp/0133-local-settlement.spec.md:42)).
- The application-value versus protocol-identity distinction is useful and resolves the apparent conflict between re-derived IDs and client-minted `clientMutationId`.
- Out-of-bound skew correctly falls back to re-derivation rather than refusing the mutation ([LLP 0133](/Users/ccheever/projects/snapback/llp/0133-local-settlement.spec.md:171)).
- Local read baselines are honestly diagnostic rather than server OCC inputs; authoritative re-execution validates its own reads, consistent with LLP 0003.
- Receipt privacy is appropriately bounded to the submitting authority.
- The acceptance sketches have concrete falsifiers, although they need substantial additions below.

## Concerns

### MATERIAL 1 — The client-attested lane label defeats the normative trust policy

The Spec admits that a lane-L execution can be labeled lane Q and thereby gain acceptance of client-supplied IDs and time ([LLP 0133](/Users/ccheever/projects/snapback/llp/0133-local-settlement.spec.md:121)). Calling this “a semantics selector, not a privilege” does not make decision 10 enforceable. It lets any client bypass lane-L re-derivation and the bounded-skew declaration simply by choosing the legacy label.

The comparison with what the shipped replay lane already permits is insufficient: the commission governs local-execution settlement specifically, and “server re-derivation is the default” cannot be a server-side evidence boundary if the server cannot establish which policy applies. The proposed acceptance test only checks the supplied label, so a mislabeled local execution passes by construction.

Resolution:

- Define a server-checkable lane-admission fact. Possibilities include artifact/profile capability, an owner-issued capture-mode witness, or restricting lane Q to a server-identifiable queued-plan surface.
- Refuse a lane label inconsistent with that fact.
- Add adversarial acceptance: a local-execution submission mislabeled Q must not obtain replay acceptance.
- If the intended policy is explicitly honest-client-only, state that limitation and escalate it under LLP 0130 ER-2 because it weakens the claimed trust boundary.

### MATERIAL 2 — Leaf-equality ID rewriting is not sound

The claim that exact equality against a high-entropy minted-ID ledger tells the client “exactly which values are its own” confuses value origin with semantic use ([LLP 0133](/Users/ccheever/projects/snapback/llp/0133-local-settlement.spec.md:222)).

Hidden corruption paths include:

- An ID string copied intentionally into a non-reference field is rewritten.
- A reference encoded inside a structure not represented as an exact string leaf is missed.
- Branch divergence can change ID-call cardinality or meaning; positional local/server answer ledgers do not necessarily yield a semantic `{speculativeId → authoritativeId}` pairing.
- A dependent intent already submitted or in flight cannot be repaired by the “not-yet-submitted” rewrite.
- The Spec assumes a mapping exists for every re-derived ID even when the authoritative branch does not mint the corresponding object.

High entropy reduces accidental collision probability; it does not establish provenance or reference semantics.

Resolution:

- Require contract-visible typed ID-reference positions or provenance-tagged argument nodes for lane-L dependent intents.
- Define semantic map construction under changed branches and changed ID-call cardinality. Unpaired IDs must produce an unresolved cascade, not a guessed positional mapping.
- Pin serialization: an intent containing an unresolved speculative-ID reference cannot cross the submission boundary until every predecessor mint settles.
- Add tests for non-reference equal strings, nested arrays/objects, branch-added/removed ID calls, multiple minted IDs, rejection, and an attempted concurrent dependent submission.
- Open question 2 cannot say the current floor is sound; typed/provenance-aware references are required unless another proof is supplied.

### MATERIAL 3 — The external-store composition claim contradicts shipped behavior

The shipped store does rebase layers over the newest authoritative rows, which supports part of the argument. But it does not retire a confirmed layer “on any settlement.” A confirmed layer remains until its matcher succeeds or a later authoritative query delivery arrives ([external-store.mjs](/Users/ccheever/projects/snapback/packages/snapback-client/external-store.mjs:361)). The existing test explicitly preserves a confirmed optimistic row after transport confirmation ([external-store.test.mjs](/Users/ccheever/projects/snapback/packages/snapback-client/external-store.test.mjs:162)).

Therefore these claims are currently false or underspecified:

- settlement itself retires the layer;
- the receipt applies authoritative rows;
- `snapshotVersion` is enough to order application of those rows;
- after the last intent settles, the client view necessarily equals the server at that receipt version.

A mutation receipt carries settlement facts, not necessarily the affected canonical query rows. A delayed live delivery can leave the confirmed speculative layer visible after settlement.

Resolution:

- Specify the new integration seam: either settlement carries a validated authoritative changeset that the external store can apply, or receipt settlement and authoritative query delivery remain separate and convergence waits for the latter.
- Define correlation between receipt, live delivery, matcher, and `snapshotVersion`, including both delivery orders and dropped/delayed delivery.
- Replace the overly strong equality invariant with a precise query-scoped invariant accounting for later server commits and authoritative-delivery progress.
- Add confirmation-before-query, query-before-confirmation, rejection-after-newer-authority, delayed/dropped delivery, and multiple out-of-order settlement tests.

### MATERIAL 4 — The tuple gates exceed decision 10 and conflict with named owners

The document says its decided scope is exactly decision 10 ([LLP 0133](/Users/ccheever/projects/snapback/llp/0133-local-settlement.spec.md:58)), yet it claims ownership of which execution-identity elements gate settlement and normatively decides:

- implementation-hash mismatch refusal;
- schema/activation mismatch refusal;
- non-gating of runtime identity and deterministic-tier semantics.

Those are substantive decisions in ledger rows 3 and 5, which LLP 0129 leaves with other owning documents. LLP 0129 explicitly requires substantive design to remain with each ledger-row owner ([LLP 0129](/Users/ccheever/projects/snapback/llp/0129-local-first-program.plan.md:189)). Saying the capture-versus-settle policy belongs elsewhere while mandating “detect and refuse” already chooses an important part of that policy.

Resolution:

- Remove these tuple decisions from LLP 0133 or state them only as non-normative dependencies pending rows 3 and 5.
- Keep element 4 here only to the extent necessary to express decision 10’s treatment of `now` and IDs.
- Move/refine the element 1/5 admission and mismatch behavior in their commissioned owners, then cite the accepted contracts.
- Do not decide that elements 2/3 “never gate commit in this version” under ledger row 1.

### MATERIAL 5 — Per-field bounded skew lacks an executable provenance model

The Spec declares bounded skew per stored field, but the captured fact is an invocation-level `ctx.runtime.now()` answer. One frozen answer may be:

- written to several fields with different opt-ins;
- transformed before storage;
- included in nested values;
- used for control flow as well as stored data.

The document does not explain how settlement identifies every application-visible sink, substitutes the claimed value for opted-in sinks, and re-derives it for other sinks during one re-execution. The claim ledger’s `field-or-slot` vocabulary does not establish dataflow provenance.

Resolution:

- Define the admitted expression/profile for bounded-skew fields and how runtime provenance reaches durable write sinks.
- Specify mixed opted/non-opted use of one `now` answer, transformed values, nested fields, repeated writes, and branch-dependent writes.
- Bound and validate `maxSkewMs`; identify the authoritative server clock/floor and exact sampling point.
- Add mixed-field and transformed-value acceptance cases, not only one direct field.

### MATERIAL 6 — Exactly-once identity does not yet bind the new semantics

The Spec says exactly-once is untouched, but the current durable identity binds function, authority, auth, args, read set, and ctx ledger ([storage.rs](/Users/ccheever/projects/snapback/src/storage.rs:638), [input fingerprint](/Users/ccheever/projects/snapback/src/storage.rs:14908)). LLP 0133 introduces lane, implementation hash, activation, bounded-skew declarations, claim treatment, and possibly evaluator identity without saying which enter the retained identity.

A duplicate `clientMutationId` with a changed lane or activation must neither receive a stored result under semantically different input nor re-execute. The ordering among descriptor verification, settlement lookup, exact identity comparison, tuple gates, and fresh execution is not specified.

Resolution:

- Define the complete settlement identity extension and collision behavior.
- Bind every semantics-affecting field, at minimum lane, artifact/activation witness, and applicable declaration identity.
- Specify gate ordering for fresh versus already-settled IDs.
- Add duplicate tests with altered lane, hash, activation, claims, and bounded-skew declaration.

### DETAIL 1 — Reservation-stale retry wording risks changing LLP 0059 choreography

LLP 0059 says a one-shot handler is not rerun internally merely because the reservation became stale; the stale result is effect-free and the client may retry the complete request. LLP 0133’s “stale-reservation retry re-runs the whole settlement” is ambiguous ([LLP 0133](/Users/ccheever/projects/snapback/llp/0133-local-settlement.spec.md:150)).

Resolution: say explicitly that the current attempt returns `SNAPBACK_AUTH_RESERVATION_STALE` with no committed effect; a later request under the same `clientMutationId` re-executes. There is no hidden in-attempt rerun.

### DETAIL 2 — “Nothing references a timestamp” is false

A later intent can copy a speculative timestamp from a row into its args. It may not require automatic rewriting, but the Spec must acknowledge the possibility and state the consequence instead of asserting that timestamps are never referenced.

### DETAIL 3 — Acceptance coverage is incomplete

Add explicit falsifiers for:

- adversarial lane relabeling;
- tuple/duplicate gate ordering;
- branch-divergent ID ledgers;
- typed versus non-reference ID strings;
- mixed bounded-skew sinks;
- receipt/live-delivery ordering;
- final convergence after delayed authoritative delivery;
- reservation-stale retries without duplicate effects.

## Open questions

1. What server-verifiable fact distinguishes lane Q from lane L?
2. Is lane Q available to every mutation, or only to a declared queued-plan profile?
3. How are speculative and authoritative ID calls paired when branches or call counts differ?
4. Can a dependent lane-L intent be dispatched before all earlier speculative-ID producers settle?
5. Does a settlement response contain canonical affected rows/changesets, or must convergence await live-query delivery?
6. Which exact fields extend the durable `clientMutationId` identity?
7. Which ledger-row owner decides activation/hash mismatch disposition?
8. What provenance mechanism makes “per-field” bounded skew implementable?

## Verdict

**NOT READY**

There are six unresolved MATERIAL concerns. In particular, the privilege-free lane-label claim and leaf-equality ID rewrite are not sound as written, the shipped external store does not support the asserted settlement behavior, and the tuple section exceeds the document’s commission.

## Recommended next step

Revise LLP 0133 while keeping its central decision-10 policy intact:

1. Make lane admission server-verifiable.
2. Replace entropy-based ID rewriting with typed/provenance-aware references and serialized dependency handling.
3. Specify the receipt-to-authoritative-delivery reconciliation seam against the actual external store.
4. Move tuple-row decisions back to their owners.
5. Define executable per-field time provenance.
6. Bind new settlement semantics into exactly-once identity and expand the acceptance matrix.

Then request a targeted Codex re-review before counting this family as READY.
