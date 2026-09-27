# DS round 2 — preflight custody, schema lookup and retained manifest rows

Date: 2026-09-27. Branch: `sb4-intent/ds-delivery-server`.
Merged `origin/main` first in `09d70e30c` (no conflicts), with both parents
retained. Read the round-0/1 briefs, reports, journal entries, both round-1
reviews, and LLP 3000.022. No push or publication.

This supersedes round 1's claim that optimizer-dependent wasm bytes satisfy
the publisher's budget. Published bytes are built on the macOS publisher
without `wasm-opt`; its unoptimized size is the relevant measurement. The
supervisor owns the one integration ratchet increase for LLP 3000.022.
This lane leaves the budget unchanged and installs no tools on shared paths.

## Changes by file

Paths are relative to `snapback4/`.

| File | Change |
|---|---|
| `crates/snapback4/src/serve.rs` | Captures the mutation's kind and argument types from the engine under the same ownership as receipt/fingerprint preflight. Decodes against that captured signature and retains the executing writer's binding recheck. Adds a test pause immediately after preflight. |
| `crates/snapback4/tests/serve_delivery/mod.rs` | Pauses before decoding, adopts an argument rename, removal or query conversion, then requires terminal HTTP 200 `E_DELIVERY_BINDING` and unchanged head. Keeps the distinct pause before executing writer ownership. |
| `crates/snapback4-core/src/engine/delivery.rs` | Gates stamping and manifest construction using installed-schema table membership before opening a ledger. Builds the binding index incrementally under the cold query's allowance, shares only a complete index through the installed schema, and preserves already-reserved envelopes' fitting rows after later envelope failure. Adds internal no-work and real detached-reader/adoption tests. |
| `crates/snapback4-core/src/schema.rs` | Holds the shared server-only delivery lookup beside compiled bindings. |
| `crates/snapback4-core/src/schema/capabilities.rs` | Excludes runtime lookup state from serialized schemas. Cache state also does not participate in schema equality or hashing. |
| `crates/snapback4-core/src/engine/mod.rs` | Prepares membership and resets the cache on new, release, open and adopted schemas; reader clones share it. |
| `crates/snapback4-core/src/engine/postgres/mod.rs` | Prepares the same schema-lifetime lookup when attaching the PostgreSQL engine. |
| `crates/snapback4-lang/tests/delivery.rs` | Requires the retained `[["c1",4]]` row under second-envelope overflow; adds untracked-query controls with 1 and 1,001 bindings, plus 100 candidate lookups after a fitting eight-binding index; makes the many-binding debit discriminating. |
| `crates/snapback4-lang/src/guide/receipts.rs` | The paragraph above Owing says the SDK reports debt collected from publications and accepted manifests. `progress` remains a catch-up read whose returned images qualify. |
| `crates/snapback4-lang/tests/guide/definitions.rs` | Pins that paragraph and rejects the obsolete walked-pages wording. |
| `scripts/build-wasm.sh` | Restores the pre-round-1 script exactly; removes the duplicate-function elimination and sign-extension modifications. |
| `JOURNAL.md` | Appends this round's changes, validation and unoptimized size. |
| `reports/20260927-delivery-server/` | Updates the current report pointer and retains this report, logs and reversible mutation evidence. |

## Forms and observable behavior

The inline and continued clause still compile; there is no wire interface
change from round 1:

```quarry
mutation delivered(group: chats, low: int, high: int)
  reports delivery of messages by .chat, .ordinal:
  require low <= high else NOT_A_RUN
  return null
```

```quarry
mutation delivered(group: chats, low: int, high: int) reports delivery of messages by .chat, .ordinal:
  require low <= high else NOT_A_RUN
  return null
```

The test body isolates the platform boundary. A real reporter must record the
claimed coverage, as the full receipts card does.

The SDK still posts `{id, args, store_id, delivery: {fingerprint}}`. For this
fixture the fingerprint remains
`2f5d2629caf0cd61eacb5eb5bd772dd8684be9e7872af1112bd679c5719f3443`.
A request with `{group:"c1",low:1,high:1}` captured before adoption renames
`low` to `first` now receives nonretryable `E_DELIVERY_BINDING`, rather than
HTTP 400 `E_INPUT`. Existing durable receipts still replay first.

`query unrelated(): return chats['c1']` carries no `delivery`, no `partial`
and no delivery meter, including with 1,001 bindings and an 800-step ceiling.
Its data, ordinary meter, completeness and cut agree with a schema without
reporters. Internal tests also require that no ledger or index was initialized.

In the colliding-id query returning each row's own image, a tight output budget
admits the messages envelope and its `rows: [["c1",4]]`; the envelope carries
`partial: true` when the notes envelope does not fit.

## Regression strength and cache behavior

The source-lookup test uses legacy/imported unsafe integer positions, which
skip coordinate allocation after indexed lookup. All 100 rows reach the
ordinary answer. Eight bindings fit in 21 supplemental steps; 44 source
lookups spend another 176, leaving three steps under the 200-step allowance.
The manifest is partial and its debit is exactly **197**. Removing lookup
charging changes that result.

The 1,001-binding test is deliberately cold: 42 index insertions consume
**195** steps; the next needs six. Charging one step per insertion instead
consumes 200, and fails the test. No failed partial index enters the shared
cache. A completed index is shared across subsequent queries and detached
readers of that installed schema; adoption prepares a new membership set and
cache while old readers keep their old schema. Cache population changes no
schema wire bytes or hash. Each racing cold builder pays its own reservations;
only the first completed index is retained for later readers.

