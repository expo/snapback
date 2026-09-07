# Corrected ordinary Linux execution — carrier complete, Twin failed

Exactly two conditionally authorized invocations ran once each. **Carrier completed all three historical arms and both original comparisons. Twin failed in its baseline load phase; the pair stopped immediately without retry or repair.** The pair is not qualified.

| Invocation / arm | Child PID | Exit | Original supervisor arm time |
| --- | --- | --- | --- |
| carrier / baseline02a5 | 3568732 | 0 | 29.139432430s |
| carrier / carrier4fb | 3568866 | 0 | 27.941312144s |
| carrier / coverage47a7 | 3569039 | 0 | 28.514641740s |
| twin / baseline02a5 | 3569373 | 1 | 19.057575164s |

Carrier outer elapsed **86.097943759s**; supervisor/sampler3568725, outer3568724. Twin outer elapsed **19.392179912s**; supervisor/sampler3569366, outer3569365. Twin started only after the original carrier results were COMPLETE and both original comparison outputs verified stateEquality/populationEquality with no persisted fields omitted. Later Twin arms never launched. No timeout, memory/output protection stop or outer containment fired.

## First workload failure and completed assertions

Twin failed at unchanged `worker.mjs:42:284`, called from load's `sync()` at49:419:

```
AssertionError [ERR_ASSERTION]: The expression evaluated to a falsy value:

  assert(result.next?.startsWith('h1.'))
```

The actual next value was not logged, so no particular replacement value or product diagnosis is asserted. Its preceding result-existence, expected20 row IDs and capped-state assertions completed. The original500-page load/count assertions completed; retained backend JSON contains **10,000 rows,500 answers,one outbox entry**. Only the empty phase completed as a whole. Warm[0] was not executed, and no retained/warm/timed measurement, contradiction/atomicity check, populated replacement/reopen lifecycle or cross-arm comparison completed for Twin. Failure-path store cleanup is not a passed close lifecycle phase. The first failure, original stderr, backend and all emitted observations remain intact.

For **each of the three carrier arms**, all13 applicable phases completed: empty, load, retained, warm, timed, contradictions, publicationRollback, populatedReopen, removeOwners, purge, reopen, reset, close. This includes:

- All four unchanged negative cases (`contradiction`, `timedContradiction`, `unknownOrdinary`, `unknownTimed`) rejected with the original `/conflicting durable fact/` expectation, followed by exact canonical-state, persisted-backend-byte and outbox equality assertions for each case.
- Injected publication failure rejected under the original assertion, with the same three preservation checks and loaded-state alias isolation.
- Populated reopen preserved complete state/outbox and row population; ownership removal, purge, reopen and coverage reset assertions completed. Final persisted counts are zero rows/answers and one preserved outbox entry.
- Both original comparator processes passed complete canonical snapshot bytes, logical populations and carrier-index owner counts against baseline. No assertion or persisted-state field was omitted. Twin-only populated replacement was not applicable to carrier.

Warm snapshots have **501 answers** on all three carrier arms, as approved. These are results of the corrected fixture, not relabeled historical500-answer warm/timed measurements. All raw memory/timing samples are retained in original result/observation files. Sampling can miss transient peaks; after-GC/pre-audit memory and generic JSON backend/audit costs retain their original scopes. No capacity, latency or performance-equivalence conclusion follows.

## Exact source and assembly custody

Read the complete approved proposal/PATCH and original failed-run report/terminal before mutation. Both prior writers' actual exit0 receipts remain unchanged. Local intent preceded exclusive remote creation at:

`/home/ccheever/clique-tooling/search-resident-format5-linux-ordinary-contradiction-e17fee76`

The derivative is its `packet/`; outputs are `run/carrier/` and `run/twin/`. Each original command used the derivative's `executables/node` and unchanged `supervise.mjs --execute-population --fixture ordinary --mode carrier|twin --output <separate-absent-output>`, with cwd packet. Exact argv, start epochs, executable/start-tick identities and durable once/launch/terminal records are retained under results/run and local *-launch receipts. The original run-once.py was reused byte-for-byte (SHA256 `f9f165325399d188fde524399fdca4b1f125b1491f6792ba4fefccef977e37f3`).

Old Linux packet MANIFEST SHA256 **e1fd840712da9c00cdeeb952e2364b119107a88133b18edc3bb1379638339087** was verified across all512 leaves before assembly and again after execution. Copying used distinct inodes, with no overwrite of an existing destination. The parent manifest is retained separately in provenance/MANIFEST.parent-linux.json; original packet and failed attempt are untouched.

