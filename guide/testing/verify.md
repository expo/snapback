---
title: Verify the declared app contract
id: testing.verify
order: 2
audience: agent-first
capabilities: [operating.verify]
authorities: [llp/0010-agent-dx-and-acceptance.spec.md, llp/0146-agentic-authoring-affordances.rfc.md, packages/snapback-cli/package.json, packages/snapback-cli/verify.mjs, packages/snapback-cli/verify-receipt.schema.json]
examples: [packages/snapback-cli/verify.test.mjs, packages/snapback-cli/fixtures/verify/snapback.verify.config.mjs, packages/snapback-cli/fixtures/verify/minimal-profile.mjs]
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

## Author `snapback.verify.config.mjs`

Prefer the dedicated `@expo/snapback-cli/verify` subpath. The package root
currently re-exports the same helpers for compatibility, but the subpath keeps
verifier-only imports explicit and matches the package's dedicated export.
Default-export one `defineVerifyConfig(...)` value. Paths in
`backendDirectory` and `testFiles` are relative to the config file:

```js source=packages/snapback-cli/fixtures/verify/snapback.verify.config.mjs
import { defineVerifyConfig } from '@expo/snapback-cli/verify';

import { runMinimalProfile } from './minimal-profile.mjs';

export default defineVerifyConfig({
  schemaVersion: 'snapback.verify-config.v1',
  backendDirectory: './snapback',
  profiles: [{
    id: 'local-headless',
    title: 'local headless acceptance',
    testFiles: ['./minimal-profile.mjs'],
    requiredCapabilities: ['result_contract_v1'],
    paths: [{
      id: 'list-success',
      kind: 'success',
      targetProfileId: 'local-dev-sqlite-ibex',
      functionId: 'app:list',
    }],
    run: runMinimalProfile,
  }],
});
```

Each profile lists every file whose bytes define the acceptance run, every
capability it needs, and every expected path. Path `kind` is one of `success`,
`failure`, `action`, `relational`, `search`, or `snapshot-bundle`;
`targetProfileId` names the target actually exercised; `functionId` binds D1
read/write evidence to a declared function when the path has one.

The runner receives `{ artifact, backendDirectory, generatedDirectory,
profileId }`. It returns boolean `ok`, the exact target/data/authority/seed
identity in force, optional diagnostics, and one six-field D1 conformance
report for every registered path:

```js source=packages/snapback-cli/fixtures/verify/minimal-profile.mjs
// This package fixture proves the authoring contract without claiming that it
// observed an application's reads or writes. Replace this body with the real
// headless acceptance run and report complete provenance only when measured.
export async function runMinimalProfile({ artifact, profileId }) {
  if (profileId !== 'local-headless' || typeof artifact?.identity?.inputsHash !== 'string') {
    throw new Error('minimal verify profile received the wrong execution context');
  }
  return {
    ok: true,
    context: {
      target: { kind: 'local-generated-artifact', identity: artifact.identity.inputsHash },
      data: {
        kind: 'sqlite-fixture',
        identity: 'sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
      },
      authority: { kind: 'dev-asserted', identity: 'user_ada', principalClass: 'dev' },
      seed: artifact.seedIdentity,
    },
    conformance: [{
      pathId: 'list-success',
      status: 'observed',
      report: {
        missingReads: [],
        missingWrites: [],
        extraReads: [],
        extraWrites: [],
        readProvenance: 'unsupported',
        writeProvenance: 'unsupported',
      },
    }],
  };
}
```

Replace the fixture identities with facts from the run. `target.identity`,
`data.identity`, and `authority.identity` must be non-null;
`authority.principalClass` must be named; and `seed.kind` must say what was
exercised rather than `not-exercised`. This minimal shape deliberately reports
both D1 provenance classes as `unsupported`, so it proves registration and
identity plumbing without claiming authoritative read/write coverage. A real
runner reports `complete` only from measured evidence.

Missing registered path evidence and non-empty
`missingReads`/`missingWrites` fail coverage.
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
