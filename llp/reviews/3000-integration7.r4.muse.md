# Integration 7 round 4 — muse

**Reviewer:** Muse Spark 1.3 Contributor
**Effort:** high
**Date:** 2026-10-13
**Reviewed source:** 0ef865b4e9
**Scope:** LLP 3000.036 §15.4 reconciliation; delta 74895a66f0..0ef865b4e9
**Provenance:** ~/sb4-loop/muse-exec.sh --yolo --model muse-spark-1.3-contributor --reasoning-effort high --prompt-file review-r4-brief.txt. Mutually blind; response verbatim below. Raw transcript sha256 d1d0953cd3ced573f48058a32aca0ad4d7f9f818fa122dad8a6631cf8719f5f8, archived compressed.

---

NOT READY, bound to `0ef865b4e9`.

Material finding — wrong governing pointer for this form:

- The reconciled [§15.4](llp/3000.036-what-the-app-farm-asks-of-the-rule-language.rfc.md) says “PAGE can instead lower an eligible membership filter to source discovery ([§14](llp/3000.036.001-merged-pages-for-owner-or-x-lists.rfc.md)). In the Integration 7 witness, unavailable `eventActors` discovery…” This attributes `filteredEvents(): return feedPosts last 10 by .at where exists eventActors[.actorId]` to PAGE.
- That shape is not PAGE-eligible. PAGE governs a read-rule top-level `owner = viewer or exists members[…]` disjunction with an exact unique key, a finite cap over fixed viewer/row-independent pins, and party lanes ([§14](llp/3000.036.001-merged-pages-for-owner-or-x-lists.rfc.md); [intent_branches.rs](/home/ccheever/projects/snapback-sb4loop/snapback4/crates/snapback4-lang/src/bind/intent_branches.rs)). Here the probe is a query `where` filter with one row-dependent component, `eventActors` declares only `unique actor`, `online only`, no cap, and the binder’s `membership()` operates on `ReadExpr`, declining uncapped shapes.
- The precise governing source is the generic row-correlated reverse-join discovery in [§15.4’s device paragraph](llp/3000.036-what-the-app-farm-asks-of-the-rule-language.rfc.md), per [where_guards.rs](/home/ccheever/projects/snapback-sb4loop/snapback4/crates/snapback4-device/tests/readauth/where_guards.rs): “a probe keyed by a row column is instead a reverse-join discovery… unknown source coverage stops before any target range opens,” with the identical envelope `unknown && !complete && next.is_none()`, `tables == [gate]`, `data == []`.
- Correction: point this witness at LLP 3000.036 §15.4 device paragraph / `LaneSource` discovery (cf. `perRow`), and reserve §14 for capped owner-or-membership read rules. As written it attributes an unrelated lowering to PAGE.

Verified accurate (not blocking): row-independent vs membership distinction preserved; Integration 7 envelope matches the fixture (`data []`, `complete false`, `unknown/speculative true`, `next null`, `tables [eventActors]`, `withheld`, `queries.length` fence); history preserved; no wider read-policy claim.

Minor: “fully synced event-slot witness” overstates a witness run under held pending writes; say “source-present event-slot witness.”

