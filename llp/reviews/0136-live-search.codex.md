# LLP 0136 live search review — Codex family


## Round 1 — 2026-07-31

**Reviewer family:** OpenAI Codex
**Provider / runtime:** codex-cli 0.146.0, `codex exec`, model `gpt-5.6-sol`
**Reasoning effort:** CLI default (`medium` per CLI banner)
**Date:** 2026-07-31
**Method:** fresh CLI runner, read-only sandbox, blind to this Spec's fable artifact
**Target SHA-256:** `5bfe7b882ee4b168f00f42e355dfe6fa2d6a7dc141bcc9b4efeb61f432b1f9bb`
**Status:** completed

## Verbatim review

## Overall assessment

LLP 0136 has a strong core design, but it is **NOT READY** under LLP 0130 SD-4. Several material seams remain unresolved, including one direct LLP 0053 composition failure and an understated amplification boundary.

The five LLP 0119 blockers are recognized, but clearing blockers 1–3 does not create the claimed end-to-end path for every admitted authorization profile.

## Strengths

- Preserves LLP 0073’s ordinary-search classification and `SNAPBACK_FUNCTION_NOT_LIVE` pin.
- Uses a distinct `live_full_text_search_v1` capability rather than inferring liveness from parent capabilities.
- Correctly chooses `LiveQuery + SearchQueryPlanV1` instead of adding public kind/plan variants.
- Correctly identifies the existing dispatch and manifest mismatches.
- Correctly verifies that `rqs_eligible_digest_kind` returns `None` for `SearchQuery`, preserving the retention/resume nonclaim ([manifest.rs](/Users/ccheever/projects/snapback/src/manifest.rs:1717)).
- The first-page-only cursor model is faithful to LLP 0073’s current-state keyset semantics: cursors from superseded pages may legitimately resume with bounded movement or restart.
- Correctly identifies that `ChangedRow` lacks posting keys and therefore cannot support token-, partition-, or index-change precision.
- Auth-scoped admission correctly retains LLP 0053’s protocol and namespace requirements.
- The proposed capability claim is target-specific, falsifiable, and does not weaken `full_text_search_v1`.

## LLP 0119 blocker check

| Blocker | Assessment |
|---|---|
| Manifest admission | Directionally correct, but incomplete: public-read live search also requires extending `validate_authority_independent`, which currently admits only `HandlerPlan::Query` ([manifest.rs](/Users/ccheever/projects/snapback/src/manifest.rs:1636)). |
| Subscription admission | Correct. The existing `LiveQuery` check can remain, with the proposed `after` refusal. |
| Execution dispatch | Correct as far as query execution, but insufficient for downstream auth delivery, cursor publication, and failure handling. |
| Unreachable matcher arm | Correctly identified and made reachable, but its key is table-only, not index-specific ([live_matcher.rs](/Users/ccheever/projects/snapback/src/live_matcher.rs:180)). |
| Missing posting-key carrier | Correct and honestly scoped as option 5 work. |

## Concerns

### 1. Critical/MATERIAL — Auth-scoped replacements cannot carry the cursor

The Spec says every refreshed page travels as `live_replace`, and that adding `cursor` to `LiveReplace` is its sole wire change ([0136](/Users/ccheever/projects/snapback/llp/0136-live-search.spec.md:137)). That is false for `owner.v1` in sessions mode.

The current fanout path branches auth-scoped subscriptions into `deliver_authorization_snapshot`, bypassing `LiveReplace` entirely ([local.rs](/Users/ccheever/projects/snapback/src/local.rs:13422)). Its snapshot contains only subscription, function, version, and rows ([live_wire.rs](/Users/ccheever/projects/snapback/src/live_wire.rs:135)); the cursor produced by `db.search` is discarded ([local.rs](/Users/ccheever/projects/snapback/src/local.rs:12574)).

Consequences:

- Owner-scoped subscribers do not receive the per-delivery cursor promised by the first-page contract.
- The most security-sensitive admitted path cannot implement page continuation from its latest authorized replacement.
- “Every delivery is a full page on `live_replace`” and “one wire change” are inaccurate.
- The React/auth fence currently commits rows and version atomically, with no cursor state.

