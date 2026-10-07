# P2A packet revision 2 — 2026-10-05

This is a disclosed harness revision for a clean restart, authorized by the lead
in the Round 1 brief. Attempt 1 is a **harness-defect void**, not a product result
and not the single permitted setup rerun. It is retained in
`attempts/snapback4-attempt-01-void/`, with its original outcomes unchanged and
superseded by `VOID.md`. `PACKET.v1.sha256` preserves the original seal;
`metadata/harness-v1-v2.diff` and `metadata/revision-2.json` bind this amendment.
No qualified native driver, validator, runner, contract, helper or UI-kit byte is
changed. Both restarted lanes receive the revised symmetric authoring handoff.
Neither old partial authoring nor any old result contributes to the comparison.

## Governing context

Scope: P2A builder/operator lifecycle, safety accounting, custody and restart.
Foundation: LLP 0000 (root). Governing working-set documents: LLP 0201 D7
(pilot safety limits and affected-pilot reruns), LLP 0201.000 §§3–7 (passive
helper, owned backend, independent evidence, disclosed series break and retained
setup rerun). No product authoring surface changes. Hand-off: none; later pilot
acceptance remains the owner's decision. The pilot is unscored and has no O4 or
overall score. First-green scored attribution still requires independent review.

## D7 interpretation and cleanup

The lead's explicit interpretation for this pilot: the 2M safety ceiling counts
non-cached input plus output. Raw Codex input minus cache reads plus output is
135,613 in the real attempt at 409.183861 s; cache reads are 1,874,304 and cache
writes zero. Reasoning's 476 tokens are already in the 9,857 output tokens and
are never added again. The inherited checksum-validating adapter presents input
with cache reads AND cache writes already removed. We cap `input + output` in
that normalized representation, record every cache-read/cache-write token per
phase without a cap, and retain the raw rollout for independent accounting.
The four-hour wall limit per milestone and separate replay wall limit stand.
Replay permits one interval, so ending/restarting it cannot reset its ceiling.

Each builder starts in a new session. The supervisor tracks PID/start identities,
descendants, and a random inherited ownership marker across shell-created
sessions and reparenting. It persists ownership without copying process
environments or potentially secret command arguments. Cleanup signals only
owned identities, waits for all live members, and escalates TERM to KILL even
when the leader already exited. It records signals and completion before end
publication; after-builder rechecks cleanup before ports and custody, including
recovery when the supervisor dies without an end record. Foreign listeners still
refuse setup. CoreSimulator is launchd-owned: under the exclusive mini lease,
newly booted devices are shut down except the dedicated device; all devices
already booted at builder start are preserved. Builders remain forbidden to
boot simulators. Ordinary operator process-group cleanup also waits for children.

## Round-0 review disposition

Both supplied blind reviews finished (`.exit`, exit 0) before this revision was
sealed. Original reviews and their digests are retained under metadata/reviews.
These are received Round-0 reviews, not claims of Round-1 reviewer approval.

| Review finding | Disposition |
| --- | --- |
| Astra 1: setup override can replace source/commands | Fixed. Repair allows only reason/scope, never replacement operatorConfig or commands; original custody is reused. |
| Astra 2: false product result lost before validator failure; compile failures retried as setup | Fixed. Persist raw driver status/exit before validation, latch false independently, and inspect raw retained status on retry. Unclassified build/authoring faults stop the chain and cannot be retried as setup. |
| Astra 3: children survive leader exit | Fixed with tracked process custody, escalation and detached TERM-resistant listener regression. |
| Astra 4: passing artifacts plus exit 17 accepted | Fixed. Driver exit must pair with verdict (0/success, 1/false); null/crash/invalid evidence stops. |
| Astra 5 and Grok 3: Convex actual engine/store not bound | Fixed. Fixed operator launcher owns the preflight binary, assigned loopback ports and all sqlite/file storage. It attests the live kernel process image and hash at each start; both witnesses required for success; early product failures retain the starts actually reached. Hosted environment settings scrubbed; source audits trace all client/oracle origins. No secret appears on the driver's recorded wrapper argv. |
| Astra 6: replay ceiling reset | Fixed. A second replay-start is refused; controlled-clock regression exceeds the old cumulative ceiling. |
| Astra low: corrupted custody not tested | Fixed. A corrupted-copy test requires refusal. |
| Grok 1: unrestricted access to other lanes/reference/driver | Fixed. Inherited macOS file sandbox denies home and shared scratch except the lane, shared authoring aids, pinned tools/caches, private Codex home/temp, and boundary append. Reference, driver, other lane, old attempts/logs and symlink escapes are tested as unreadable. No old global Codex session tree is exposed. |
| Grok 2 and 7: capped/killed builder can be measured | Fixed. Only builder-ended plus confirmed cleanup is measurable. Original termination and final metering disposition are separately retained. |
| Grok 4: setup retry can remeasure a passed segment | Fixed. Any completed segment refuses setup repair; no product retry or passing-segment rerun. |
| Grok 5: app not bound to Release output | Fixed. Require an absent per-attempt DerivedData before build and app inside it, with matching -derivedDataPath. Audit generated/prepared source again before build; preserve both source bindings and preparation log. |
| Grok 6: hangs/instrument errors retried as setup | Fixed. Preserve the qualified manifest's outcomeClass, retain ambiguous/instrument failures separately, and prohibit automatic setup repair after driver execution. |
| Grok 8: missing runner/phase/null-verdict mutations | Fixed. Tests cover binary hash drift, exact chain script order, null verdicts, and retained raw false status. |

Narrow alternatives declined, with reasons: a generic allowlist forbidding all
preparation changes outside node_modules/Pods would reject legitimate Expo
native project generation. Instead, a second read-only audit binds generated
source before compiling into fresh DerivedData. A bundle mtime is weaker than
requiring no DerivedData before compile and can reject compiler-preserved mtimes;
we use the fresh-output path and source/build evidence. We do not change the
qualified driver to infer that every timeout is an application failure: opaque
interruptions stay unmeasured, stop the chain and are ineligible for setup rerun.
The existing differences in backend guidance, paths and assigned port ranges are
necessary platform instructions; native obligations and aid bytes remain shared.
Ten-second usage sampling is disclosed safety sampling, not scored attribution;
full rollout and observed/requested boundary times remain retained. No claimed
precision or driver/validator trust anchor is changed to hide these limits.

## Restart custody and checks

The active Snapback lane is restored to exactly one `instrument` symlink. All
original lane bytes, logs, results, chain records and packet inputs are retained.
Restart admission requires an explicit `--restart-void` whose VOID metadata binds
the original seal and every prior chain, plus matching retained inventories.
Unvoided history refuses launch. A consumed record cannot authorize another
chain. The newly launched chain writes `restart.json` before any builder starts.
The retained operator attempt-01 is outside the new active results tree, so it
consumes zero setup reruns. A future failure is retained independently.

Preparation checks run only inert subprocesses, filesystem/sandbox probes,
checksum validation, the real-rollout meter, and the qualified driver's absent-app
preflight. No builder, source-review model, app build, driver measurement or
pilot-chain is started by this revision. The lead alone runs the restart.
