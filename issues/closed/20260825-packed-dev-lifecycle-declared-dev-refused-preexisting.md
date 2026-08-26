# packed-dev-lifecycle: `SNAPBACK_APP_BINDING_DECLARED_DEV_REFUSED` is red on pristine main

**Type:** Issue
**Status:** Resolved
**Systems:** cli, codegen, acceptance
**Author:** Claude (sbs-orchestrate supervisor)
**Date:** 2026-08-25
**Revised:** 2026-08-26
**Related:** LLP 0310.000 (Track C), LLP 0189 (verification cadence), `issues/closed/20260825-metro-exit-on-codegen-tmp.md`

## Symptom

`node --test packages/snapback-cli/packed-dev-lifecycle.test.mjs` fails on a pristine
`origin/main` checkout (baseline taken 2026-08-25 during the LLP 0310 lane work,
before any lane change) with:

```text
file:///private/var/folders/4_/6m2cbnz54r34g_k18rxs7h800000gn/T/snapback-packed-dev-lifecycle-EHxrYF/external-consumer/node_modules/@expo/snapback-client/diagnostic-error.mjs:153
  return new SnapbackDiagnosticError(diagnostic, { ...facts, message });
         ^

SnapbackDiagnosticError: SNAPBACK_APP_BINDING_DECLARED_DEV_REFUSED: The declared-dev capability is not installed on this exact generated app object.
    at snapbackDiagnosticError (file:///private/var/folders/4_/6m2cbnz54r34g_k18rxs7h800000gn/T/snapback-packed-dev-lifecycle-EHxrYF/external-consumer/node_modules/@expo/snapback-c
    at refusal (file:///private/var/folders/4_/6m2cbnz54r34g_k18rxs7h800000gn/T/snapback-packed-dev-lifecycle-EHxrYF/external-consumer/node_modules/@expo/snapback-client/app-client
    at preflight (file:///private/var/folders/4_/6m2cbnz54r34g_k18rxs7h800000gn/T/snapback-packed-dev-lifecycle-EHxrYF/external-consumer/node_modules/@expo/snapback-client/app-clie
```

The packed importer's declared-dev binding refuses because the declared-dev
capability is not installed on the exact generated `app` object the packed
lifecycle imports. Every LLP 0310 lane (Tracks A/C/E, expo-restart) inherits this
red and cites it by name; none of them introduced it.

## Evidence

- Supervisor baseline log: `packed-dev-lifecycle.test.mjs` on pristine main,
  same failure signature, recorded before any lane commit
  (`$SCRATCHPAD/logs/baseline-packed-dev-lifecycle.log`, run 2026-08-25).
- Track C rounds 13–17 and Track E rounds 17–23 finals each report this as the
  sole inherited red of that suite.

## Expected resolution

Root-cause why the packed lifecycle's generated `app` object lacks the
declared-dev capability (identity of the imported object vs. the object the
capability was installed on — the same "exact object" contract the error names),
fix the importer or the installation seam, and restore the suite to green.
Until then this ticket is the authoritative record that the red is pre-existing
so lanes are not blocked on it (LLP 0232 optimistic landing).

## Investigation and scoped repair — 2026-08-26

The exact-object refusal was caused by two byte-identical but separately loaded
copies of `@expo/snapback-client` in the packed fixture. The generated
`react/snapback/generated/app.binding.<digest>.mjs` synchronously installed the
capability through `react/node_modules/@expo/snapback-client`; the harness
passed that app to `createSnapbackAppClient` imported from the external
consumer's top-level `node_modules/@expo/snapback-client`. The nested copy's
module-private WeakMap recognized the exact app/capability pair; the top-level
copy correctly did not. The packed lifecycle predates the LLP 0302 seam and did
not realign its orchestrator import after each scaffold began owning its own
installed closure.

The scoped importer repair now applies the exact-object check only when
preflight is actually selecting the URL/`declared-dev` arm. An explicitly
supplied, independently admitted binding does not consume an inert capability
from another closure. A regression test proves both halves: that binding
reaches ready, while attempting URL selection with the same foreign stamp still
refuses with `SNAPBACK_APP_BINDING_DECLARED_DEV_REFUSED`. No ambient/global
lookup, name match, or opportunistic installation was added.

The original declared-dev red was gone at this stage: the packed headless M1→M2
arm was green and the unchanged full suite passed that lifecycle before
reaching the later scaffold `npm run prove`. The full suite was still red there with
`SNAPBACK_APP_BINDING_UNAVAILABLE`: the starter acceptance reads
`process.env.SNAPBACK_URL`, while its managed lifecycle adapter does not supply
that value to the acceptance process. That distinct pre-existing template and
acceptance lifecycle mismatch kept this issue open until the subsequent repairs
below made the exact full suite green.

## Resolution — 2026-08-26

The full masking chain is resolved in three separate changes:

1. `c4206da52` narrows declared-dev exact-object custody to the source actually
   selected by preflight. An explicit admitted binding no longer consumes an
   inert declared-dev stamp from a second packed module closure, while URL
   selection through that foreign stamp still refuses.
2. `221724231` hands the managed ready origin to the starter acceptance
   journey as `ready.serverUrl`. The template no longer assumes an ambient
   `SNAPBACK_URL` that its lifecycle owner never promised to export.
3. This landing repairs the Expo process-group proof after a cooperative exit
   begins before the first stop signal. Expo removes its supervisor descriptor
   before stopping Metro; the packed fixture observes that removal and exits.
   macOS then presents the same PID/start-time/PGID with command `(node)` or
   `<defunct>`, which permanently discharges signaling authority. The guarded
   stop previously returned at once and therefore never observed the group
   become empty. It now uses the existing grace window for observation only in
   that pre-signal discharged state. It never signals the discharged numeric
   group and still releases the durable cleanup lease only after the accepted
   `stopped` proof.

The exact packed lifecycle suite passed twice after all three repairs, each
run reporting `tests 1`, `pass 1`, `fail 0`:

```text
$ TMPDIR=/private/tmp/snapback-bun-tmp BUN_TMPDIR=/private/tmp/snapback-bun-tmp \
  BUN_INSTALL_CACHE_DIR=/private/tmp/snapback-bun-cache \
  SNAPBACK_RUNTIME_BINARY=<bootstrap-qualified binary> \
  node --test packages/snapback-cli/packed-dev-lifecycle.test.mjs
ℹ tests 1
ℹ pass 1
ℹ fail 0
```

Two reproduction notes for anyone re-deriving this red:

- In a worktree without a bootstrap-qualified native runtime the suite aborts
  early with `packed lifecycle proof requires the bootstrap-qualified native
  runtime`. That is a precondition failure, **not** this ticket's defect; point
  `SNAPBACK_RUNTIME_BINARY` at a qualified binary before concluding anything.
- An `EMFILE: too many open files` in the Vite arm is a sandbox file-descriptor
  limit, not a product defect. It does not reproduce outside the sandbox with
  `ulimit -n 65536`.
