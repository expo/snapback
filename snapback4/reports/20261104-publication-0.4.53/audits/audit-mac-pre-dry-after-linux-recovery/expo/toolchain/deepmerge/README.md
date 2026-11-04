# Expo configuration merge patch

Local MIT fork of deepmerge 4.3.1, used only by the Expo build toolchain.
Upstream: https://github.com/TehShrike/deepmerge
Advisory: https://github.com/advisories/GHSA-gcqx-w48m-w2h4

Reject __proto__, constructor and prototype keys in both copy loops, define own
data properties instead of invoking setters, and refuse unknown target-property
membership. Arrays, customMerge, arrayMerge, symbols and TypeScript declarations
retain the upstream API. Keep this directory with package.json's local override;
replace it only with a verified upstream fix and rerun the toolchain proofs.
