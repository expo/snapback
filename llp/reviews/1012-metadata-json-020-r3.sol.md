# Metadata JSON projection and 0.0.20 — round3 sol review

**Date:** 2026-09-08
**Target:** `ce7f9b00b04095823e8a5a619c77fc90c840d615`
**Baseline:** `d19d9399ec07c0dd3b5ec14974259f382636dc6e`
**Reviewer:** fresh gpt-5.6-sol / xhigh session `01a0807d-baa7-7983-a977-64bbac27f559`
**Method:** read-only exact-object inspection; no product execution

# CHANGES REQUIRED

## Material inherited-in-scope defect

- `metadata.ts:77-85,108` treats every metadata key beginning with `[` as an encoded tuple. An older plain-root record whose legitimate field name is `[future]` therefore throws in `JSON.parse()` during `ProjectionCache.reset`; JSON-valid bracket names such as `[]` can instead be misowned or silently dropped. This violates the explicit legacy-readability and special-name contract in LLP 1012 §4.

  The new tests do not cover this case: `[future]` is tested either in the published-0.0.19 shared header or in the new encoded form `["[future]"]`, never as an older plain-root key. Tuple detection needs parse-and-shape validation with fallback to the literal plain-root name in both `restoreMetadata` and `MetadataKeys.owner`.

## Other classifications

- Confirmed introduced defects: none.
- Hypothesis, not an additional blocker: `swap-journal.ts:39-42` promotes callable `toJSON` roots but not boxed primitive roots. If child mutation of `Number`/`Boolean`/`String` wrappers is intended to be supported, `metadata.ts:45-66,88-94` can reopen a scalar root as an object. The documented contract is not explicit enough for me to count that as confirmed.
- Unrelated inherited observations: none.

Static inspection otherwise supports the intended behavior for sparse arrays and length, callable serializer promotion, ordinary non-callable `toJSON`, current-layout `__proto__`/`state`/bracket names, bounded journal writes, keys-only cache custody, published-0.0.19 shared-header migration, transaction refusal/retry, old-reader fail-closed admission, and preservation of unrelated rows, answers, outbox, and bytes.

I inspected exact Git blobs/diffs for `ce7f9b0` against `d19d939`, including the permitted instructions, LLP 1012 §4, relevant code-referenced LLP 1013 §3, the three modified store files, relevant range-store/carrier code, the permitted tests, and the four version files. I did not inspect mutable working-tree source, review/run records, or excluded material. I executed no tests, builds, probes, benchmarks, or network operations; the reported qualification remains author-reported rather than independently reproduced.

## Root adjudication

Candidate rejected. The canonical run separately records49 Node failures,
concentrated in database cold reopen. Root accepts Grok’s missing first-write
version-marker finding; the same incomplete initial projection omits
`factFormat`, causing current coverage to be classified as legacy and reset.
The proposed remedy must initialize all metadata roots on first publication,
not merely add a downgrade canary. A direct full-replacement downgrade
witness does not qualify the production journaled first-write path.

Sol’s older plain-root bracket-name ambiguity is inherited and outside the
released production state namespace. Root and the implementer inspected the
historical producer, closed state/StoreSwap interfaces, public exports and
version-checkpoint field sets; app-controlled keys remain nested in known
maps. The [source scope record](../../benchmarks/runs/2026-09-08-release-cold-headroom/legacy-metadata-source-scope.md)
retains that evidence and its limits. LLP1012 clarifies this scope; no heuristic
decoder is added, because literal old names can be byte-identical to tuples.
The boxed-wrapper hypothesis is outside canonical production admission,
which JSON-normalizes state before journaling; trusted direct-backend callers
must identify the complete serialization boundary. No arbitrary raw-wrapper
plus child-journal guarantee is claimed.

Three repair rounds have been exhausted. No further code repair or publication
has occurred; the user has been asked about exactly one additional bounded
round while the separate cold019 benchmark continues. Raw CLI transcripts and
process receipts remain in the private coordinating `.llp/` ledger. Process
`ended` timestamps identify supervisor-observed completion; they are not
independent timing measurements for a process that exited before it was joined.
