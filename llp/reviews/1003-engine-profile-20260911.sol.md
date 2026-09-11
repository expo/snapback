# Snapback2 engine-profile correction — sol

**Date:** 2026-09-11
**Model / effort:** gpt-5.6-sol / xhigh
**Runtime:** codex-cli 0.153.4
**Target:** `438dfa64cc8011302c2343a28333cbed62ae2d69`
**Base:** `a3976b8d98dd9b2b517dd53c736548683d728942`
**Source capsule SHA-256:** `1ea7e72f47167e9616564c1cd16a9a26cbe82039ac24c3f4478c9d8f06bcff0f`
**Patch SHA-256:** `2cdbb47ec4f92692b5e02b1c776465d61ce33e936655d8aac7812a88ea4d4daa`
**Method:** Fresh mutually blind, read-only, focused code review. No peer
findings, subagents, clones, builds, remote commands, web, or edits. This
review covers only the debugger/release global-profile correction. It does
not claim Linux Intl correctness or release qualification. The independent
native runtime check subsequently exposed the separate Intl publication
blocker retained in the release run record.

## Received review text

READY

No introduced material findings.

The delta admits exactly two ordered global profiles differing only by `DebuggerInternal`; all other missing or unexpected names still refuse. Frozen-global verification and pre-authored-code ordering remain intact. Tests cover the actual engine plus both pure accepted profiles and representative missing-required/unknown rejection. LLP 1003 accurately reflects the correction.

Inspection was limited to `effect-profile.patch` and directly relevant candidate regions. Per request, I did not run builds or tests.

