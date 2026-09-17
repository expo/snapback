# Grok launcher review, repaired candidate

Received 2026-09-16. Requested `grok-4.6`, xhigh; native receipt reports
`grok-4.6-build`, one turn. Fresh independent session
`01a0abb1-7c8e-7552-9eb1-c7cf1275649b`, complete source inline, no tools or
other review. Only the final review text is retained here; raw private
provider response is not a public artifact.

## Verdict: READY

Reviewed SHA256s:
- `stage-pilot.mjs`: `f1ff8973d57afe3ec70bad62ea2b735cd3422b121f3ef1dadc0d3f806eba9177`
- `run-pilot.mjs`: `c49afd2ae62399f67bdbcc4f868851056e0c481b5180b2aa52c85b951ba39f3c`
- `pilot-prompt.md`: `93969c649dab511b59e9d1d5bf212e732ad50b641b44950eaed07504feeeb260`

No must-fix runtime, lifecycle, or evidence-integrity blocker for this run-local Workroom diagnostic. It stages one packet, omits holdouts fail-closed, pins Node `v24.13.1` and `snapback4@0.2.26`, runs one Codex `exec` on an empty `app/` outside git, keeps private artifacts on failure, and will not group-signal until `ps` shows the detached child is its own group leader (else exact-child only). Four hours is driver-side operational stop only; the prompt does not treat it as a score cap. This is not a scored cell and does not need the full social-messenger harness.

## Why this is enough for the pilot

**Staging (`stage-pilot.mjs`)** refuses the wrong Node, a non-repo source, a destination inside the source or any git tree, an existing destination, and a disk floor below 2 GiB. Fixtures/tools are copied with `COPYFILE_EXCL` and hashed before/after. Non-regular packet entries fail. `removeHoldoutSection` requires exactly one `## Holdout probes` heading and a following `##` boundary, then checks the heading is gone (`stage-pilot.mjs:44-55`). Starter and conformance are generated and recorded; the runner refuses unverified profiles (`run-pilot.mjs:129-131`). The packet is then made `0555/0444`. Manifest kind/version/pin/`rawHoldoutsDelivered: false` match what the runner accepts.

**Run (`run-pilot.mjs`)** refuses Windows, wrong Node, a git-tracked root, escaped `app`/`packet`, a non-empty `app/`, a second `private/`, and packet/prompt drift before spawn. Child env is a tight allowlist with `HOME`+`PATH` required. Codex is spawned `detached: true` with cwd `app`, prompt on stdin, `--skip-git-repo-check`, `--ignore-user-config`, `--json`. Group identity is `pgid === child.pid` via `ps` (`run-pilot.mjs:176, 285-291`); on mismatch it SIGTERMs the exact child and never `kill(-pgid)`. SIGINT/SIGTERM, disk floor, and the four-hour timer request stop only of that validated group (SIGTERM 30s, then SIGKILL 10s). Raw stdout/stderr/heartbeat/process-group logs are `wx` `0600` and still present if later metadata writes fail. Integrity is rechecked at end (exit 126 on change). Native `~/.codex/sessions` copy is exact-suffix and best-effort; driver JSONL remains the primary capture.

**Prompt (`pilot-prompt.md`)** is a fresh builder brief for team-workspace W1–W7 with published `snapback4@0.2.26`, Node 24.13.1, no W8, no repo mining, loopback/reserved ports, kill-by-PID only, and no scoring claims.

## Optional hardening (not must-fix)

1. **`cleanupPromise` latch before the group is validated** (`run-pilot.mjs:202-206, 270-274`). If `requestStop` runs from a stdout/stderr log write failure in the short window after spawn and before `groupValidated = true`, the latched cleanup is a no-op and later group kill/ceiling/SIGINT will not arm. Repro needs that I/O failure in a sub-second window.

2. **Stop handlers are installed after spawn/ps/`start.json`** (`run-pilot.mjs:172-174, 284-304`); **SIGHUP is never handled**. A signal in that window, or a hangup during a 4h SSH session, can exit the driver and leave the detached child. Same class: handlers are removed in `finally` before native-rollout walk and `end.json` (`run-pilot.mjs:331-372`).

3. **After `requestStop`, the `try` still `await`s `exitPromise` with no cap** (`run-pilot.mjs:325, 212-222`). If the leader has left the validated group, SIGKILL of `-pgid` will not reap it and the driver will not reach `end.json`. Not expected for foreground `codex exec`.

4. **Pre-spawn `fail()` after `private/` is created** (`run-pilot.mjs:143-161`) skips `end.json` and blocks retry with `PILOT_RUN_ALREADY_EXISTS`. Empty logs remain; this is before Codex starts.

5. **Trailing JSONL line without `\\n` is not parsed for `thread.started`** (`run-pilot.mjs:247-260`); **stdio `destroy()` after a 2s close race** (`run-pilot.mjs:341-343`) can drop a small unread tail. File-backed stdout and `-o last-message.md` still exist.

6. **`removeHoldoutSection` errors if Holdout is the last `##` section** (`stage-pilot.mjs:50-51`) rather than slicing to EOF. Fail-closed (no holdout leak). Only matters if this brief has no following `##`.

7. **Ceiling/disk/SIGINT return codes are chosen before `groupCleanup.disappeared === false`** (`run-pilot.mjs:374-379`), so the driver can exit 124/125/130 while a group member is still present after the SIGKILL wait.

None of these is a reproducible material blocker for this diagnostic as written.
