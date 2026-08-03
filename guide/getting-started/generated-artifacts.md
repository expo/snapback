---
title: Generated artifact custody and review
id: getting-started.generated-artifacts
order: 3
audience: agent-first
capabilities: [backend.codegen]
authorities: [llp/0010-agent-dx-and-acceptance.spec.md, llp/0012-headless-integration-contract.spec.md, llp/0037-schema-source-of-truth.decision.md, llp/0041-packaged-dev-loop.rfc.md, packages/snapback-codegen/review-surface.mjs, packages/snapback-codegen/review-manifest.schema.json, packages/snapback-codegen/codegen-policy.schema.json]
examples: [packages/snapback-codegen/review-surface.test.mjs, packages/snapback-cli/templates/todo-contract]
status: current
targets: [all]
maturity: shipped
reviewed: 2026-08-03
reviewed-commit: 6e5d69d1037c6042fb9338221dfb489e00f5f78a
---

# Generated artifact custody and review

Codegen separates reviewable source control state from regenerable build
output. One complete input hash names one complete generated graph; every file
in that graph has a SHA-256 digest and byte count.

## Know what belongs in source control

There are exactly three custody classes:

- `review-manifest`: `snapback/generated/artifacts.json`. Commit this file. It
  is the deterministic review projection for the whole graph.
- `consumer-committed`: a projection that a source-only consumer or CI policy
  explicitly needs. Commit only the paths listed in `committedProjections` in
  `snapback/codegen.policy.json`, and add matching negations to the app's
  `.gitignore`. The closed policy record uses
  `schemaVersion: "snapback.codegen-policy.v1"`.
- `regenerable-cache`: every other generated projection. These bytes live
  under `.snapback/codegen-cache/<inputsHash>/` and are ignored.

Snapback's maintained demos, including the backend bakeoff, use this
manifest-only policy. Existing external repositories may retain a committed
legacy `generated/` tree while they migrate; that compatibility is deliberately
limited to pre-v2 manifests and explicitly declared `consumer-committed`
projections. It is not an exception for new repository-owned demos. The admin
UI's separately generated bindings remain under their existing dedicated
generator and CI gate because they are not a Snapback backend graph.

## Regenerate one complete graph

```sh
snapback generate snapback
snapback generate snapback --json
```

The human result inventories tables, operations by kind, live and ephemeral
counts, file custody, warnings, and degraded result types. A degraded result
links the authored export or schema field to the generated type and gives an
exact remediation. `--json` returns the same deterministic summary and structured
diagnostics.

Generation writes a temporary complete graph, digests it, atomically publishes
the hash-addressed cache, verifies it, then atomically materializes
`snapback/generated/` for import compatibility. A hard generation or write
failure leaves the previously serveable graph intact.

## Consume through the manifest

The packaged dev loop, runtime load, release builder, app CLI, Vite lifecycle,
Contract validation, and CI resolve generated files through `artifacts.json`.
A missing or tampered cache produces `SNAPBACK_CODEGEN_CACHE_INVALID`; run
`snapback generate snapback` to reconstruct it. Only a digest-matching
`consumer-committed` projection may be read without the cache. Codegen never
serves an unverified materialized cache projection as a stale fallback.

A release closes over the verified cache graph, not whatever files happen to
remain in `generated/`. CI regenerates from a cold cache, verifies every
digest, and diffs the review manifest plus explicitly committed consumer
projections.

Vite rewrites relative imports beneath a `generated` or
`generated-<target-profile>` directory to the verified cache file. This covers
the React/client API import and Contract's generated descriptor and
`runtime-links` imports without changing their author-friendly source spelling.
Node scripts do not have a bundler hook, so they call
`resolveGeneratedArtifact(generatedRoot, artifactPath)` before reading JSON or
dynamically importing a generated module.

## Review a codegen change

Review `artifacts.json` beside the source change. Its stable summary shows the
surface-size change, while `files` shows the content digest, logical kind,
custody, consumer, and regeneration command for every projection. Identical
inputs produce byte-identical review manifests and summaries.

If a consumer truly cannot regenerate, declare its exact projection path in
`snapback/codegen.policy.json`; do not commit the whole graph. Re-run codegen and
the review manifest will record the new custody.

## Anti-patterns

- **Do not import arbitrary files from an unverified cache path.** Resolve
  through the review manifest.
- **Do not hand-edit `generated/` or `.snapback/codegen-cache/`.** Regenerate;
  digest verification treats edits as tampering.
- **Do not add the whole generated tree to `committedProjections`.**
  Custody is a narrow consumer need, not a way to restore noisy diffs.
- **Do not fall back to stale materialized projections after a cache error.**
  Regenerate or fail closed.
