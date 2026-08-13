# Budget report

- Bytes before: 57,080
- Bytes after: 55,806
- Budget: `< 55,808` (2 bytes spare)
- Net reduction: 1,274 bytes

## Text tightened

Only capability-table `What` prose changed. The merged handler-runtime,
media-field, and authority-profile descriptions were tightened first. Further
compression covered verbose backend, asset/job, realtime/sync, password,
instance/store/dev-loop, diagnostics/verification, and deployment descriptions.

A structural comparison against `HEAD` confirmed all 111 rows remain in the
same order and all 20 changed rows differ only in the `What` column. Alias
strings, targets, maturity, witnesses, authorities, pages, GAP markers, owners,
and review dates are unchanged.

## Verification tails

`wc -c guide/capabilities.md`:

```text
55806 guide/capabilities.md
```

`volta run --node 24.18.0 node scripts/generate-guide-manifest.mjs` (exit 0):

```text
[guide-manifest] wrote guide/guide-flat.realtime.generated.md (realtime; 39652 bytes)
[guide-manifest] wrote guide/guide-flat.recipes.generated.md (recipes; 103671 bytes)
[guide-manifest] wrote guide/guide-flat.reference.generated.md (reference; 1693349 bytes)
[guide-manifest] wrote guide/guide-flat.sync.generated.md (sync; 58918 bytes)
[guide-manifest] wrote guide/guide-flat.testing.generated.md (testing; 39324 bytes)
```

`node scripts/check-guide.mjs` (exit 0; pre-existing warnings retained):

```text
[guide-check] warning: guide/testing/acceptance.md: authorities changed since review at 772c006495: demos/_kit/harness.mjs, demos/_kit/server-process.mjs, llp/0010-agent-dx-and-acceptance.spec.md, llp/0012-headless-integration-contract.spec.md, llp/0031-server-route-taxonomy.spec.md, src/cli.rs
[guide-check] warning: guide/testing/large-fixtures.md: authorities changed since review at cca0db7d8e: demos/zerobugs/control/snapback/functions.mjs, llp/0183-zerobugs-quality-surface.rfc.md, src/seed_identity.rs, src/storage.rs
[guide-check] warning: guide/testing/verify.md: authorities changed since review at 772c006495: llp/0010-agent-dx-and-acceptance.spec.md, llp/0146-agentic-authoring-affordances.rfc.md, packages/snapback-cli/package.json, packages/snapback-cli/verify-receipt.schema.json, packages/snapback-cli/verify.mjs
[guide-check] ok — 125 pages, 1414 snippets, 169 routes + 51 host-ops joined, 61 warnings
```
