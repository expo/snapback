# Publish 0.1.16 under the rapid-publication posture

**Status:** Closed — 0.1.16 published to npm `latest` on 2026-08-09; see
the execution record at the end of this file. The skill-web sanity re-run
named below did **not** run and is carried forward in
[`20260809-g4-rerun-lane-plan.md`](../20260809-g4-rerun-lane-plan.md).
**Impact:** 4 · **Urgency:** 4 · **Ease:** 3
**Systems:** Packaging, Publishing, Templates
**Date:** 2026-08-08
**Related:** LLP 0041 (rapid-publication amendment, 2026-08-08), LLP
0198 P1, diary 0072, `benchmarks/records/2026-08-08-messaging-0115-n3.md`

First application of the author's 2026-08-08 rapid-publication ruling
(LLP 0041 amendment): main carries meaningful published-surface fixes
that 0.1.15 consumers cannot reach — the expo-chat template web-deps
fix (hit all six web lanes in the run-6 N≥3 series; both web lanes'
longest loop three runs running), the six P1 guide anchors, and the
docs-site generator. Run the qualified fast-path publication
(0.1.14-ceremony recipe; carrier-refresh order and fence-sweep traps in
the memory/ticket record) and publish the closure as 0.1.16. Then
re-run one skill-web lane against 0.1.16 to confirm the web-deps loop
is gone (cheap N=1 sanity check, not a ratchet claim).

## Claim pointer (2026-08-09)

This publication is now lane 2 of the LLP 0176 G4 restart claimed in
[`20260809-g4-rerun-lane-plan.md`](../20260809-g4-rerun-lane-plan.md). The
0.1.16 cut is no longer only a rapid-publication errand: it is the vector the
G4 external rerun consumes, so the promotion lane additionally owns updating
`guide/published-closure.json`, regenerating the guide manifest, sweeping the
eleven `<!-- since: 0.1.16 unreleased -->` fences, and retaining a
`fastpath-ledger-0.1.16-<revision>.json` under `~/snapback-release-ledgers/`
(no such ledger was retained for 0.1.14 — do not repeat that gap).

Any session that wants to run this publication should record its branch in the
lane-plan ticket **before** starting; that ticket also carries the lapse rule
if this claim goes stale.

## Execution record — 2026-08-09

**Published.** All eleven `@expo/snapback-*` closure members plus
`create-snapback-app` are live on npm `latest` at `0.1.16`, published
fast-path from clean `main` revision
`ee21fa4a82c5486e1e4abf48e67a1745e7316e83` on branch
`release/fastpath-0.1.16`.

### Retained ledger

`~/snapback-release-ledgers/fastpath-ledger-0.1.16-ee21fa4a82.json`,
SHA-256 `b448829da9654e4deceda58076bcfae01eb240eea053cdd2e30e1e296bac5182`.

It was copied out of `dist-publish/` **before the first `npm publish`**,
which is the specific 0.1.14 bookkeeping gap the lane plan told this lane
not to repeat. The retained file is the pre-publication `dry-run` ledger,
matching the shape of every retained fast-path ledger from 0.1.8 onward.

### Byte verification

Every one of the eleven published tarballs was re-downloaded from
`registry.npmjs.org` after publication and hashed: **11 byte-identical to
the ledger, 0 mismatched or missing.** `latest` resolves to `0.1.16` on all
eleven names. The immutable `bakeoff-0-1-7-fdd49db8abf1` and
`bakeoff-0-1-14-fc88615895cb` tags are untouched.

### Runtime provenance

Both runtimes carry the clean `public-package` / `release` build identity at
exactly `ee21fa4a8`. darwin-arm64 was built locally; linux-x64 was built and
attested on `expo-build-1000` via `scripts/build-linux-runtime-release` and
transported through the `snapback.runtime-artifact-attestation.v1` seam. All
four transported artifact digests were re-verified on the assembling host
and matched the builder's output exactly.

### Two published-bytes defects found and repaired before publishing

Qualification found two sets of bytes that ship inside published packages and
had drifted from their sources on `main`. Both were repaired and landed as
`ee21fa4a8` — which is why the candidate is one commit ahead of the `main`
tip that opened the lane:

