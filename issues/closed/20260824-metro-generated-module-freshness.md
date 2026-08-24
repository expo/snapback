# Metro keeps stale hashed generated modules after codegen rotation

**Status:** Open
**Opened:** 2026-08-24
**Systems:** CLI, Supervised Expo dev loop, Code generation, React/Expo
**Related:** LLP 0299, LLP 0301, LLP 0306 (chip-away B9, idea 2), LLP 0114,
`benchmarks/runs/2026-08-23-clique-published-0125-sol-high/record.md`

## Problem

Every schema/function edit rotates the content-addressed generated modules
(`app.descriptor.*`, `app.binding.*`, digest-named descriptor files). Nothing
on the supervised `--expo` path invalidates Metro when that happens, so hot
reload frequently keeps serving the old descriptor and the app fails with
`SNAPBACK_REACT_BINDING_MISMATCH` until the agent kills and restarts Metro.
The published-0.1.25 Clique pair (LLP 0306) restarted Metro about twelve
times in Familiar M3 alone; both lanes learned "kill Metro" as a ritual.

Verified on main at `9a782983d` (2026-08-24) — with one correction from the
LLP 0307 review round:

- The only regeneration reaction in the supervisor is a binding remint
  published to the bootstrap exchange
  (`packages/snapback-cli/expo-dev.mjs:2798-2822`); nothing touches Metro.
- The Metro spawn (`packages/snapback-cli/expo-dev.mjs:1743-1771`) passes no
  cache flags and is never re-invoked after codegen.
- **Correction (2026-08-24 review):** the stable alias `app.binding.mjs`
  *does* change bytes on rotation — `renderAppBindingAlias`
  (`packages/snapback-codegen/index.mjs:16625-16632`) embeds the
  digest-named specifier in its re-export line and the alias is rewritten
  on every generation (`:21866`). So "make the alias bytes change" is
  already implemented and is NOT the missing mechanism. The root cause of
  the observed staleness is undiagnosed.
- The Vite arm got a hot-load binding refresh (`e98961ad3`) and
  `packages/snapback-client/react-binding-hmr.mjs` re-admits after the bundler
  replaces a module — but nothing verifies Metro replaces it.
- LLP 0299 is silent on bundler caching; this is explicitly outside its
  scope ("0299 does not make Metro drop `app.descriptor.*`", LLP 0306 §B9).

## Impact

The paved supervised loop's day-2 story (edit schema → regenerate → keep
working) silently breaks at the bundler layer. Agents burn wall clock and
context on restart festivals and misattribute the failures to the product.
This is one of the four remaining cost-shape items LLP 0306 names for the
next full published pin.

## Direction

**Diagnose first, then invalidate — do not implement around an unconfirmed
mechanism.** The alias bytes already rotate, so the staleness lives
somewhere else. Reproduce under supervised Metro (`snapback dev --expo`,
shipped `expo-chat` template), regenerate, and compare the alias file's
bytes/mtime against what the served bundle actually contains. Candidate
mechanisms to distinguish:

- Metro's watcher does not cover `snapback/generated/` in the template's
  configuration (projectRoot/watchFolders), so no rewrite is ever seen;
- new-file detection: the digest-named module is a *created* file each
  rotation; Metro's haste map/watcher may treat creations differently from
  modifications of already-resolved modules;
- the rewrite is seen but hot reload does not re-run the import chain
  (no HMR boundary accepts the change → a full refresh is required but
  never triggered), leaving the old hydrated descriptor live in the app;
- `app.descriptor.json` (a JSON asset) caching independently of the module
  graph.

Whatever the repair, it must preserve the atomic generated-graph
publication boundary (the digest-named module remains the sole hydrated
binding; no partially-written graph may become importable).

## Acceptance

- With `snapback dev --expo` supervising a running Metro, an authored
  schema/function edit followed by regeneration produces a client that admits
  the new descriptor identity without killing Metro, on the shipped
  `expo-chat` template.
- A packed-template test (or supervised-loop test in
  `packages/snapback-cli/expo-dev-loop.test.mjs`) proves the served bundle
  reflects the successor descriptor identity, not just the exchange and the
  filesystem.
- `SNAPBACK_REACT_BINDING_MISMATCH` remediation text names the freshness
  mechanism instead of implying a Metro restart.

## Resolution (2026-08-24, lane H)

Diagnosed mechanism: Metro-wide watcher disablement inherited from `CI=1`
("Metro is running in CI mode, reloads are disabled") — not watcher
coverage, not alias bytes (which already rotate), not HMR propagation, not
descriptor-asset caching. Proven byte-for-byte on a shipped scaffold:
identical served bundle SHA across a regeneration with
`X-Metro-Files-Changed-Count: 0` while alias/digest/descriptor all rotated
on disk. Independently corroborated by the published-0.1.26 Q-a probe via
`SNAPBACK_EXPO_METRO_WATCH_INERT` (`ci-environment` cause).

Repair: the supervisor now always strips `CI` from its owned Metro child
(`expoMetroChildEnvironment`) — the supervised loop is a watch custodian by
contract (LLP 0241 D6); the watch-inert advisory now assesses the actual
child environment; the false CLI-side CI advisory is suppressed for
`--expo`; `SNAPBACK_REACT_BINDING_MISMATCH` timeout remediation is
bundler-neutral and points at the watch-inert advisory for the cases where
a restart is still needed. The supervised loop test proves the same Metro
PID serves the successor identity after an authored edit.

Residual (advisory-covered, not blocking): watcher-blind roots such as
`/private/tmp` still cannot watch (`watcher-blind-root` advisory names the
move); no non-CI, watcher-visible staleness has been observed — if one
appears it is a new ticket. The dual review (grok READY; codex's two copy
findings fixed in the landing) and the orchestrator's outside-sandbox test
runs back this closure; `expo-dev-loop.test.mjs`'s environment red is
pre-existing at unmodified main (identical failure at base).
