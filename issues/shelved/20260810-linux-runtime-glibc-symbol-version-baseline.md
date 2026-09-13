# Linux runtime portability gate covers sonames, not glibc symbol-version baselines

**Status:** Open
**Impact:** 3
**Urgency:** 2
**Ease:** 3
**Confidence:** 5
**Systems:** Linux packaging, Release
**Date:** 2026-08-10
**Related:** `issues/20260808-linux-runtime-icu-dynamic-link-portability.md`,
LLP 0041 (§Linux runtime self-containment — 2026-08-08)


## Triage (2026-08-26 leftover sweep)

Still open. Related ICU/libcurl consumer fix closed in `issues/closed/20260808-linux-runtime-icu-dynamic-link-portability.md`. This ticket is the remaining `.gnu.version_r` / `GLIBC_*` floor. Also cited by `issues/shelved/20260821-f3-npm-closure-linux-artifact-blocker.md`.

## Finding

The ICU/libcurl fix makes the published Linux runtime self-contained against
an explicit host-soname allowlist, and the ELF gate refuses any produced
binary that needs a non-baseline soname. Verified 2026-08-10 in a bare
`ubuntu-base-22.04` rootfs (proot on `expo-build-1000`): every soname now
resolves — and the launch still fails, purely on version symbols:

```
/pkg/bin/snapback: /lib/x86_64-linux-gnu/libc.so.6: version `GLIBC_2.38' not found
/pkg/bin/snapback: /lib/x86_64-linux-gnu/libc.so.6: version `GLIBC_2.39' not found
```

A binary built on a glibc-2.39 builder (Ubuntu 24.04 class, including
`expo-build-1000` and the current EAS image family) cannot run on glibc
2.35 hosts (Ubuntu 22.04) or Debian 12 (2.36), regardless of bundling —
glibc itself cannot be bundled beside a host `ld-linux`.

## Resolution paths (pick one when 22.04-class support is wanted)

1. Build the release on the oldest supported distro (or a manylinux-style
   sysroot / zig cc–style `--target x86_64-linux-gnu.2.35`), keeping the
   soname gate as-is.
2. Extend the ELF gate to also read `.gnu.version_r` and refuse
   `GLIBC_*`/`GLIBCXX_*` version references above a declared floor, so the
   floor at least becomes an explicit, gated claim rather than an accident
   of the builder image.

Until then the honest support statement is: hosts at or above the builder's
glibc line (Ubuntu 24.04-class as of 0.1.17-era builds). LLP 0041 records
this residual exposure.
