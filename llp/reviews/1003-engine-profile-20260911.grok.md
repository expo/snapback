# Snapback2 engine-profile correction — grok

**Date:** 2026-09-11
**Model / effort:** grok-4.6 / xhigh; reported grok-4.6-build
**Runtime:** grok-cli 1.0.25; session 01a0911d-79e6-7b00-b9f8-7dd28ad36db6
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

I'll review only this Snapback2 integration delta: start with `effect-profile.patch`, then the directly related candidate files, and stay within the three-read limit.The workspace is a focused review pack. I’ll read `effect-profile.patch` first, then only the candidate files that delta actually changes.The first hunks are in. I’ll read the rest of the patch, then only the candidate files those hunks actually touch.The patch is small; next I’ll read only the matching candidate sources around the new two-profile check, tests, and LLP 1003 wording.A leftover test around `EFFECT_GLOBALS` may still assume `DebuggerInternal` is always present. I’ll read that and the LLP wording next.The `EFFECT_GLOBALS` entry is now an identifier, not a string. I’ll check the compiler test that parses that list so a profile mismatch doesn’t slip through.The compiler parser still only reads quoted names, so that path looks safe. I’ll check LLP 1003’s hardening language for a contradiction with the two-profile host surface.**READY**

No introduced material findings.

The host now admits exactly two post-hardening surfaces: `EFFECT_GLOBALS` as-is, or that same list with only `DebuggerInternal` removed. Presence of that name builds the debugger expected list; absence drops only that one entry. Every other required name, including `Intl`, `fetch`, and `__ibex2_fire_timer`, is still mandatory. Unexpected names still fail `names != expected` and are still reported against the full `EFFECT_GLOBALS` set. There is no optional-global table, compiler allowlist change, or runtime flag.

`verify_globals` still runs after `harden()` and before isolated authored install. The frozen check is unchanged: `Object.isFrozen(globalThis)` must be `"true"`. Prelude cleanup still uses the same serialized `EFFECT_GLOBALS` list.

The runtime test builds a real engine and accepts only those two vectors. The pure test accepts both lists and rejects an unknown name plus missing `Intl` / `fetch` / `__ibex2_fire_timer`. LLP 1003 §1 matches this: two exact host surfaces, `DebuggerInternal` stays off the authored allowlist, other missing required names and unexpected survivors still refuse construction.

**Inspection limits.** This was a one-pass read of `effect-profile.patch` and the delta-facing code in `candidate/` (`ibex.rs` verify/build path, `ibex_tests.rs`, LLP 1003 §1/§3, the compiler `EFFECT_GLOBALS` quote parser, prelude allowed-global cleanup). No builds, tests, remotes, parent directories, or peer-review output.

