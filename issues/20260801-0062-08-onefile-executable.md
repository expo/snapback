# 0062-08: the app-bound one-file Ibex executable

**Status:** OPEN — the macOS arm64 implementation checkpoint landed on
2026-08-04; qualified Linux and the remaining §7 lifecycle/acceptance matrix
are still required. **Authority:** LLP 0062 §6.2 whole (the 2026-08-01 author
direction: embeds Ibex/Hermes + the generic trusted engine + the fixed
app binding; fetches the dynamic envelope; ordinary deploys never
rebuild it; one executable per app × platform; the one-file claim is
literal — no Node, npm tree, framework, sidecar).

Packaging + release provenance + the embedded-parent code-mode
boundary per §6.2; offline cached-envelope surfaces; unsupported
platforms refuse rather than approximate.

Done when: `./example introspect|call|run` works from a single
downloaded file against a live target, with §7's host-portable suite green.

## Implementation checkpoint (2026-08-04)

The implementation is on both repositories' `main` branches:

- Ibex landing `f8c893b0b504c249dbf507ab8460cedec3ce664b` publishes the
  authenticated app-bound Stub V4 / Catalog V2 producer, restricted Hermes
  worker, typed native broker, strict app-bound schemas, and reconciled CapSec
  evidence.
- Snapback landing `a017367547d12fd0c21b2c5c202510da3e820bdb`
  (implementation commit `37ed952672d43abdfede88a9d51a76e04a11da5b`)
  adds the literal app-bound builder, embedded trusted coordinator,
  no-eval inert argument-schema interpreter, and restricted Ibex code-mode
  path. The package publication list and canonical test inventory were
  corrected in `16d8a2e58ef009873f88b3f57175dc41b1b2f275`.

The qualified macOS arm64 release used catalog
`sha256-zn3dhXFPyUEfahufQ8cm1wHlgYnDaQrcfC-rj7BQZSg`. Its literal executable
passed live anonymous introspection; session-authenticated query and mutation;
file and stdin TypeScript execution with `process` and `fetch` absent from the
worker; cached offline introspection after copy to a source/catalog-free
directory; system-library-only Mach-O dependency inspection; live envelope
rotation without rebuilding; and authenticated `--ibex-info` inspection.

Two builds from identical inputs were byte-for-byte identical at SHA-256
`9914b6a1408bc6e1098627a11c6662169f903b5c6e12d144c1553e9f8150a50c`.
Changing only publisher lineage changed both the embedded binding digest and
the executable digest, so the basic rebuild-only-on-binding-change claim is
proven for the qualified tuple.

This checkpoint does not close the issue or accept LLP 0062. Remaining work:

- Produce and exercise the Linux x86_64 release on a builder that can qualify
  the declared GLIBC 2.35 floor. The available GLIBC 2.39 hosts correctly
  refused promotion instead of emitting an unqualified artifact.
- Implement and prove signal-first grace before forced interruption, including
  broker-call refusal during grace and cleanup observation.
- Complete exact worker-to-parent frame-body admission. Ibex already enforces
  canonical framing, protocol, `runId`, monotonic sequence, and the closed
  frame-type set in that direction, and exact parent-to-worker bodies; the
  emitted body schemas still need equally closed validation.
- Add the value-free per-call and run-summary audit lane, including planted
  sensitive-value and large-intermediate-value leakage proofs.
- Complete provisional-settlement and teardown/race semantics: strict result
  admission, late-frame handling, timer/iterator cleanup, and pinned terminal
  precedence.
- Run the remaining §7 host-portable language, disclosure, resource-ceiling,
  lifecycle, and race matrix across every claimed release tuple.

## Blocker resolution (2026-08-03)

Ibex LLPs 0028 and 0029 plus new LLP 0048 landed with dual-family review in
Ibex commit `36442ab9fa399b315ca562da1bdb72190a4aa4f6`. The closed 0062-07
ticket records the document identifiers, review result, and exact handoff.
This issue may now begin implementation; none of its one-file product,
two-tuple evidence, or host-portable acceptance conditions is pre-satisfied by
the documentation landing.

## Historical blocker check (2026-08-01)

Still blocked. Ibex standalone-executable compilation work is active, but the
ibex corpus does not yet admit an external TS/JS file as a separately
attributed restricted worker principal: LLP 0029 still excludes file-execution
ingress and the reviewed extension requested by 0062-07 has not landed. Do not
start packaging this executable until 0062-07 records all three ibex document
changes and their landing commits.
