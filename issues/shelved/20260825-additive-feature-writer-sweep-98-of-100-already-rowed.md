# The additive-feature writer hazard is 98% contained: two uncovered declarations

Status: open
Date: 2026-08-25
Systems: snapback-kernel, snapback-engine, snapback-auth, snapback-sync
Related: llp/0303-subject-authority-correlation-policy.decision.md,
  issues/shelved/20260824-test-support-bypass-surface-inventory.md,
  issues/shelved/20260824-test-support-tiering.md

## Why this was run

LLP 0303 revision **(o)** — *an enumeration under default features is not an enumeration* — was
written after two independent executable reviews of the same authorization interlock both enumerated
its writers thoroughly, both read default features, and both missed
`install_graph_corpus_streams_for_test`: public under additive `test-support`, writing the
caller-selected incarnation and epoch with no interlock, executed twice from an external dependent
crate with the epoch advancing 0→1 each time.

That was found one lane at a time, after the fact. This sweep asks the systematic question once:
**is that hazard class contained within the existing inventory, or does it cut across it?**

The reason it is not academic is Cargo's feature model. Features are **additive and unified across
the graph** — one dependent enabling `test-support` for a single integration test, benchmark, or
transitive crate enables it for every compilation of that crate in that graph. A `test-support`-gated
writer is therefore reachable by anything in a graph that contains a test.

## The answer: largely contained

**100 callable writers** are reachable under additive features and can reach a durable authorization
effect.

| Population | Existing rows | Unrowed | Total |
|---|---:|---:|---:|
| Callable writers / capability seams | **98** | **2** | 100 |
| Module and re-export reachability edges | 3 | 0 | 3 |
| **Full source-reachability population** | **101** | **2** | **103** |

The 172-item class-C inventory contains 84 of the 100; the remainder sit correctly in class B as
invariant-preserving or production-proof-preserving writers. Against the complete 508-item
test-support inventory, **98 of 100 are already rowed.**

This is a genuinely reassuring result and the first sweep in this programme to mostly confirm an
existing count rather than correct it.

## The two uncovered declarations

**`seed_grant_revocation_watch_for_test`** — related to the existing
`seed_renewable_watch_for_management_test` row, but a **distinct public direct writer** with
different caller-selected grant bindings and watch state. Warrants a new **class-C** row. Treating it
as an already-counted variant would contradict the inventory's one-public-item-per-row method.

**`configure_graph_measurement_scheduler`** — a variant of the existing
`configure_graph_corpus_scheduler` row but *not* equivalent in hazard: the corpus helper lets a
caller select and directly install authorization/data streams (class-C shape), while the measurement
helper reads existing streams and reserves the next boot issuer transactionally (class-B,
invariant-preserving). It still warrants a leaf row, because the inventory counts every public
declaration separately and the aggregate `pub mod test_support` row is not a stable substitute for a
declaration-level one.

Both postdate the inventory, which is why they have no leaf row rather than having been missed.

## Consequence

One clearly actionable addition (the class-C writer) and one class-B leaf row. The actionable total
moves from **123 to 124**; the class-B row is inventory hygiene rather than new exploitable surface.

More usefully: the class does **not** cut across the inventory in the way the single-lane finding
suggested it might. Lanes should still enumerate across feature sets — that requirement stands and
has already caught real defects in two separate reviews — but the inventory itself does not have a
systematic hole in this dimension.

## Provenance

Read-only against `4f0f3eb5838515479d587b15732e80b5df3e6d68`, ref rechecked unchanged at the end.
Candidates were enumerated once per feature set and the candidate sets diffed, which is what isolates
items a default-features pass cannot see.
