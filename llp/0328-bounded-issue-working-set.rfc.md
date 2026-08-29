# LLP 0328: A bounded working set over the filesystem issue corpus

**Type:** RFC
**Status:** Draft
**Systems:** Project, Issue tracking, Developer experience, Agent experience,
Tooling, Proof/gates
**Author:** Charlie Cheever / Codex
**Date:** 2026-08-28
**Revised:** 2026-08-28 (initial Draft)
**Related:** LLP 0000, LLP 0016, LLP 0175, LLP 0189, LLP 0232, LLP 0276,
LLP 0287, LLP 0289, LLP 0324

## Summary

Keep Markdown files under `issues/` as the authority for repository-scoped
work, while adding the small control plane the corpus now needs:

- one exact metadata contract for new and materially edited tickets;
- a generated, queryable inventory of open and closed records;
- a bounded `issues/current/` overlay for work an agent should orient to now;
- one shared idempotent writer contract for automated ticket producers; and
- checked creation, graduation, and closure operations.

The current tree contains **456 open ticket files** plus `issues/README.md` and
**1,500 closed ticket files**. The archive is valuable evidence and must not be
mass-rewritten. The open directory, however, no longer works as a working set:
it mixes active programmes, deferred research, author decisions, one-off
papercuts, and 92 currently named battery/drift tickets in one flat list.

This RFC adds an index and an overlay; it does not introduce another issue
authority. Location remains the lifecycle authority: `issues/*.md` is open,
`issues/closed/*.md` is closed, and Linear becomes authoritative only after a
filesystem ticket records graduation and closes as AGENTS.md requires.

## 1. Current state

### 1.1 The corpus has outgrown directory listing as navigation

Measured on 2026-08-28:

| Surface | Files |
| --- | ---: |
| Open tickets, excluding `README.md` | 456 |
| Closed tickets | 1,500 |
| Total ticket records | 1,956 |
| Open filenames dated 2026-08-21 through 2026-08-28 | 324 |
| Closed filenames dated over the same interval | 278 |
| Open `battery-*` tickets | 71 |
| Open `main-drift-*` tickets | 21 |

The date-window counts describe filename dates, not a Git-introduction claim,
but they show the recent operating rate. A flat `ls issues/` is now dominated
by creation order and cannot answer “what is active?”, “what blocks this
system?”, or “is an automated signature already represented?”

### 1.2 Ticket metadata has several dialects

Among the 456 open records:

| Field spelling found | Files |
| --- | ---: |
| `Status` | 384 |
| `Date` | 247 |
| `Created` | 45 |
| `Systems` | 303 |
| `Owner` | 11 |
| `Source` | 15 |

Of the status-bearing files, 297 say exactly `Open` case-insensitively, 87 use
another sentence or lifecycle phrase, and 72 files have no status field. Some
top-level status lines contain words such as “implemented”, “resolved”, or
“complete” while also naming a remainder; those may be legitimate partial
records, but a machine cannot distinguish them from a ticket that should have
moved to `closed/`.

The body prose is often excellent. The defect is not that all tickets should
look alike; it is that the few facts needed for routing, lifecycle, and
deduplication are not reliably machine-readable.

### 1.3 Automated producers are strong locally but not joined globally

The drift and complete-battery paths already key tickets by gate plus normalized
failure signature, update a matching open record, and move resolved signatures
to `issues/closed/` under their governing LLPs. That is the right behavior.

Those producers currently own their own templates and lookup rules. Human,
review, guide-gap, capability, and future automation tickets have no shared
origin or dedupe vocabulary. A global control plane should preserve the stronger
producer-specific semantics while making their common identity and lifecycle
facts queryable.

## 2. Authority and metadata

### 2.1 Markdown remains canonical

The ticket body is the source of truth. A generated index may summarize fields
and route readers to the file, but it may not become the place where status,
resolution, or ownership is edited.

