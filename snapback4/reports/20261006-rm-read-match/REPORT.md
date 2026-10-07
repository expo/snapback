# RM: exhaustive typed read rendering

Date: 2026-10-06. Base: `8e3062941096d465ec067b00d5eb37c7f1d9f8fd`.
Branch: `sb4-intent/rm-read-match`. Host: Apartment mini, macOS 27.0.1 arm64.
Node 24.19.0, Bun 1.3.12, locked TypeScript 5.9.3 and Binaryen 132.0.0.

## Result and decision

`matchRead(read, handlers)` is exported by `snapback4/contract` and
`snapback4/react`. It dispatches the existing five meanings and passes the
original narrowed read, its data, or its refusal to exactly one callback.
Its return type is the union of the callbacks' return types. There is no new
read state, classifier, subscription, retention, traversal, device call or wire
field: runtime is two union guards and a switch over the ready discriminant.

All five handlers are required unless an explicit `otherwise(read)` is given.
That fallback covers omitted loading/absent/present handlers only; denied and
partial always require their own handlers. Explicit callbacks take precedence.
The fallback parameter conservatively retains all three eligible arms even
when an explicit handler handles one of them. This avoids a second, elaborate
API for computing the complement of a handler object. `ReadMatchHandlers<T,R>`
and `ReadMatchFallbackHandlers<T,R>` support reusable named handler sets.
Input types are inferred from the read (`NoInfer` prevents handler annotations
from widening it); result types may differ across handlers.

Points and pages have one handler set because they already have identical
existence meanings. A page passes `page.read`, not `page.items`. A nonempty
incomplete page still dispatches `present`; use `readPresentation` for its
independent incompleteness notice. Settled reads accept the same set, making a
renderer reusable with observations; their loading callback cannot run.

