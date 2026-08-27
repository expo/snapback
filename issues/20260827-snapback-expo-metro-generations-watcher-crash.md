# Supervised Expo Metro crashes (ENOENT) on `.snapback/generations/.tmp-*` codegen transients — `SNAPBACK_EXPO_METRO_EXITED`

**Status:** Open
**Systems:** Dev loop, Expo/Metro supervision, Codegen
**Date:** 2026-08-27
**Related:** LLP 0030 (managed snapback/vite dev), LLP 0061 (guide; guide-gap),
LLP 0201 (social-messenger benchmark), grok-0127 run
(`benchmarks/runs/2026-08-25-clique-grok-0127/`)

## Symptom

During the supervised `snapback dev snapback --expo --expo-platform web` lifecycle,
the owner dies with `SNAPBACK_EXPO_METRO_EXITED`. The proximate cause is Metro's
watcher (FallbackWatcher) crashing with `ENOENT` while Snapback **atomically writes
and then removes** codegen transient files under `.snapback/generations/.tmp-*`.
Metro is crawling/watching that directory and races the atomic
rename/remove, throws ENOENT, and exits — taking the supervised dev loop with it.
It typically fires around an M1→M2 schema successor / codegen run in the running
lifecycle.

## Reproduction (cross-model, cross-run — this is not a one-off)

Surfaced independently by multiple autonomous lanes on published 0.1.29, both
authoring profiles, in the 2026-08-27 clique matrix:
- `sol-snapback-explicit`: run-log `event=error attribution=snapback-defect
  evidence="lifecycle Metro stderr ENOENT .snapback/generations/.tmp-* then
  SNAPBACK_EXPO_METRO_EXITED"`.
- `sol-snapback-familiar`: run-log `error | attribution=snapback-defect |
  evidence=supervised Metro FallbackWatcher crashed ENOENT while Snapback
  atomically removed .snapback/generations` → correction-loop `excluded
  .snapback/generations transient workspace from Metro crawl via metro.config.cjs`.
- Previously hit by the grok-0127 run (Snapback familiar M2:
  `SNAPBACK_EXPO_METRO_EXITED` — "Metro watch ENOENT on codegen `.tmp-*`"; owner
  had to be restarted on the existing sqlite). See that lane's final-report/diary.

## Impact

The supervised Expo dev loop — the primary authoring surface — dies mid-build and
must be manually restarted. It is a recurring, self-inflicted crash in the ruled
lifecycle (no wrapper, no destructive reseed), so agents cannot avoid it without
inside knowledge, and it costs a milestone-boundary restart each time.

## Workaround the lanes discovered

Add `.snapback/generations` (the transient codegen workspace) to Metro's ignore
set — `metro.config.*` `resolver.blockList` / `watchFolders` exclusion — so Metro
does not crawl/watch the dir Snapback churns.

## Wanted

1. Snapback's **generated `metro.config`** (and the supervised Expo bootstrap)
   should exclude `.snapback/generations` (and any other transient codegen scratch
   dirs) from Metro's watch/crawl **by default**, so the dev loop is crash-free out
   of the box. Alternatively, write codegen transients outside the Metro-watched
   tree, or make the atomic rename invisible to the watcher.
2. Guide-gap (LLP 0061 §5): the authoring-loop / familiar-profile pages should
   note this exclusion until (1) ships, since agents currently rediscover it by
   crashing.

## Evidence pointers

Lane run-logs under `~/clique-matrix-0129/lanes/{sol-snapback-explicit,
sol-snapback-familiar}/run-log.md` on `expo-build-450b`; grok-0127 cell
`benchmarks/runs/2026-08-25-clique-grok-0127/cells/grok-clique-familiar/`.