Resolution: specify cursor transport and atomic client adoption for both:

1. authority-independent `LiveReplace`; and
2. LLP 0053 `AuthorizationInvalidationSnapshot`.

Because `AuthorizationInvalidationSnapshot` uses `deny_unknown_fields`, the LLP 0091 “old decoders ignore an optional member” argument does not automatically apply. The revision needs an explicit compatibility/version-negotiation story and acceptance for old decoders.

### 2. Major/MATERIAL — Wake amplification is table-wide across indexes

The matcher compares only `change.table == plan.table`; it never compares the index ([live_matcher.rs](/Users/ccheever/projects/snapback/src/live_matcher.rs:180)). Therefore a write wakes subscriptions over **every search index on the source table**, not merely “every subscribed search on that index” as stated in the wake and budget sections ([0136](/Users/ccheever/projects/snapback/llp/0136-live-search.spec.md:119)).

Per-index ceilings do not bound total work for a table with several indexes:

```text
worst-case re-executions per write
  = sum(max subscriptions for every live-search index on that table)
```

Resolution:

- Rewrite wake granularity and inspection facts as table-granular across all indexes.
- Add a per-table or target-wide live-search subscription/work ceiling, or prove a finite bound on index count and aggregate fanout.
- Extend amplification measurements to multiple indexes sharing one table.
- Keep the optional `changed_fields` narrowing only if it uses each subscription’s complete participating-field set and treats empty/unknown data conservatively.

### 3. Major/MATERIAL — Refresh failure semantics conflict with the existing LLP 0053 path

The Spec says search failures terminate the subscription with the request-path diagnostic ([0136](/Users/ccheever/projects/snapback/llp/0136-live-search.spec.md:235)). The current implementation does neither:

- Authority-independent failures emit `ResyncRequired` with a generic reason and leave resubscription recovery to the client.
- Auth-scoped failures enter LLP 0053’s bounded retry and quarantine obligation path ([local.rs](/Users/ccheever/projects/snapback/src/local.rs:13881)).
- The live envelope has no carrier for the original structured search diagnostic.

Immediate termination of an auth-scoped subscription would also be unsafe unless the outstanding quarantine/delete obligation is preserved through retirement. LLP 0053 deliberately treats re-query errors as negative authorization events.

Resolution: define separate exact state machines for public-read and owner-scoped failures, including:

- whether the subscription remains registered;
- which envelope carries the diagnostic;
- client cursor invalidation;
- retry/resubscribe behavior;
- obligation preservation and ACK behavior;
- when the server may retire the live scope.

Acceptance must verify LLP 0053 quarantine and retry behavior, not merely eventual initial-subscribe refusal.

### 4. Major/MATERIAL — Coalescing and concurrency control are new machinery but unspecified

The proposed in-flight/dirty/trailing scheduler is not the current local fanout mechanism. Current local fanout runs synchronously under serialized mutable state; there is no per-subscription dirty flag or asynchronous rerun scheduler.

The Spec also commissions “subscription/concurrency budgets” but defines only subscription-count ceilings. It defines no:

- maximum concurrent search reruns;
- queued/dirty subscription bound;
- scheduler ownership or fairness;
- teardown race behavior;
- generation/authority fencing of queued work;
- aggregate CPU/work admission.

“Coalescing bounds burst cost by executor throughput” is not itself a bound.

Resolution: either:

- scope v1 to the existing serialized local execution and honestly state that each observed commit may rerun each matching subscription; or
- specify the coalescing scheduler, its retained state, lifecycle races, concurrency ceiling, and target obligations.

### 5. Major/MATERIAL — The optional-wire compatibility claim is too broad

LLP 0091’s optional `resume` was genuinely ignorable: old clients retained their previous behavior. A live-search `cursor` is load-bearing operation result data. Ignoring it means a decoder cannot construct the promised `{items,cursor,hasMore}` result after replacement.

