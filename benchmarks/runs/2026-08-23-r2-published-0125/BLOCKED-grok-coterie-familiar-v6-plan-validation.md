# R2 `grok-coterie-familiar` blocked before admission by v6 plan-validation drift

Date: 2026-08-24  
Host: `Mac.lan` (`mac-mini-durand`)  
Disposition: **cell remains pristine; campaign stopped before admission**

The required fresh `validate-plan.mjs` invocation for
`grok-coterie-familiar` failed before admission:

```text
Error: R2_PLAN_INVALID: recovery transition does not bind the recovered two-cell prefix to pristine cell 3
    at fail (.../validate-plan.mjs:28:9)
    at .../validate-plan.mjs:177:3
```

No admission artifact was created, no private cell root was created, and no
Grok or product process was launched for this cell. The slot therefore remains
pristine and must not be represented as an attempted or consumed cell.

## Cause

During the preceding `grok-coterie-explicit` attempt, commit
`f489b8e28871e79c419a1ee0d6534f2b85645aa4` landed on `origin/main` with the
suite-status finalization repair. The conductor's required fetch/rebase before
publishing the preceding disposition incorporated that commit. It migrated the
live campaign bindings from the requested v5 corpus to v6:

- instrument manifest SHA-256 changed from
  `13d5fe72dfdf5f401b1e81452f1668af071fb83093cdb92aed1941db61ddff3d`
  to `2f87099eb13640f632ee76483c6c414f03f8671174c7ac52098c858292d540ae`;
- materialized root changed from
  `/Users/ccheever/bench-matrix-20260823-r2/instrument-corpus-hardening-20260824-v5`
  to `/Users/ccheever/bench-matrix-20260823-r2/instrument-corpus-hardening-20260824-v6`;
- production driver SHA-256 changed from
  `de0163b2a5621e70cec038089ed2b3abeca3ec82e85904c9faa286c124e81135`
  to `61931aeca07f67b569127d75ae256b5cce372ce335dbde4530f8934303f10559`;
- manifest-loader SHA-256 changed from
  `d21925146a888cda3f24d19bdf9c3e0994ed87d7ac88c5fc485a92a46f5ee530`
  to `4af14ab4e413df1abc2b7f463ec739644c0be0f692193633669fecc382631dc7`.

The landed `validate-plan.mjs` remains at SHA-256
`908544533fcda8d5488129c077c518e9e1270cac7e59580a758090fbf3373308`.
It assigns `config.pins.instrument.instrumentMigrations.at(-1)` to the
disposition migration and requires that object to be the v5 two-host migration,
including its reason, admission hash transition, validate-plan hash transition,
and recovery linkage. After the v6 append, `.at(-1)` is instead the suite-status
finalization migration. Its `instrumentManifestSha256From` is the v5 digest,
whereas `recovery-resume.v4.json` still binds the v4 digest
`1320261386aadb2dfdf0ebd161df8845f0d8582f37000aa77aebd334107c2833`.
Consequently `recoveryInstrumentMigrated` is false and the validator refuses at
the recovery-transition check before reaching instrument resolution or cell
admission.

## Retained materialization and untouched cell

The setup materialization requested by the conductor still exists at the v5
path and verified at creation with manifest SHA-256
`13d5fe72dfdf5f401b1e81452f1668af071fb83093cdb92aed1941db61ddff3d`.
The newly configured v6 path was not materialized by this conductor. It was
materialized by the concurrent repair at 2026-08-24 18:45:25 PDT, and its
`instrument.manifest.json` independently hashes to the configured v6 digest
`2f87099eb13640f632ee76483c6c414f03f8671174c7ac52098c858292d540ae`.
The validator still refuses before instrument resolution, so the existence of
this digest-verified v6 materialization does not cure the inconsistent recovery
check and cannot authorize bypassing it.

At stop time:

- `cells/grok-coterie-familiar/cell.json` remains `not-started`;
- `admissions/grok-coterie-familiar.json` does not exist;
- `/Users/ccheever/bench-matrix-20260823-r2/cells/grok-coterie-familiar`
  does not exist;
- no product, harness, controller, driver, validator, instrument, or plan code
  was modified by the conductor.

Campaign continuation requires a landed, internally consistent v6 plan
validator and an explicit ruling that the final cell should use the migrated
driver/corpus, followed by digest-verified v6 materialization and a fresh
validation/admission gate. This report does not authorize a rerun of any
consumed cell.
