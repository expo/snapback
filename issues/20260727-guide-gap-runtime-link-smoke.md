# Guide gap: doctor misses exact runtime link failures

**Status:** Open  
**Impact:** 5  
**Urgency:** 5  
**Ease:** 3  
**Confidence:** 5  
**Severity:** P1  
**Labels:** guide-gap, developer-experience, ibex  
**Systems:** Runtime bootstrap, Diagnostics, Packaging, Developer experience, Guide  
**Author:** Codex, directed by Charlie Cheever  
**Date:** 2026-07-27  
**Related:** Diary 0022, LLP 0010, LLP 0031, LLP 0041,
`issues/20260727-vendor-ibex-advance-blocked-on-compat-abi.md`

During the backend bakeoff, bootstrap had previously validated a runnable
binary, but a later source-checkout rebuild failed to link:

```text
ex_hermes_create_no_eval
ex_hermes_watch_time_limit
ex_hermes_unwatch_time_limit
```

`scripts/ibex-doctor` reported healthy because it checked prepared runtime
state rather than whether this checkout could produce and launch the exact
Cargo binary. The older binary remained runnable and was honestly classified
`stamp-mismatch`, but the author had to infer the safe override manually.

## Desired resolution

- Add a disposable exact-link probe using this checkout's Cargo target,
  features, build script, libraries, and toolchain. Static file presence and
  launching an older binary do not satisfy it.
- Preserve the read-only doctor contract by building only in an automatically
  cleaned temporary target directory, or amend the governing contract
  explicitly if a different custody model is chosen.
- Return a stable nonzero `SNAPBACK_*` diagnostic with missing symbols and
  exact producer inputs when the consumer link fails.
- Distinguish “validated binary is runnable” from “current checkout is
  buildable”, and launch the newly linked probe before reporting success.
- Emit one structured recovery record naming selected binary, selection rung,
  expected commit/dirty state, actual stamp, reuse skip/failure reason, and
  exact safe repair or `SNAPBACK_SERVER_BINARY` override.
- Surface the same record through bootstrap, `snapback doctor`, `snapback dev`,
  and demo/server-process helpers. Add guide troubleshooting and capability
  coverage.

## Acceptance

- A fixture with present Hermes artifacts but absent compatibility symbols is
  diagnosed before an app harness attempts an opaque rebuild.
- Diagnostics name all missing symbols, the runnable stale binary if one
  exists, why automatic reuse was refused, and safe next actions.
- Green state proves exact link plus launch with dynamic-loader overrides
  scrubbed. Temp output is cleaned on success, failure, signal, and timeout.
- Existing packaged-doctor vertical-slice, bootstrap codes, binary-identity
  classification, and explicit override behavior remain compatible.

The vendor ABI repair is tracked separately; this ticket owns detection,
explanation, and recovery.
