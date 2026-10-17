# Implementation review round 1 response

Candidate replacement 39d332273f. The accepted RFC semantics are unchanged.

1. Entirely dormant live → manual: reconcile using recovered source definitions before projection, including retired-column provenance; enable file-backed restoration identities for dormant-live sources too. Regression removes the complete live child table, moves parent, then restores manual schema; only new reader sees it.
2. Restore sequence counters and timeline high watermark via ordinary import_sequences/restored_sequence inside the bounded barrier; return commit watermark to both native stores. Ordinal 100 restores, next insert allocates 101.
3. Dormant live equality: already fixed in 1221be9d9b; preserve parent lifetime evidence, restamp current policy. Narrow/widen regression passes.
4. Bulk final validation now examines changed identities/groups and captured children of changed parents, under the same job account. A one-parent restore next to 20,000 unrelated rows passes.
5. Captured-only activation retains its prior actual-image traversal; live transitions use declared scratch. A <=300000 declared column storing a tiny row adopts an unrelated table successfully.
6. Authoritative memory seed_server_rows establishes one job account and admits input before its collector; source event peaks use the same account. Lazy 100,000-row iterator refuses before exhaustion and commits no row.

Muse round 1 returned transport retries, no verdict; stopped and retried on the replacement candidate. Fresh independent reviews of round 2 do not receive this response or round-1 findings.

## Round 2 response

1. Forward adoption uses recovered whole-table manual authority definitions before captured-cell provenance can override them. Narrowed restorations validate each original manual image before dropping its cells. Disagreeing dormant manual copies refuse atomically.
2. A restored narrowed row's own historical Through definition drives reverse reconciliation after dormant cell overlays, even after an intermediate manual generation. Current parent values replace stale authored authority cells; lifetime checks remain.
3. Live key admission includes the appended row id and every string/bytes tag and terminator. The all-zero byte boundary plus maximum row-id encoding has a core test.
4. Every trusted bulk put reserves simultaneous old/new index vectors using cardinality/width-aware scratch before native index_write. An unrelated 6000-index table cuts E_BOUND before replacing its row.
5. Final cap validation reuses cap_skips_null and counts nonexpired occupants, matching ordinary cap semantics. Set-null and expiring-population witnesses are tested.
6. Descendant capture validation is skipped when that edge's relevant parent inputs/deadline match the original image. A parent restored identically beside 20k captured children succeeds; changing its captured policy refuses.
7. Authoritative memory restore delegates to the same bounded final-image barrier as SQLite/Postgres: recapture current live authority, retain one job account and roll back oversize input. Trusted durable derivation images are preserved under the native restore contract, rather than triggering a separate unbounded global rebuild. Legacy captured-only memory restoration is unchanged.

The per-row provenance path also now preflights stored image/definition bytes before ownership and fetches only destination dormant cells against the owning page/row account. The RFC's closed admission and fixed-price design remain unchanged; these implement its complete-source and retained-state requirements.

## Round 3 response

Muse READY; fresh Codex found three points. Destination decode/index scratch now participates in the byte-admitted callback reservation, and a 6000-destination-index adoption cuts before allocating. Every cap validator selects a plain index; a two-token word index beside a plain owner index cannot inflate occupancy. Dormant live cap changes bypass historical Through equality and restamp current inputs, then validate destination occupancy.

The restoration relation also preserves each restored row's live source provenance until the entire barrier finishes. That prevents formerly-live rows from accidentally taking captured-history or immediate-manual correspondence shortcuts after intermediate generations. Source captured-to-live still requires current input agreement. Regression witnesses cover dormant cap increases/decreases, live → narrowed → manual → captured, and captured → dormant → live with consistent/inconsistent current parents.

Two defensive checks complete the proof: raw live constraints/unique keys may not depend on mutable engine inputs, and live manual-handoff inference must map every focal input. The latter keeps the handoff proof self-contained; core read-rule admission already refuses reference hops. A focused core unit test demonstrates why identical unmapped hop syntax cannot stand for an empty copy map if that surface expands. Ordinary captured-only correspondence remains unchanged.

Muse's non-blocking scalar-literal note was addressed in 1a9b79d95d; complex raw literals refuse live admission.

## Round 4 response

Postgres overrides walk_adoption with a byte-admitted direct traversal of r, independent of indexes deliberately cleared for rebuilding. Each singleton prepays driver/raw payload, exact decoder and destination callback scratch before decode/write. A real private PostgreSQL 16 cluster exercises adoption, live index rebuilding, transfer rollback, transfer, and parent-only trusted restore.

Through adoption now selects the bounded reservation per affected table: previous/destination live or restored-live provenance. Unrelated captured tables retain their prior actual-image traversal even when an independent live edge exists. Postgres projection uses the same per-table scope. A <=300000 captured declaration with tiny stored data adopts an independent empty live edge successfully.

The before-allocation index reservation also includes the bounded token cardinality of word indexes in captured/manual successors. A live-to-captured adoption adding four word indexes refuses E_BOUND before callbacks and preserves the old generation, rows and ability to transfer. Native bulk put shares this cardinality helper.

## Round 5 response

