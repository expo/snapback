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
