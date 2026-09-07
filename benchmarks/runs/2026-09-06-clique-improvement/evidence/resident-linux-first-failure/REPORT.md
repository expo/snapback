# Ordinary Linux resident execution — stopped on first failure

The single authorized carrier invocation failed in its **baseline arm**, in `contradictions`. Baseline child and original supervisor both exited **1**; outer elapsed **21.995100356s**, child elapsed **21.689663259s**. No timeout or protection stop fired. The later carrier/coverage arms and the separate Twin invocation were **not launched**. No retry, repair, or comparison result was produced.

First failure, preserved in `results/carrier/baseline/failure.json` and original stderr:

```
AssertionError [ERR_ASSERTION]: The input did not match the regular expression /conflicting durable fact/. Input:

'TypeError: conflicting deliveries for resident.page at seq 11'
```

The frozen worker's `unchangedAfterFailure` assertion failed at `worker.mjs:46:176`, called from the contradictions loop at `53:127`. Its subsequent canonical-state/backend/outbox preservation assertions did not complete. This is an actual failed harness assertion, not a demonstrated successful rollback or an independently established product defect. Nothing was changed to reconcile the error text.

## Frozen source and invocation

Read the prior Linux readiness report/phase and complete original supervise/worker/support/compare sources before execution. Fresh preflight and final verification matched every one of the derivative's **512 manifest entries / 204,073,598 bound bytes**, with exact inventory (513 files including MANIFEST).

- Packet: `/home/ccheever/clique-tooling/search-resident-format5-linux-20260907T011256Z-e51045c8/packet`
- MANIFEST SHA256: `e1fd840712da9c00cdeeb952e2364b119107a88133b18edc3bb1379638339087`
- Node **v22.23.2 linux/x64**, SHA256: `3517c2df0b2f8cd7f422b4b8450ef81c6889f08eb03e281d6de9079b15e6a327`
- Exclusive execution root: `/home/ccheever/clique-tooling/search-resident-format5-linux-ordinary-20260907T012601Z-da2956f5`

`intent.json` preceded exclusive remote creation. From the packet cwd, the actual original command was:

```
/home/ccheever/clique-tooling/search-resident-format5-linux-20260907T011256Z-e51045c8/packet/executables/node /home/ccheever/clique-tooling/search-resident-format5-linux-20260907T011256Z-e51045c8/packet/supervise.mjs --execute-population --fixture ordinary --mode carrier --output /home/ccheever/clique-tooling/search-resident-format5-linux-ordinary-20260907T012601Z-da2956f5/carrier
```

Historical revisions remain baseline `02a5b980b705d4cfacea6d06dd04e0d9ae654e6d`, carrier `4fb998f25cc3ef114fc8a837d5abded3f8ae31ac`, coverage `47a7f491a7d7f3b3abd976f2767bf2856a5baf68`. Only baseline ran. Original bundles, fixtures, assertions, runtime and protection predicates remain unchanged; this is not P2 qualification.

The external `run-once.py` (SHA256 `f9f165325399d188fde524399fdca4b1f125b1491f6792ba4fefccef977e37f3`) used exclusive durable launch/once markers and detached logs. Its 1200s containment was looser than the original 1000s invocation limit and never fired. Per-command PATH was `/usr/bin:/bin`; only child environment NODE_OPTIONS/NODE_PATH/LD_PRELOAD/LD_LIBRARY_PATH were scrubbed. No global configuration changed.

Actual outer PID **3564510**, supervisor/sampler **3564511**, baseline child **3564518**; child start **2026-09-07T01:29:58.438Z**. Launch argv, executable, `/proc` start ticks and terminal are retained. The initial supervisor cmdline observation was empty during startup; the actual Popen argv remains recorded without rewriting that observation. Twin's output and launch markers remain absent.

## Partial observations and unchanged bounds

Completed original phases: empty **7.160018ms**, load **18126.976278ms**, retained **627.486035ms**, warm **1927.166947ms**, timed **644.301832ms**. No COMPLETE result or cross-arm comparison exists; subsequent lifecycle checks did not complete. Failure-path store cleanup is not a passed close lifecycle phase.

