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

## Extend or eject

The supported extension surface is the root export only:

- add application-owned `step(...)` callbacks and path tokens;
- use `until(...)`, `defer(...)`, `mintSession(...)`, or
  `createSessionClient(...)` inside those callbacks;
- supply a `StarterLifecycleAdapterV1` to replace process startup/readiness and
  shutdown while retaining the runner's bounded cleanup and receipt projector;
- use `projectStarterAcceptanceReceipt`,
  `validatePassingStarterReceipt`, and `parseStarterAcceptanceReceipt` when a
  fully custom process needs to keep the admitted v1 receipt contract.

Context additions are additive. Removing or changing a declaration field,
path-token meaning, callback contract, or lifecycle-adapter method requires a
package major. Deep imports, child-process layout, temp filenames, bounded-log
formatting, and raw receipt-object members are not extension points. An ejected
runner that emits its own JSON targets `snapback.starter-acceptance.v1` and
still passes through `@expo/snapback-cli/verify` for admission. The templates
pin this package and the CLI to the same Snapback release so their compatibility
implementation rotates together.

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