The path is the lifecycle authority:

- `issues/YYYYMMDD-slug.md` — open;
- `issues/closed/YYYYMMDD-slug.md` — closed; and
- `issues/current/<same-name>` — a relative link or regular pointer to an open
  ticket, never a copy.

The filename date is the ticket's creation date. A later observation or edit
does not rename the file. Slugs and dates never become reusable identities.

### 2.2 Core metadata v1

Every new ticket and every existing ticket materially edited after adoption
uses this compact header:

```markdown
# Short descriptive title

**Status:** Open
**Date:** 2026-08-28
**Systems:** Testing, Build
**Origin:** human
**Dedupe key:** optional-human-key
**Related:** LLP 0328
```

Rules:

- `Status` is exactly `Open` in `issues/` and exactly `Closed` in
  `issues/closed/`. Progress detail belongs in the body, not after the status
  token.
- `Date` is ISO `YYYY-MM-DD` and agrees with the filename prefix.
- `Systems` is a non-empty comma-separated routing vocabulary. The checker
  reports spelling variants before any future vocabulary ratchet; this RFC
  does not invent a closed subsystem enum.
- `Origin` is one registered lowercase id. The initial registry contains
  `human`, `review`, `guide-gap`, `drift-backstop`, `complete-battery`, and
  `imported-legacy`. New automated origins name their writer.
- `Dedupe key` is required for automated origins, unique among open tickets of
  that origin, and optional for human tickets. A closed key may rearm only when
  the governing producer says the condition recurred; the new record links its
  predecessor.
- `Related` is optional and may name LLPs, issue paths, or a Linear pointer.
  Relationships do not change which system owns live state.

Additional structured fields such as battery impact/urgency/ease/confidence,
gate id, failure signature, or author escalation remain allowed. The shared
parser preserves unknown fields in the body and rejects only duplicate core
keys or a core key whose value violates this contract.

Closed tickets additionally contain a non-empty `## Resolution` section naming
what happened and, when applicable, the landing commit, replacement LLP, or
Linear issue. “No longer relevant” is a valid resolution when explained.

### 2.3 Location wins over prose

A top-level ticket cannot claim `Closed`; a ticket beneath `closed/` cannot
claim `Open`. The checker reports legacy disagreements during migration and
fails them only when the file is new or materially edited under the ratchet.

This makes partial completion unambiguous: keep the ticket open, leave
`Status: Open`, and describe the completed and remaining parts under a current-
state heading. When no repository-scoped remainder remains, close it.

## 3. Generated inventory and operator surface

### 3.1 One generated index

Generate and commit `issues/index.generated.json`. It contains one record per
ticket with:

- canonical path, title, filename date, and open/closed lifecycle;
- systems, origin, dedupe key, and related pointers;
- whether the ticket is in `issues/current/`;
- producer-specific gate/signature fields when declared; and
- explicit `legacyMissingFields` during migration.

The index does not copy ticket bodies or infer priority from prose. Its header
binds the sorted path set and source-content digest, so a missing, duplicated,
or stale record is detectable. Closed records remain in the index for lineage
and dedupe lookup, but ordinary list commands default to open records.

Committing the index is deliberate: orientation must work in a cold checkout
without first running a generator. One centralized projection changes when a
ticket changes; no per-ticket generated leaf is introduced.

### 3.2 Stable commands

Expose one small operator façade, initially `scripts/issues`:

```sh
scripts/issues list --current
scripts/issues list --system Testing
scripts/issues list --origin complete-battery
scripts/issues show 20260828-short-slug
scripts/issues check
scripts/issues regenerate
```

`list` and `show` are read-only and consume the checked index. Output is
deterministically ordered and bounded, with an explicit continuation command
when more records exist. Exact path and dedupe-key lookup are never truncated.

Creation and closure helpers may be added to the same façade, but direct file
editing remains supported. The checker, not mandatory use of one CLI, enforces
the contract.

