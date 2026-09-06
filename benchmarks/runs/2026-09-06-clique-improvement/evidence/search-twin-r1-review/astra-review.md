**NEEDS_CHANGES**

Reviewed only `0fa68e928e9ff59c3bc5bc2edada49f96ecec6ef` against `1f9b4b95c54ba7a5a9d0ece41e9463b29078cfa4`. All 54 changed files independently match the r4 manifest. The worktree remains clean. No peer agents, other reviewers’ output, coding transcripts, or benchmark app lanes were used.

I applied R2, the complete approved clock inputs, and the later 66,000-byte and 524,288-slot decisions. Inherited superseded prose is not a finding.

1. **[P1] Direct search incorrectly rejects locally decidable ownership rules.**  
   [store.ts:187](/Users/ccheever/projects/snapback-worktrees/clique-search-twin-review/snapback2/packages/evaluator/src/store.ts:187)

   `missingSearchAuthority` recognizes only Allow, Deny, Public, and certain Exists rules. Every other rule produces an unknown directory entry—even a scope-pinned `owner == viewer` rule requiring no external authority.

   Reproduction: a synthetic table with `owner: Principal`, an index beginning with owner then wordPrefixes, a viewer-bound scan, and one matching held row. `Runner.readAuthority` returns `true`; the same store’s query returns `Null` with `partialSites: ["missing-authority", "search.findPeople.0"]`.

   The directory must preserve the evaluator’s locally decidable authorization semantics instead of unconditionally classifying these rules as unknown.

2. **[P1] The complete runtime exceeds the unwaived size ceiling.**  
   [build.mjs:15](/Users/ccheever/projects/snapback-worktrees/clique-search-twin-review/snapback2/packages/snapback2/build.mjs:15)

   I independently reproduced the exact five-root measurement with Node 22.23.2 and esbuild 0.25.9:

   - Minified: **204,645 bytes**
   - Gzip: **66,457 bytes**
   - Ceiling overage: **457 bytes**
   - SHA-256: `f4439dd4af53b77171a30c27fe04e3af70123fbaf10618673d2b04e36d1db425`

   This includes the frozen entry’s full retained implementations and generated Unicode data. Review-checkpoint authorization does not waive this blocker.

3. **[P2] First use of a direct search enumerates scope history after the twin is already warm.**  
   [store.ts:184](/Users/ccheever/projects/snapback-worktrees/clique-search-twin-review/snapback2/packages/evaluator/src/store.ts:184), [held-directory.ts:21](/Users/ccheever/projects/snapback-worktrees/clique-search-twin-review/snapback2/packages/evaluator/src/held-directory.ts:21)

   Direct-search directories are created lazily inside execution. Their constructor visits every indexed scope and refreshes its authority.

   Reproduction using the native v4 search packet and synthetic held rows: first hydrate through `search.findPeople`, then query `search.inConversation` for one conversation. With 20 held scopes, that warm query performs 20 directory refreshes; with 80, it performs 80. A subsequent term performs zero refreshes.

   This is a history-dependent warm-read initialization path. It should be constructed during hydration or replaced with maintained scoped lookup.

4. **[P2] Warm authority-only reads remain linear in retained receipt history.**  
   [coverage.ts:160](/Users/ccheever/projects/snapback-worktrees/clique-search-twin-review/snapback2/packages/evaluator/src/coverage.ts:160)

   `CoverageIndex.verdict` traverses every owner’s copy of a matching verdict to detect disagreement. That work repeats during ordinary warm rule evaluation.

   Reproduction: retain one searchable row and identical authority-only verdicts under 20, 80, then 2,000 answer owners. After warming the directory, one matching search inspects respectively **20, 80, and 2,000 verdict records**, although the row population remains one.

   Maintain allow/deny counts or an equivalent conflict summary during receipt updates. The disclosed carrier retirement history scan does not cover this separate warm-query scan.

5. **[P2] Deleting scopes leaves unbounded directory dependency metadata.**  
   [held-directory.ts:25](/Users/ccheever/projects/snapback-worktrees/clique-search-twin-review/snapback2/packages/evaluator/src/held-directory.ts:25)

   Refresh removes entries from dependency sets but never removes empty sets from `dependencies` or `digests`.

   Reproduction: register the v4 global-search directory, then insert and remove one message through 2,000 distinct conversation scopes. Final state contains zero rows, directory entries, allowed entries, and unknown entries—but retains **2,000 dependency keys and 2,000 digest keys**, all pointing to empty sets.

   These maps grow with deleted scope history until reconstruction. Remove their keys when the last dependent entry leaves.

The external reproductions are retained in [directory-probes.ts](/tmp/clique-frozen-v4-independent-review/directory-probes.ts), [authority-probe.ts](/tmp/clique-frozen-v4-independent-review/authority-probe.ts), and [clock-probes.ts](/tmp/clique-frozen-v4-independent-review/clock-probes.ts). Synthetic inputs are labeled in each file. [build-probe.mjs](/tmp/clique-frozen-v4-independent-review/build-probe.mjs) bundles the frozen source and verifies the captured Unicode table hash; it writes only outside the repository.

The exact bounded execution command was:

```sh
node --test --test-timeout=10000 --test-concurrency=1 /tmp/clique-frozen-v4-independent-review/directory-probes.ts.mjs /tmp/clique-frozen-v4-independent-review/authority-probe.ts.mjs /tmp/clique-frozen-v4-independent-review/clock-probes.ts.mjs
```

All three probe files completed in 968 ms; their observed behavior is recorded in [probes.log](/tmp/clique-frozen-v4-independent-review/probes.log). Size reproduction used `node /tmp/clique-frozen-v4-independent-review/measure.mjs`.

Beyond those findings, the review traced normalized coverage/cursor identity, issuing-program Q admission, pooled halos, recursive Text minimum validation, overlay negative dominance, asset viewing, custody transitions, and transactional clock handling. Replaying the recorded owner06 envelopes through the frozen client passed cold-reopen controls both with initial program trust and with raw custody before program arrival. Older frames preserved retained state; invalid clocks and equal-clock equivocation refused; timed omission preserved the untimed anchor, one pooled row, and zero evictions. This is recorded-envelope replay, not a new owner or device qualification.

All checkpoint-listed qualification logs hash-match. Their scopes remain distinct: the earlier evaluator result is 225 modeled plus 24 server-only cases; twin is 28 passes; same-swap is four; repaired SQLite is 15. The original owned run retains its four SQLite failures, with 200 non-SQLite passes—not additional cases to add again. Local store qualification remains 31 passes plus one timeout cancellation; the 38-pass, 12.070-second exploratory run is not a ten-second pass. The subsequently available [M5 log](/Users/ccheever/clique-improvement/lanes/search-twin/store-checkpoint-v4-m5-10s.log) reports 38 passes in 2.644 seconds; I did not independently verify its remote checkout binding.

The memory evidence supports substantial compaction, not a total resident-memory or phone claim. The 1,000-distinct-word fixture drops from 618,171,288 to 115,326,928 bytes. The separate 100k index measurement retains 290,873,924 bytes; the 100k carrier mirror records 213,457,616 bytes heap delta, 85,736,668 serialized bytes, and 300,000 guard/proof slots. These measurements cannot be summed into a combined footprint. The original 262,144-slot failure remains historical evidence; the current 524,288 ceiling accommodates that measured mirror. Combined carrier-plus-twin peak memory and current phone/Expo process-kill qualification remain unestablished by the reviewed artifacts.