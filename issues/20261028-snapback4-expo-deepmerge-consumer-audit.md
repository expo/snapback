# Expo deepmerge advisory blocks packed consumer qualification

Status: Open
Scope: Snapback 4 Expo starter development toolchain / publication
Found: CALLS1 packed Linux consumers, 2026-10-28

`qualify-linux.mjs --consumer-only` against packed 0.4.44 client and Expo
artifacts on `d1a921bb63` exited 1 in `evaluateStarterAudit`:
`@expo/cli: a fix is available; update the starter toolchain`.

The recorded npm report names deepmerge 4.3.1, GHSA-gcqx-w48m-w2h4, through
`@expo/config`. It marks `@expo/cli`, `@expo/metro-config` and
`@expo/prebuild-config` fixable, while marking deepmerge itself unfixable.
The latest npm deepmerge version was 4.3.1. The
[reviewed advisory](https://github.com/advisories/GHSA-gcqx-w48m-w2h4),
updated October 27, lists no patched release.

CALLS1 changed neither Expo dependency pins nor the audit policy/allowlist.
The existing exact metadata exception requires range `*` and immediately
unfixable children; this finding does not satisfy those conditions. No new
exception, dependency downgrade or weakened assertion was applied.

Reproduction: pack the client and Expo packages, then run
`node snapback4/scripts/qualify-linux.mjs --consumer-only --client CLIENT.tgz
--expo EXPO.tgz --out NEW_DIRECTORY` with absolute artifact paths, from the
repository root. Preserve the generated starter-expo/starter-audit.json.

Local retained evidence is under `target/calls1-evidence/consumer-results/`
and `target/calls1-evidence/logs/calls1-qualification-fixtures.log` in the
CALLS1 worktree. Its consumer-attempt.json is an explicitly failed report,
not a qualification receipt. Backend/proof/security/migration/staging consumers
and all generated frontend cases passed before this gate. The remaining starter
cases and clean-environment tail were not reached; no consumer.json was issued.

Resolution requires a compatible patched dependency path or a separately
reviewed policy decision covering this precise finding, followed by the full
packed consumer command. Until then retain the failing qualification result.
