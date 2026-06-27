# Review: LLP 0007 — Storage portability contract

**Reviewed:** `llp/0007-storage-portability.spec.md` (working-tree revision)
**Family:** Claude (Anthropic)
**Provider/runtime:** Anthropic API via Claude Code — model Opus 4.8 (1M context)
**Date:** 2026-06-25
**Redacted:** No — reviewed locally against in-repo documents and the on-machine
Valet repository; nothing sent to any external provider beyond the model serving
this session.
**Method:** Single-session independent read-and-critique grounded in the Valet
retrospective evidence (diaries + LLP corpus, especially Valet's own storage,
sync-protocol, query-builder, schema-migration, and portable-backend specs and its
implementation-status guide). Requested with "revise to make them better," so this
**applied** the edits documented below.

> **Independence (LLP 0005).** This session did not author the draft (Codex did);
> a Claude review is cross-family. The applied changes are grounded in Valet's
> shipped storage layer, not invented; the precise lines Snapback should *not*
> cross (e.g. the exact decimal encoding) are left open.

## Overall assessment

A strong, correctly-scoped Spec: portable-by-default with explicit opt-outs,
engine-independent ids/versions/timestamps, "generated facts over inference," and a
sync-ready changeset contract. Its bones were right; what it lacked was the
**hard-won implementation specificity** that the predecessor already paid for. Valet
shipped almost exactly this contract and left a precise record of where the abstract
version silently breaks — which is the most useful thing that can happen to a draft
storage spec. The revision folds those in, and one of them is a genuine
correctness trap the Spec as written would have permitted.

## Strengths

- **Portability stated as observable behavior, not just types** (*Design
  Principles*) — "same observable behavior on SQLite and Postgres" is the right,
  falsifiable framing.
- **System fields + runtime-clock timestamps** (*Timestamps*) are exactly what Valet
  proved "secure by construction"; the integer-milliseconds choice is *better* than
  Valet's `REAL` storage.
- **"Index-first scale" and "no silent full scans"** anticipate the precise perf
  cliff Valet hit; the draft's instinct was correct before it had the evidence.

## Concerns

- **C1 — The version/changeset contract permits an implementation that violates it.
  [High]** "Advances the global version once … every row associated with that same
  commit version" is right, but Valet *stated the same rule* and implemented it with
  a per-row `AFTER` trigger that bumped the version once **per row**, so rows in one
  changeset got different versions — breaking atomic delivery and cursor compare.
  *Resolves when:* the Spec forbids the per-row trigger and requires one
  per-transaction version allocation. **Applied** (implementation-constraint
  paragraph in *Versions and Changesets*).
- **C2 — "Portable field vocabulary" with no single-sourced physical mapping is
  where Valet silently diverged. [High]** Valet mapped `v.number()` to `REAL`
  (client) vs `INTEGER` (server) and left `v.bytes()` unmapped server-side.
  *Resolves when:* one generated type-map is asserted by both writer and reader.
  **Applied** (*Data Model*).
- **C3 — Query semantics needed the all-or-nothing pushdown rule, the
  no-silent-fallback teeth, and local↔server parity. [Medium-High]** Valet fell back
  to a full scan silently on one untranslatable (JSON/array) predicate, and its
  local replica diverged from the server on ordering/`withIndex`. *Resolves when:*
  the Spec adopts all-or-nothing translation with a diagnostic, pins null/comparison
  semantics (the `neq`-NULL case), and requires identical results across execution
  sites. **Applied** (*Query Semantics*).
- **C4 — Schema evolution and the schema hash were under-specified relative to what
  Valet ran. [Medium]** The conservative-applier bullets are nearly verbatim what
  Valet shipped (validation worth citing), but the deprecate+backfill idiom and the
  single-canonical-hash caveat (Valet used two divergent hashes) were missing.
  **Applied** (*Schema Evolution*).
- **C5 — The SQLite→Postgres graduation had no mechanism, and the store-trait shape
  was unstated. [Medium]** Graduation is a logical-bundle export/import problem
  distinct from byte snapshots; Valet's unsolved hard part was **atomic
  cross-engine import**, and its biggest retrofit cost was a synchronous store trait.
  *Resolves when:* both export contracts are named, atomic import is first-class, and
  the store contract is async/transaction-aware from day one. **Applied** (new
  *Export and Engine Graduation* section).
- **C6 — Read-only query enforcement cannot come from SQLite. [Low-Medium]** The
  engine will not reject writes on a "query" path. *Resolves when:* the Spec routes
  this to an authorizer/capability above storage. **Applied** (*Transactions*),
  cross-linked to LLP 0009.

## Suggestions (non-blocking)

- The open questions now include the portable id/handle representation and
  materialized-vs-streaming results — both bit Valet's second backend; resolve them
  before a real Postgres adapter, not after.
- Consider making the cross-engine conformance corpus (LLP 0010) the standing
  portability proof; Valet treated "the trait is portable" as an assertion because
  the matrix CI was never built.

## Open questions (for the author)

- Exact id algorithm; decimal encoding; JSON-query subset on the paved path — all
  genuinely open and left so.
- The atomic cross-engine import design — flagged as first-class but not solved here.

## Recommended next step

*Proposed only — the author decides; status unchanged (`Draft`).*

1. **Status stays `Draft`.**
2. **Charlie reviews the applied edits** (C1–C6) — C1 (per-row version) and C2
   (type map) are the two with correctness teeth; the rest sharpen or add open
   questions.
3. **Validate against a real Postgres adapter and the conformance matrix** — that
   will force the id/streaming/decimal questions faster than more review.
