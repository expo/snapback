# RULES3 — wave 13 authorization

Worktree `/home/ccheever/projects/sb4-w13-rules3`, branch `sb4-w13-rules3`.
Base `59fb4ead1b` (0.4.29). No version bump, publication, or origin push.
The only branch transfers were to the explicitly commissioned Mac scratch clone
`~/projects/snapback-ws-rules3`; no publication checkout was accessed or changed.

## Changes by requested item

| Item | Implementation and evidence | Commits |
| --- | --- | --- |
| Seven authorization recipes | `guide rule-recipes` adds offline-roster, quantified-consent, mutable-workflow, source-publication, owner-now, grant-expiry, role-workflow; each has its own fixtures and HTTP suite executing the exact shipped source. An eighth compiled section demonstrates update-images. | `afd096cf7a`, `c929166df8` |
| Offline roster + supervisor | One synced precinct roster with role and explicit supervisor assignment; supervisor overview needs its online seat and precinct assignment. HTTP snapshot/acquire/revoke is checked on memory and SQLite devices. | `afd096cf7a`, `c929166df8` |
| Quantified consent | Normalized photo/pupil tags, maintained tagged/consented counts, atomic clearance refresh on tag insert/delete and global pupil-consent fanout. Both partial consent and withdrawal across multiple photos are tested; empty tag sets do not publish. A named transition checks guardian authority on old and current consent consistency on next. | `afd096cf7a`, `c929166df8` |
| Mutable workflow | Live keyed parent probes replace frozen read-through for the released flag. Existing response visibility closes and reopens with the parent. | `afd096cf7a` |
| Source publication | One trusted mirror helper is called after approval, rename, reply and takedown. Private source notes remain private; public removal requests look up the publication rather than the hidden source. | `afd096cf7a` |
| Owner now / peers at deadline | Private current count and timed peer projection update atomically. Deadline is immutable; final total is bounded by the explicit 100-writer product cap and guarded until opening. Owner updates before opening and peer/final reads after the boundary are tested. | `afd096cf7a`, `c929166df8` |
| Grant expiry / owner visibility | Separate owner-only audit survives grant expiry, while the expired grant disappears for both owner and accountant. Owner retains the ledger; accountant loses access. | `afd096cf7a` |
| Role workflow | Host drafts and sees rates, manager edits, sponsor approves; the table transition independently locks approved scripts and protects sponsor-only decisions. | `afd096cf7a` |
| Two rule layers / update images | Rules writes section opens with intent vs table authority. E_RULE names the table authorization layer; N_WRITE_DENIED identifies old, next, combined old/next, or named transition where the bounded proof can distinguish them. Developer E_RULE phase records the failed image without another probe. Hidden client targets remain NOT_FOUND; generic hidden-collision ambiguity is preserved. | `1a6ee44ac4`, `c929166df8`, `ad7d5d45fc`, `68641c2a8a` |
| Refusal ladder | Rules/testing state decode → asserted hidden lookup → table rule → require, qualified by authored statement order. HTTP tests cover E_INPUT, hidden asserted/nullable lookup, blind hidden update, readable E_RULE, require-first, and rollback on a later require; uniformly hidden pages are complete and empty. | `1a6ee44ac4`, `c929166df8` |
| Actionable recipe pointers | Refusals/help name the matching recipes. `guide rule-recipes NAME` opens the named tested section, using the existing selector; eight CLI selector tests cover it. | `2c2c21098c` |
| Open language decisions | LLP 3000.036 §23 records universal relation quantifiers, union-sync horizons, read-through children of unions, and publication as one construct, with exact evidence lanes and current recipes. LLP 3000.036.002 §10 governs diagnostics and evaluation fidelity. | `afd096cf7a`, `1a6ee44ac4`, `2c2c21098c`, `ad7d5d45fc` |
| 0.4.30 changes entry | Added this lane's user-visible changes to the packaged changelog / guide changes. Version stays 0.4.29 for integration. | `afd096cf7a` |

## Design and review

Used `llp-orient` and read the Snapback 4 fence, governing rule/update-image,
maintained-column, read-through and union-sync decisions, plus the wave-13
Publish gate, fix list, verification ledger, H9, NA5/NA6/NA7 and the relevant
lane schemas/friction. The evidence lanes were read-only.

Fresh mutually blind Muse (`muse-spark-1.3-contributor`, high, through the
commissioned wrapper) and Codex (`gpt-6.1-sol`, high, new exec sessions) reviewed
the amendments with the code. Round 1 was NOT READY: consent's unnamed image
rule, refusal-message attribution and accounting evidence were corrected.
Both round 2 reviewers returned READY at `d71507f2db`. Both final round 3
reviewers returned READY for `ad7d5d45fc`, including native-only opt-in image
attribution, named recipe navigation and the census delta. The subsequent empty-roster hint preservation at `68641c2a8a` received a fourth
paired READY review and passes all 36 affected tests on Linux and Mac. Its
extended existing regression fails before the fix and passes afterward. All
verbatim reviews, model/command/snapshot provenance and full Codex transcripts are under
`llp/reviews/3000.036.002-rules3-r*`.

