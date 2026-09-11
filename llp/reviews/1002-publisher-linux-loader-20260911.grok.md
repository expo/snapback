# Linux x64 publisher loader correction — Grok code review

**Date:** 2026-09-11
**Model / effort:** grok-4.6 / xhigh
**Session:** `01a0921a-76f0-7e30-9051-d49d10535c60`
**PID:** 25994
**Interval:** 2026-09-11T20:13:22Z–2026-09-11T20:16:01Z
**Exit:** 0
**Target:** `6c7f81aceeafa98b4fd064770adc25068b9e07bc`
**Base:** `5e2b6edcbd3b2ec398ce712750bdbc06d4e8b11a`
**Method:** Read-only bounded review, mutually blind with Sol. Only the
five-line patch and two publisher files were supplied. No peer findings,
subagents, clones, worktrees, remotes, web, edits, builds or tests. Public
response only; no private reasoning. Escaped newlines rendered for readability.

## Received review text

I'll review this exact Snapback delta myself: first the patch, then only the candidate publisher files as needed, without subagents or extra inspection.The review skill wants a subagent, which this request forbids, so I’ll review the delta in-process: patch first, then only the two candidate files as needed.The patch only admits `ld-linux-x86-64.so.2` and updates the ELF fixture. Next I’ll read the surrounding allowlist and the tests that still reject Hermes, ICU, and other loaders.**READY** for commit `6c7f81aceeafa98b4fd064770adc25068b9e07bc` versus parent `5e2b6edcbd3b2ec398ce712750bdbc06d4e8b11a`.

This delta only adds an exact-name allow for the ordinary glibc Linux-x64 loader and puts that name in the existing positive ELF self-test fixture. It does not loosen the rest of the Linux NEEDED allowlist.

## Material issues

None. No correction is required for this exact delta.

## Preservation

Linux media-helper qualification still walks `DT_NEEDED` names from `readelf -d` and rejects anything that fails `isSystemLinuxDependency` (`publish.mjs` 576–600). The new clause is exact equality (`publish.mjs` 582–584):

```javascript
name === "ld-linux-x86-64.so.2"
```

That is not a prefix, suffix, or `ld-linux*` regex.

- **Third-party shared Hermes/ICU:** names such as `libhermes.so`, `libhermes.so.0`, `libicuuc.so.72`, `libicui18n.so.72`, and `libicudata.so.72` still fail the existing `lib*.so` regex (they are not `libc` / `libm` / `libstdc++` / `libgcc_s` / `libpthread` / `libdl` / `librt` / `libutil` / `libresolv` plus `.so`) and are not the loader string, so they still throw `non-system dependency`.
- **Arbitrary loaders:** `ld-linux.so.2`, `ld-linux-x32.so.2`, `ld-linux-aarch64.so.1`, `ld-linux-armhf.so.3`, `ld-musl-x86_64.so.1`, path-qualified names, and version/suffix variants such as `ld-linux-x86-64.so.20` still fail both checks.
- **Admitted name:** only the exact SONAME `ld-linux-x86-64.so.2`.
- **Unchanged reject fixture:** `libheif.so.1` still throws (`publish.mjs` 978–984). Empty dynamic section still passes (`publish.mjs` 973–977).

No lower glibc/libstdc++ compatibility claim is made or implied by this change.

## Inspection limits

- Read `delta.patch`, then `isSystemLinuxDependency`, `elfDependencies`, `verifySelfContainedMediaHelper`, and the `runSelfTest` ELF fixtures in `publish.mjs`.
- Searched `publish.test.mjs`; it is not in the delta and has no ELF NEEDED / Hermes / ICU / loader cases.
- Did not re-audit the prior publisher, engine-binary dependency scanning, Darwin path, or qualification flow beyond this allowlist.
- Did not inspect peer review or session outputs, parent directories, remotes, or the duplicate `publisher-loader-delta.patch`.
- Did not clone, worktree, edit, build, or run tests.
- Implementer reports (self-test, 16 publisher tests, Ubuntu 24.04 native staging / 19 consumer steps) were not reproduced here.

## Optional suggestions

Not required for READY. The self-test now proves the Ubuntu-shaped positive case (`publish.mjs` 966–972) but still has only `libheif.so.1` as a Linux negative. A single extra `assert.throws` that includes `libhermes.so`, an ICU SONAME, and a non-x64/musl loader (`ld-linux-aarch64.so.1` or `ld-musl-x86_64.so.1`) would lock the preservation this review inferred from the predicate.

Do not treat this as publication authorization.