LLP 0289 may later move the implementation beneath `scripts/governance/`; the
stable façade survives that regrouping.

### 3.3 The inventory joins, but does not absorb, proof inventory

Register the issue-index checker as one affected proof gate selected by
`issues/`, the origin registry, the writer library, and the generator. LLP
0287's canonical proof inventory owns how that gate runs; it does not absorb
ticket membership as test membership.

The gate checks structural truth. It does not fail a landing merely because the
backlog is large, a ticket is old, or a human has not assigned priority.

## 4. `issues/current/` is the bounded orientation overlay

The open directory is the backlog; `issues/current/` is the declared working
set. Link a ticket there when at least one of these is true:

- an agent or human is actively implementing or investigating it;
- it blocks an Accepted/Active LLP or a document already linked from
  `llp/current/`;
- it is queued for an explicit near-term programme; or
- it awaits a named author decision that is presently actionable.

Do not automatically link every drift or battery ticket. A recurring failure
joins the working set when its producer reaches its governing escalation
threshold or a maintainer selects it for repair.

The overlay has a hard ceiling of **64 links**. This is a circuit breaker, not a
priority model: 64 is large enough for concurrent programmes and small enough
that the generated current view remains an orientation packet rather than a
second backlog. If the ceiling is reached, curate or explicitly amend the
budget; do not silently stop checking it.

Links must resolve to open tickets, have the same basename as their target, and
be relative symlinks or regular pointer files using the LLP overlay convention.
Closing or graduating a ticket removes its current link in the same change.

The generated index exposes current membership, and `scripts/issues list
--current` is the normal first read. Agents still search the full open index
when orienting to a subsystem so the overlay cannot hide relevant backlog.

## 5. Shared automated-writer contract

Extract the common filesystem operations from automatic producers into one
library owned by the issue control plane. A producer supplies:

- registered origin;
- stable dedupe key and preferred slug;
- title, systems, and producer-specific metadata;
- initial body and reproduction command; and
- its own observation/update/closure policy.

The shared layer guarantees:

1. lookup by exact open `(origin, dedupeKey)`;
2. atomic create without overwriting another path;
3. idempotent observation update;
4. refusal on key/path collision;
5. exact metadata and index regeneration; and
6. recoverable close-by-move only after a resolution is present.

It does not decide that a failure passed, that a guide gap is repaired, or that
an escalation threshold fired. Those semantics stay with LLP 0175/0189/0232
and the owning producer. This prevents a convenient generic writer from
becoming an unreviewed issue-state oracle.

The existing drift and complete-battery writers migrate only after fixtures
prove filename, signature, observation, escalation, and closure parity. Their
current normalized-signature behavior must not be weakened to fit the generic
API.

## 6. Lifecycle operations

### Create

A human or producer chooses an unused `YYYYMMDD-slug.md`, writes the core
metadata and a useful summary, regenerates the index, and links the ticket into
`current/` only when §4 applies. The checker prevents duplicate paths and
open automated dedupe keys.

### Update

Keep status exactly `Open`. Record progress, evidence, blockers, and narrowed
remainders in the body. A material edit to a legacy ticket opts that ticket
into metadata v1; trivial link spelling or automated observation timestamps
may use a narrow migration exception recorded by the checker.

### Close

Add `## Resolution`, set `Status: Closed`, move the same filename to
`issues/closed/`, remove any `current/` link, and regenerate the index. Never
delete the evidence record merely because the work is done.

### Graduate to Linear

Record the Linear pointer and the reason repository-local tracking is no longer
sufficient, close the filesystem ticket with resolution `Graduated to Linear`,
and remove it from `current/`. Do not keep both records live.

### Reopen

Do not move a closed record back or reuse its filename. Create a new dated
ticket linked to the predecessor. Automated signature rearming follows the
producer's governing LLP and records the predecessor path.

## 7. Adoption without rewriting history