The implementation decision is recorded in [LLP 3000.031 §8](../../../llp/3000.031-presence-proven-absence-in-the-client-contract.rfc.md#8-exhaustive-typed-matching-lane-rm-2026-10-06).
The user's explicit Lane RM contract-edit commission governs this narrow additive
change; no engine, store, authorization or acquisition semantics changed.

## Orientation and inventory

Scope: public client contract, React export, current read publishers/page
accumulation (read-only), generated social/web/Expo sources, guide and tests.
The relevant LLPs are all in `llp/current/`, none in `llp/foundation/`:
[3000](../../../llp/3000-snapback4.explainer.md),
[3000.031](../../../llp/3000.031-presence-proven-absence-in-the-client-contract.rfc.md),
[3000.023](../../../llp/3000.023-answers-stay-on-screen.rfc.md),
[3000.028](../../../llp/3000.028-one-query-online-or-offline.rfc.md), and
[3000.007](../../../llp/3000.007-relaxed-quarry-and-explicit-residency.rfc.md).
Several have Draft headers; this inventory describes their implemented sections
and checks those against current code. The fence, rules, NOT-DOING, journal,
client card and package reference were read before editing. No stale `@ref`
was found in the changed code. Hand-off: none; the existing LLP was extended.

| Surface | Code | Governing section and meaning |
| --- | --- | --- |
| `Read<T>` | [contract.ts: Read, ReadyMetadata](../../packages/snapback4/src/contract.ts) | LLP 3000 §2; 3000.031 §§1.1,3: ready, loading or denied. Only ready carries data/metadata. |
| `Ready<T>` | [contract.ts: Present, Partial, Absent](../../packages/snapback4/src/contract.ts) | 3000.031 §§1.1,3: named covariant arms. Present data is `T & ({} \| undefined)`; partial data is T; absent data is `T & (null \| [])`, with literal `complete: true`, `cut: null`. |
| `SettledRead<T>` | [contract.ts: SettledRead, Client.query](../../packages/snapback4/src/contract.ts) | 3000.023 §11: one-shot result excludes loading, not stale or partial. Observations/hooks retain the full union. |
| `isReady`, `isLoading`, `isDenied` | [contract.ts: guards](../../packages/snapback4/src/contract.ts) | 3000.031 §§1.1,3: property guards on data/loading/denied. Ready alone does not prove presence or completeness. |
| `existence(read)` | [contract.ts: existence](../../packages/snapback4/src/contract.ts) | 3000.031 §1.1: returns loading/denied or the already published discriminant. Its return value does not narrow the original read. Settled overload excludes loading. |
| Classification | [read-existence.ts: readyExistence, readyRead](../../packages/snapback4/src/read-existence.ts); [local-query.ts: evaluateLocal](../../packages/snapback4/src/local-query.ts) | 3000.031 §1.1: nonempty first, then proven empty, otherwise uncertain empty; device pending facts are private inputs. Freshness never demotes existence. |
| `readPresentation` | [contract.ts: ReadPresentation, readPresentation](../../packages/snapback4/src/contract.ts) | 3000.031 §7: pending = loading; incomplete = ready and (partial or !complete or cut or continuation); stale = ready and !fresh; revalidating = ready and flag. why/since copy through only on their appropriate arms. No data narrowing or authority. |
| `fresh`, `since` | [contract.ts: ReadyMetadata](../../packages/snapback4/src/contract.ts); [local-query.ts: final freshness](../../packages/snapback4/src/local-query.ts); [read-observation.ts: offlineAnswer](../../packages/snapback4/src/read-observation.ts) | 3000.023 §§3.3,10; 3000.031 §§1.1,7: server-current transport knowledge versus the timestamp of known server state (Unix ms, optional, including zero). Missing since does not mean fresh. Connected/presence queries retain sample freshness; it is not an age bound. |
| `revalidating` | [read-observation.ts: revalidatingAnswer, ReadObservation](../../packages/snapback4/src/read-observation.ts) | 3000.023 §§10,12: optional literal true on a retained ready answer during replacement. Independent of fresh. It adds no authority and cannot cross withdrawals/refusals/identity fences. |
| `complete`, `cut` | [contract.ts: ReadCut, ReadyMetadata](../../packages/snapback4/src/contract.ts); [engine/local.rs](../../crates/snapback4-core/src/engine/local.rs); [engine/mod.rs: query outcome](../../crates/snapback4-core/src/engine/mod.rs); [engine/runner.rs: read_cut](../../crates/snapback4-core/src/engine/runner.rs) | 3000.007 §5.6; 3000.031 §§1.1,7: coverage/computation completeness is separate from freshness and pagination. Disclosed cut is meter/words; meter takes precedence. Non-uniform server work withholds its cut (null), while complete remains false. Null never certifies no cut. |
| `next` | [contract.ts: Cursor](../../packages/snapback4/src/contract.ts); [react-pages.ts: Pages](../../packages/snapback4/src/react-pages.ts) | 3000.007 §5.6; 3000.028 §3.3; 3000.031 §1.1: opaque evaluator-owned continuation, null/omitted when absent. A full complete page can still have another page. Cursor does not confer disclosure/absence authority. |
| Point reads | [point/array type fixture](../../packages/snapback4/test/fixtures/read-types/consumer.ts); [local-query.ts](../../packages/snapback4/src/local-query.ts) | 3000.031 §§1.1,1.3,3; 3000.028 §§2.3,3.4: typically row-or-null, unknown coverage often withholds to loading; absence needs coverage/pending proof. Hidden and missing rows remain indistinguishable. |
| Page reads | [react.tsx: usePage](../../packages/snapback4/src/react.tsx); [react-pages.ts: getSnapshot](../../packages/snapback4/src/react-pages.ts) | 3000.031 §1.1; 3000.028 §3.3: combined read carries classification, not items. Source-row identity deduplication, all-page completeness/freshness, any-page revalidation, cut precedence, final continuation and oldest known stale since compose without inferring emptiness from the item list. |
| Membership-dependent Send | [social/Conversation.tsx](../../crates/snapback4/src/verbs/init/social/Conversation.tsx) | 3000.031 §1.3; 3000.028 §8: only denied or fresh non-revalidating absent blocks social Send. Loading/partial/stale absence can queue; server authorization still decides. |

### Reachable combinations and conservative types

The SDK's classifier has this precedence; the matcher consumes its result
without inspecting data emptiness or private pending facts:

| Published state | Actual disclosed value | Completeness/cut/continuation | Freshness/revalidation |
| --- | --- | --- | --- |
| loading | No published data | No ready metadata | Neither flag belongs to this arm; acquisition or later withdrawal |
| denied | Original Refusal; no data | No ready metadata | Neither flag belongs to this arm; never an implicit empty answer |
| present | Anything other than top-level null or an empty array, including false, 0, empty string, nested null, or a nonempty page | Complete or incomplete; null or disclosed cut; with or without continuation | Fresh or stale; retained ready answer may revalidate independently |
| absent | Top-level null or empty array | Complete, null cut, no next; no admission/intersecting or unknown prediction blocking proof | Fresh or stale; may revalidate. Offline absence is at the acquired watermark |
| partial | Top-level null or empty array without absence proof | Incomplete, cut, continuation, or pending uncertainty. Complete + null cut + no next is possible when pending work alone blocks proof | Fresh or stale; may revalidate independently |

Consequences and limits:

- `present && !complete` and `present && next != null` are ordinary page
  combinations. They need an incomplete notice, not the partial callback.
  `complete && next != null` is legal: the requested page is complete, the
  population is not exhausted. An empty continuation cannot be absent.
- The engine sets complete false for disclosed meter/word cuts. The public
  structural metadata type does not encode that implication; custom clients can
  construct complete+cut values, and the matcher preserves their published word.
  The runtime matrix deliberately includes these conservative type combinations
  as well as normal producer combinations. It is not a claim that all matrix
  cells arise from the production engine.
- Partial can be a retained absent point reclassified when a prediction arrives,
  with otherwise complete metadata. Unknown point coverage often publishes
  loading instead. A generic partial handler must still accept T (including null),
  not an asserted empty tuple. Page clients and custom reads share this contract.
- No absent + non-null continuation, absent + incomplete, absent + disclosed cut,
  or nonempty SDK partial is produced by the classifier. TypeScript encodes only
  some of these invariants; the matcher does not attempt to repair invalid mocks.
- Present nullable points narrow to the row; absent nullable points retain
  `null | (Row & [])`. Structural arrays may have row properties, so the latter
  cannot soundly become just null while preserving covariance (3000.031 §3).
  Nullable arrays similarly retain `null | []`; readonly arrays remain readonly.
- Fresh does not imply complete, non-revalidating, safe-to-mutate, or nonempty.
  Since is optional and is not a discriminant. A ready revalidating answer is
  still ready, not loading. A hard withdrawal must dispatch loading/denied now;
  no matcher-owned last answer can remain.
- `usePage` keeps the ready prefix while a later page loads, with hasMore false
  during that wait; first-page loading or a refusal replaces the combined read.
  Its items alone never prove absence. Completeness/freshness are combined with
  AND, revalidation with OR, meter outranks words, and since is omitted when
  any stale component lacks a known timestamp.

## Adoption and documentation

Social: QuotedMessage dispatches directly to typed message.text. Conversation's
room/history/receipt status lines and send gate use matchRead. Feed, Chats,
Profile, Search, Direct and BoundedConversation adopt applicable matches. Search
preserves its independent incomplete/stale/revalidating notices. Profile and
once-media retain simple guards where those already express one condition.
All pre-existing `@ref`s still apply; the matcher points to 3000.031 §8.

Web: generated web-app and maintained chat App/Thread status lines use matchRead;
Expo: maintained Inbox/Thread (copied verbatim by init) use it. Their existing
membership gates block any absent or denied read, including stale absence; this
behavior is deliberately preserved rather than silently changed to the social
policy. The online-only starter contains a client/schema and query examples,
no rendering component or state branch to replace. Its no-replica behavior is
unchanged and its consumers use the same exported matcher.

The client card teaches the paved form within 110 lines, its 15-line opening,
and 1,199 whitespace-delimited words (budgets 114 / 15 / 1,200). The package
reference teaches full and fallback handlers, point/page narrowing, metadata,
and unchanged social membership gating. The social and web starter READMEs
teach the matcher; the stale social README claim that only partial existence
shows “Partial results” was corrected to its already-implemented presentation
predicate. The generated Expo/online READMEs had no read-state explanation;
the shared client guide is their existing entry point. No Rust template strings
or Rust/device implementation were edited.

## Verification

Evidence: [affected client/UI tests](./affected-client-tests.log.gz),
[guide tests](./guide-tests.log.gz), [starter generation](./starter-generation-tests.log.gz),
[expanded social tests](./social-starter-tests.log.gz), [final type tests](./type-tests.log.gz),
[reference audit](./ref-check.log.gz), [final guide tests](./final-guide-tests.log.gz),
[final one-shot/README tests](./final-guide-client-tests.log.gz), and [wasm identity](./wasm.json).
The [full-suite log](./full-suite.log.gz) and [exit status](./full-suite.exit)
are retained alongside these records.
The required invocation was from the worktree root, using the local pinned Node:

```sh
export PATH=/Users/ccheever/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH
LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT bash snapback4/scripts/test.sh
```

Targeted Node/Cargo commands ran from `snapback4/`, its independent workspace.


- Dependencies installed with `bun install --frozen-lockfile` in snapback4.
- Package build and initial matcher/type tests: 14 passed. Missing each of five
  states fails tsc; missing denied/partial even with otherwise fails tsc.
  Point, array, nullable array, generic covariance, Refusal and literal metadata
  types, fallback union and mixed result unions are checked against dist exports.
- Runtime matrix: 3,458 cases, frozen input/handlers, original argument and return
  identity, exactly one callback; fallback/explicit precedence, refusal identity,
  pending uncertainty, opaque data (no traversal), withdrawals and incomplete
  nonempty pages with independent fresh/revalidating/since/cut/next.
- Affected client run: 12/12 files, 178/178 tests, no skips. Includes real browser
  draft/focus/quote withdrawal, social membership gates/search, process/wasm read
  integration, React web/Expo lifetimes and generated intent transitions.
- Expanded social starter run: 15/15 tests, no skips. The added generated-source
  test renders Feed/Chats/Profile/Search with React and DOM host stubs across
  11 state/metadata cases, checking status text, stale/revalidating notices and
  enabled pagination. Existing browser tests cover interactive lifetime behavior.
- Guide Rust tests: 113 passed. Starter generation Rust tests: 22 passed.
  All 40 README/card TS/TSX blocks compile and cover 54 public functions.
- Final CLI rebuild succeeded; `guide client` exposes matchRead and the restored
  proven-refusal wording (111 printed lines including the CLI’s extra newline,
  1,199 words; source card has 110 lines).
- Reference audit: 528 LLPs, 10,424 references, zero errors or unchecked references.
- Full Mac suite: Rust passed (299 test binaries, 1,012 executions, including
  77 witness tests); chat/Expo typechecks and fixture tests passed. The client
  pool completed 324/324 files: 6,504 passing tests, 2 failures, 6 skips.
  Both full-count seeded model files passed: 79/79 tests. Overall command exit 1,
  one failed step (`client tests`), 2,895 seconds; the two test failures are
  accounted for below. All other full-suite steps passed.
- One full-run failure was RM's shortened guide wording about **proven** permanent
  held-read refusal. Restored the exact qualification within the same 1,199-word
  budget. Final guide tests: 113 passed; final one-shot/README run: 80 passed.
- The other failure is the unchanged process-runner fixture's exact inspection
  count: 47 versus 2 in the full run, 44 versus 2 isolated, 53 versus 2 in a
  fresh temporary archive of the untouched base commit. The baseline extraction
  contained only scripts and that test file, not RM code. No full-suite green
  claim is made. See [the ticket](../../../issues/20261006-snapback4-darwin-stale-empty-inspection-count.md),
  [isolated log](./runner-isolated.log.gz) and [baseline log](./runner-baseline.log.gz).
  Process-custody code is outside this read-rendering change and remains untouched.
- Wasm baseline: 2,117,610 bytes raw / 639,941 bytes gzip, within the unchanged
  639,941-byte budget. SHA-256:
  `e08359fecc0129ad21f85da97c068b12b1b28132563b9dc312624da131d52eb9`.
  The full-suite wasm build has the same SHA-256; see [wasm.json](./wasm.json). No Rust/device/wasm inputs or budget changed.

All work stayed in this mini worktree. Test-owned process groups and headless
browsers were the only execution resources used; simulator choreography tests
use fixtures/fake simctl. No fleet host, real simulator, X27R worktree, push,
publication or version/budget change was used.