The retained baseline snapshot contains **10,000 rows, 500 answers, one outbox entry, 105,200 fact slots**, 10,000 receipt members and 400 halos. After-GC/pre-audit RSS was **180,985,856B**, heapUsed **52,269,240B**, external **3,131,125B**, ArrayBuffers **898,555B**; serialized state **8,278,766B**. Assets were zero; internal fact images are not media assets. All four emitted canonical snapshots and backend bytes are retained. The 86 external RSS samples peaked at **279,805,952B**; 184 child timer samples peaked at RSS **275,177,472B**, heapUsed **118,379,112B**, external **37,493,874B**, ArrayBuffers **34,171,893B**. These sampled maxima can miss synchronous peaks; whole-state JSON I/O/audit costs remain included. No whole-store size, capacity, comparative performance, or complete-lifecycle conclusion follows.

Original invocation **1,000,000ms**, arm **300,000ms**. Phase limits in seconds: empty10, load60, retained20, warm20, timed10, contradictions10, publicationRollback10, populatedTwinReplacement30, populatedReopen30, removeOwners20, purge20, reopen20, reset10, close10. Original supervisor preflight10s and comparison maximum30s/remaining invocation budget were unchanged. Original child flags `--expose-gc --max-old-space-size=1024`; limits: RSS1536MiB, heapUsed1024MiB, external1024MiB, ArrayBuffers512MiB, cumulative canonical output512MiB. Original os.freemem floors start4096MiB/running2048MiB; RSS sampling250ms (`ps` bound1s), child memory sampling100ms. No population, phase, assertion, sampling or protection reduction.

Fresh EPYC identity/runtime receipts include hostname `expose-builder-pixel`, Linux `6.8.0-138-generic`, AMD EPYC9454, 96 logical CPUs and complete process.versions. Initial load `[0,0,0]`; **os.freemem()262,781,562,880B**, separate **/proc MemAvailable262,781,808,640B**, **MemFree206,455,083,008B**. These are separately observed values, not interchangeable names or substituted predicates. Final load `[0.2841796875,0.0654296875,0.021484375]`; final MemAvailable262,801,698,816B and MemFree206,440,570,880B.

## Receipts, retrieval and release

All original stdout/stderr, launches, terminal, observations, failure, emitted canonical states/backend and owned identities are in `results/`; derived `execution-summary.json` is explicitly a summary. Complete result archive and extracted files are locally mode0444. Remote outputs and source remain preserved.

- Archive `complete-results.tar.gz`: **7,355,577B**, SHA256 `6c71868f96ed77973953f272e54ceb50b273160c4e2afdff70ea3f420314597d`.
- `results/RESULTS-MANIFEST.json`: SHA256 `ff20d7efa844ffc636fd0c1a4b34c635f55eff110c996e51a6b471d542d1f7bf`, binding **26 files / 33,282,462B**, plus the manifest itself. Exact inventory and all hashes verified in `retrieval-verification.json`.
- Exact SSH argv, stdin, PID, times and exits: preflight-ssh.json, carrier-launch-ssh.json, observation-01.json, archive-ssh.json, retrieve-ssh.json. All exited0, no reconnect/replay. Local/remote bounds respectively: 90/60s, 60/30s, 65/40s, 300/270s, 90/60s; archive construction240s. Short SSH bounds did not contain the detached resident workload.
- `results/cleanup.json` verifies recorded PIDs3564510/3564511/3564518 absent, checking their recorded start identities only. No signals were needed; no owned helper remains active. No other host/process was inspected or altered.

The actual workload assertion failure is retained without retry. A final local existence probe returned1 because this report/phase had not yet been created; no execution failure was hidden. Prior readiness failures remain in their immutable original evidence. No product/source, guide, publication, native/device, competitor, search-release or full-Clique qualification work occurred.

Writer: native gpt-6-astra/xhigh, UUID `01a0783e-90b6-70b3-a096-c7a980574ceb`, CLI PID71898, parent PID71889 (`launch.json`). Owned work is complete; writer released in phase.json. The parent records this CLI's actual terminal after return; no CLI exit is invented here. Root owns disposition.
