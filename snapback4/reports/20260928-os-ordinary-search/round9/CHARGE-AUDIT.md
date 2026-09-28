# Composition charge audit

The blocking product change is confined to local-search.ts. With R retained
IDs and C current IDs, it rejects C > R before subset work, reserves a Set of
retained IDs, and charges R + 2C steps (build candidates, validate membership,
build suppression). It retains the existing current-Set heap reservation and
adds the retained-Set reservation. At R=C=100 that is 300 steps instead of
1,360,100; at 86 it is 258 instead of 1,005,942. ID decoding/serialization still
pays its byte reservations. The per-page ceiling remains 1,000,000 steps.

Every other coordinator charge was inspected:

| Work | Charge driver / audit |
| --- | --- |
| Stream decode and buffering | Each received byte once, plus a constant per chunk; text() reserves heap and steps before retention. |
| Input/argument/cursor binding | jsonBound visits nodes/keys; serialized-size upper bounds scale with actual string lengths, not page-pair products. Cursor is capped at 4,096 bytes. |
| Audience validation/digest | Scope count plus serialized scope bytes and SHA blocks; no pairwise membership search. |
| Current/Left scope disjointness | Set creation plus membership probes, scopes.length + left.length steps and scope-sized heap. |
| Retained candidate request | One map over local.data, bounded by limit + 1, plus ID serialization bytes. |
| ID overlap subset | Fixed here: R + 2C, two page-sized Sets; no Array.includes inner scan or 136-byte maximum comparison price. |
| Merge order | Two steps per mixed comparison; ties pay actual ID lengths. Each iteration consumes one source row; no constituent refill. |
| Suppression/page deduplication | Two hash lookups priced by actual ID length per consumed row; page-sized output/seen storage. |
| Row output | jsonBound node/key walk plus that emitted row's bytes, once per emitted row. |
| Consumed source and combined cursors | Bounded descriptor/ID bytes per consumed row, one combined serialization at return. |
| Ledger resume | Fixed seven counters, monotone; the local scan and both state observations share the same allowance. |

Adjacent Rust composition charges were also read: device/search.rs prepays
retained-group decoding and digests from serialized bytes (32× heap, 3× steps),
plus fixed identity work and byte-linear output. Server search_overlap performs
one authorized point read per supplied ID, charges actual ID/table bytes and
ordinary point-read work, and checks limit + 1 before the loop. No other
product-of-page-count charge was found. This is a scoped charge audit, not a
claim that every underlying index operation is constant-time.

The tight comparison regressions now include one additional step for building
the single retained candidate Set when C=0. Removing the subset charge, time
comparison charge or tied-ID charge fails those boundaries independently.
