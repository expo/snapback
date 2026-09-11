# Snapback 2 reduced Clique loop bar — 0.0.21, Astra medium, N=3

**Status:** preregistered before execution
**Governing:** LLP 1000; LLP 0329.016 §8; `benchmarks/protocol.md`;
`rules/NOT-DOING.md`

## Claim

This series tests only the Snapback 2 loop bar. It does not score the full
Clique capability brief, native clients, media, offline behavior, scale, or a
comparison backend.

The frozen cell is:

- task: the reduced React-web, media-free Clique M1→M3 brief in `brief.md`;
- package: public npm `snapback2@0.0.21`, integrity
  `sha512-Mc2fRjWYmKW4rYhh+ksZ/Q4ZvM5JzyXxZ/IMRmDkXTgYUiJq03yYcYIodxp15mf8sePWjFR9g8u9MEi0K90zcw==`;
- harness: Codex CLI `exec --json`, `gpt-6-astra`, medium effort;
- population: three genuinely fresh sessions, replicates `astra-medium-01`,
  `astra-medium-02`, and `astra-medium-03`;
- execution: strictly sequential, one clean app/store directory per replicate,
  with no conversation, implementation, dependency tree, generated output, or
  store reused between replicates;
- host: the same Silver Apple M5 Max (`Mac17,6`, 18 CPU cores, 128 GiB) for all
  three replicates; exact live OS, toolchain, hardware, load, and package
  registry observations are recorded by the controller at each start;
- builder context: the exact brief plus installed-package README/served guide
  only for Snapback facts; no Snapback source checkout, prior benchmark lane,
  sibling session, steering, or delegation;
- M1 deadline: 1,200 seconds from prompt delivery to the later of the M1 suite
  and browser/live acceptance green; the controller terminates a cell whose
  `evidence/m1-green.json` has not appeared by the deadline;
- whole-cell safety cap: 3,600 seconds from prompt delivery. This is an
  operational cap, not a new gate for M2 or M3.

The controller is `run-cell.mjs`. A launch is consuming: a failed or interrupted
replicate is retained and is never replaced by a warm retry under the same
ordinal.

## Frozen measurements

For this series, a **retrieval call** is one builder tool invocation before the
first product edit whose purpose is acquiring Snapback API facts from the
installed package README or `snapback2 guide` surface. Package installation,
ordinary shell/environment inspection, and reads of the builder's own app do
not count. One invocation remains one call even if it prints multiple sections.
The builder records the calls and the native event stream is audited against
them. The first product edit includes a scaffold-generating command such as
`snapback2 init`, not only a later hand edit.

A **Snapback-attributed correction loop** is one root-cause failure-to-recovery
episode caused by a package defect, package-documentation mismatch, or missing
discoverability for a required ordinary path. Builder mistakes, environment
failures, and ambiguous incidents remain recorded but do not enter that count.
This attribution follows the Draft protocol and is reported with that caveat.

A replicate passes M1–M3 only when its retained evidence shows every brief
acceptance item green, the documented acceptance entrypoint exits zero, and
`snapback2 test` exits zero with its receipt retained. Placeholder assertions,
source-only claims, or an API check substituted where the brief requires a
browser do not pass. The empirical pass^3 gate is met only if all three frozen
replicates pass; with three observations, any failure makes the value less than
0.8. Report every constituent result, median, and range; do not make an N>=8
ordering or variance claim.

## Existing-record audit frozen before execution

- `2026-09-09-clique-snapback2-0.0.20-treatment` contains three cold builders,
  but each uses a different model configuration (N=1 per configuration). Astra
  M1 was green in 498 s, Grok M1 in 3,105 s, and Muse M1 in 8,261 s. The
  publication has no mechanically retained pre-edit retrieval count for any
  lane, and only Astra has a committed machine record. It is calibration, not
  an eligible N=3 loop-bar cell.
- `2026-09-10-clique-ri-0.0.21` contains one Astra-medium and one Grok-xhigh
  full-app builder. They ran in parallel with other work, are N=1 per model
  cell, and publish no reduced-run pre-edit retrieval measurement. Astra's
  first attempt aborted on a missing harness file and the continuation is not a
  fresh replacement for this series. These runs remain useful full-app
  existence evidence but do not fill a replicate here.

The new series therefore starts with zero eligible replicates. Neither this
orchestrating conversation nor any prior warm continuation is counted.
