---
title: Diagnostics and local doctoring
id: operating.diagnostics
order: 3
audience: agent-first
capabilities: [operating.diagnostics]
authorities: [llp/0010-agent-dx-and-acceptance.spec.md, src/diagnostic.rs, packages/snapback-codegen/index.mjs, packages/snapback-cli/runtime-recovery.mjs, demos/_kit/harness.mjs, scripts/ibex-doctor, scripts/runtime-link-smoke.mjs, scripts/bootstrap-ibex-runtime]
examples: [demos/todo/tests/acceptance/headless.mjs, packages/snapback-codegen/authoring-validation.test.mjs]
status: current
targets: [all]
maturity: shipped
reviewed: 2026-08-03
reviewed-commit: 6e5d69d1037c6042fb9338221dfb489e00f5f78a
---

# Diagnostics and local doctoring

Snapback failures carry stable machine identity. Assert and branch on the
`SNAPBACK_*` code; display the message to a human; inspect `details` only
for code-specific facts.

The same contract applies before runtime. Compiler, codegen, dev-server, and
surface-construction failures must carry a stable code, point at the authored
offender (file plus span when known), preserve the first actionable cause, and
report once per source/artifact generation—not once per reactive evaluation.
An authoring failure that can be known during codegen or boot must not be
deferred into an error-shaped data cell.

## Consume the diagnostic shape

The full diagnostic is:

- `code`: stable machine classification;
- `severity`: lowercase `info | warning | error | fatal`;
- `subsystem`: stable owning subsystem;
- `message`: human explanation, not an API;
- `details`: structured code-specific context.

Public unauthenticated projections intentionally drop `message` and
`details`, because they can contain source paths, handler text, arguments, or
operator context. Error envelopes expose the diagnostic at
`error.diagnostic`; some terminal mutation paths also attach a receipt.

## Assert on codes, not prose

The shared acceptance helper demonstrates the rule:

```js source=demos/_kit/harness.mjs
export async function assertThrows(fn, code, message) {
  try {
    await fn();
  } catch (error) {
    const got = error.diagnostic?.code ?? error.message;
    if (code && got !== code) throw new Error(`${message ?? 'wrong error'}: expected ${code}, got ${got}`);
    return error;
  }
  throw new Error(`${message ?? 'expected an error'}: nothing thrown (wanted ${code})`);
}
```

Messages may improve without a compatibility event. A code change is a
contract change and must update its schemas, callers, tests, and docs together.

## Repair ambient time and identifier diagnostics

During handler generation, `BUNDLE_UNSUPPORTED_TIME`,
`BUNDLE_UNSUPPORTED_RANDOM`, and `BUNDLE_UNSUPPORTED_TIMER` include a
suggested repair and route to
[trusted runtime time and identifiers](../backend/trusted-runtime-values.md).
Use `ctx.runtime.now()` for a trusted integer timestamp and
`ctx.runtime.id()` for a fresh identifier. Neither method is a general
replacement for randomness, delay, or scheduling.

## Diagnose the vendored Ibex runtime first

Run the read-only doctor before repairing runtime files by hand:

```sh
scripts/ibex-doctor
```

It checks the submodule state, prepared Hermes artifacts/framework, CLI,
required tools, and then the part file-presence checks cannot prove: an exact
link of this checkout's final `snapback` Cargo target in an automatically
cleaned temporary target directory, followed by launch and restricted
handler-VM qualification of that newly linked binary with `DYLD_*` and
`LD_LIBRARY_PATH` scrubbed. It also verifies, read-only, that the served
binary's persisted readiness receipt (`<binary>.runtime-readiness.json`) is
digest-coherent with that binary and the current Hermes artifacts. An older
runnable binary does not make the current checkout green. On a clean checkout, bootstrap before
Cargo build/test/run:

```sh
scripts/bootstrap-ibex-runtime
```

Bootstrap distinguishes a structurally complete Hermes set from one compatible
with the vendored Ibex revision. Before using installed artifacts or copying a
prepared checkout, it reconstructs the vendored authority-bound source-cache
keys and requires the artifact receipt to match. An incompatible `../ibex` (or
`SNAPBACK_IBEX_CHECKOUT`) is skipped for the vendored download/build fallback;
Ibex `build.rs` still performs the authoritative full-identity validation. Do
not copy a receipt or edit its identity by hand.

The stable bootstrap failure vocabulary is:
`SNAPBACK_IBEX_SOURCE_MISSING`,
`SNAPBACK_IBEX_SUBMODULE_BROKEN`,
`SNAPBACK_IBEX_SUBMODULE_INIT_FAILED`,
`SNAPBACK_IBEX_SUBMODULE_WEDGED`,
`SNAPBACK_CAPABILITY_IBEX_HERMES_MISSING`,
`SNAPBACK_IBEX_HERMES_DOWNLOAD_FAILED`,
`SNAPBACK_IBEX_CARGO_BUILD_FAILED`,
`SNAPBACK_IBEX_RUNTIME_LINK_FAILED`,
`SNAPBACK_IBEX_RUNTIME_LINK_TIMEOUT`,
`SNAPBACK_IBEX_RUNTIME_LINK_INTERRUPTED`,
`SNAPBACK_IBEX_RUNTIME_LINK_PROBE_FAILED`,
`SNAPBACK_IBEX_RUNTIME_LOAD_FAILED`,
`SNAPBACK_IBEX_RUNTIME_VM_CREATE_FAILED`,
`SNAPBACK_IBEX_RUNTIME_RECEIPT_INVALID`, and
`SNAPBACK_IBEX_HOST_UNSUPPORTED`.