The current headless live handle and authorization fence track rows/version, not an operation cursor. The React store publishes result-contract values derived from the delivered row payload; search’s existing special projection is currently owned by one-shot `client.search()`.

Resolution:

- Define the headless live handle’s atomic `{rows,cursor,version}` state.
- Define the search-page projection into the LLP 0114 store for establishment, public replacement, auth replacement, resubscription, and quarantine.
- Gate live-search subscription on a client protocol/capability that proves cursor-aware decoding, or explicitly declare a minimum client version.
- Do not describe the cursor as semantically ignorable.

### 6. Moderate — Public-read admission requires another validator change

The Spec says public-read search will carry `authorityIndependent`, but the current validator rejects every HostPlan except ordinary `HandlerPlan::Query` ([manifest.rs](/Users/ccheever/projects/snapback/src/manifest.rs:1646)).

Resolution: add this to the explicit blocker/work inventory and require validation proving the search index’s visibility is exactly `public-read`, with empty authority dependence and compatible read summary.

### 7. Moderate — Budget defaults are simultaneously normative and provisional

The document declares defaults of 64 and 8, then says they will be “finalized at implementation against the measurement gates.” That leaves the accepted Spec without stable default semantics.

Resolution: either pin the defaults now, or define permitted ranges and make target-specific values mandatory capability facts selected through a subsequent accepted amendment. Measurement should validate a preregistered bound, not retroactively choose it.

### 8. Moderate — Acceptance’s “byte-for-byte” page comparison is not valid for cursor ciphertext

LLP 0073 explicitly says equivalent cursors use random nonces and need not have byte-identical ciphertext; its oracle compares decoded plaintext, encoded length, and presence ([0073](/Users/ccheever/projects/snapback/llp/0073-portable-full-text-search.rfc.md:411)).

Resolution: compare rank, rows, highlights, and stored fields byte-for-byte, but compare cursors by LLP 0073’s semantic oracle. Also define how the test obtains a fresh non-live result at the identical pinned commit head when later commits may be concurrent.

## Suggestions

- State explicitly that the optional `changed_fields` optimization is excluded from the initial claim; its current “admissible but optional” posture complicates wake-occurrence noninterference and target inspection.
- Add multi-index/table fanout, auth-snapshot cursor rotation, and cursor clearing on quarantine to the acceptance corpus.
- Specify whether the per-connection limit counts supersession net-zero, following the existing live supersession precedent.
- Add the new capability to the closed `TargetCapabilityId` vocabulary and pin the exact inspection DTO rather than saying it appears “beside” `FullTextSearchFactsV1`.
- Replace “the final delivered page always reflects the final head” with a falsifiable quiescence formulation; an indefinitely advancing head has no final delivery.

## Open questions

1. Is `owner.v1` live search required in v1? If yes, the authorization-snapshot cursor protocol is mandatory, not optional.
2. Is coalescing intended only for future asynchronous/hosted targets, or must local SQLite implement a scheduler despite serialized fanout?
3. Should amplification admission be per index, per source table, target-wide, or all three?
4. On refresh failure, should owner-scoped search remain quarantined under LLP 0053 while public search terminates, or should both use a new coded terminal protocol?
5. What explicit client capability proves cursor-aware live-search replacement handling?

## Verdict

**NOT READY**

LLP 0130 SD-4 cannot apply: there are unresolved MATERIAL concerns, and the current auth-scoped failure/delivery account risks weakening or bypassing LLP 0053’s obligation boundary.

## Recommended next step

Revise LLP 0136 in place to:

1. model both public `LiveReplace` and auth-scoped `AuthorizationInvalidationSnapshot` delivery;
2. define cursor-aware client/fence compatibility;
3. correct wake amplification to table-wide, cross-index fanout;
4. specify concurrency/coalescing and aggregate budgets;
5. reconcile refresh errors with LLP 0053; and
6. repair the acceptance oracle.

Then rerun Codex-family round 1 before commissioning the second family. I could not persist the mandated review artifact under `llp/reviews/` because this session’s filesystem is read-only.
