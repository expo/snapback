NEEDS_CHANGES

Independent Astra correctness review of the **full `e1c6e2b79a9e13ceb363f647f52807218aa2b57a` → `47a7f491a7d7f3b3abd976f2767bf2856a5baf68` delta**. This includes `4e927c26df5b1cec4f2ce885f9521474586b54a3`, receipt ownership `02a5b980b705d4cfacea6d06dd04e0d9ae654e6d`, preparation `4fb998f25cc3ef114fc8a837d5abded3f8ae31ac`, and the final coverage repairs. `4e927` was not treated as a trusted base.

Two reproducible P2 correctness defects remain in the explicitly requested standalone ClientStore scope. Both reproduce on the supplied `e1c6` source as well as the final source: they are **inherited, not introduced by R8**. The final repair addresses its particular malformed-rehydrate and duplicate-absence cases, but does not establish isolation and refusal atomicity across all direct entrypoints. I found no additional confirmed introduced defect in the R8 changes. The resource qualifications below are separate from this correctness disposition; this report makes no overall landing or release decision.

**Finding 1 — P2: shallow-frozen external rows bypass isolation and leave search postings inconsistent with row bodies.**

Source: [store.ts:167](/Users/ccheever/clique-improvement/reviews/search-twin-r8-complete-r1/packet/source/snapback2/packages/evaluator/src/store.ts:167), specifically the `Object.isFrozen(row) ? row : …` branch at line 168. This is shared by `put` at line 171 and the new rehydrate preparation at lines 78–81; construction calls `put` at line 43. The exported `immutable` helper at lines 18–23 also skips traversal once the outer object is frozen.

`Object.freeze` freezes only the object on which it is called. A valid tagged row whose outer `{ Row: … }` wrapper is frozen can still have mutable nested fields. `prepareRow` accepts that wrapper by reference, validates it once, and places it in the table and index. Subsequent caller mutation changes the stored body without updating the normalized word postings or notifying dependencies.

Reproduction in [probe/standalone.ts](/Users/ccheever/clique-improvement/reviews/search-twin-r8-complete-r1/astra/probe/standalone.ts), using the frozen fixture's native-certified schema:

```ts
const row = { Row: {
  id: { Id: 'one' }, name: { String: 'café' }, handle: 'Null'
} };
Object.freeze(row);
store.put('people', row); // Also reproduced through constructor and rehydrate.
row.Row.name.String = 'quiet';
```

On the final source, `store.byId('people', 'one') === row` is true. Its name changes to `quiet`. Searching `café` still returns that now-`quiet` row; searching `quiet` returns no rows. The identical result occurs independently through **put, constructor, and rehydrate**, on both frozen versions. This is a concrete inconsistency in locally held search, not merely an assertion about object identity.

Evidence: [final result](/Users/ccheever/clique-improvement/reviews/search-twin-r8-complete-r1/astra/probe/standalone-source-result.json), [e1c6 result](/Users/ccheever/clique-improvement/reviews/search-twin-r8-complete-r1/astra/probe/standalone-before-result.json), fields `shallowFreeze`. These are direct standalone calls with synthetic private receipts. They do not demonstrate an authenticated HTTP/SSE admission exploit or a native-emitted malformed row.

Fix: distinguish rows the store itself has normalized and recursively made immutable from arbitrary caller objects. Clone, materialize optionals, and deeply freeze external inputs even when their outer wrapper is already frozen; an internal ownership marker can preserve efficient reuse of verified store-owned values. Merely calling the current `immutable` helper on the frozen wrapper is insufficient. Preserve this behavior across all three entrypoints and add a nested-mutation regression that checks both body and search results. This need not restore a retained full-receipt pool.

Attribution: the shortcut already exists in `packet/before/.../store.ts`'s `put`. Final rehydrate factors and reuses it rather than correcting its assumption. Its new malformed-row controls test ordinary unfrozen inputs, so they do not substantiate isolation for this accepted input.

**Finding 2 — P2: direct receipt replacement can throw after deleting the old authority and partially installing a new range.**

