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

Verified still true on main at `9a782983d` (2026-08-24):

- The only regeneration reaction in the supervisor is a binding remint
  published to the bootstrap exchange
  (`packages/snapback-cli/expo-dev.mjs:2798-2822`); nothing touches Metro.
- The Metro spawn (`packages/snapback-cli/expo-dev.mjs:1743-1771`) passes no
  cache flags and is never re-invoked after codegen.
- The codegen artifact inventory (`packages/snapback-codegen/index.mjs:8512`)
  emits no stamp/invalidation-shaped artifact; the stable alias
  `app.binding.mjs` re-exports the digest-named module, so the alias's
  *import target* changes while its own path stays cached.
- The Vite arm got a hot-load binding refresh (`e98961ad3`) and
  `packages/snapback-client/react-binding-hmr.mjs` re-admits after the bundler
  replaces a module — but nothing makes Metro replace it in the first place.
- LLP 0299 is silent on bundler caching; this is explicitly outside its
  scope ("0299 does not make Metro drop `app.descriptor.*`", LLP 0306 §B9).

## Impact

The paved supervised loop's day-2 story (edit schema → regenerate → keep
working) silently breaks at the bundler layer. Agents burn wall clock and
context on restart festivals and misattribute the failures to the product.
This is one of the four remaining cost-shape items LLP 0306 names for the
next full published pin.

## Direction

Treat generated identity like CSS: invalidate, don't restart. Candidate
mechanisms (owner to choose):

- a stamp file in `snapback/generated/` that the shipped template's Metro
  config watches, so rotation triggers a rebuild of the alias graph;
- supervisor-driven Metro cache invalidation (Metro exposes
  `--reset-cache` only at spawn, so this likely means template
  `metro.config.js` wiring plus a file-watch nudge rather than a supervisor
  RPC);
- making the stable alias the only imported module and having codegen rewrite
  its bytes on rotation (bytes change → Metro's ordinary file watch picks it
  up), instead of an alias whose bytes are stable while its target rotates.

The third option looks smallest: Metro already watches project files; the
problem is precisely that the alias file's bytes do not change when the
digest-named target rotates.

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
