# Integration 24: final PostgreSQL delta

Snapshot `6c638549fd297187a4c9e6804b7748f631a9bcc5`. Full unchanged-surface qualification is in `../final/`.


## Final upstream synchronization and delivery

Main through `6cbe3869da` merges as `18fb954531`; metadata/measurement commit `6c638549fd` regenerates three independent evaluation lockfiles at 0.4.40 without changing registry versions. Both journal histories, the integration report and 0.4.40 versions survive. Authoring census regenerates unchanged (884 entries), as do the registry and guide manifest. Clean-source Wasm remains 737,990 bytes gzip with the 738,490-byte budget.

Changed-input qualification at `6c638549fd` passes on Linux and Mac: full PostgreSQL core (1,212 reported passes each); CLI binary plus committer/overload/wave-26 targets (629 Linux / 621 Mac); four portable pipeline oracles; 246 private adapter tests; isolated cold-plan, codec, committer/maintained/command, 60 evolution tests, RT0, actual 128-client HTTP and four store oracles. Linux additionally passes the TCP_NODELAY/strace witness over actual TCP. All commands pass; both owned private clusters stop/status 3/no PID/no surviving original process, data is removed and source status is empty. No new flake occurs. These functional checks make no S1 capacity or on-wire-overlap claim; the upstream witness-gap issue stays open.

The actual default public native binary is rebuilt (SHA-256 `33d84264253bcc891304fdf8fcc91824a8776a167e140e6d1ec8b73e4e877d79`). The unmodified public deploy/serve witness passes ownership, restart, redaction, P1-CE/P1-MC and evolution checks; all recorded child PIDs and its separate private cluster are independently absent, then owned data is removed. A fresh prepared client/Expo pack is byte-identical to the fully qualified artifacts (`45ef5fde…` / `0b431967…`), so the installed-consumer receipt applies to those exact bytes.

Compiler, device, simulator, SDK and root-guide sources are unchanged. Full five-crate, client pools, survey, replay, difftest and Exact receipts retain their actual tested snapshot binding; they are not relabelled as reruns at a later HEAD. New ref-check and inventories pass. All 150 original store-file byte hashes are rechecked unchanged at the end. Detailed commands, counts, content bindings, logs and cleanup receipts are in `snapback4/reports/integration24/post-main/`.

Delivery: qualified for final fetch and nonforce `sb4-loop:main` push. Full `scripts/test.sh` remains unrun as instructed; no npm publication is claimed. The real application survey/replay exceptions above remain explicit.