Source: [coverage.ts:82](/Users/ccheever/clique-improvement/reviews/search-twin-r8-complete-r1/packet/source/snapback2/packages/evaluator/src/coverage.ts:82), [coverage.ts:114](/Users/ccheever/clique-improvement/reviews/search-twin-r8-complete-r1/packet/source/snapback2/packages/evaluator/src/coverage.ts:114), and [store.ts:47](/Users/ccheever/clique-improvement/reviews/search-twin-r8-complete-r1/packet/source/snapback2/packages/evaluator/src/store.ts:47). The range-preparation pass records boundaries without complete Value/type validation. Old owner contributions are removed at coverage lines 115–119; range installation at line 123 can still throw in `CoverageSpans.change` and its comparisons. `setReceipt` has no rollback around that mutation, and `touchProofs` is never reached on the exception.

Reproduction in the same bounded probe:

1. Install owner `owned` with a valid primary absence for `people/byId/missing`; `hasAbsence` is true.
2. Replace `owned` with a receipt containing a valid same-pool `people/one` row and an ordinary `people.byId` Exhausted range. Its malformed boundary is `after: { Id: null }`; other bounds are null.
3. Catch the thrown TypeError. Query the original absence again.

Both final and `e1c6` throw `null is not an object (evaluating 'left.length')`, **but the old absence is now false**. The old owner has gone; the newly created range group remains. The final diagnostic records `owners: 1` (the empty constructor seed) and `groups: 1`. Thus a refused replacement changes authority and leaves partially installed metadata. No artificial exception injection is involved.

Evidence: [final result](/Users/ccheever/clique-improvement/reviews/search-twin-r8-complete-r1/astra/probe/standalone-source-result.json), [e1c6 result](/Users/ccheever/clique-improvement/reviews/search-twin-r8-complete-r1/astra/probe/standalone-before-result.json), field `failedReceiptReplacement`. This malformed tagged boundary exercises the direct standalone API; the public wire decoder/tagger would reject it. No public authorization bypass is claimed. The demonstrated impact is refusal atomicity and authority corruption in an entrypoint this review was explicitly asked to follow.

Fix: finish validation of all incoming range boundaries, suffix widths, typed values, and other fallible range preparation before deleting the existing owner, or make contribution installation transactional. Reuse the established typed index validation instead of adding a competing wire format. Preserve the old owner's counts, group/spans state, row dependencies, and registered-directory state on refusal. The existing final-count notification order should remain. Validation should be proportional to the incoming receipt, with no warm history scan.

Attribution: this is inherited in the `e1c6` CoverageIndex replacement algorithm. The new staged whole-store `rehydrate` protects its old facts root from this prepublication failure, but direct `setReceipt` still operates on the active CoverageIndex. The final absence-value prevalidation at lines 110–113 fixes a closely related failure class for absences; it does not validate range endpoints. The supplied failed-replacement tests cover membership, halo, issuing Q, verdicts, and unsupported absence values, leaving this endpoint path uncovered.

**Review coverage and conclusions beyond the findings.**

I read `packet/context.md` first, oriented through both AGENTS files, RULES/NOT-DOING, LLP 1000, relevant engine/authority/search sections of 1001, cursor/search sections of 1011, retention/coverage/outbox/resume sections of 1012, and the offline/live-query guides. I used the packet's current all-ID, ordinary/timed, Unicode, capacity, and measurement decisions where older prose differs. I examined the complete changed-path set and delta, final implementations and relevant predecessor implementations, the stage handoffs and source-bound evidence, and direct unchanged callees including receipt tagging, held-program custody, typed values, directory/span maintenance, index trees, journaling, projection, hydration, and retirement.

The following conclusions are source-review conclusions supported by the supplied scoped evidence, not new broad-suite passes:

