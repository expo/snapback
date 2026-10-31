# PUB051 power hold continuation

Written 2026-10-31T16:43:09.812823+00:00. Publication is pending; no upload.

Publication source: b34992d40be5297ec42feb9aa4a29200bccfca98. It is pushed unchanged to origin/main, Linux detached at it and Mac sb4-publish-0.4.51 at it via SSH Git push. Release affected31/31 complete/unchanged raw exit0; explicit inventory/ref0. Both final-source stock web/Expo audits0 with zero findings and matching candidate hashes. Read lineage.json and STATUS.md for prior opening recovery and fixture repairs already pushed/qualified.

Native attempt1 went on battery before witness, at16:26:17Z; original chain-a1.env-invalid and raw controller exit1 are preserved. Scoped kill-dryrun.sh stopped only owned jobs; hold-native-a1-power.sh shut down only the dedicated witness simulator. Cleanup0, source clean, no native/Darwin proof reuse. Simulator is Shutdown. Native build caches may be used by fresh successful commands at the same source.

Read-only observer sb4-pub51-power-hold-observer (256M) consults power-hold-native-a1.json and observes AC/lid every10min. Last manual check16:37:44Z battery94%; next16:47:44Z. It appends raw checks/STATUS, writes power-hold-native-a1-restored.json only upon AC with lid open, and never starts any job. Do not query early or burn attempts. Linux foreground ssh -tt localhost connectivity was checked successfully; actual staged/registry smokes remain mandatory.

After the restoration marker is present, inspect it/source and execute the already-prepared Mac start-native-a2-guarded.sh at K/source.sha (fresh instantaneous AC/lid checks, exact source/cleanup/preflight markers, no old witness or prepare, atomic native-a2-started.sha). Capture stdout/exit in mac-native-a2-start.*. Then start Linux unit pub51-native-handoff-a2 at8G running K/qualify-after-native-a2.sh with output native-handoff-a2.log. Do not restart the original a1 handoff; it correctly rejects the preserved invalid marker.

Attempt2 kit mirrors corrected attempt1 with fixed attempt names. Native chain stops after native/prepare/Expo check; canonical audit-after-prepare-a2.sh then gates handoff. Native logs: chain-a2.log, native-continue-a2.log, native-2.exit, prepare-2.exit. Correct post-native-a2.sh provenance. Power wait600s and strict watch. All shell syntax, collector compile and source/attempt assertions PASS; kit changes documented in power-hold-native-a1-kit-adjustments.json and STATUS.

The a2 handoff copies exact Mac client/Expo tarballs with cross-host SHA equality, runs canonical Linux audit then starts Linux qualification attempt1 (80G, because none has started) and Mac warm/pre chain2. Mac lean/warm/pre2 and dry-run2 use no old results; single dry-run ATT2/MAXATT2, RUSTPROCS2, nohup+caffeinate gate-tolerant. Pre-Darwin49 files. Completed Linux receipt/platform source/SRI is validated before six-template INIT_INSTALL0 packument refresh and Mac dry run. Original .50/a1 inactive scripts must not be started.

Remaining original steps: classify any actual test red; both-host foreground staged smoke via ssh -tt; repeat fresh both-host audits; guarded finish attempt2/source; both-host foreground registry smoke; strict verify-registry all4 versions/latest and byte integrity; records commit on main with fetch/rebase retries; final root WORKSTREAM-REPORT and STATUS PUBLISHED with npm views/records SHA. No upload is automatically armed. A different-kind product red stops before upload under brief.

Source paths: own Linux WT ~/sb4-pub-0441, own Mac WT ~/sb4-pub-0444-wt. Only kill Mac jobs through scoped script files from HOME. Never read credential files. Current public registry registry-power-hold-status.json: all4 version/latest0.4.49 and0.4.51 E404.

UPDATE 2026-10-31T17:03:29.374343+00:00: AC restored; native attempt2 actually started (mac-native-a2-start.exit0 and atomic marker). Handoff unit pub51-native-handoff-a2 active at8G. Do NOT run start guard again. Monitor a2 route. Pending attempt1 qualified.json was only framework metadata and is archived unchanged; initial guard exits1/141 retained separately, lid/power reader SIGPIPE corrected before actual launch.
