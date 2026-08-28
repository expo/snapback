---
title: Diagnostics and local doctoring
id: operating.diagnostics
order: 3
audience: agent-first
capabilities: [operating.diagnostics, clients.dev-diagnostics]
authorities: [llp/0010-agent-dx-and-acceptance.spec.md, llp/0094-wire-envelope-contract.spec.md, llp/0095-client-lifecycle-and-conformance.spec.md, llp/0146-agentic-authoring-affordances.rfc.md, crates/snapback-types/src/diagnostic.rs, crates/snapback-kernel/src/diagnostic.rs, crates/snapback-kernel/src/remediation.rs, crates/snapback-kernel/src/authoring_suggestion.rs, packages/snapback-client/remediation.mjs, packages/snapback-cli/mcp-control.mjs, packages/snapback-codegen/index.mjs, packages/snapback-cli/runtime-recovery.mjs, demos/_kit/harness.mjs, scripts/ibex-doctor, scripts/runtime-link-smoke.mjs, scripts/bootstrap-ibex-runtime, llp/0219-client-dev-diagnostics-channel.rfc.md, packages/snapback-client/client-diagnostics.mjs, packages/snapback-client/client-diagnostics.d.mts, packages/snapback-client/index.mjs, packages/snapback-react/implementation.mjs]
examples: [demos/todo/tests/acceptance/headless.mjs, packages/snapback-codegen/authoring-validation.test.mjs, crates/snapback/tests/host_ops_v0.rs, packages/snapback-client/client-diagnostics.test.mjs, packages/snapback-react/dev-diagnostics-acceptance.test.mjs]
status: current
targets: [all]
maturity: shipped
authoring-profiles: []
reviewed: 2026-08-10
reviewed-authorities-digest: sha256:1c25648b54546e0cba48be11aa9c86c92fe3548afc6b94f50767aa6b4761deab
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

<!-- since: 0.1.19 -->

## Inspect client-side dev diagnostics

Every `SnapbackClient` owns one bounded, process-local diagnostics channel,
available from `client.diagnosticsChannel()`. Its carrier is
`snapback.client-diagnostic.v2` with these exact fields: stable `code`,
`severity: 'error' | 'warning'`, `subsystem`, human `message`, structured
`details`, `occurrence: { firstAtMs, lastAtMs, count }`, and optional `site`.
The legacy `snapback.client-diagnostic.v1` object stays error-only;
`onDiagnostic` and `inspection().diagnostics` receive v1 projections through
`projectDiagnosticV1`, so warnings are filtered rather than silently widening
the frozen carrier.

Call `snapshot()` for the current frozen projection. `events` is bounded
history (256 entries by default). `activeConditions` is a separate keyed map
(64 entries by default) for conditions that are true now, such as an unchanged
durable queue head past its wedge deadline; history eviction does not clear a
condition. `counters.emitted` counts event emission attempts,
`counters.coalesced` counts repeats merged by code/site inside their cooldown,
and `counters.dropped` counts capacity eviction or post-disposal/condition-cap
drops. `subscribe(listener)` observes later emissions and condition changes;
read `snapshot()` first when you need initial state. A condition clear notifies
with `null` so consumers re-read the snapshot.

The default line reporter subscribes only when development is positively
identified: `__DEV__ === true`, a live bundler HMR host, or explicit
`NODE_ENV === 'development'`. Missing production markers are not proof of
development, and production never enables this reporter by default. Set
`devDiagnosticsReporter: false` to opt out even in development. Reporter
deduplication changes console volume only; every structured occurrence remains
accounted for by the channel.

Redaction is structural, not a best-effort scrub of rendered prose. The channel
admits bounded plain-data shapes and safe error summaries, caps strings,
entries, and depth, rejects functions/promises/exotic objects, and drops
payload-bearing keys such as args, inputs, payloads, presence values,
credentials, tokens, headers, and bodies. Producers contribute only
payload-safe scalar facts such as queue depth/age/sequence, transition counts,
generated-reference names, hashed canonical-input identity, and the
development-only hook site; transport provenance may be one string or a
bounded list of strings. Raw mutation arguments, presence values, credentials,
and application payloads never belong here.