This is the implementation choice for “keep the index shared with the installed
schema.” Only tracked queries pay cold construction; subsequent queries borrow
the shared index, while every tracked source lookup remains charged. Membership
is prepared at schema installation, outside individual query delivery ledgers.

## Validation and measurements

Final restored-source checks pass:

- 15 delivery tests, 5 clause tests, 2 replay/fingerprint tests. The optional
  cost benchmark stays ignored; this round does not change that path.
- The **whole guide: 87 passed**, zero failures or skips.
- 2 internal delivery tests (hidden work, detached-reader sharing/adoption).
- 6 HTTP delivery tests, plus the existing durable/ephemeral bearer-authority
  test covering both sides of its lock gaps.
- PostgreSQL delivery test in **Serialized and Serializable** modes, using a
  private socket-only cluster from the lane's existing `/tmp` binaries. The
  cluster was stopped after the passing test; no shared installation changed.
- Frozen Bun install succeeded. Reference audit: 517 LLP docs, 9,622 refs,
  zero errors and zero unchecked (final evidence in `round2/ref-check.txt`).

All seven deliberate mutations fail their named assertions, with production
files restored in `finally` blocks. The probes are reproducible with
`python3 reports/20260927-delivery-server/round2/mutations.py` when no other
build uses this worktree. See `round2/mutations.json` and `mutant-*.txt`:

| Mutation | Discriminating failure |
|---|---|
| Per-source lookup costs zero | The fitting-index, 100-candidate case no longer exhausts lookup work as expected. |
| Index insertion costs one step | Supplemental debit becomes 200 instead of 195. |
| Skip walk once any envelope set `partial` | Retained messages rows become `[]` instead of `[["c1",4]]`. |
| Remove source membership gate | The internal test observes an allocated supplemental ledger. |
| Remove answer membership gate | The unrelated-query test observes `"partial"` under index exhaustion. |
| Fetch signature after preflight | The paused argument-rename case returns HTTP 400 instead of terminal HTTP 200 binding refusal. |
| Restore walked-pages prose | The guide no longer states the SDK publications/manifests contract. |

The restored-source affected tests were rerun after these mutations. During
test development, the new cache-lifetime fixture needed a file-backed store,
a fitting binding count and the binding decoder's three argument names; its
initial fixture failures and borrow compile error were ours and are fixed.
They were outside the full-suite run.

The unoptimized full-suite build measured **1,985,385 B raw / 573,265 B gzip**:
**424 B over** the unchanged **572,841 B** budget. Round 1 before optimization
was 1,985,385 / 573,266, so this is 0 raw / −1 gzip byte against that recorded
unoptimized result; round 1's optimized 570,429-byte artifact is not the
publisher comparison. No claim of an optimization saving is made here.
Rust 1.97.0, wasm-bindgen 0.2.127, Node 24.13.1, Bun 1.3.14; no `wasm-opt` on
PATH. Wasm SHA-256:
`8fb46c34b5536599c516bafe08c83382491828421cf37c598ded27754b2a65a2`.
The script is byte-identical to `eca8c12e0^:snapback4/scripts/build-wasm.sh`.
Evidence: `round2/wasm.json` and the wasm phase in the full log.

`scripts/test.sh` ran **once**, on the final implementation, and exited **1**.
The exact summary is:

```text
== 1 failure(s) in 1834 s
   wasm build
```

**Every failure:** `wasm build` is **ours**: the unoptimized artifact exceeds
the unchanged budget by 424 bytes. It remains open for the supervisor's
explicitly assigned integration ratchet. Reproduce on this Linux host with
`wasm-opt` absent from PATH:

```sh
bash scripts/build-wasm.sh
```

There are **no baseline or environmental failures in this full run**. Every
other phase passed: Cargo build, docs budget, release guard, package
checks/build, chat check, all 953 Rust executions plus doctests (1,288 s),
chat/Expo typechecks, fixture wrappers, client tests (195 s; the main group
reports 2,632 passes and 10 skips), and all **78 client models** (262 s,
zero skipped). The full run repeats and passes the 15 delivery, 5 clause,
2 replay/fingerprint and complete 87-test guide targets.

Exact command:

```sh
CARGO_BUILD_JOBS=8 RUST_TEST_THREADS=4 SNAPBACK4_RUST_TEST_PROCESSES=4 scripts/test.sh
```

Evidence: [`round2/full-suite.log.gz`](round2/full-suite.log.gz),
[`round2/full-suite.exit`](round2/full-suite.exit),
[`round2/focused.txt`](round2/focused.txt),
[`round2/core.txt`](round2/core.txt), [`round2/http.txt`](round2/http.txt),
[`round2/authority.txt`](round2/authority.txt),
[`round2/postgres.txt`](round2/postgres.txt), and
[`round2/mutations.json`](round2/mutations.json).

## Scope, deviations and remaining work

The user explicitly replaces round 1's optimizer-dependent size requirement:
the build script is reverted, the unoptimized result is reported, and the
supervisor raises the ratchet once at integration. No device collection,
client queue, debt persistence, package version, budget increase, push or
publication change is part of this round.

Scoped LLP orientation used the available `llp-orient` skill from the main
checkout because this worktree's vendored skill symlink is uninitialized.
LLP 3000.022 §§2, 5 and 6 govern receipt custody, preflight/writer binding,
source qualification, supplemental work and no-op receipts. LLP 3000.021 §3.2
is amended by §8; the current receipts card is the authoring surface. No new
protocol decision or approval is needed.
