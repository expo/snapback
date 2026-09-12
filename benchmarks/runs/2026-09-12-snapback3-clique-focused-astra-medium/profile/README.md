# Isolated Snapback3 acquisition CPU diagnostic

This closes the missing browser CPU-profile measurement with one valid, explicitly instrumented u0500 acquisition. It is not a normal latency repetition, a canonical grading result, or M7 evidence. No app, platform, package, seed contents, or graded data was changed.

The authoritative record is `diagnostic.json`; raw evidence is `run.json` and `browser-main-thread.cpuprofile`. Open the latter in Chrome DevTools Performance or another CPU-profile viewer. `top-self-time-functions.json` preserves all aggregate frames, source excerpts, mapping method, and category totals. Evidence and browser profiles are private.

## Measured outcome

The unchanged authored `src/acquire.ts` obtained exactly all 10,000 expected unique message IDs across 100 conversations and 151 pages. No missing or extra IDs; no foreground send. A fresh private browser profile used the real app, SDK, HTTP owner, worker and IndexedDB. Source and fixed-package inputs match `inputs.json`, including the frozen 100,015-message static seed and all108 installed Snapback3 payload files.

- Authored acquisition wall time: **23,665.5ms**, instrumented.
- CPU-profile interval: **25,100.818ms**, covering page load/auth/render plus acquisition.
- Same-interval process CPU: Node owner **1.08s**, Rust worker **3.22s**, Chromium browser process **12.02s**, renderer process **28.50s**, GPU **0.05s**. Process CPU can exceed wall time because multiple threads run. These are measured process totals, not stack attribution.
- Browser main-thread CDP ThreadTime delta: **14.823s**. TaskDuration **14.138s**, ScriptDuration **6.780s**, layout **0.045s**, style recalculation **0.008s**.
- Main-thread CPU profile: **10.930s idle samples**, **1.334s GC samples**, **0.940s native/program samples**. Sampling-weighted times are not exact per-function CPU clocks.
- 146 observed long tasks, total **8.741s**, largest **91ms**.

Direct self-sample attribution identifies **6.124s within the SDK bundle**, **2.832s in React core/rendering**, **2.692s in other framework/helpers**, and **0.112s in authored app/UI/instrumentation.** These are exclusive sampled frame categories, not inclusive subsystem costs. The SDK subset is further identified as **2.111s evaluator/value/index code**, **0.688s persistence JavaScript**, **0.617s hash/UTF-8/codepoint primitives**, **0.320s protocol validation**, and **0.058s client/resource orchestration**; **2.330s remains source-unmapped**. The hash module total is not all cryptographic hashing.

Useful source correspondences include storage transaction success callback **0.520s**, canonicalJson **0.425s**, SHA compression callback **0.331s**, wireJson **0.292s**, canonicalValue **0.199s**, storage.write entry **0.168s**, UTF-8 length **0.139s**, and protocol ownWire **0.136s**. SDK correspondence is inferred by a unique ordered literal/property signature against the installed SDK followed by its source map. Metro emitted no map, so the exact minified frame positions, inference method and source excerpts are retained instead of presenting those mappings as a composed source map.

## Persistence, network and memory boundaries

The authored storage adapter observes 151 acquisition-overlapping writes. Their sum and clipped interval union are both **8,037.2ms**; median **50.6ms**, p95 **66.8ms**, maximum **75.3ms**. They carry 85,697 patch-row entries in total, with at most704 per write.

These are awaited `storage.write` spans. They include JavaScript cloning/iteration, transaction scheduling and IndexedDB completion wait. They overlap CPU and other activity. The trace does not isolate browser native IndexedDB code or disk service time; do not label8.04s as pure disk, subtract it from wall time, or attribute the browser process12.02CPU-s to storage without a native stack profile.

The main-page Network trace has151 completed /api/read responses within the profile interval: **25,072,206 encoded bytes**. Median request elapsed time is **25.473ms**, p95 **33.355ms**. All completed main-page requests total26,971,543 encoded bytes. This omits service-worker/other-target traffic and does not isolate network RTT.

Heap sampling lived in the Node controller, not a browser helper array. The app's own acquisition IDs/pages and storage timing arrays remained untouched. Periodic heap sampling stopped before result inspection:

- Peak sampled JS heap: **244,180,040 bytes (232.87MiB)**.
- End before forced GC: **110,288,960 bytes (105.18MiB)**.
- End after explicit supported GC: **51,219,144 bytes (48.85MiB)**.

Forced GC occurred after the CPU profile stopped and is separately timestamped. Only afterward did the helper inspect acquisition IDs and reduced storage timing records. It never called IndexedDB getAll or serialized full IDB stores for measurement. These numbers are JS heap, not total browser memory; forced-GC heap is not an ordinary retained-memory guarantee. No allocation profile was collected.

## Exact commands and inputs

EPYC isolated lane:

`/home/ccheever/snapback3-clique-focused-20260912/packet/lanes/astra-snapback3-profile`

The coordinator copied only frozen app/source/build files, the frozen static-asset supplement, the exact frozen scale seed, and dependencies from the completed grade lane. No narratives or grader report were read. The original grade, original builder, M7 prep/staged lanes and their processes were not changed.

The successful execution commands were:

```sh
cd /home/ccheever/snapback3-clique-focused-20260912/packet/lanes/astra-snapback3-profile
/home/ccheever/.local/node-v24.13.1-linux-x64/bin/node diagnostic/profile.mjs
/home/ccheever/.local/node-v24.13.1-linux-x64/bin/node diagnostic/analyze-profile.mjs
python3 diagnostic/summarize.py
```

The profiler helper itself launched:

```sh
/home/ccheever/.local/node-v24.13.1-linux-x64/bin/node node_modules/snapback3/dist/cli.mjs dev . --host 127.0.0.1 --port 54905
```

For a repeat, materialize another fresh isolated copy of these hash-bound inputs and helper files; the helper intentionally refuses to reuse a browser profile. Do not rerun it against another lane's DB. Script hashes, source hashes, CLI command, phase timestamps, samples, PID identities and exact stop states are in diagnostic.json/run.json.

Capacity preflight found load0.40, approximately242GiB available memory and274GiB free disk. Ports54905–54906 were free. Valid-run owner PID1660557, worker1660713, browser1661189, renderer1661213, GPU1661208 and zygotes1661191/1661192 are all stopped; controller1660548 exited. Ports54905–54906 were independently confirmed free afterward.

## Preserved measurement-only failures

`preparation-error.json` records inherited read-only directory modes preventing the first static-asset overlay. Only copied directory modes were corrected, before any owner was launched.

`attempt-1/` retains the first actual run's raw CPU profile, process samples, private profile/DB and helper source. That helper recorded the returned CDP object but then incorrectly treated `Profiler.stop`'s `{profile}` wrapper as the profile payload. One permitted retry corrected the helper, used fresh browser storage and a fresh seeded DB, and produced the valid evidence above. The first attempt is not merged into timings. No product failure is inferred.

The remaining attribution gaps are native Chromium/IndexedDB stacks, the source-unmapped SDK samples, service-worker network traffic, and heap allocation stacks. No additional model, migration, grading, product patch or ordinary-repeat run was performed.