The existing authoring census gains 21 mutation occurrences: 20 server-only
and one eligible roster delete. It removes no previous occurrence or private
write site and adds no eligible private insert/update site.

## 100-schema before/after census

Copied final `snapback/`, fixtures, versions and package/TS metadata into
`/tmp/sb4-rules3-census`; dependencies, where present, were linked read-only.
Ran the base binary and changed binary with `check --json` on all 100 copies.
99 pass in each run. Lane 087 retains its known E_SERVER_TOOLCHAIN because its
copied app has no TypeScript installation. No previously clean schema gains a
refusal. Every code count is identical before and after.

There are 313 ordinary note entries plus four search-diagnostic entries, 317
note/search occurrences total. (The initial progress update's 416 was a counting
mistake, corrected during the run.)

| Code | Before | After |
| --- | ---: | ---: |
| E_SERVER_TOOLCHAIN | 1 | 1 |
| N_CONDITIONAL_COMPLETE | 11 | 11 |
| N_DELETE_NEEDS_READ | 1 | 1 |
| N_DELETE_RESTRICTED | 1 | 1 |
| N_EPHEMERAL_SERVER | 2 | 2 |
| N_FIXTURE_ARGUMENT_DRIFT | 21 | 21 |
| N_LOOKUP_HIDDEN | 5 | 5 |
| N_MAINTAIN_AUTHORIZATION | 2 | 2 |
| N_MAINTAIN_DELTA | 7 | 7 |
| N_NEVER_COMPLETE | 18 | 18 |
| N_NO_CURSOR | 144 | 144 |
| N_NO_HORIZON | 12 | 12 |
| N_NO_PRODUCTION_WRITER | 49 | 49 |
| N_PATCH_CLEARS | 2 | 2 |
| N_SEARCH_SHAPE | 1 | 1 |
| N_SEARCH_UNSCOPED | 1 | 1 |
| N_SEARCH_WORDS | 2 | 2 |
| N_SPARSE_FILTER | 16 | 16 |
| N_SYNC_ORDER | 5 | 5 |
| N_UNREADABLE_PROBE | 13 | 13 |
| N_VACUOUS_RULE | 1 | 1 |
| N_WIDE_MERGE | 3 | 3 |

Raw results, comparison script and summary are in
`snapback4/reports/wave13-rules3/`.

## Verification

- Setup: Snapback 4 frozen install, CLI build, WASM build, SDK build; root
  frozen install and ensure-workspace-hoist completed.
- Recipe fixture + HTTP and refusal ladder: all eight original suites pass;
  final selector suite adds a ninth. Both device stores exercise offline roster
  acquisition and revocation.
- Language: all eight new blocks compile without diagnostics or notes; section
  selectors and static old/next attribution tests pass. Existing 21 recipes stay
  in the compilation census (29 blocks total).
- Engine: frozen pre-change compound traversal comparison and real Runner
  traced/untraced × implicit/explicit old+next parity pass, including public
  probe ceilings, physical allowance exhaustion, finite witness deadlines and
  non-readable/unknown verdicts.
- Mac: initial 65 affected tests pass; final rerun passes 27 dev-refusals + nine
  recipe/ladder/selector tests + three real accounting/traversal tests. Scratch
  clone only; no publication worktree.
- Affected clients: 34 tests pass across client-recipes, wire-envelopes and
  delivery-refusal.
- WASM/SDK final build passes: 2,354,227 raw bytes, 717,006 gzip bytes against
  717,214; no budget increase. The first experiment exceeded by 674 bytes;
  moving opt-in developer attribution out of the web artifact fixed it.
- Docs budget passes: README 320/320 and named self-contained account test.
- Root `check-guide`: 22 passed, zero failures/skips/preconditions.
- Root `check-inventories`: PASS (365 package tests, 35 script tests, 31 demos,
  487 publication leaves, 162 pages / 1,937 snippets). Initial fresh-tree
  missing demo caches were regenerated using scripts/check-generated-artifacts;
  that prescribed generator also passes with no tracked root projection drift.
- `./ref-check`: final closeout passes (548 documents, zero errors/unchecked).
- Full Rust workspace (all requested crates plus difftest/native): final run
  pending. Earlier qualification caught a guide-byte overflow (fixed without
  raising the budget) and one route-saturation 503 under concurrent load.

## Scope boundaries / deferrals

LANG2 owns all completeness-planner bullets and notes; KIT2 owns proof helper
and client recipes; SURF3 owns general guide/help/flags and production bootstrap.
One-line pointers are in the touched guide/LLP text. The rule-recipes positional
selector is the narrow addition needed for this lane's diagnostic links.

The four larger language decisions remain explicitly open, as requested; this
lane adds their current executable recipes, not unreviewed language/protocol
capabilities. No new irreversible operation or publication was performed.