- **Closed extents and chronology:** RangeMeaning/ExtentCondition retain typed prefix and bound meaning, operation/site/rule identity, immutable same-pool Limit endpoints, and disclosed membership including halo. Exact normalized identities, separate scoped masks, explicit primary-negative guards, and sequence-partitioned positive postings support the intended distinction between move-out and global absence. Admission checks incoming versions at their own sequences; it does not union all row IDs into a timeless presence set. Applied-frame and preflight eligibility remain distinct, with refreshes checked against immutable proofs. The final carrier preparation still retains the transaction's required old/incoming versions.
- **Lookup and ownership:** ExtentIndex seeks table/index/scope/token buckets and prunes interval summaries. FactIndex uses exact sequence namespaces; live and proof postings share the physical HeldIndex and prepared keys with separate required memberships. Answer/guard references drive release. The new CoverageIndex authority summaries remove ClientStore's second full receipt-pool owner. This establishes a structural ownership change, not a total-memory saving. Warm query paths use maintained indexes/counts/directories; explicit cold reconstruction and whole-store rehydrate remain whole-state operations.
- **Movement, holes, authority, and overlays:** Carrier hole masks are distinct from primary absences; TwinStore uses active/inactive scoped-negative history to suppress older FIFO contributions without manufacturing primary absence. Explicit newer positives, tombstones, viewed rows, and retained-history policy remain separate paths. I followed body collection, halo loss, answer invalidation, byte-lease purge, and immutable proof retention. Native movement/revocation/halo controls and synthetic contradictory-admission controls are different evidence classes; neither is relabeled as the other.
- **Clocks and conditional recovery:** Clock identity is checked against held operation/certificate custody. Ordering remains sequence-first, then strictly newer equal-sequence readTime; exact replay and older-clock behavior are preserved. Full-redelivery comparison keeps the original sequence-normalized fingerprint. Ordinary answers missing enrolled immutable proofs request a bounded FULL revalidation, with no mutable-row proof reconstruction. Transaction-local enrollment is rechecked before publication. The reset-limit marker comparison is now inside the atomic swap. Clock-only tail selection does not advance the recorded watermark or count as a retirement miss; actual full row evidence remains a distinct retirement input.
- **Persistence and failure:** Private format 5 remains separate from public v5. Projection preserves an absent marker for common admission to classify; old experimental formats reset coverage while preserving outbox/seal. JSON normalization isolates ordinary swap inputs and arbitrary backend-loaded JSON. SwapJournal rolls back carrier state on failed publication, and maintained carrier indexes update after backend publication. The demonstrated standalone defects do not establish a failure of those generic-backend controls.
- **Final coverage repairs:** Per-owner absence identities are deduplicated, while distinct-owner Set membership and duplicate/disagreeing verdict counts remain distinct. Staged rehydrate validates the tested rows/proofs before current-row mutation and defers registered-directory notifications until final facts and rows exist. Existing index/directory objects are preserved on successful replacement. It removes both seed and non-seed old authority. The two findings above limit the broader all-entrypoint/isolation claim.
- **Public result/refusal handling:** Conditional denied projections omit data and next; partial projections omit next; complete/capped retain appropriate next. The resume change throws the published typed refusal only for the current, unaborted authority path; stale/aborted paths retain their error handling. Separate moving-main drain and epoch-adoption changes are outside this freeze and must be preserved during later integration.
- **Unicode/native semantics:** I used the separate frozen native source at `26c9fd5e0d3922ce7680493c0e8f7371f4793d59`, not older branch Rust. Native `engine/search.rs::unicode_words` and the TS repair agree on pinned Unicode tokenization, null producing no words, and the named normalization/token work terms. Query occurrence counting precedes deduplication, Q is independently issuing-site-bound, and the 4N bound remains. I checked native argument Text minimum/format decoding and predicates against the TS custody/validation path: positive minima recurse, zero is omitted in canonical identity, present Arg format:null refuses, and Column format:null is a different contract. Current v5 identity checks fence trusted custody; arbitrary old raw IR parsing is not an equivalent trust boundary.

**Fixed size, movement, and resident qualification remain failed or pending.**

