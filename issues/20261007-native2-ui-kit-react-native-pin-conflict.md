# Native.2 UI kit can install RN 0.86.2 beneath the required RN 0.86.3

**Opened:** 2026-10-07, Lane P3 Round 2
**Status:** Open
**Area:** Native benchmark kit / dependency admission
**Related:** LLP 0201.000; `snapback4/reports/20261005-ni-native-protocol/PHASE-2-RERUN-RESULTS.md`

Convex's revision-11 prepared-source audit refused handoff because the effective
React Native pin could not be established. The root app pins 0.86.3, but the
unchanged supplied `ui/package.json:22` pins 0.86.2 as a development dependency.
Convex's `vendor/ui/node_modules/react-native/package.json` actually contains
0.86.2, and the root lock records it. UI runtime source imports `react-native`.
Metro's default hierarchical lookup can reach this nearer installation; the
auditor did not establish an effective deduplication rule for this app.

The supplied README says these dependencies are for typechecking and runtime
React Native comes from the app. The installed closure does not enforce that
intent. Both builders received the same kit. Snapback 4's retained custody has
the same development pin but no nested RN installation under `vendor/ui`.
Neither this refusal nor a source lookup proves which RN bytes an unexecuted
Convex Release build would have loaded. No operator build or native measurement
was run after the refusal.

Retain the audit; do not remove dependencies from custody or override the gate.
Prepare a new kit/candidate that aligns its development pin and enforces one
runtime resolution for file-linked consumers. Add a fresh-install dependency
resolution regression for root and UI imports, inspect the exported native
module graph, and repeat affected qualification and independent-app handoffs.
This is a shared-kit integration finding, not a demonstrated Convex backend
failure. Evidence is archived on eb1000 under
`~/sb5-evidence-archive/20261007-p2rerun/convex-rerun/prepared-source-audit/`.
