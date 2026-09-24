# Snapback 5

Snapback 5 tests whether removing authored residency reduces the learning cost of Quarry. The program declares its model, rules, reads and writes; the engine derives residency from those queries while keeping the partition stream, device-computed pages, typed completeness and Snapback 4's predictor. [LLP 4000](../llp/4000-snapback5.rfc.md) defines the hypothesis and the comparison against Snapback 4.

It builds over the existing `snapback4-*` crates. Shared additions land in Snapback 4 first; Snapback 5's treatment belongs in feature-gated modules, with a control build that excludes it. Snapback 4 remains the sibling control, and the web device inherits its measured wasm budget.

Nothing in the Snapback 5 runtime is implemented yet. This directory contains only the fence, the [concept-count tool and its guide](./tools/README.md), and the [commission measurement](./reports/20260924-concept-count.md). Read [AGENTS.md](./AGENTS.md) before working here and append implementation decisions to [JOURNAL.md](./JOURNAL.md).
