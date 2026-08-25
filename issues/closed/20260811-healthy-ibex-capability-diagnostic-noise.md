# Healthy embedded Ibex runtime reports CLI unavailability twice

**Status:** Closed 2026-08-11
**Impact:** 2
**Urgency:** 3
**Ease:** 4
**Confidence:** 5
**Systems:** Runtime, Diagnostics, Admin console, Packaging
**Date:** 2026-08-11
**Governing:** LLP 0010, LLP 0017
**Found while:** Inspecting the Tiny Triumphs npm runtime in the admin console

## Problem

The admin console's diagnostics tab shows this healthy startup sequence:

1. `SNAPBACK_IBEX_CLI_UNAVAILABLE`
2. `SNAPBACK_IBEX_FUNCTIONS_LOADED`
3. `SNAPBACK_IBEX_CLI_UNAVAILABLE` again

The “unavailable” message says the embedded vendored runtime remains usable,
and the positive load event confirms that Ibex handler modules loaded. A
normal npm installation therefore presents a healthy implementation choice as
an unavailable capability, then repeats it. The result looks actionable even
though no repair is required.

## Confirmed cause

`RuntimeManager::diagnostics()` emits `SNAPBACK_IBEX_CLI_UNAVAILABLE` whenever
the optional external `ibex` executable is absent (`src/runtime.rs`). The
instance constructor records that diagnostic once. Every successful function
generation then calls `post_install_function_generation`, which appends
`self.runtime.diagnostics()` again after
`SNAPBACK_IBEX_FUNCTIONS_LOADED` (`src/local.rs`).

The admin UI maps every `recentDiagnostics` entry in order
(`admin-ui/admin-boundary.mjs`); it is not manufacturing the duplicate.

## Desired outcome

External-CLI absence remains an inspectable runtime capability fact, but a
healthy embedded handler path does not emit an unavailable diagnostic. Emit a
stable refusal only if a real operation requests an external CLI capability
that is absent. Keep `SNAPBACK_IBEX_FUNCTIONS_LOADED` as the positive
generation event.

Do not solve this by globally deduplicating the admin list. Repeated errors and
warnings can represent distinct occurrences and must remain visible. Remove
the non-actionable healthy-state production at its source; retain the old code
in compatibility/registry projections if the stable diagnostic vocabulary
requires it during transition.

## Acceptance

- Constructing a local runtime without an external `ibex` executable exposes
  the exact absence in the runtime capability report and emits no unavailable
  diagnostic merely for that fact.
- Loading one or more embedded Ibex function generations retains the positive
  loaded event without reintroducing the unavailable notice.
- A path that genuinely requires the missing external executable, if one
  remains supported, refuses with one stable actionable diagnostic.
- Repeated genuine diagnostic occurrences remain distinct in
  `recentDiagnostics`; there is no broad UI-side deduplication.
- Runtime, local-generation, inspect-casing, server, admin projection, and
  generated diagnostic-registry tests are updated together.

## Non-goals

- Bundling a second external Ibex executable into npm packages.
- Changing the canonical embedded Ibex/Hermes execution engine.
- Hiding errors or warnings because their codes happen to match.

## Resolution

`RuntimeManager::diagnostics()` no longer turns passive absence of the optional
external `ibex` executable into a diagnostic occurrence. The exact absence
remains projected through `runtime.ibexCli` and the `ibex_cli` capability gap,
while each successful embedded generation continues to emit
`SNAPBACK_IBEX_FUNCTIONS_LOADED`. No supported operation consumes the detected
external executable, so there is no genuine missing-CLI refusal path to retain.

The retired `SNAPBACK_IBEX_CLI_UNAVAILABLE` spelling remains reserved in the
generated diagnostic vocabulary for compatibility with historical records.
The runtime comment carries the explicit `diagnostics-registry: reserved SNAPBACK_IBEX_CLI_UNAVAILABLE`
marker; the generated registry records that occurrence with site kind
`reserved`, keeps it out of the emitting-site count, and retains it in the
public `SnapbackDiagnosticCode` union.
Runtime, local generation, inspect casing, server projection, and admin tests
cover the new boundary; the admin regression also proves that two genuine
same-code warnings remain two ordered `recentDiagnostics` occurrences.
