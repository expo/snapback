# UNION: finish review and named coverage after the bounded loop

**Status:** Closed
**Date:** 2026-10-12
**Systems:** Snapback 4 union sync audiences; simulator and review evidence
**Related:** LLP 3000.036.000.000 §§6, 8a, 9, 10

The continuation brief allowed at most two further paired rounds (6 and 7).
Round 7 reviewed revision 7: GPT NOT READY; Muse READY WITH CHANGES.
The two-round limit is exhausted. Revision 8 fixes GPT's two High findings,
with new expiry-default disclosure and removed-roster replay regressions,
but has not received a further paired review. The RFC remains Draft; no
READY or author acceptance is claimed. No push was made.

[GPT round 7](../llp/reviews/3000.036.000.000-union-sync-audiences.r7.gpt.md),
[Muse round 7](../llp/reviews/3000.036.000.000-union-sync-audiences.r7.muse.md),
[late Muse round 5](../llp/reviews/3000.036.000.000-union-sync-audiences.r5.muse.md).

Remaining work:

- Fresh paired review of revision 8, if the author commissions another loop.
- Two-column-plus-group world, sparing independently through both columns
  and walking three window indexes (late Muse round 6).
- A binder diagnostic for arms with identical column prefixes: their
  window map collides and the current order-column repair cannot help
  (fail-closed; late Muse round 6).
- Windowed pure-column two-/three-party world: independent newest-row floors
  and certification through every column arm (Muse round 5 High).
- Two-prefix groups and scopes; roster/group cross-table interleaving;
  snapshot page-size sweep; windowed bulk leave; windowed epoch
  leave→rejoin→create; born delete/reinsert; update/delete/recreate and
  recreate/update chains; a large roster leave with interleaved owners.
- Separate identity assertions for each epoch key input: group/recipient
  types, index changes, and inherited capture identity. The new lifetime
  regression covers expiry-column interpretation and disclosure.
- Defensive leave() errors for missing sync/index, even outside an admitted
  schema. Unknown-table stage_left panic is not reachable through the cited
  path: deferred::stage first validates all event tables in events_recording
  before calling stage_left with the same immutable schema/page.

The printer findings are answered in RFC §10: N_NO_HORIZON skips windowed
syncs before its line() call sites, and line_in(table) is explicitly the
column-form printer; line() alone cannot infer columns from an index name.
Current-audience guards now also prevent synthesized scopes from removed
arms. Ignored semantic marker behavior is documented in §5.2; bad positions
fail closed, and no ignored marker can certify a complete window.

## Coordinator continuation (2026-10-12)

The coordinator authorized two further pairs, rounds 8 and 9, on revision 8
onward. Round 8: GPT READY WITH CHANGES (Low docs only); Muse READY WITH
CHANGES (ancestor lifetime identity plus material coverage).

Revision 9, commit `40908b7126`, implements the named disclosure follow-ups:

- Exhaustive windowed two-/three-column worlds; two-column-plus-group worlds
  with and without windows.
- Equal-prefix window collision diagnosis with compiling online/all-rows repairs.
- Two-prefix scopes, sparing each column and preserving another group; a
  1,200-row alternating-owner roster leave, including a 600-row window.
- Both-store snapshot limits 1–8/1,000, roster/team cross-table scope ordering,
  blocking windowed epoch leave/rejoin/create, and compound rebirth chains.
- Separate epoch identity assertions for content/group/recipient types, index,
  capture and ancestor expiry defaults/types/columns. Ancestor interpretation is
  now included in the fingerprint.
- Explicit missing-table/sync/group-index errors in leave(), and a direct staged
  unknown-scope error regression on both stores.

Expiring group arms are refused on unions, including inherited expiry. A new
regression pins that exclusion; the admitted single-group path adds renewal,
expiry/sweep between pages and revival. This is not an expiring-union claim.
The final authorized paired round and integrated qualification remain pending.

## Final bounded outcome — 2026-10-12

Final round 9 retry on revision 10: GPT NOT READY, Muse READY. The prior GPT
attempt was interrupted by provider capacity without a final verdict; all
actual reviews and the incomplete provenance are preserved. The two completed
authorized pairs are exhausted. Revision 11 (`6e8b459087`) fixes GPT's remaining
High: expired physical predecessors cannot lend birth authority to a transient
fresh-id grant; repeated renewals remain born and deletion withdraws the joins.
Raw scopes require an actually live earlier commit span. Zero/two-renewal
regressions fail on revision 10 and pass with the fix. Synthetic-clock renewal
traces now assert deletion without replacement.

Current sb4-loop `9e345842af` was integrated locally (`5c6e7b39e1`) with LANG2's
refused-commutation fix; the 100,000-case ordinary campaign is clean. An
integration repair (`7f76133984`) preserves per-arm scans for synced UNION
sources beside the online branch planner; both-store snapshot/epoch witnesses
reproduce the previous deferral and pass with the guard.

Remaining required work: fresh paired review of revision 11 and the integration
repair before UNION promotion. No readiness or author acceptance is inferred;
no push or merge into sb4-loop was performed. Named disclosure coverage and
hardening items above are implemented. Optional null-lifetime, prediction-race
and activation-straddle witnesses remain explicit in RFC §8a. Old unreleased
epoch experiments without an activation clock retain their documented legacy
baseline behavior. The broader Lean C2/W4 findings remain existing follow-ups.

## Resolution — narrowed revision 12 and commissioned round 11

The coordinator commissioned up to three new pairs, beginning with revision
11 plus integration. Round 10 Muse returned READY; GPT provider-terminated
before a verdict after reproducing content-expiry-before-join/sweep naming
an unreadable id. The coordinator's explicit conditional narrowing was
applied in d5e7da77d4: union content and direct/inherited membership scopes
are non-expiring and horizon-free; per-arm window support is removed.
Excluded expiry/window work moves to 20261012-union-expiry-windows-deferred.md.

Round 11 reviewed revision 12: fresh GPT READY, Muse READY WITH CHANGES
(two Low diagnostics only). Both Lows are repaired with regressions. Named
disclosure/hardening requirements are implemented in admitted full-row
forms; windowed forms are deliberately refused, not claimed as supported.
The final narrowed simulator is green (27 passed, two opt-in ignored), as
are affected language/device/core checks and ordinary difftest run 100,000
(5,028,923 executions, zero disagreements or unexpected refusals). Historical
failed/incomplete evidence is retained. No author acceptance, push or merge
into sb4-loop is inferred. Optional broader witnesses and existing Lean C2/W4
findings remain explicit follow-ups rather than this ticket's required work.
