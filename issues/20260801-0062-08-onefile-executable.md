# 0062-08: the app-bound one-file Ibex executable

**Status:** OPEN — the macOS arm64 implementation and complete host-portable
acceptance matrix landed on 2026-08-04; only the qualified Linux x86_64 tuple
is still required. **Authority:** LLP 0062 §6.2 whole (the 2026-08-01 author
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

## Completion pass (2026-08-04)

Ibex commit `4c34c831aa087d6783b0d68f281cdb374ed7fc89` and the
Snapback implementation commits `656cf3c1c91bc49937865e4fa63259aa542ae6f6`
and `25cde3801ebf40d77342bb0bf53a3f9942778789` close the macOS-side
implementation remainder from the earlier checkpoint:

- the worker-to-parent ABI now admits exact closed bodies and typed identifiers;
- signal and timeout teardown fire `signal` first, refuse new calls, live opens,
  and timers during grace, retain already-established cleanup work, then force
  interruption with pinned terminal precedence;
- provisional settlement validates strict JSON, exact chunks, digest, and size
  before stdout, and reports result ceilings through the resource exit class;
- per-call and terminal summary audit frames carry only allowlisted metadata,
  keyed commitments, coarse size classes, and typed elision records; and
- timers, iterators, establishment timers, late frames, and terminal races have
  deterministic cleanup and regression coverage.

The final qualified macOS arm64 catalog is
`sha256-7Pt7_U-TZ7QHWQHUkh9ytz7SISktYhL4rnNH_PPxz_Q`. Two builds of the
literal executable from identical inputs were byte-for-byte identical at
SHA-256 `7eb31cf1f3b4aaa24aa10ea45268f28c7a33e51a6d92437a8cd6a78b60e3a8f5`.
The exact final artifact passed live authenticated broker calls; file and stdin
top-level-await TypeScript; categorical import, enum, namespace, and parameter-
property refusal; absent-default output; strict-result and call/output ceilings;
timeout and SIGTERM cleanup grace; orphan-timer teardown; planted 500-row value
non-disclosure; authenticated inspection; system-library-only Mach-O dependency
inspection; and cached offline introspection after relocation.

This checkpoint does not close the issue or accept LLP 0062. The sole remaining
gate is to produce and exercise the Linux x86_64 release on a builder that can
qualify the declared GLIBC 2.35 floor. The available fleet is Ubuntu 24.04 or
newer with GLIBC 2.39, lacks a usable container/chroot path, and correctly
refuses promotion instead of emitting an unqualified artifact.

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
