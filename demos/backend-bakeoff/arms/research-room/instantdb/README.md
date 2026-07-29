# Research Room × InstantDB

LLP 0102 deep-round implementation of the frozen collaborative research-room
workload on InstantDB 1.0.52. The arm used a fresh official hosted temporary
app, three real Instant auth principals, linked-data permissions, Instant
Storage, InstaQL, atomic InstaML transactions, and backend
`subscribeQuery`/EventSource observation.

The final acceptance result is **11 PASS, 4 explicit GAP, 0 FAIL, 0 Stop**.
The GAPs are provider-native semantic retrieval, scheduling, the related
provider-hosted function/secret boundary, and immediate retirement of the
already-empty anonymous temporary app shell. See
`evidence/acceptance-results.json`.

## Reproduction

From `work/`, provision a new disposable target, then run:

```sh
npm install --ignore-scripts
node scripts/provision-target.mjs
npm run push
npm run seed
npm run accept
node scripts/measure-build.mjs
npm run build
node scripts/secret-scan.mjs
npm run cleanup
```

The scripts keep provider identifiers and tokens only under the ignored
mode-0600 `work/.arm-runtime/` directory. Cleanup validates the exact target
identity before destructive work.
