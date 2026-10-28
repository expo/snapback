# Snapback 4 Expo starter audit response changed on an identical dependency graph

Status: Open
Date: 2026-10-28
Scope: Snapback 4 publication starter toolchain; discovered during TOK3 packed consumers.

The optimized TOK3 packed starter proof stopped at the Expo npm-audit gate:
`@expo/cli: a fix is available; update the starter toolchain`.
The earlier packed run completed all six starters with zero findings. The two
Expo package locks contain **zero package-version differences**, including Expo
57.0.30. The later audit reports eight low findings rooted in deepmerge
[GHSA-gcqx-w48m-w2h4](https://github.com/advisories/GHSA-gcqx-w48m-w2h4),
with fixAvailable true on several ancestors. The empty allowlist correctly fails.

Reproduce from packed client/platform/Expo tarballs using
`node snapback4/scripts/publication-starters.mjs <client> <platform> <expo>`.
Capture npm audit JSON and compare the exact lock before changing dependencies.
TOK3 retains both responses and the version comparison in its report evidence.
No audit waiver or toolchain change was made. Publication remains unqualified;
resolve the dependency/advisory metadata through the existing toolchain policy.