| Qualification | Actual frozen evidence and disposition |
|---|---|
| Complete fixed five-root size | Final **222,224 minified / 72,555 gzip**; actual gate exits 1. **6,555 over the unchanged 66,000 ceiling**; target 64,000. Earlier `4e927` 72,199, `02a5` 72,229, and `4fb` 72,367 also fail. |
| Original movement deadline | R8 original 10,000 ms run: 10 pass / 1 cancellation, 10,026.4675 ms total. **Failed**. |
| Exploratory movement | 43/43 at 23,819.336667 ms with a 120 s deadline. Behavioral exploration, **not original-deadline qualification**. |
| Carrier-stage movement | 22 pass / 1 cancellation, 10,026.90675 ms, original 10 s. Bound to the earlier candidate before refusal-order correction; **not final-source qualification**. |
| Logical custody capacity | Fixed **524,288** combined guard/proof/reference/marker slots, including descriptor/image/mask payload charges and bounded per-owner index multiplicities. The captured 524,286-absence control passed after an approved byte-identical setup-allocation repair. It is not an untouched-test or product-performance claim. |
| Realistic format-5 resident use | **Pending.** No current realistic 10k ordinary paginated format-5 resident result is executable evidence in this packet. The later fixture preparation remains external to this freeze. |
| Historical resource concern | Prior row-only private-format-2 10k observation: RSS +383.8 MB, heap +93.3 MB, ArrayBuffers +42.8 MB. Material concern, different boundary. Separate 100k index-only ~291 MB observation must not be added to it or treated as current-format/phone clearance. |

The fixed **1M steps / 4 MiB closure / 8 MiB execution heap / 1 MiB output** limits remain explicit. A logical slot is not a byte of resident memory. Exact 2 remains deferred. No feature cut, hidden root/payload, truncated word, weaker admission authority, or size waiver is proposed.

The seven carrier checkpoint state strings and final 114 slots agree in the supplied bounded three-image/eight-frame witness. The receipt reachability controls establish loss of obsolete full-body reachability through the inspected object graph. Neither observation proves total resident cost, closure-environment reachability, runtime latency, or device readiness. Explicit whole-store rehydrate temporarily owns old state, replacement preparation, and its row journal; that cost is not an 8 MiB whole-store heap clearance.

**Actual checks and evidence limits.**

I verified all **1,495 manifest-listed packet files** against their recorded sizes and SHA-256 hashes: zero mismatches. I performed source/diff review and one small standalone diagnostic probe with preserved boundary variants, using copied immutable inputs only. I did not run size, movement, capacity, full-store/full-suite, native rebuild/launch, heavy population, memory, remote, phone, or benchmark-app checks. No product or snapshot was edited, and all task writes are inside this Astra directory. No subagents or peer/prior reviewer reports were used.

The probe uses the native fixture schema with canonical hash `4e3289092099fe102b48f8eb3d3b402dd59002e3eb481c4c3fe87e4e6ab610f3`. It invokes standalone ClientStore directly, with synthetic private receipts. **Neither actual public delivery admission nor native store admission is exercised by the new probe.** The supplied native and public controls were read, not rerun.

The definitive commands, run from this directory, were:

```sh
/Users/ccheever/.bun/bin/bun probe/standalone.ts source
/Users/ccheever/.bun/bin/bun probe/standalone.ts before
```

Both exited 0 because the diagnostic catches and records the refusal; this is **not a passing correctness assertion**. Their output demonstrates the two defects. Initial variants `{ Unsupported: 'bad' }` and `{ Id: 42 }` were accepted, further exposing the absent boundary validation, but did not produce the sought exception. Their exact script revisions, outputs, and logs are preserved. The final `{ Id: null }` variant produces the post-mutation exception on both versions. There were five small diagnostic executions total, no suite or population/deadline substitution, and no per-file qualification deadline is claimed.

