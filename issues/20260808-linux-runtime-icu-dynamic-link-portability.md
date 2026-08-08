# Published Linux runtime links libicuuc.so.78 — unlaunchable on stock consumer hosts

**Status:** Open — blocks the 0.1.14 latest promotion (rolled back cleanly)
**Impact:** 5
**Urgency:** 5
**Ease:** 3
**Confidence:** 5
**Systems:** Ibex/Hermes, Linux packaging, Release, Hosted proof
**Date:** 2026-08-08
**Related:** LLP 0041 (promotion), LLP 0010 (bootstrap codes),
`issues/20260803-linux-hermes-release-carrier-gap.md` (ICU-family precedent),
`tests/acceptance/publication/candidate-0.1.14.json` (the affected candidate)

## Finding

The first full qualified ceremony (candidate `fc8861589`, published as
0.1.14 under `bakeoff-0-1-14-fc88615895cb`) was refused at the final
leased `latest` promotion by the hosted public proof
(`public-package-proof.yml` run 31246917408): the published
`@expo/snapback-runtime-linux-x64` binary fails to launch on the
`expo-small` runner with

```
error while loading shared libraries: libicuuc.so.78:
cannot open shared object file: No such file or directory
```

(`SNAPBACK_IBEX_RUNTIME_LOAD_FAILED`, exit 127, dynamic-loader overrides
scrubbed — the exact consumer-shaped launch the proof exists to model.)
The darwin platform proof passed. The promotion executed a complete
reverse rollback (receipt `snapback.package-promotion-receipt.v1`,
operation `release-0.1.14-20260808-r3`, epoch 3, all 10 rollback events
ok) and `latest` remains 0.1.13 for every previously published package.

## Why

The EAS `linux-large` builder (image sdk-57) carries ICU 78 and the
runtime links it dynamically. Stock consumer distributions ship older
sonames (Ubuntu 24.04: ICU 74; 22.04: ICU 70; Debian 12: ICU 72), so
the published binary only runs on hosts that happen to have ICU 78. The
EAS *staged* proofs pass because the proof runners share the builder's
image family — the mismatch only appears on a differently-provisioned
host, which is precisely the hosted proof's job to catch.

Note the seal/qualification on `expo-build-1000` (Ubuntu 24.04) used a
locally built binary linking the local ICU and cannot catch this class.

## Exposure

- `create-snapback-app@0.1.14` is a FIRST publish, so npm auto-set its
  `latest` and there is no prior to roll back to. Consumers running
  `npm create snapback-app` today get 0.1.14, which installs
  `@expo/snapback-cli@0.1.14`; on Linux hosts without ICU 78 the runtime
  will not launch. Darwin consumers are unaffected.
- All other packages' `latest` remains 0.1.13.

## Resolution path

1. Make the Linux runtime ICU-independent: static ICU, bundled/vendored
   ICU with rpath, or build against the oldest supported soname. This is
   a build.rs / Ibex build-profile decision — coordinate with the Hermes
   carrier work (the prebuilt Hermes closure has the same ICU family
   question).
2. Add a portability check to `scripts/build-linux-runtime-release` and
   the staging workflow: `objdump -p`/`ldd` allowlist on the produced
   ELF (refuse sonames outside the supported baseline) so this never
   reaches a published closure again.
3. Cut the successor version through the now-proven ceremony (staging →
   publish → leased promotion), which will also give create-snapback-app
   a working `latest`.

## Ceremony state for the successor operator

Ceremony infrastructure is fully proven through rollback: EAS
provenance receipts validate, telemetry exact-current gate passes at the
frozen candidate, authority lease v4/epoch-3 issue+acquire+close all
worked, tag moves + reverse rollback verified live. Reusable state:
release branch `release/qualified-0.1.14` (pinned candidate + fixes),
receipts in `~/snapback-qualified-0.1.14/`, candidate ledger committed
at `tests/acceptance/publication/candidate-0.1.14.json`, promotion
receipt + post-vector in `/tmp/rel/` on the ceremony host.
