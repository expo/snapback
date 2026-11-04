# PUB context and assumptions

Scope: Snapback 4 four-package 0.4.53, qualification only. User explicitly authorizes the release commit push; no finish/resume/upload.

Governing: Snapback4 AGENTS publication section and LLP 3000.021 §3.3 bind one Mac-prepared client/Expo pair to source and platform-local receipts. LLP 3000 publication suite sections preserve complete inventories and assertions. LLP 0233 and 0288 are Draft Snapback 1 proposals, not new authority inside the Snapback 4 fence; LLP 0113 is the older qualification-authority design. The implemented Snapback 4 publisher plus the user-provided 0.4.52 recipe controls this lane. LLP 3000.001.001 §13 and the packaged changelog/reference describe progressive acquisition; no performance claim or RFC acceptance is added.

No matching literal 0.4.52 entry exists in this checkout's JOURNAL.md; the prior REPORT.md and exact release commit provide the integration record. The tail of JOURNAL records progressive history through fix round 6.

The checkout arrived detached; use sb4-publish-0.4.53 for the release commit, then detach at its pushed SHA. Current main is 9346e1fa37. Reports for qualification will be worktree-ignored, and receipts/logs remain immutable.

The prior clean-install-linux.sh performs a registry install of the already-published version and therefore cannot succeed for unpublished 0.4.53. Pre-qualification Linux clean installation means the frozen checkout's bun install --frozen-lockfile and prepared tarball consumers; reserve the prior registry script for the supervisor's post-publication proof.

Node is explicitly pinned to Volta 24.18.0 in every release command (ambient /opt/homebrew/bin/node is 25.9.0). Homebrew GNU timeout 9.11 is installed, despite the prompt's warning; the kit already places it on PATH. Preserve its bounds. The first bump helper invocation was read-only on refusal because following/Cargo.lock had 0.4.49; align that fixture's current pin before using the helper. The first client build refused missing generated wasm; build-wasm then build-client is the required fresh-tree order. Both logs retained.

Kit changes beyond version/date/path/source: explicit /usr/bin/grep, a2 orchestration starts attempt 1, pubstep clears SNAPBACK4_BIN and refuses either prior JSON or log, Expo equality check now asserts its printed result. Do not execute legacy setup scripts that delete target subdirectories. No target deletion or old checkout modification is permitted.

0.4.52 release notes do not list known gaps: omit the two starter tickets. No new design decision or LLP needed; hand-off none.

The inherited Git author is Snapback Test <snapback-test@example.invalid>. Release commit will use the prior release author Charlie Cheever <ccheever@firewoodagent.com> via per-command configuration, without changing shared configuration. Background children launched by a completed tool shell did not persist, so long Mac chains run as foreground caffeinate sessions; chain-pre-a2 waits for its gate child. No assertion/scope change.

Final kit guards also record and recheck >=45 GiB immediately before the pre-dry cache refresh (after any Linux wait); native provenance correctly names attempt 1 although the inherited orchestration filenames retain a2.

Linux clean-install resolution: preserve the prior registry script as linux-kit/clean-install-linux-registry.sh; the active clean-install-linux.sh now installs the exact qualified client/Linux tarballs after qualification, runs version/init/check, and matches the installed binary SHA256 to the receipt. This adds a runnable pre-publication clean-install check; registry verification still belongs after finish.

The tolerant gate also rechecks and logs >=45 GiB at its actual entry, including after a power wait; its existing in-run watchdog and flake handling are unchanged.

After source push/freeze, Mac changed to battery before native entry. The AC gate waits unchanged. During the wait, Linux source-bootstrap.sh installs/builds the same frozen source in the owned checkout; this is prerequisite work, not qualification. Official Linux qualification still waits for the Mac-prepared client/Expo pair. Linux build output is explicitly confined via CARGO_TARGET_DIR to the owned source/target.

Linux target-path refinement before qualification: only source-bootstrap confines its one root CLI build with CARGO_TARGET_DIR. Official qualification clears any inherited CARGO_TARGET_DIR and uses the verified standard per-project Cargo target path, preserving nested consumer fixture semantics from the prior kit.

Handoff sequencing: warmPreDryToolSession runs warm-pre-after-audit-a2.sh, which proceeds through pre-Darwin and then waits for incoming Linux receipt/tarball before cache refresh and dry run. Before populating that incoming directory, run the retained audit-pre-dry.sh once and require exit 0 (fresh Mac starter audit repeat). Then validate successful Linux output, staged clean install, assemble records, and transfer receipt/tarball. This prevents automatic dry-run entry before the pre-dry audit. Never run finish/resume/npm publish.

Linux attempt 1 full source suite passed but installed DX5 upgrade proof hit ENOENT at publication-dx5-upgrade.mjs:99 proveDX5Upgrades: historical ~/sb4-loop/wave21/apps had been archived (Mac default absent too). Recovered only the two required authored lane subsets from Linux wave21/archive.tar.zst into owned fixtures/wave21/apps, 32 files/210930 bytes; original script hashes match 0.4.52 and every copied Mac file matches. Use supported SNAPBACK4_WAVE21_ROOT override in Linux linux-a2.sh and Mac publish-lowpar.sh. Isolated actual historical upgrade proof passed 80/80 and 8-user readiness; no product edits, no flaky-test waiver. First diagnostic failed on a cleaned temporary platform tgz; a separate diagnostic-only pack from built binary fixed the test prerequisite, all logs retained. Failed full attempt moved with hash validation to own archives/linux-attempt-1, wrappers untouched in records. New full Linux attempt 2 uses run-all-a2.sh/linux-a2.sh/start-linux-a2.sh; systemd unit sb4-pub53-linux-2. assemble-records now includes archives. Mac chain still waits for qualified handoff.

Supervisor handoff: finish.sh now also passes SNAPBACK4_WAVE21_ROOT to the recovered authored fixtures, because resume re-runs installed-consumer proofs. Original script archived; finish-fixture-override.diff reviewed; bash -n passed. No finish/resume/publish command was executed.
