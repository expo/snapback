# Snapback 4: Sim group-membership check is any-field equality, not the audience binding

Status: Open
Severity: minor
Priority: P2
Area: tests
Observed: 2026-09-13
Evidence: Code-traced
Baseline: `6918cccbc264cf000982b03a5a11a2cf5563f885` / Snapback 4 0.1.15
Review provenance: Snapback4 comprehensive-review synthesis (2026-09-13 child review)

## Problem and reproduction

[replica.rs](../snapback4/crates/snapback4-sim/src/replica.rs):164-169:

```rust
fn matches_group(row: &Json, group: &[Json]) -> bool {
    // The chat fixture's audience prefix is one column; a group value equal
    // to any reference-shaped field of the row is a member of that group.
    let Some(object) = row.as_object() else { return false };
    group.iter().all(|value| object.values().any(|field| field == value))
}
```

Membership holds when each group value equals *any* field of the row —
not the audience-bound columns the real partition uses
(`sync to T[...]` audience + `rule-must-exactly-match-audience` refusal,
schema.rs:160-210,766-772). A row whose audience column says group B but
which happens to carry group A's value in some other field is treated as
a member of A. The sim can therefore pass scenarios that mask real
partition/leave/withdraw bugs: test-fidelity gap, not a runtime bug. No
open ticket covers sim fidelity (searched issues/ for sim/matches_group —
no hits).

## Implementation locations

- [crates/snapback4-sim/src/replica.rs](../snapback4/crates/snapback4-sim/src/replica.rs) (`matches_group`, `Host for Replica`)

## Suggestion

Resolve membership through the same audience binding the server uses
(audience columns of the table's sync line), not any-field equality.
Add a sim fixture where a non-audience field echoes another group's value
and assert the row is not delivered to that group.
