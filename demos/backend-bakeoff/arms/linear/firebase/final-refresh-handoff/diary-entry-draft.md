# Linear / Firebase Stage 5 final refresh — diary draft

**Date:** 2026-07-29

The sealed arm and every original receipt remain unchanged. A fresh additive
project upgraded
`firebase-admin` from 13.5.0 to 14.2.0 and `firebase-functions` from 6.4.0 to
7.3.2. After the provider-order gate opened, the exact isolated emulator
target completed the frozen Linear suite with **12 PASS, one explicit GAP, one
unavailable remote dependency, zero FAIL, and no Stop-class defect**.

What felt good:

- The original arm already used Firebase's recommended modular entry points,
  including the v2 callable-functions path, so its actual business-function
  source needed no migration.
- The client, UI, rules, indexes, and all frozen acceptance assertions copied
  without semantic changes.
- Both callable exports loaded under the declared Node.js 22 runtime after a
  clean dependency install, and the production client build passed.
- Runtime behavior survived the two major upgrades without changing the
  callable business code: authority, conflict, push, offline queueing,
  migration, and exact cleanup all reproduced.
- The Local Emulator Suite again gave unusually direct evidence: Admin SDK
  checks, client metadata, second-client listeners, exported state hashes, and
  an exact hub-derived cleanup plan.

What felt bad or uncertain:

- Admin SDK 14 drops Node.js 20, so the Functions runtime declaration had to
  move to Node.js 22 even though the host development machine currently
  defaults to Node.js 24. The explicit Node 22 check was necessary to close
  that confidence gap.
- The upgrade pulls a substantial transitive lockfile change, including
  Firestore 7 → 8 and Express 4 → 5 through the official packages, despite
  only two requested direct-version changes.
- `npm audit` reports thirteen transitive findings, including seven high
  severity paths, while its advertised fixes include incompatible downgrades.
  That is operational evidence to retain rather than silently auto-fix.
- Preparing strong isolation touches many endpoint and lifecycle files even
  though it does not change product semantics. A typed provider-arm
  environment object would reduce the chance of a missed hard-coded port.
- The Functions emulator silently opened Eventarc and Tasks auxiliary
  listeners on its default `9299` and `9499` ports even though they were not
  in the requested `--only` set. Hub-derived cleanup proved they were
  exact-owned and closed them, but that was still weaker isolation than the
  protocol requires. I retained that run as a discovery attempt and reran the
  full suite with explicit Eventarc `61121` and Tasks `62121` bindings.
- Firebase's configuration supports those auxiliary bindings cleanly once you
  know they exist, but the implicit startup behavior makes a generic
  “requested service ports only” preflight insufficient. Strong arm tooling
  should either derive the entire listener graph before startup or require an
  explicit provider-specific port manifest.

Native full-text search remains a GAP, and hosted deploy remains unavailable
because hosted credentials were absent. The local upgrade is strongly
confirmed; it does not manufacture either missing product fact.
