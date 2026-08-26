# packed-dev-lifecycle: `SNAPBACK_APP_BINDING_DECLARED_DEV_REFUSED` is red on pristine main

**Type:** Issue
**Status:** Open
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
