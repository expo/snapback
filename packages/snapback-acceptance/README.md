# `@expo/snapback-acceptance`

`@expo/snapback-acceptance` is the supported starter acceptance runner and
generated-operation profile builder used by Snapback's first-party templates.
It owns the recurring platform mechanics: isolated server lifecycle,
application-readiness waiting, ordinary-session minting, bounded polling and
step deadlines, cleanup, starter receipt compatibility, and the starter
conformance projection.

Application assertions stay in `acceptance.mjs`. A path is declared with a
generated operation reference, and the same path token is passed to the
bounded callback that performs the product assertion. The package never turns
operation existence or invocation into an automatic product claim.
Non-operation product assertions are declared with `operation: null`; every
declared token must complete exactly once before the journey can pass.

```js
import assert from 'node:assert/strict';
import {
  defineStarterAcceptance,
  runStarterAcceptanceIfMain,
} from '@expo/snapback-acceptance';
import api from './snapback/generated/api.mjs';
import artifacts from './snapback/generated/artifacts.json' with { type: 'json' };

export const acceptance = defineStarterAcceptance({
  acceptanceFile: import.meta.url,
  appRoot: import.meta.dirname,
  artifacts,
  paths: {
    listTodos: {
      id: 'list-todos',
      kind: 'success',
      targetProfileId: 'local-dev-sqlite-ibex',
      operation: api.listTodos,
      provenance: 'baseline',
    },
  },
  async journey({ adminClient, paths, step }) {
    await step(paths.listTodos, async () => {
      const result = await adminClient.query(api.listTodos, { args: {} });
      assert(Array.isArray(result.rows));
      return { rowCount: result.rows.length };
    });
  },
});

await runStarterAcceptanceIfMain(import.meta, acceptance);
```

The verify config imports that declaration and passes
`starterVerifyProfileOptions(acceptance, options)` to
`defineStarterVerifyProfile`. Registration and observation therefore share the
same builder-issued token and generated operation id. `snapback verify` remains
the only done-oracle; direct execution is a raw debugging path, not a second
aggregate verifier.

The definition's `overallTimeoutMs` is a hard runner deadline that reserves
`cleanupTimeoutMs` for final cleanup. Lifecycle methods, preflight, the
journey, step callbacks, retry predicates, session-mint children, client
inspection, cleanup callbacks, and lifecycle stop all receive an
`AbortSignal`. Callbacks may ignore their signal only if their work is already
synchronously bounded; spawned or asynchronous work must stop on abort.

## Extend or eject

The supported extension surface is the root export only. There are three
different ownership levels:

1. **Extend the managed runner or lifecycle.** Add application-owned path
   tokens, `step(...)` callbacks, and `defer(...)` resources, or supply a
   `StarterLifecycleAdapterV1`. The adapter must honor the start/stop signals.
   Only lifecycle facts the adapter returns in `lifecycleEvidence` are stamped
   into the receipt; the runner does not invent `owned`, `waitLevel`, or
   `firstQueryRetries` claims. `mintSession` and `createSessionClient` are
   managed-CLI-shaped helpers: they require the lifecycle state to expose a
   Snapback executable, ready file, and admin token. A lifecycle that does not
   spawn that CLI must mint its own application session inside its bounded
   callback.
2. **Eject the process while retaining the package projector.** Keep the
   declaration/profile builder and call `projectStarterAcceptanceReceipt`,
   `parseStarterAcceptanceReceipt`, and `validatePassingStarterReceipt` from
   the same package release. The custom process owns lifecycle and cleanup,
   while the package and CLI still rotate receipt compatibility together.
3. **Eject the package completely.** Independently emitting
   `snapback.starter-acceptance.v1` forfeits same-release receipt-rotation
   protection. The ejected implementation assumes lifecycle, deadline and
   child cancellation, cleanup, receipt migration, and CLI-version pinning;
   `defineStarterVerifyProfile` remains the admitting authority.

Within the first two levels, the supported helpers are:

- add application-owned `step(...)` callbacks and path tokens;
- use `until(...)`, `defer(...)`, `mintSession(...)`, or
  `createSessionClient(...)` inside those callbacks;
- supply a `StarterLifecycleAdapterV1` to replace process startup/readiness and
  shutdown while retaining the runner's bounded cleanup and receipt projector;
- use `projectStarterAcceptanceReceipt`,
  `validatePassingStarterReceipt`, and `parseStarterAcceptanceReceipt` when an
  ejected process retains package-owned compatibility.

Context additions are additive. Removing or changing a declaration field,
path-token meaning, callback contract, or lifecycle-adapter method requires a
package major. Deep imports, child-process layout, temp filenames, bounded-log
formatting, and raw receipt-object members are not extension points for code
that retains the package. A completely ejected runner accepts those members as
its own migration burden. The templates pin this package and the CLI to the
same Snapback release so retained compatibility implementations rotate
together.

## Documentation outside a checkout

A running Snapback server serves the Guide compiled into that exact build.
These links use the first default development port; use the origin printed by
`snapback dev` or `snapback start` if yours differs.

- Read first: [the start packets](http://127.0.0.1:4287/_snapback/guide/start/index.md)
  — the budgeted per-template first read (LLP 0259).
- Read [the acceptance workflow](http://127.0.0.1:4287/_snapback/guide/testing/acceptance.md)
  for profile and receipt semantics.
- Look up (do not linear-read) the [capability index](http://127.0.0.1:4287/_snapback/guide/capabilities.md)
  before treating a starter path as a broader target or product claim.
- Run `snapback guide` or `snapback guide <query>` to browse or search the
  embedded Guide.
- Run `snapback mcp` for the same build-bound corpus as read-only MCP
  resources, starting at `snapback-guide://manifest`.

<!-- @ref LLP 0275#d9-public-starter-acceptance-runner-author-ruling-2026-08-22 — public runner ownership and eject/extend compatibility stay explicit. -->
<!-- @ref LLP 0187#t4--build-the-out-of-repo-funnel-before-it-is-tested-for-real — published packages route readers to checkout-independent documentation. -->
