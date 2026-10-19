# REL5 workstream report

Branch: `sb4-b17-rel5`. Product: `snapback4/`. Version remains **0.4.33**, integration target **0.4.34**. No push or publication. Implementation and validation are complete. Both final independent reviews are READY.

## Changes by item

1. **Reactivation and atomic refusals (#1).** Matching active executable content is a no-op; matching any successfully adopted retained release selects its existing id with restoration and full adoption checks. New sources validate privately before numbered publication. Definitive refusals remove private and numbered candidates. A submitted request with a lost/ambiguous reply preserves source even before history shows its later commit; the regression commits afterward and restarts successfully. Deploy and rollback accept the same `--restore-dormant` flag; retained selection already expresses restoration intent. Compiler-owned `$intent:` indexes do not require authored restoration intent, but still rebuild and validate. Commits: `2b203e8887`, `62a0ac7b7f`.

2. **Rollback foresight (#7).** Deploy/check attempt reverse adoption on the candidate's post-adoption private snapshot. Static warnings also identify old required fields, broader value domains and relaxed constraints that future writes can strand. They name the prior release and `rollback <dir> --to N --check --bridge <new-dir>`. Snapshot success never freezes later writes. Commits: `2b203e8887`, `62a0ac7b7f`.

3. **Old-client contracts (#6).** Active-to-candidate, rollback and saved-baseline reports identify removed/kind-changed operations, new required or removed/retyped/narrowed inputs, changed result contracts and authored refusals. Literal defaults, ignored deprecated inputs and same-module aliases preserve query/mutation callers through existing shared IR. Required inputs remain required in generated types; SDK/generated availability accepts extra optional served inputs. Result/refusal review conservatively compares consumed operation domains, including write images, selectors, consulted indexes and nominal/action returns. Unconsumed controls stay quiet; this is advisory rather than exact value lineage or arbitrary behavioral equivalence. Commits: `88ef98d58f`, `62a0ac7b7f`, `03541d222c`, `67b605c576`, `225e4c2729`, `421a345ea1`.

**Guide and qualification:** `b5d5a1c4e2` adds shared cold/hot packed cases and executes both installed `guide deploy` Quarry blocks verbatim with frozen v1 calls. The guide changes entry targets 0.4.34. `37877abae6` keeps that entry user-facing; `044c0a79d4` records reviews, preserves documentation budgets and corrects shared standalone-guide context/generated snapshots. Deploy stays at 150 lines; README at 319/320. `0819e24e7f` updates old diagnostic and preview expectations: intentional rollback/result reviews are required while unchanged guards remain quiet. No product semantics changed after `421a345ea1`.

## Design and independent reviews

Amended LLP 3000.000.000 §16 and LLP 3000.000.000.000 §11, using llp-orient/llp-review. No new LLP number or author acceptance was invented.

Both fresh blind reviewers mark semantic revision **421a345ea1 READY**:

- [Muse transcript](llp/reviews/3000.000.000-rel5-r6.muse.md).
- [Codex transcript](llp/reviews/3000.000.000-rel5-r6.codex.md).
- [Identical brief](llp/reviews/3000.000.000-rel5-r6.brief.md) and [revision/hash/command provenance](llp/reviews/3000.000.000-rel5-r6.provenance.json).

All earlier transcripts remain verbatim. R1 repaired pending-control custody and projected domains; R2/R3 repaired collection, write, recursive and aggregate dependencies; R4 added scalar payload evidence and ordinary rollback reporting; R5 added actual search-index sources through `Index::uses_column`. Each material concern received regression coverage. R3 invoked Codex only; no Muse review is claimed for it. The user explicitly authorized extra rounds. Muse quota fallback ran through the supplied wrapper; no key file was read or printed.

## Tests and evidence

Full Cargo coverage, after affected corrective reruns:

| Crate | Test targets completed | Passed | Opt-in ignored |
|---|---:|---:|---:|
| snapback4 | 54/54 | 1,349 | 15 |
| core | 43/43 | 751 | 5 |
| language | 169/169 | 2,235 | 14 |
| device | 102/102 | 1,569 | 4 |
| simulator | 44/44 | 714 | 7 |
| Total | **412/412** | **6,618** | **45** |

All five doctest suites pass. The first full five-package command completed CLI/core/device, then was stopped when it entered duplicated language work. A separate full lang+sim command completed the remaining scope. Initial broad commands retain their failure exits; corrected affected targets replace those failures in the per-target coverage. This is not an exact-HEAD full-suite or publication claim.

Initial failures were obsolete requiredness/availability snapshots, standalone identity snippets incorrectly receiving language-card context, guide line/word budgets, and the former default workaround diagnostic. Corrective targets pass: CLI check 105; core lane source 10; device read-authority corpus 88; guide 126; aggregate copies 64 (four ignored); list contracts 14; revocation corpus 5; guide surface 4; diagnostics 19. The final complete CLI unit target passes 492 (five ignored), including all four candidate/control recovery tests. Language evolution passes 12; retention passes 51.

Linux affected clients: 59 release/availability/generated/shared-case tests plus 42 preview tests pass. The React release test passes; the optional published-0.2.33 compatibility witness skips because `SNAPBACK4_F2_LEGACY_BIN` is absent. Client TypeScript typecheck passes.

Mac Studio only (`ccheever@macstudio-charlie-apt101-a`, `~/sb4-ws-rel5`): final semantic code passes 12 language tests, four candidate/control tests and 58 affected client tests, zero skips. Two compile-time benchmark include fixtures were copied only inside that scratch root. The fleet inventory file is absent on this Linux host; the explicitly commissioned host was used. The black MacBook was never used.

Packed source is **0819e24e7f**, prepared afresh with `publish.mjs --prepare-client`. `qualify-linux --consumer-only` executes all REL5 cases: reactivation, refused-deploy-cleanliness, rollback-foresight, old-client-diff and installed-v1-v2-guide. Day-two/day-four/day-five, production accounts, security, staging, client/rule recipes, frontend and host starters pass. Ubuntu 24.04 and Alpine both pass through proot; qualification exits 0. The source/client integrity checks pass. [Packed cases and full validation evidence](snapback4/reports/20261019-rel5/verification/README.md). The first attempt passed its day-two business flow then found H9's obsolete zero-warning expectation; all 42 preview controls now pass and the fresh attempt passes H9. Its superseded private store/tarballs were removed.

`--consumer-only` is deliberate: ordinary qualification invokes the explicitly prohibited `scripts/test.sh`. Full Rust and affected client coverage run separately. Consumer evidence never produces a publication receipt or a publication-qualified claim.

Three original wave-17 lanes, copied read-only from the evidence and replayed twice on persistent private stores: **013 hackathon judging, 030 harvest tickets, 042 sterile trays**. Only release-selection workarounds were removed; original schemas/business assertions and source hashes are preserved. All six runs pass; immutable dirs stay exactly 1 and 2. Lane 042 intentionally denies OR access to loads in v2, so its original proof still labels that old-client behavior degraded; all transition/data/rule assertions pass. [Replay results, exact patches and binary/source digests](snapback4/reports/20261019-rel5/README.md), commit `2f5b536a08`.

Root setup/checks pass: frozen Bun install, ensure-workspace-hoist, generated artifacts, inventories, ref-check (zero errors/unchecked), docs budget, and guide (22 passed, zero failed/skipped/preconditions; 121 existing warnings). Wasm remains 726002 B gzip under 726502 B. Commands are bounded; final Cargo/test/check commands use zero incremental/dev/test debug profiles. Two early docs-budget child runs inherited default debug profiles; final reruns explicitly used the required environment and those build outputs were removed.

## Scope and cleanup

MIG owns backfills and staging clock; SEC3 owns invariants/audit/security tooling. Their ownership is pointed to in the governing amendment. No other worktree or original lane evidence was modified.

Defaults/deprecation/aliases deliberately cover authored non-native Quarry queries/mutations. Helpers, actions and jobs keep their distinct invocation contracts and explicitly reject these modifiers/alias targets. This scope adjustment is documented and dual-reviewed. Compatibility reports remain conservative and do not certify arbitrary client behavior or authorization equivalence.

Mac build output/dependencies and all replay copies are removed. Linux target output (29 GB) and every disposable consumer app/store/dependency directory are removed after evidence capture. Exact client/Expo packs remain in `/home/ccheever/sb4-rel5-packs-verified`; Linux platform tarball and root JSON remain in `/home/ccheever/sb4-rel5-linux-verified`. Committed verification evidence includes raw-log digests, compressed logs (zero session redactions), per-target Cargo coverage, complete consumer JSON and the exact one-off replay runner. Temporary work is not retained under target or the owned /tmp paths. No requested REL5 implementation item is deferred; ignored optional witnesses and the consumer-only qualification limitation are explicit above.
