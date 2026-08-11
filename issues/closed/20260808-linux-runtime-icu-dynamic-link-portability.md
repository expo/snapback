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

## Resolution — 2026-08-08

The successor runtime mechanism bundles every non-baseline shared-library
dependency from the native Linux builder into the package `lib/`, links the
executable with transitive `$ORIGIN/../lib` `DT_RPATH` via
`--disable-new-dtags`, and enables Ibex's `sfe-static-network` feature so curl
and OpenSSL are static rather than consumer-host requirements. A pure-JavaScript
ELF64 allowlist gate fails closed during `prepare-runtime.mjs`,
`scripts/build-linux-runtime-release`, the EAS qualified-staging Linux build,
and `packages/snapback-runtime-linux-x64/package.test.mjs`; attestation v3 and
the package seal bind the complete transported `lib/` closure.

### 0.1.15–0.1.17 fast-path era note — 2026-08-10

The fleet's fast-path releases moved `latest` to 0.1.17 while this fix was in
flight. The published 0.1.17 `lib/libhermesvm.so` links `libicuuc.so.74` /
`libicui18n.so.74` (that cut's builder carried ICU 74, not 78), so severity
dropped from "unlaunchable on stock consumer hosts" to "unlaunchable on hosts
older than the ICU-74 line": Ubuntu 24.04-class hosts now work, but Ubuntu
22.04 (ICU 70) and Debian 12 (ICU 72) consumers still cannot launch, and
nothing before this fix pinned the linkage — the next cut would regress to
whatever ICU its builder happened to carry. The bundling mechanism plus the
fail-closed soname allowlist gate above closes the class, not the instance.

### Verification — 2026-08-10

Full production path run on `expo-build-1000` at the landed mechanism
(`scripts/build-linux-runtime-release`): the bundler shipped
`libicuuc.so.74`, `libicui18n.so.74`, `libicudata.so.74` (transitive), and
`libz.so.1`; `bin/snapback` carries `(RPATH) $ORIGIN/../lib` with no
`libcurl.so.4` NEEDED (static curl). In a bare `ubuntu-base-24.04` rootfs
under proot — zero `libicu*`, zero libcurl, the environment where both
published 0.1.14 and 0.1.17 cannot load — the packaged binary launches
(`snapback 0.1.0`, exit 0), with `LD_DEBUG=libs` showing every non-baseline
resolution served from the package `lib/`. `package.test.mjs` passes against
the real seal, and the cross-host (darwin) assembly path validated the v3
attestation and re-sealed the transported closure. The gate refuses the
actual published 0.1.14 tarball with six violations (negative control).

A bare `ubuntu-base-22.04` rootfs still refuses the binary — but now purely
on `GLIBC_2.38/2.39` version symbols (every soname resolved); that is the
builder-glibc floor documented as residual exposure in LLP 0041 and tracked
in `issues/20260810-linux-runtime-glibc-symbol-version-baseline.md`.

This ticket **REMAINS OPEN** until a successor version ships through the full
ceremony and its `latest` promotion completes.

## Closure — 2026-08-11

The open condition — "a successor version ships through the full ceremony and
its `latest` promotion completes" — is met. Qualified 0.1.18 (candidate
`2d28570daa14`, `release/qualified-0.1.18`) ships the self-contained runtime
this ticket's mechanism built: bundled ICU closure in package `lib/`,
`$ORIGIN/../lib` RPATH, static curl/OpenSSL, and the fail-closed ELF soname
allowlist gate in every staging path. The leased promotion completed
(operation `release-0.1.18-20260811-r12`, epoch 15, `promoted-and-closed`,
receipt at `tests/acceptance/publication/promotion-receipt-0.1.18.json`) and
`latest` is 0.1.18 for all eleven packages — including
`create-snapback-app`, whose broken 0.1.14 first-publish `latest` exposure is
thereby retired. The post-promotion hosted proof (runs 31449958810 /
31451683450) launched the published `@expo/snapback-runtime-linux-x64` on a
stock GitHub-hosted runner — the exact consumer-shaped launch that refused
0.1.14 — green.

Residual exposure stays where it was already filed: the builder-glibc symbol
floor (Ubuntu 22.04-class hosts) is
`issues/20260810-linux-runtime-glibc-symbol-version-baseline.md`, not this
ticket. Closed.