The new packet MANIFEST is the **exact approved** proposed manifest, SHA256 **4fdbac90dcc13fe192e89a44b3f6855da2df28f9ce179f26e6f01737c647b26b**. Its descriptive proposed-status metadata was retained verbatim; assembly-receipt.json establishes actual assembly. All512 leaves / **204,073,633 bound bytes** verified before launch and after execution. The only changed execution file is ordinary controls.json, SHA256 **e17fee7642385e5e540869aedcdefdb14e5b54c9a717e21b4b1f4ef2d0dfc409**, with precisely the approved warm[0] op/plan/site/readTime edits. All rows/pages/negative frames/programs/certificates/contracts, six bundles, worker, supervisor, comparator, support, sampling and assertions remain exact. The preserved historical commits are02a5b980b705d4cfacea6d06dd04e0d9ae654e6d /4fb998f25cc3ef114fc8a837d5abded3f8ae31ac /47a7f491a7d7f3b3abd976f2767bf2856a5baf68.

Linux Node22.23.2 x64 SHA256 **3517c2df0b2f8cd7f422b4b8450ef81c6889f08eb03e281d6de9079b15e6a327** remained exact. No source rebuild, regeneration, source worktree edit or new oracle/readiness battery occurred.

## Host, unchanged bounds and failures retained

Fresh preflight observed EPYC9454/96 logical CPUs, hostname expose-builder-pixel, Linux6.8.0-138-generic; runtime identity/process.versions are retained. Load `[0.04,0.12,0.09]`, disk free959,731,118,080B. **os.freemem262,638,944,256B**, separately read **MemAvailable262,637,912,064B** and **MemFree204,100,022,272B**. The original libuv Linux available-memory predicate was unchanged; MemFree was not substituted. Per-invocation before/after load and memory observations remain in launch/terminal receipts.

Original invocation limit **1,000,000ms**, arm **300,000ms**; phase seconds: empty10/load60/retained20/warm20/timed10/contradictions10/publicationRollback10/populatedTwinReplacement30/populatedReopen30/removeOwners20/purge20/reopen20/reset10/close10. Original preflight10s and comparator30s/remaining invocation budget stayed unchanged. RSS1536MiB, V8 heap flag/heapUsed1024MiB, external1024MiB, ArrayBuffers512MiB, cumulative canonical output512MiB; os.freemem start4096MiB/running2048MiB;250ms RSS sampler with1s ps bound and100ms child memory sampling. Per-invocation outer1200s was looser and never triggered; no global/tighter resident deadline was added.

Two external tooling failures are preserved separately from the Twin workload failure in failures.json:

1. Initial capacity-probe JS had an escaped-newline syntax error (Node exit1), before any population. Corrected only the external probe; inspected/reverified the existing assembly without recopying it. Both command receipts remain.
2. The once-downloaded archive passed its size/hash checks, but local Python rejected extractall's unsupported filter keyword. No member had been extracted. Inspected the empty owned destination and copied validated regular members exclusively; no new transfer, source change or workload retry.

All SSH operations had explicit bounds and recorded argv/PIDs/exits. No disconnect occurred. Assembly SSH180s/remote150s, completion inspection90/60s, detached launch60/30s, observations65/40s, collection300/270s with archive240s, retrieval90/60s; these are operational bounds, not tighter resident containment. Per-command PATH/environment scrubbing follows the prior wrapper; no global configuration changed. The prior original ordinary contradiction failure remains FAILED_NOT_QUALIFIED with its immutable evidence.

## Complete results and cleanup

Complete original states/backend/outbox custody, sampler observations, stdout/stderr, launches, terminal and comparison outputs are local in `results/` and preserved remotely. Derived execution-summary.json is distinct from original receipts. The frozen bulk packet remains remotely retained and fully verified; the archive additionally contains its exact manifest and corrected controls.

- `complete-results.tar.gz`: **39,194,543B**, SHA256 **3b3b6c8122eb3b9012e2cb4c74a95e947d1ac9f2325ab68f8781876f9852024f**.
- `results/RESULTS-MANIFEST.json`: SHA256 **aa5ba537c14014fbbb39ed6dacf4921eeb8ab538fe20c95a347f822ba413ead7**, binding **88 files /175,753,259B**, plus the manifest itself. Every extracted file and exact inventory verified. Archive/extracted files are mode0444.
- results/cleanup.json checked only the eight recorded own PID/start identities; all are absent. No signal was sent. Every local SSH/helper was awaited. The independent native-build writer, Office lane and all other processes were untouched.

Writer gpt-6-astra/xhigh, UUID01a0783e-90b6-70b3-a096-c7a980574ceb, CLI25359/parent25294. Owned work is complete and writer released in phase.json. Parent records the actual CLI terminal after return. Root owns disposition. No media/Unicode, P2cb578, native-owner/server, phone, publication, competitor, full-Clique or product/performance qualification is claimed.