The doctor additionally distinguishes uninitialized/conflicting/drifted
submodules, a missing vendored CLI, missing Node/Bun/Cargo, and dynamic-loader
configuration. Follow the emitted next checks; do not collapse those states
into “build failed.”

Every runtime entry point exposes the same
`snapback.runtime-recovery.v1` record: repository doctor (`runtimeRecovery` in
`--json`), bootstrap (one `runtime recovery record:` line), packaged
`snapback doctor` and `snapback dev` (`runtimeRecovery`), and demo
`startServer` (`handle.runtimeRecovery`, or `error.runtimeRecovery` on launch
failure). It names the selected binary and resolver rung, expected checkout
commit/dirty state, actual build stamp, whether the current checkout proved
buildable/runnable, why automatic reuse was allowed or refused, exact producer
inputs, and safe repair or explicit override.

The read-only native `snapback build-identity` command prints
`snapback.binary-identity.v1` without binding a port. Doctor and helpers use it
to obtain the executable's independently embedded commit, dirty state, crate
version, and build profile; older binaries that predate the command may still
be classified runnable via `--help`, but their actual stamp remains honestly
unknown.

A dirty worktree triggers the same posture at server spawn: the kit skips
a prebuilt `target/debug/snapback` it cannot verify against a committed
identity ("this checkout is dirty or has no committed identity") and
falls back to the `cargo run` rung, which costs a rebuild-check on every
boot (~30 s). That is provenance working as designed, not a fault. If
you accept the local binary knowingly — a test loop on an intentionally
dirty tree — the sanctioned escape is the same explicit override the
diagnostic quotes: `SNAPBACK_SERVER_BINARY=<path>`. The override's
unpinned identity stays visible in the spawn record, so acceptance is
always a recorded choice, never an ambient default.

When `SNAPBACK_IBEX_RUNTIME_LINK_FAILED` names compatibility symbols such as
`ex_hermes_create_no_eval`, do not delete Cargo output or rebuild Hermes
blindly. Run the recorded bootstrap command. If the record also names a
runnable stale binary, use its quoted `SNAPBACK_SERVER_BINARY=...` override
only as an explicit temporary escape; its independent stamp and resolver rung
remain visible, so the override cannot masquerade as a current-checkout build.

For an installed application runtime, run the packaged vertical-slice doctor:

```sh
snapback doctor --json
```

It emits `snapback.cli-doctor.v2` and succeeds only after
`SNAPBACK_RUNTIME_LAUNCH_OK`, `SNAPBACK_DOCTOR_BUNDLE_LOAD_OK`,
`SNAPBACK_DOCTOR_QUERY_OK`, `SNAPBACK_DOCTOR_MUTATION_OK`,
`SNAPBACK_DOCTOR_LIVE_OK`, and `SNAPBACK_DOCTOR_SHUTDOWN_OK`. The probe uses a
fresh temporary database and an owned ready descriptor. A path mismatch,
failed load, malformed query result, non-committing mutation, missing live row,
shutdown failure, or cleanup failure remains the first structured error and
cannot be converted into a green file-presence check.

## Report the runtime's own readiness identity

`doctor` proves the whole loop. When you want just the runtime's identity —
"which binary is this, and does its handler VM come up in the restricted
no-eval posture?" — ask the binary directly:

```sh
snapback runtime-qualify
```

It prints a `snapback.runtime-qualify.v1` result carrying the VM profile
(`restricted-no-eval-handler-vm`), `ok`, and the binary's build stamp. It
creates the same VM every JS handler uses, so a mismatched Hermes framework
or a runtime/glue contract skew fails here rather than at the first handler
invocation. This is the identity to quote in a bug report or a packaged
consumer's readiness note.

Persist the live verdict and its binary/Hermes digests in the app's managed
state, then re-verify it later without writing or launching the runtime:

```sh
snapback runtime-qualify --persist
snapback runtime-qualify --verify
```

The first command still performs the restricted-VM qualification and writes
`.snapback/runtime-readiness.json`; the second recomputes the installed
runtime bytes and refuses binary or framework drift. Use `--receipt <path>`
on both commands only when another app-owned custody path is required. The
receipt uses the same `snapback.runtime-readiness.v1` schema as the repo-side
bootstrap proof ([LLP 0010](repo:llp/0010-agent-dx-and-acceptance.spec.md))
but never writes into read-only `node_modules`. Doctor's live six-boundary
qualification stays authoritative — this retained identity complements it,
never replaces it.

## Preserve the first useful failure

Acceptance harnesses must fail during setup instead of reporting a vacuous
0/0 pass, bound every wait, include the diagnostic body when an assertion
fails, and clean up their server/handles. When one failure cascades, fix and
rerun from the earliest stable code rather than patching later symptoms.

## Anti-patterns

- **Do not parse `message` text.** Use `diagnostic.code` and typed details.
- **Do not expose full diagnostics on public endpoints.** Use the public
  classification projection.
- **Do not rebuild Hermes first.** Doctor, then let bootstrap select compatible
  prepared artifacts or the vendored fallback.
- **Do not accept a zero-check or timeout-only test result.** Require the
intended diagnostic and non-vacuous witnesses.

Two early data-seam examples are intentionally blocking:

- `FUNCTION_JS_QUERY_STATIC_RESULT_NOT_ROWS` rejects a JavaScript query whose
  handler visibly returns an object literal; return `[row]` or `[]`. Dynamic
  result shapes still meet the runtime rows-array guard.
- `SNAPBACK_CONTRACT_QUERY_UNCONFIGURED` rejects a mounted component's
  `requiredQueries` before the multi-live surface opens any subscription.
