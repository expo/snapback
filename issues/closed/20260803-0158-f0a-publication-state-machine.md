# 0158 F0a: fork publication state machine + intra-state crash-cut matrix

**Opened:** 2026-08-03. **Source:** LLP 0158 §Design sketch ("Crash-safe
mint publication" — the six-state machine S0–S5, v0.10–v0.11 as reviewed).

Implement: staging sentinel written+fsync'd before any clone byte
(startup refuses sentinel'd directories — new `snapback start` behavior);
S2 durability set (full SQLite WAL/journal set + each minted sidecar's
contents + staging dir); quarantine→lineage stamp conversion INSIDE the
mint transaction (no separate clear step); registry intent row; rename as
the single authoritative commit with both-parent directory fsync (or
same-parent staging); sentinel travels with the directory and clears only
after registry reconciliation; local-evidence-only recovery (lineage
stamp + mint receipt + sentinel; registry is advisory bookkeeping).

Post-recovery boot assertion: serves iff no sentinel ∧ lineage stamp
present ∧ no quarantine stamp.

Acceptance: intra-state crash-cut matrix — cuts around each sidecar
write, each DB/WAL flush, rename vs each directory fsync, registry
finalization, sentinel unlink — with the boot assertion after every cut,
plus recovery proven with the registry absent/stale/unavailable (Codex
round-6 delegated list).

## Resolution — 2026-08-03

Landed same-parent staging with a pre-clone fsynced sentinel, SQLite backup,
transactional quarantine→lineage conversion, complete SQLite/sidecar/directory
durability, advisory registry intent/finalization, rename commit, and
post-reconciliation sentinel removal. Boot validates local lineage+receipt and
all minted sidecars, and refuses staging or incomplete evidence before additive
SQLite open. The 20-point intra-state matrix covers each SQLite durability-set
member and recovers every cut to absent or bootable with the registry absent,
stale, or unavailable.