[probe/captured-inputs.json](/Users/ccheever/clique-improvement/reviews/search-twin-r8-complete-r1/astra/probe/captured-inputs.json) binds 96 copied source/input files and the Bun executable. The copied set is a conservative static transitive import closure, including type imports and an unused OfflineRuntime root; it is **not an onLoad trace**. All probe imports resolve within the copied graph apart from Bun/Node builtins. [probe/verification.json](/Users/ccheever/clique-improvement/reviews/search-twin-r8-complete-r1/astra/probe/verification.json) binds the scripts, outputs, historical variants, and post-probe hash verification: zero input/executable mismatches. Bun is 1.3.12, executable SHA-256 `39e644cea4e6db24a3af36013695655d6f789b4b98f1f13bacb882ac6e5c3c18`.

The supplied final indexed-entry result passes its direct Bun assertions and has **no original per-file deadline**. Earlier captured Node 10 s adapters were new adapters, not historical Bun deadlines. The supplied final public controls pass **4/4 at the original 10,000 ms deadline**, 1,424.501417 ms total. Carrier final focused controls pass 50/50 at 4,162.601041 ms on their recorded graph. Package typing/build, caps, references, and diff checks are scoped evidence only. Historical failed results and fixture/input corrections remain separate; I did not convert any prior-stage pass into a final-source whole-system qualification.

**Hashes and provenance.**

| Artifact | SHA-256 |
|---|---|
| `packet/manifest.json` | `2347dc10a76ebec5d5475aab63517e123d58810b1d93aee1f7ad997d586f7201` |
| Full `packet/delta.patch` | `3d6f06ff3a144c3f4730d78590f1546904e994cac88ca24016a8d20bffc99aae` |
| Final evaluator `store.ts` | `1b85895fdbee4ea5d15347d3794ee938241fc7e3e8582dcabf76aefa085929d9` |
| Final evaluator `coverage.ts` | `0144dc627632cce23acc838b7951aa87c6e6b56425b3cc9dcd4255ac772d1e02` |
| Final `index-store.ts` | `9e81e7ddf6a49d5986325c13aff0b0b2f52c89a0faf5e57442af1a967fdf918b` |
| Final `range-store.ts` | `920c489a931713c538b700f02e059ac72e38caf3f2f4ea98b3df618db3f00a56` |
| Final `fact-integrity.ts` | `877f9fe773d3173a5ebab58dd1683187227a706b35b8ccbd77945f09c72be9cc` |
| Final `carrier-index.ts` | `55a086697e62e398945509eb47e4af8b127772f7fc6a810f4ca1037542e84a6a` |
| Probe captured-input manifest | `34a94304ef92fded2d4bf224ea9c55a05aaf54d32334f3c2fd290b5a412b7630` |
| Definitive probe source | `e4420d3fab751396e79ecc49ba477d6f28dec1cc60e4dba48cca3af4c1982b56` |
| Final-source probe result | `130bd36a2f85d83827c1699864c2dcb60f490db3049e6f8b6219ab622a3b8bd9` |
| e1c6 probe result | `a3124a23f7b34ab112d86040dafed1ea44df2d6c49dea5fc3bea4830117d8516` |
| Probe post-run verification | `c891965136eeb9fb7a3330b8ba33c6c7b0bc80ef35129c63a134e028a1b806ea` |

The native source boundary is commit `26c9fd5e0d3922ce7680493c0e8f7371f4793d59`, source graph `07d985316ae2d74494980a0c4871a13a877237ca0de15f97e2d12ad337518e70`, with recorded owner executable SHA-256 `4d0f8f0176921b56305e9969da0fcb2dd5ecedae1f65d983f537e613d0c6e46e`. That executable identity comes from the immutable packet inventory; I did not launch or independently hash a native binary. The trusted identities are `i53-codepoint-bytes-unicode-search-text-refinements-v5` and `bounded-spike-rust-search-text-refinements-4`.

The native-family review is independent. Packet context records Muse ultra unavailable; this report claims no Muse run or substitute. The remaining uncertainties are resource/scale/device qualification, later integration with the excluded main/drain changes, and the absence of a new public/native end-to-end execution in this review. Those limitations do not weaken the two source-bound standalone counterexamples above.
