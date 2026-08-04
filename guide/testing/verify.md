---
title: Verify the declared app contract
id: testing.verify
order: 2
audience: agent-first
capabilities: [operating.verify]
authorities: [llp/0010-agent-dx-and-acceptance.spec.md, llp/0146-agentic-authoring-affordances.rfc.md, packages/snapback-cli/verify.mjs, packages/snapback-cli/verify-receipt.schema.json]
examples: [packages/snapback-cli/verify.test.mjs]
status: current
targets: [local]
maturity: partial
reviewed: 2026-08-04
reviewed-commit: dab2410b6793ffa5685069a0a4054f0e2b21608a
---

# Verify the declared app contract

> **Local target, partial surface.** This page describes generated-artifact
> admission and explicitly registered acceptance paths. Live-target admission
> and automatic discovery of every repository acceptance suite remain GAPs.

`snapback verify --json` is the CLI-owned readiness composition from LLP 0146
D2. It is not the unbuilt `acceptance.run` host operation. In fixed receipt
order it checks fresh generated identity, the digest-bound LLP 0010 runtime
readiness receipt, local schema/function admission plus registered D1
coverage, generated target capabilities, and registered acceptance profiles:

```sh
snapback runtime-qualify --persist
snapback verify ./snapback --config ./snapback.verify.config.mjs --receipt ./.snapback/verify-receipt.json --json
```

A config default-exports `defineVerifyConfig({ schemaVersion:
'snapback.verify-config.v1', ... })`. Each profile names the actual test files,
required capabilities, and every expected path with a closed kind (`success`,
`failure`, `action`, `relational`, `search`, or `snapshot-bundle`) and target
profile. Its runner returns `ok`, the target/data/authority/seed identity in
force, and one six-field D1 conformance report per path. Missing registered
path evidence and non-empty `missingReads`/`missingWrites` fail coverage.
Those deltas are authoritative only for a class whose provenance is
`complete`; an observed `incomplete` or `unsupported` class stays visible as
partial coverage and is never labeled conformant.
`extraReads`/`extraWrites` become a warning only when their intersection over
every complete class observation for the function stays non-empty, which preserves a table
used only on a conditional path.

The package-owned `snapback.verify-receipt.v1` schema binds the profile-set
identity, digest of the config and actual test bytes, artifact target, data,
authority, seed, all five stage verdicts, and ordered `next[]` actions.
`recommendedNext` appears only when exactly one stage failed. With no
registered profiles, a fresh app can pass the platform checks, but the receipt
says `no-registered-acceptance-paths` and does not claim D1 aggregate coverage.

The current admission authority is the locally regenerated generated-artifact
set. It does not claim that a live target admitted those bytes, does not
implement `acceptance.run`, does not prove product completeness, and does not
perform or custody CV-14 semantic review. Build acceptance profiles with the
headless-first discipline in [Acceptance testing](acceptance.md).
