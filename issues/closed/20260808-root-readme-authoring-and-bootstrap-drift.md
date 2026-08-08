# docs: root README is stale and recommends the wrong bootstrap path

**Status:** Open
**Impact:** 4
**Urgency:** 4
**Ease:** 3
**Confidence:** 5
**Systems:** Repository entry point, onboarding, runtime bootstrap, guide
**Date:** 2026-08-08
**Related:** LLP 0000, LLP 0010, LLP 0061, LLP 0187, LLP 0195

## Summary

The root `README.md` still presents Snapback as “early design with a first
local-dev core slice,” calls implemented areas the “next design work,” and
describes only a small fraction of the current authoring surface. A new agent
or contributor arriving through the repository root gets a materially older
product model than the guide, capability index, current packages, and demos.

More seriously, its first setup command is:

```sh
git submodule update --init --recursive
```

That conflicts with the repository's current bootstrap policy. `vendor/ibex`
is intentionally not initialized by the normal skills/checkout path because it
is a large runtime checkout most work does not need. Before Rust work,
`scripts/bootstrap-ibex-runtime` is the supported entry point; it initializes
the submodule on demand, prefers prepared artifacts, qualifies the launched
runtime, and emits stable diagnostics. The README's recursive command can do
expensive unnecessary work and bypasses the intended explanation and recovery
path.

The README's demo section also highlights only the earliest demos rather than
helping an author discover the current metadata-declared example portfolio.

## Ask

Rewrite the repository entry point around the current product and audience:
route application authors to `guide/index.md` and the canonical starter,
separate contributor/runtime-build setup from app authoring, replace the
recursive submodule instruction with the supported bootstrap sequence, and
either provide or link to a maintained demo catalog.

Coordinate the product-positioning language with LLP 0000 and the planned
public documentation surface in LLP 0195 rather than maintaining a second,
unowned product description.

## Acceptance

- No normal setup path recommends recursive initialization of every submodule.
- App authors, repository contributors, and runtime developers each get a
  clearly separated first action.
- Status, implemented capabilities, target support, and “next work” agree with
  the current root LLP and capability index.
- The README links prominently to the guide, authoring loop, capability index,
  and maintained example catalog.
- A check or explicit ownership rule prevents the entry point from becoming an
  unreviewed shadow capability index again.


## Resolution

Fixed 2026-08-08 (docs-review execution, 1284ae8a5). The status blockquote
now reflects the shipped local-target product and eleven-package 0.1.15
closure; a "Build an app on Snapback" section routes app authors before
contributor content; "Next design work" became a GAP-row-deferring
"What's next" with the explicit rule that the capability index wins where
they disagree; and the recursive `git submodule update --init --recursive`
advice was replaced with `scripts/bootstrap-ibex-runtime` per the
on-demand Ibex policy. The acceptance bullet asking for a mechanical
README-ownership check was not built — the stated ownership rule is the
interim substitute, and the freshness-program ticket
(20260808-guide-freshness-warning-saturation.md) owns the mechanical class.
