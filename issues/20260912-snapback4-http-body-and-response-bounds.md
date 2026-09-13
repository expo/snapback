# Snapback 4: Bound HTTP admission and release the engine before network response work

Status: Open
Priority: P1
Observed: 2026-09-12
Review finding: R18
Evidence: Code traced; no large-body or slow-reader load experiment
Baseline: `d6c803878a5432cce5f045777786a049972d3d70` / Snapback 4 0.0.16
Related: [LLP 3000.002](../llp/3000.002-end-to-end-resource-bounds.research.md), [comprehensive review](../llp/reviews/3000-architecture-code-review-20260912.md)

## Problem and reproduction

The host reads a POST body into an unbounded `String` before decoding and
applying Quarry argument limits, and discards the read result. Several routes,
including `/sync`, build/serialize/respond while their engine lock is still
held. Input and output buffering can therefore dominate request cost outside
the interpreter's meter, and a slow response can hold the shared database
owner after its computation is done.

Enforce a documented request-size bound during receive, handle incomplete/read
failures explicitly, and arrange bounded response preparation so network
progress does not own the engine mutex. Do not solve a potentially enormous
snapshot merely by cloning it to another unbounded buffer; coordinate with the
acquisition design in LLP 3000.002.

Acceptance examples: an oversized and an interrupted body fail before large
allocation or operation execution; a response held open by a test transport
does not block an unrelated small query; responses at the admitted limit
remain valid. This is a performance/resource-lifecycle finding, not a security
review or a request for an authentication policy change.

## Implementation locations

- [crates/snapback4/src/serve.rs](../snapback4/crates/snapback4/src/serve.rs)
