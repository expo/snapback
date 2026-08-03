# 0166 L3 — registration and the sync set

**Status:** Open (program: `20260803-0166-impl-program.md`; requires L2)
**Spec:** LLP 0166 §D2 (the rule; the registration record; sources;
sync obligations; hydration scheduling), §D3 (persistence predicate)

Scope:

- `QueryRegistrationV1` (closed record; source × ownerContext pairing;
  legacy-alias resolution for non-0157 references).
- Per-source durability: `active` volatile (subscription-scoped),
  `preload` manifest-derived at boot, `programmatic` durable in
  `storeMeta` (512-record / 16 KiB JCS caps, refuse-at-cap).
- The per-axis merge lattice; last-snapshot pinning of **both** policy
  axes at final release; the effective-`retentionRequest` persistence
  condition and the downgrade-to-volatile transition.
- Scope serialization (page-set subsumes; latest page demand wins;
  superseded demands answer `unknown`).
- Producer mapping: `liveQuery` calls → `active` (with `persistResume`
  → `retentionRequest`); routes manifest → `preload`; a minimal
  `programmatic` API stub (final authoring surface is 0166 OQ8 — do not
  design a public API here, just the internal seam).
- Hydration scheduler: source-derived priority, LRU within class, the
  4-concurrent establishment bound, honest attempt states.
- Registration custody under LLP 0053 transitions (destroyed with the
  partition; never resurrects revoked state).

Done means: S1's non-broker legs pass — sync-set equality over the
qmk1 family (+ grace + blocker-held + stub carve-outs), grandfathered
variant, restart legs per source, cap legs (513th and 16 KiB-exceeding
refuse), grace-retention legs, downgrade-compaction leg; S4 stays
green.

---

**Progress (2026-08-03):** implemented (Codex, session-supervised) and
landed: closed QueryRegistrationV1 with source×ownerContext pairing;
per-source durability with 512/16 KiB caps; two-axis last-snapshot
pinning; scope serialization; liveQuery active-registration wiring with
the persistResume mapping; 4-concurrent prioritized hydration scheduler
over L2 beginEstablishment; the broker-facing seam consumed by L4.
Open residuals recorded honestly: raw routes-manifest template → 
registration producer wiring awaits a concrete route-identity boot seam;
legacy in-process demands use an authority-independent sentinel until
qmk1 callers supply owner-issued partition digests. Open until the
umbrella closes.
