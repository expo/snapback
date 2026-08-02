# PocketBase × Snapback npm bakeoff

Two independent React incident-room applications built on 2026-08-01:

- `pocketbase-incident-room/` — PocketBase server 0.39.9 with the public
  `pocketbase` npm SDK 0.27.0.
- `snapback-incident-room/` — the complete public `@expo/snapback-*` 0.1.8
  closure, including `@expo/snapback-vite@0.1.8`; no workspace imports.

The shared workout covers authenticated identities, scoped data, relations,
indexed search, realtime messages, server-derived authorship, a transactional
incident acknowledgement plus activity row, files, presence, and scheduled
work. Each implementation uses its backend's native model rather than a shared
adapter.

## Reproduce

PocketBase (downloaded binaries and data are intentionally ignored):

```sh
cd pocketbase-incident-room
npm install
# Download PocketBase 0.39.9 to .pocketbase/pocketbase, then:
npm run migrate
npm run build
npm run test:acceptance
```

Snapback (all runtime packages arrive through npm):

```sh
cd snapback-incident-room
npm install
npm run generate
npm run typecheck
npm run build
npm test
npm run test:live
```

## Result

PocketBase passes 6/6 headless checks. Snapback passes six positive checks and
one explicit expected-GAP check: `createAssetClient(...).start()` sends a dev
user but the authenticated upload intent refuses with
`SNAPBACK_AUTH_REQUIRED` on 0.1.8. The Snapback UI renders that limitation
instead of claiming attachments work.

| Fact | PocketBase | Snapback |
| --- | ---: | ---: |
| Approx. active build/debug time | 8 min | 12 min |
| Authored source | 571 lines / 3,532 words | 559 lines / 2,499 words |
| npm dependency tree | 79 packages / 93.9 MiB | 137 packages / 195.0 MiB |
| Extra backend binary | 30 MiB | included above |
| Production JS bundle | 231.6 kB | 456.2 kB |
| npm audit | 0 | 0 |
| Final headless acceptance | 0.38 s | 1.58 s |

These are one local Apple-silicon run, not throughput benchmarks. Model token
telemetry was unavailable. Authored word count is retained only as a rough
source-token proxy; it does not measure the reasoning/context tokens spent.

The full chronology and comparison are in
`../../diaries/0050-pocketbase-snapback-npm-bakeoff.diary.md`.
