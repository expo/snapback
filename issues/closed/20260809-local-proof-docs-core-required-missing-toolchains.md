# Docs-only local proof selected gates whose toolchains were absent

**Status:** Closed — fixed forward 2026-08-09
**Opened:** 2026-08-09
**Systems:** CI, Local proof selector, Developer experience
**Related:** LLP 0175, GitHub Actions run
[`31335475447`](https://github.com/expo/snapback/actions/runs/31335475447)

## Failure

The affected selector correctly classified an LLP-only push as `FAST_ONLY`,
but its universal gate list still included `rustfmt` and
`package-readme-funnel`. The workflow intentionally skipped both native setup
and root JavaScript dependency installation for that lane. Verification then
failed before inspecting the changed documentation: `rustfmt` could not spawn
`cargo`, and the README funnel could not import `ajv`.

The same run successfully planned and reopened its runner-temporary selection
receipt, so this was not a recurrence of the earlier receipt-custody defect.

## Cause

The two gates were classified by cost alone rather than by input ownership.
Both are cheap after setup, but neither is self-contained on the docs runner:
one shells out to the pinned Rust toolchain and the other resolves a root
workspace dependency. Making them universal silently invalidated LLP 0175's
dependency-free docs/static boundary.

## Resolution

The universal core now contains only its seven repository-and-Node gates.
`rustfmt` is selected additively for `.rs` paths, preserving each path's normal
owner suite, and public package READMEs have a dedicated fast funnel owner.
Client, React, codegen, Contract, and distribution publication inputs retain
the funnel through their affected package groups.

Selection receipts now carry a narrow `rustToolchain` requirement alongside
the existing JavaScript-dependency requirement. CI installs the pinned Rust
toolchain whenever that marker is true but still limits submodules, Hermes,
native caches, bootstrap, and disk admission to native selections.

Regression fixtures prove that LLP-only changes select neither gate nor either
toolchain, while Rust and public-package README changes select their gate,
retain their primary ownership where applicable, and request exactly the setup
they need.