1. Every native and authoritative-memory seed/import source prepays simultaneous old/new index vectors and source decode scratch before entering ordinary upsert, using the same shared source envelope as restoration. New SQLite and memory witnesses with 10,000 indexes refuse E_BOUND before writing. Cardinality-aware key scratch also covers declared oversized legacy keys that are allowed to stay equal or shrink.
2. Narrowed restoration prepays the current/source parent's maximum decode scratch in the owning row admission before forward correspondence or reverse manual recapture. A live → narrowed → manual generation with a subsequently widened 20 MiB parent refuses restoration atomically. Lifetime existence checks use SQL existence rather than fetching an unrelated parent payload. The final historical-capture guard admits its parent payload before fetching too.
3. Column-only restoration records live-source provenance per recovered active identity after validating the immediate manual source, before source evidence is deleted. Narrowed overlays record their own column provenance after the per-row forward check. Live Alice → manual → coherent parent/copy transfer to Bob → captured adoption now recaptures Bob; a disagreeing immediate manual copy still refuses live adoption.

## Round 6 response and admission delta

Muse READY on the full implementation; Codex found one reverse-adoption ordering defect. Active live-source rows now reconcile current manual authority before destination narrowing. Already-narrowed live rows defer compatibility classification until after dormant overlays and current-parent recapture. The new witness covers both active and already-dormant rows: manual red → live → parent blue → manual enum('blue') retains the readable child with its current blue value.

A separate native admission audit added enum-word cardinality and retained empty-index record/field-vector scratch. Two focused core tests pin both cases; the paired round-7 delta review covers 85e71381ca..22724ec28d separately from the full implementation review. These are accounting corrections, not a new language shape or ceiling.

The narrowed-row precheck defers only the exact destination authority fields that manual_image will overwrite. Unrelated incompatible data remains dormant before any current-parent fetch; full compatibility is checked after recapture. The prior 20 MiB-parent regression and both reverse-narrowing witnesses pass together (38 language live tests).

## Round 8 response, final format correction

Codex #1 and Muse's refusal witness were the broad incompatibility deferral already corrected in 34cea7574a. Round 9 independently approved that scoped correction in both families. Muse's first failing run read 43bcb754f5-era code; subsequent four passes ran after the working source advanced to the correction. This was source variation during review, not evidence of a nondeterministic product run. The corrected committed source's full 38-case suite passed repeatedly; the expanded 40-case suite also passes. The next full review freezes product source until both verdicts arrive.

Codex #2: dormant value cells now persist their own live_source bit. save_cell sets it only for live engine captures; metadata for another row cannot overwrite it. Restoration markers query the actual cell bit, and activation discovers retained live cells even when shared column shape metadata is captured. Deletion/pruning consumes the bit with its cell. Existing published captured-only stores add the column with default false inside the activation transaction.

The two-parent regression mixes a dormant captured child and a later live child, lets restored captured cells overwrite the shared shape definition, transfers the live child's parent/manual copy, and then restores captured mode. The live child recaptures its current parent; changing the captured child's original parent still refuses atomically. A separate legacy four-column store test adopts live and rolls back to manual without id changes. Language live 40/40 and core store 100/100 pass on this format correction.

## Round 10 response

Muse READY on frozen 0702c95c58. Codex found one P1: inferred manual correspondence could target the immutable parent reference. Both whole-population reconciliation and per-row restoration now treat that binding like row identity: a mapped value must already equal it, otherwise adoption refuses with a separate-copy-column rewrite. Active and dormant variants of the reference-valued policy-input witness refuse atomically and retain the original binding/generation.

The reverse-manual route now also includes destination scratch in its admitted walk, and narrowed restoration prepays the destination image before recapture. The manual successor with 6,000 indexes refuses before allocating its old/new key sets, preserving the live generation and subsequent transfer behavior. Final changed-scope checks: 42 language-live tests and 100 store tests pass. These are corrections to the accepted identity/binding and before-allocation contracts; no new language shape or runtime ceiling.

## Round 11 response

Muse READY on frozen 65564eb9f5; Codex found the immediate-manual check was limited to live destinations. Manual → captured restoration now checks the actual manual predicate and current parent before live-origin dormant cells can authorize recapture. The active and narrowed Alice-copy/Bob-parent witnesses refuse atomically with E_READ_THROUGH_ADOPT.

Authority mode and cell origin are separate. Newly narrowed rows retain their actual source table definition, independently of recovered column shape metadata. Whole/narrowed restoration carries manual/captured/live source mode in the FILE-backed relation through the final barrier. Per-row reconciliation has priority over a different global predecessor mode; captured rows preserve their own inputs/deadlines rather than acquiring whole-row live provenance from an unused older cell. Existing captured-definition bridge refusals remain intact.

Live policy-input references do not bind the lifetime of a former audience target. Immutable parent binding/deletion evidence remains mandatory. Authored references and original captured inputs keep their historical lifetime checks. A department-valued policy witness narrows its live child, moves the parent from department A to B, deletes A, and restores the child readable only by B's member. This complements the existing parent deletion/reuse refusals.

Reverse-live parent reconciliation precedes forward-child correspondence, and that check uses the ordinary destination parent policy when the parent itself exits inherited mode. Source/destination parent scratch remains admitted by the same bounded walker; no ceiling or supported live shape changes.