For agent inspection, prefer the structured surface over console scraping:
headless agents read `diagnosticsChannel().snapshot()` or subscribe directly;
React-aware tools use `observeSnapbackDiagnostics(provider, listener)`; UI can
render the same object with `useSnapbackDiagnostics()`. These are projections
of one client-owned channel, not backend telemetry, and their history dies with
the client process. The [React guide](../clients/react.md#inspect-client-dev-diagnostics)
and [offline guide](../sync/offline-and-retention.md#keep-a-queued-react-mutation-pending)
show the shipped churn and queued/wedged producers.

## Use candidates from the served generation

After the existing authorization gate admits a caller, local unknown-operation,
unknown-function, unknown-field, and wrong-argument-shape refusals add
authoring help to the same `details` object:

- `candidateOperations` contains only currently served host operations;
- `candidateFunctions` names served function ids/names, kinds, exported names,
  and argument-contract hashes, filtered to the route's expected function
  kinds;
- `candidateFields` names served schema or argument fields with their expected
  type and required/optional posture;
- `expectedArgumentContract` carries the complete served argument contract for
  an argument refusal; and
- `artifactHash` or `servedShapeHash` identifies the generation that produced
  the suggestion.

Candidates contain served schema metadata only: the rejected spelling,
argument value, row value, and secrets are not echoed. A caller that cannot
pass the existing auth gate receives the existing uniform refusal and learns
no function-existence candidates.

`localMissSummary` is a bounded process-local hint. `sameMissCount` and
`repeated` tell you that this process has seen the same category, generation,
and rejected identifier before; `capacity` is 128 and counts cap at 255. The
runtime retains only a hash of the miss, evicts least-recently-used entries,
does not persist the summary, and does not promote popular mistakes into
aliases. Regenerate or reload your artifacts when the diagnostic's generation
does not match the artifact you used.

<!-- since: 0.1.19 -->

## Apply a remediation safely

A caller that passed the ordinary authorization gate may also receive
`details.remediationSet`. This is the only remediation carrier; outer HTTP,
host-operation, CLI, MCP, and hosted envelopes do not change. Decode it with
`decodeRemediationSet` from `@expo/snapback-client/remediation` instead of
copying its vocabulary.

The set has two independent identities:

- `schemaVersion: "snapback.remediation-set.v1"` governs the carrier;
- `registryVersion: "snapback.remediation-kinds.v1"` governs the global kind
  vocabulary;
- `artifactHash` is the exact served artifact observed at refusal time; and
- `items` contains at most eight contextual offers.

Unknown set or item members are ignored. An unknown kind is skipped. An
unknown schema or registry version makes only the remediation set unusable;
the surrounding diagnostic remains valid and should still be shown.
The shared decoder also validates every known kind's four safety axes and its
action/precondition pairing against the global registry. Never infer
machine-applicability from `requiresApproval: false`, and never consume a
hand-decoded item whose axes disagree with that registry.

A machine-applicable identifier repair looks like this:

```json fragment reason="illustrative subset of a refusal; candidate names and artifact hashes are application-specific"
{
  "schemaVersion": "snapback.remediation-set.v1",
  "registryVersion": "snapback.remediation-kinds.v1",
  "artifactHash": "sha256:0123456789abcdef",
  "items": [{
    "kind": "fixTypo",
    "riskClass": "mechanical",
    "machineApplicable": true,
    "requiresApproval": false,
    "authorityEffect": "none",
    "precondition": {
      "type": "artifact-hash",
      "artifactHash": "sha256:0123456789abcdef"
    },
    "action": {
      "type": "replaceIdentifier",
      "target": "function",
      "replacement": "listTodos"
    }
  }]
}
```

Copy the exact item and hash into a closed apply input. The native CLI keeps
the JSON out of argv:

```sh
snapback remediation apply --ready-file .snapback/ready.json --input repair.json
```

On the local native target, the equivalent control MCP tool is
`snapback_remediation_apply`; direct HTTP uses
`POST /_snapback/api/host-ops` with operation `remediation.apply`. Under
the same local generation lock that selects the replacement, the server
compares both supplied hashes with the currently served artifact and verifies
that the replacement still exists. Success returns the repaired identifier.
It does not invoke the function, create an alias, regenerate code, or write
application state; retry the original operation explicitly with the returned
value.

The hosted arm emits the same carrier in its unchanged Diagnostic, but does
not expose the local `remediation.apply` host operation. A hosted consumer
must refresh its deployed artifacts and retry through the hosted deployment
workflow; it must not treat the contextual item as a hosted write primitive.

If artifacts changed after the refusal, apply returns
`SNAPBACK_REMEDIATION_ARTIFACT_STALE` and makes no change. Fetch a fresh
diagnostic and select a new item; never overwrite the old hash or transplant
the replacement into a newly generated set.

Authority changes are different. For example, `requestGrant` has
`machineApplicable: false`, `requiresApproval: true`, and
`authorityEffect: "widens"`. `remediation.apply` returns
`SNAPBACK_REMEDIATION_APPROVAL_REQUIRED`; it never turns the suggestion into a
grant. Present it to the operator and use the existing reviewed authorization
workflow. A principal-changing item follows the same explicit-approval rule.

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

A native `snapback start` without `--ready-file` may hand process-bound
capabilities to a controlling terminal. A detached start has no safe carrier
and fails before database creation with
`SNAPBACK_READY_DESCRIPTOR_REQUIRED`; its diagnostic `details.next` names
`snapback start --ready-file <owner-only-path> ...` as the repair. Never scrape
the human startup log or redirect a bearer through inherited stdout/stderr.

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

`binary.buildProfile` answers only `debug` or `release`, because it is derived
from `cfg!(debug_assertions)`. The shipped npm runtime is built on a third
Cargo profile — `production`, which adds fat LTO and strips the symbol table —
and it reports `release` there like any other optimized build. The separate
`buildRecipe` block is the fact that tells them apart:

```json fragment reason="the buildRecipe block of snapback.binary-identity.v1"
{
  "profile": "production",
  "cargoProfileClass": "release",
  "optLevel": "3",
  "lto": "fat",
  "codegenUnits": 1,
  "incremental": false,
  "strip": "symbols"
}
```

Its authority is the build, not the ceremony around it: the build script that
runs inside that very `cargo` invocation stamps the resolved profile plus the
recipe the root manifest declares, and refuses to stamp at all when an ambient
channel — a `CARGO_PROFILE_*` override, `RUSTFLAGS` reaching `-C lto`/`-C
strip`, `cargo --config`, an inherited `.cargo/config.toml`, a rustc wrapper —
could have made that declaration a fiction. Off the ship profile every declared
field is `null`: a build that was not attested states no recipe rather than a
default nothing verified. Public-package assembly reads this block from the
binary it is about to pack and refuses anything that is not the declared ship
recipe, so an ordinary release build cannot be packaged as if it were the
shipped one.

Dirtiness here is scoped to the runtime binary's input set — the shared
pathspec list in `scripts/runtime-build-inputs.txt` (Rust sources and
manifests, `vendor/ibex`, and the build-embedded corpora). Uncommitted
edits to your app under `demos/`, or to LLPs, issues, and diaries, cannot
change the binary's bytes and do not count: a prepared binary stays
verified and reusable while you iterate on an app. A dirty *input set*
triggers the refusal posture at server spawn: the kit skips a prebuilt
`target/debug/snapback` it cannot verify against a committed identity
("this checkout's runtime input set is dirty or has no committed
identity") and falls back to the `cargo run` rung, which costs a
rebuild-check on every boot (~30 s). That is provenance working as
designed, not a fault. If you accept the local binary knowingly — a test
loop on intentionally dirty runtime sources — the sanctioned escape is
the same explicit override the diagnostic quotes:
`SNAPBACK_SERVER_BINARY=<path>`. The override's unpinned identity stays
visible in the spawn record, so acceptance is always a recorded choice,
never an ambient default.

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
