# Clique setup: isolate Expo transforms before concurrent backend exports

**Date:** 2026-09-08 · **Area:** benchmark environment / Expo web export

The published019 M7 attempt aborted after its exported ClientProvider embedded
fallback-assessor port53126 while direct app helpers used assigned53130. Its
browser actually read assessor data. This is an environment-isolation failure,
not an established Snapback engine caching or auth-generation defect.

[Incident evidence](../benchmarks/runs/2026-09-08-release-cold-headroom/m7-aborted.md)
records the exact bundles, unchanged provider source, overlap and claim limits.
The fallback had separately recovered from an export embedding old53123 by
using `--clear`; its final53126 bundle did not prevent later external access.

Installed Expo stores transforms in `os.tmpdir()/metro-cache` and substitutes
production `EXPO_PUBLIC_*` values during transformation. Shared-cache reuse is
consistent with the observed mixed bindings; cache key/write history was not
traced. Do not claim that mechanism was conclusively reproduced.

This run's clean retry uses a private temporary cache and supported
`expo export --clear`, and checks active backend bindings before navigation.
Its untouched-source export and actual headless launch passed before the
fresh author clock. No shared cache was deleted and no frozen instrument was
changed. The generic launch/setup path still needs this isolation and an
explicit active-endpoint preflight when environments differ. Extend its
existing preparation; no additional blocking gate or registry is proposed.

Keep the aborted attempt and externally accessed fallback as diagnostic
records. A successful retry must not erase their clocks, failures or evidence.