### Stage 0 — parser and report-only census

Freeze the 456-open/1,500-closed inventory and add fixtures for the metadata
dialects that exist today. Generate the first index with
`legacyMissingFields`; do not edit legacy tickets merely to make the report
green.

### Stage 1 — new/changed ratchet and current overlay

Add the origin registry, metadata checker, index freshness check, stable list
command, and `issues/current/`. Enforce metadata v1 for new tickets and
materially edited open tickets. Seed `current/` only from demonstrably active
work; do not bulk-link all open files.

### Stage 2 — normalize live control points

Normalize current tickets, open automated tickets, guide capability pointers,
and tickets referenced by `llp/current/`. This is the high-value working set.
The untouched closed archive remains valid legacy evidence.

### Stage 3 — migrate automated writers with parity

Move one producer at a time to the shared library. Run frozen create/update/
dedupe/close fixtures before cutover. A producer never has two active writers,
and ticket identity never disappears between implementations.

### Stage 4 — optional background normalization

Normalize older open tickets when touched or during bounded curation passes.
There is no deadline or acceptance criterion requiring all 1,500 closed files
to be rewritten.

## 8. Acceptance

1. Every ticket path appears exactly once in `issues/index.generated.json`, and
   index freshness is checked on every relevant change.
2. New and materially edited tickets have exact lifecycle, date, systems, and
   origin metadata; automated tickets additionally have a unique open dedupe
   key.
3. `issues/current/` contains at most 64 valid relative links to open tickets,
   and the index/list command renders the same set.
4. Closing a current ticket atomically records a resolution, moves the file,
   removes the overlay link, and updates the index.
5. Linear graduation leaves one live authority and a durable cross-pointer.
6. Drift and complete-battery producer parity fixtures preserve their current
   normalized-signature dedupe, observation, escalation, and closure behavior.
7. An ordinary agent can list current work, filter open issues by system or
   origin, and resolve an exact id without reading all ticket bodies.
8. The legacy archive remains byte-for-byte unchanged except for files a
   maintainer intentionally edits or moves.

## 9. Non-goals

- No replacement for Linear's assignment, cycles, cross-repository state, or
  human project management.
- No automatic priority score over human tickets.
- No semantic auto-closure of tickets by the generic indexer.
- No requirement to put all open tickets in `issues/current/`.
- No deletion, squashing, or mass metadata rewrite of the closed archive.
- No full-text search engine; `rg` remains available, while the index handles
  exact structured routing.
- No landing veto based on ticket age or backlog size.
- No second authored issue database hidden in JSON. The index is generated.

## 10. Open questions

- **OQ1 — Is 64 the right current-overlay ceiling?** It is the initial Draft
  budget. Measure the rendered current packet and concurrent-program pressure
  during Stage 1; lower it if orientation remains noisy, or amend it with
  evidence if legitimate work repeatedly exceeds it.
- **OQ2 — How much closed metadata belongs in the committed index?** This Draft
  includes all closed records for lineage but no body text. If size becomes a
  measured problem, retain exact open records and shard closed records by year
  without changing the operator API.
- **OQ3 — What counts as a material legacy edit?** Stage 0 should define a
  narrow mechanical exception for producer observation timestamps and link-only
  repairs. Any change to title, lifecycle, problem, plan, or resolution opts the
  record into v1.
- **OQ4 — Systems vocabulary.** Begin report-only. A future closed vocabulary
  requires its own measured normalization plan; this RFC only requires a
  non-empty routing field.

## 11. Why this belongs in an LLP

The issue corpus is now durable infrastructure used by humans, agents, proof
backstops, capability governance, and LLP programmes. Deciding its authority,
dedupe semantics, automated closure boundary, Linear handoff, and historical
migration is a repository-wide workflow decision. Individual stale tickets are
maintenance; the contract that prevents another 1,956 records from becoming
one undifferentiated directory is design.

