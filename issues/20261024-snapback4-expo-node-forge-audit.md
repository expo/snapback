# Expo starter audit remains red on unpatched node-forge

Status: Open
Scope: Snapback 4 pinned Expo development toolchain
Found: DX9 wave-26 packed starter qualification, 2026-10-24

All twelve starter variants typecheck/build. All seven web variants have a clean
npm audit after pinning Vite 8.3.5 and SDK undici 8.12.2. The five Expo variants
still report one underlying high advisory, GHSA-86w9-cpqp-85rv, in node-forge
(range `*` in the current npm audit). npm reports five affected packages through
Expo's code-signing dependency chain. The current latest node-forge is 1.4.0;
no patched release was available during qualification.

DX9 pins patched zod 4.6.7 and decode-uri-component 0.5.1 overrides; they remove
the other observed Expo advisories and pass the installed builds. Qualification
now includes development dependencies and fails on any remaining advisory.
Do not waive the forge finding, hide development dependencies, or claim clean
Expo qualification. Revisit when Expo/code-signing dependencies or node-forge
supply a compatible patch; rerun all packed starter audits and builds.

Evidence: [packed starter results](../snapback4/reports/20261024-dx9/starters.json).
