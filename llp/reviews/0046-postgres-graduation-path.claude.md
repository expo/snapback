# Review: LLP 0046 — Postgres graduation path

**Reviewed:** `llp/0046-postgres-graduation-path.rfc.md` (working-tree revision, 2026-07-07 draft)
**Family:** Claude (Anthropic)
**Provider/runtime:** Anthropic API via Claude Code — model Fable 5
**Date:** 2026-07-07
**Redacted:** No — reviewed locally; nothing sent beyond the model serving this
session.
**Method:** Single-session independent read, verified against LLP 0007 (parent
spec, read in full — DK-2, atomic-import warning, validation requirements),
LLP 0037, LLP 0022, and the code (`src/storage.rs` — checked for the storage
trait the draft assumes). Same-family sub-agent passes assisted verification;
this artifact is **one** family's review.

> **Independence (LLP 0005).** Draft authored by Charlie Cheever / Codex
> (GPT-family); genuine cross-family review.

## Overall assessment

The slice selection is right (single-app `postgres-dev`, same manifests, shared
conformance suite, export/import migration, no zero-downtime claim), and the
dual-engine test matrix is exactly 0007's validation demand. Two significant
problems. First, a false premise: the draft plans "a target-specific storage
adapter behind the existing storage boundary" — **that boundary does not
exist.** `src/storage.rs` is 2,314 lines of concrete rusqlite with no trait;
0007 explicitly warns that Valet's single largest retrofit cost was extracting
a portable backend trait after consumers bound to a synchronous shape. The
RFC's true first work item — extracting an async, transaction-aware store
interface — is its largest engineering cost and is currently unnamed, which
misframes feasibility. Second, "preserves commit versions" conflates carrying
`_version` values as row data (cheap, fine) with continuity of the version
*stream* — which 0007 pins as undefined across streams: a graduated instance
is a new allocator, cursors cannot survive, clients must resnapshot.

## Strengths

- Correctly frames the risk as SQLite-specific behavior hardening into the
  contract, not merely a missing backend — the same reasoning as 0007.
- Commit fencing as the default mechanism matches DK-2 as decided.
- "SQLite-only and Postgres-only tests are allowed, but must say why" is a
  good, enforceable honesty rule.

## Concerns

1. **[HIGH] The storage seam must be extracted first** (see above). *Resolves
   with:* a Prerequisite section naming the extraction as step one — which is
   also the strongest argument for doing this work now rather than later.
2. **[HIGH] Version/cursor semantics on migration** (see above). *Resolves
   with:* stating that cursors do not survive graduation, live subscribers
   observe `resync_required`, and choosing explicitly whether `_version`
   values carry over as row data.
3. **[MEDIUM] Re-opens a decided docket row:** DK-2 already decided the
   fencing shape (per-app advisory lock or single-row `UPDATE … RETURNING`)
   and rejected alternatives with a named revisit trigger. The draft's list
   ("advisory locks, serializable transactions, a version table with
   compare-and-swap") re-litigates it — and "serializable transactions" is
   technically loose: serializability gives isolation, not version-order =
   commit-visibility-order (0007 property 3).
4. **[MEDIUM] Atomic logical import is dropped:** 0007 flags atomic
   cross-engine import as "the operation that makes 'graduate without a
   rewrite' true or false" and demands it be treated as a first-class design
   problem. The draft's export→import→verify sequence says nothing about
   partial-failure behavior.
5. **[MEDIUM] Bundle exclusions unstated — and in tension with LLP 0039:**
   "export … system tables" would sweep in `_auth_sessions` /
   `_auth_verification_codes`, which 0039 excludes from export by default.
   0007 requires the bundle to define its exclusions.
6. **[LOW] Conformance suite omits the classic divergences 0007 names:** the
   concurrent-mutation test (two handlers, one commits), null-ordering /
   pagination, and the boolean/bytes/timestamp normalization-table assertions
   (0007 pins integer-millisecond timestamps — Postgres must round-trip as
   BIGINT ms, not `timestamptz`, or document the mapping).
7. **[LOW] The project/database-handle pin (0007 open question) is exactly
   Open Question 2's subject** and should be named as the thing being pinned;
   the in-process live matcher also means `postgres-dev` inherits
   single-process realtime — worth naming as the next seam, out of scope.

## Recommended next step

Revise and stay `Draft`. The slice survives; the feasibility framing and the
migration contract need to match 0007 and the code as they are.

## Revisions applied (2026-07-07, at the author's request)

Applied to the draft: Prerequisite seam-extraction section (concern 1);
cursor/version semantics rewritten with a testable resync acceptance criterion
(concern 2); DK-2 cited, allocator list narrowed to the decided shape (concern
3); atomic-or-rejected import with structured partial-failure diagnostics
(concern 4); bundle exclusions aligned with 0039/0036 (concern 5); conformance
additions (concern 6); handle-pinning and single-process-realtime notes
(concern 7). Status left untouched.