1. `packages/snapback-cli` publishes `fixtures/comparator/app/snapback` and
   `fixtures/push-seam/app/snapback` through its `files` allowlist. Their
   committed generated trees were last regenerated at `4b401a9e8`; the
   codegen landings `801e779a0` and `02602ed56` followed without
   regenerating them, so the fixtures no longer matched the codegen shipping
   beside them in the same closure. Regenerated with the committed toolchain
   and confirmed idempotent over a second pass. (`packages/snapback-react`'s
   conversation fixture was equally stale and was regenerated too, though it
   is not in that package's `files`.)
2. `packages/snapback-cli/skills/snapback-authoring/SKILL.md` — the packaged
   copy of the canonical authoring skill, the primary agent-facing document
   in the published CLI — had lost the generated-API-reference lookup bullet
   and the crud-dashboard / media-feed template routing. The CLI's own
   `package.test.mjs` asserts byte-equality with the canonical file and was
   failing. Copied the canonical file over it.

With both repairs the full `snapback-cli` suite (21 files) and
`bun run --cwd packages/snapback-codegen test` pass at the candidate.

### Qualification, and the reds this cut publishes over

Per LLP 0189 D-6 this promotion names its reds rather than claiming a green
complete battery. Every scheduled complete `local-proof` battery for the two
days before this cut failed, degrading monotonically from 9 to 25 root
failures; the newest was run `31330321581`.

Claim-relevant gates re-run locally at the candidate, all green:

| Gate | Result |
| --- | --- |
| `guide` | PASS (115 pages, 70 warnings, 0 errors) |
| `client-bundle-metrology` | PASS (56 profiles, no frozen-ceiling regressions) |
| `snapback-codegen-package` | PASS |
| `snapback-cli` suite | PASS (21 files) |
| `package-test-inventory` | PASS (241 declared test files) |
| `agent-safe-publication` | PASS |

Two of those are red in CI for reasons that do not reproduce locally at the
candidate: `client-bundle-metrology` fails in CI on a `git` lookup of a
baseline SHA the shallow CI clone cannot resolve, and
`snapback-codegen-package` fails in CI only because its demo prerequisite is
unmaterialized downstream of the `generated-artifacts` red below.

Red and named, none of them published bytes:

- **`generated-artifacts` / `required-surface-builds`** — 91 committed demo
  generated artifacts are stale on `main`
  (`issues/20260809-main-drift-generated-artifacts.md`). 29 of the 33
  registered backends regenerate clean; the remaining four
  (`latency-kanban`, `triage-graph`, `fleet-observatory-move1`,
  `contention-calendar`) carry signed `trusted-composition-activation.json`
  files that need a signed re-mint
  (`issues/20260809-signed-composition-activations-need-remint-after-s0-toolchain-rotation.md`),
  which an unrelated release lane must not fake. Demo-only; no published
  package contains these trees.
- **`package-export-types`** — red on every complete battery for at least
  two days, with two independent declaration-only causes: the pre-existing
  `NodeJS`-namespace defect in `packages/snapback-cli/expo-dev.d.mts`
  (`issues/20260806-export-types-nodejs-namespace-expo-dev-dmts.md`, open
  since before 0.1.15 shipped) and a new one this lane diagnosed and filed,
  `issues/20260809-export-types-rejects-sanctioned-type-only-subpath.md` —
  the checker rejects `@expo/snapback-codegen/ctx`, a type-only subpath that
  LLP 0194 acceptance 1 explicitly sanctions. That second one is a gate gap,
  not a published-bytes defect: `ctx.d.mts` is in the package `files`, so
  `import type` resolves for installed consumers and there is no runtime
  symbol to import.
- **`rustfmt`, `module-ownership`, `cargo-clippy`, `rust-tests`** — Rust-side
  reds on `main` with their own open tickets. The P0 test-crate compile break
  (`issues/20260809-main-does-not-compile-versions-facade-privacy.md`) was
  fixed by a sibling session in `d230cbe2a` before this cut; `cargo build
  --release --bin snapback` was never affected.

### Known defects that ship unchanged in 0.1.16

- The published closure still cannot serve the admin console —
  `issues/20260809-published-runtime-omits-admin-console-bundle.md`. 0.1.16
  does not repair it; the reproduction there applies verbatim to 0.1.16.
- The published Linux runtime still links `libicuuc.so.78` and will not
  launch on hosts with an older ICU soname —
  `issues/20260808-linux-runtime-icu-dynamic-link-portability.md`. This cut
  used the same `expo-build-1000` (Ubuntu 24.04) recipe as 0.1.15 and does
  not change that exposure.

Neither was fast-pathed casually: both are expensive and independent of this
release's content, which is the distinction the
[first-npm-promotion log](./20260803-first-npm-latest-promotion.md)
draws — fast-path what is expensive and independent, never what is cheap and
central. The two cheap-and-central defects this lane did find (the packaged
fixtures and the packaged skill) were repaired and landed rather than
published over.

### Promotion-lane duties completed

- `guide/published-closure.json`: `newestPublished` `0.1.15` → `0.1.16`,
  `publishedAt` `2026-08-09`. `newestQualified` stays `0.1.7` — this was a
  fast-path cut, not a qualified ceremony.
- All eleven `<!-- since: 0.1.16 unreleased -->` fences swept to released,
  each first confirmed present at the release revision so nothing landed
  after the cut was marked as shipped. Zero unreleased fences remain.
- Guide manifest regenerated; `node scripts/check-guide.mjs` green.

### Not done

The cheap N=1 skill-web sanity re-run against 0.1.16 — the check that the
expo-chat template web-deps loop is gone — was not run by this lane. It is
carried forward in the lane-plan ticket. Publication alone does not prove
the loop is fixed.
