READY

Independent native review of frozen candidate `26c9fd5e0` (`revision.patch` SHA-256 `c974a401140c8e6f4960769a6f74ad5e0090171e1cf55a8ecaabcc8aa4176b0a`). Current-session identities/size allocation supersede older 34k / v3 / v4 pins. This review did not run the suite; conclusions below are static unless tagged as supplied-packet evidence. Twin, compiler, and client remain separate owning lanes.

## Verdict

No introduced blocking defect was found in the engine delta against the approved proposal, argument-format contract, clock contract, and the listed LLP/rules constraints. Cheap merge, search certification, trie maintenance, feed overlap, format admission, and timed envelopes are consistent with those contracts. Remaining work is qualification, root-owned docs, and other lanes.

## Reviewed semantic scope

Native engine/owner path only:

- Active schema `Index.components` and tagged `Scan.prefix` (`Scalar` | `WordPrefix`), ordinary `Read.key: Expr[]`
- Unicode 17 `u17-nfc-scf-nfc-wsp-p`, independent query Q, `source_max` equal to captured present-text bound
- Held-search rederive from actual IR + source `Exists` rule (not compiler metadata)
- Transactional `_search_nodes` / `_search_postings` / reverse membership, successor/drop/reset/seed/jobs
- Cheap `L+K+2` only when term meaning is shared and each lane is prefix-uniform; ordinary scopes partition by the physical index
- Landed feed: one shared initial-seek template, refuse-before-copy, strict mismatch fallback
- Complete metering of retained buffers plus search derivation; heap `32 × legacy_steps + derived_scratch`; ceilings 1M / 8MiB / 4MiB / 1MiB
- `ScopeTouch` old/new ordinary scopes; live range intersection; membership invalidation via existing exact probes
- `ArgType.Text` min/max/format recursively under Optional/List; shared `validate_inputs` before query/mutation, job enqueue, and channel admit
- Clock: pinned signed-safe `readTime` on full `DeliveryEnvelopeV1` iff declared, even on unvisited branches; validator includes stamp only when present and still excludes `seq`; protocol remains 1
- Identities `i53-codepoint-bytes-unicode-search-text-refinements-v5` / `bounded-spike-rust-search-text-refinements-4`; publication remains root-owned; package metadata stays `0.0.8`

## Material concerns

None.

## Why the audited risks do not block

**Index / Q / authority.** `check_scan` requires `source_max` to equal the independently inferred *present* `Fact::Text(n, false)` at the issuing expression. Optional text, constructed text, and bound mismatch refuse. Capture stores `Meaning` (argument identity, viewer, literal, field path), not later names: shadowing, `if`/`else` `Select`, and loop-carried assigns cannot retarget Q or held authority. Held descriptors are rederived from the merge and the source `Exists` membership probe; a compiler-supplied blob must match exactly. WordPrefix slots are excluded from visibility pins (`column().zip(scalar())`), so a search binding cannot forge a source-field authorization fact. Point `Read`/`Exists` on a derived index is refused (`derived_offset().is_some()`).

**Cheap merge.** `disjoint_merge` requires a lane-invariant term (literals compared by normalized token; setup forbidden) plus per-lane `uniform_visibility`. Ordinary prefix values are the physical posting scopes; one source row has one ordinary tuple per index, so distinct tuples are disjoint and equal tuples coalesce on prepared logical identity. Uniform authorization alone is not enough. Conservative miss: two aliases of the same argument do not get the cheap bound (expression JSON, not `Meaning`).

**Trie / handles / successor.** Nodes are `(table,index,parent,scalar)` with posting refcounts; reverse delete is deepest-first; logical keys and receipts carry source descriptors, not node ids; cursors are ordinary suffix only; empty search is `resolve(None)` and does not walk parent `0`. Physical `Int(node)` is scan-local. Writes, seed, maintained aggregates, operator, jobs, and `reindex_row` share insert/remove. Successor additive rebuild is in-transaction; drops call `clear_search_indexes`; reset/seed-fault paths wipe `_search_*`. Allocation reuse cannot change a logical key.

**Feed overlap.** Merge borrows `Scan`, shares one `InitialSeek` whose retained size is checked before cloning bounds, and falls back to ordinary seek on mismatch. Receipt/trace first images stay independent (`RowMembership` clones a distinct client image when it differs from the hidden first observation). Halo `RowRef`s are recorded into the same pool `project_delivery` accepts. `n2_suffix` is the ordinary remainder after the equality prefix.

**Format / clock.** Format predicates are the existing column `TextFormat::matches` (handle ASCII `[a-z0-9_]`; URL exact `http://`|`https://` + nonempty remainder; Rust whitespace/control; no parser). Empty handle follows min. Unknown format tokens fail deserialize. Validation runs before body, job enqueue (`E_JOB_ARGS` rewrite includes `format handle|url`), and channel admit. v4 identities are fenced by `has_current_semantics`. Clock is the executing pin, not inferred; untimed bytes omit `readTime`; `+32` is charged on timed query closure; resume stays protocol 1 and 1MiB.

**Chat fixture vs stress.** Adjusted chat uses the two proposed indexes plus `search.q`. Supplied packet evidence (not re-run here) reports 23 programs certified; `search.global` cheap-merge `100+20+2`, `max_closure_bytes` 3 557 738 < 4MiB, actual global closure 2 844 510; `messages.send` 50-delivery fanout with derived work under 1M steps. Stress schemas are separate.

## Optional improvements (non-blocking)

1. **Cheap-merge term identity uses expression JSON, not captured `Meaning`.** Aliased identical terms take the conservative per-lane reserve. Safer than a false cheap bound; a later Meaning-based coalescing proof could recover budget.

2. **Search closure bytes are added into `derived.scratch` and therefore into the 8MiB heap as well as the 4MiB closure ceiling.** Conservative double-count. Chat still fits; do not treat this as spare heap.

3. **`ArgType.Text` still ignores unknown extra keys** (inherited serde). Unknown *format values* are rejected. Session contract forbids a new ProjectJson protocol to close arbitrary old decoders.

## Inherited / out of scope

- Twin, compiler lowering, Expo/client fact-guards, local `h1`, and package `scripts/measure.mjs` consumer loop
- Root consolidation of LLP 1000/1001/1011/1012 and `NOT-DOING.md` (those files still mention the superseded 34 000-byte twin ceiling; `current-session-contract.md` is 66 000 gzip / 64 000 target across Twin/PersistentRangeStore/OfflineRuntime/offlineView/projection/receipt + normalization)
- Publication/versioning (lane package remains `0.0.8`)
- Search scale curve, atomic large-rebuild latency, DB/WAL, phone/Expo, integrated local runtime bytes
- Historical v4 certificates and mixed-version timed-client guarantees (explicitly not authorized)

## Practical limits of this review

Static inspection of the frozen snapshot, governing LLPs/rules, approved `proposal-r2.md`, argument-format and clock contracts, and the engine/owner delta. No build, nextest, server, or performance run was executed here.

Supplied packet evidence (not independently reproduced): 431/431 core + skip, 151/151 owner unit + skip, doctests empty-pass, format/clock/feed-overlap/guide-native logs, v5 corpus export 249 cases. Those logs are not a substitute for matched compiler/client integration, the 66 000-byte complete local runtime measurement, search scale, or platform qualification.

Certificate `derived_*` / closure figures are admission estimates. Actual witnesses in the packet differ (short query terms, null optional fields) and are a separate claim, as required.
