## 12. Wave-24 loop repairs (DX7)

Commission: Charlie Cheever, 2026-10-22; implementer: Codex in sb4-b24-dx7.
This amends §11, LLP 3000.036 §22.8 and the ordinary rule-helper exclusion.
SEC8 owns security questionnaire/dispositions, presence intent, invariant test
coverage and lifecycle advice; DX7 only reports their existing verdicts.
Implementation and tests accompany this amendment; review readiness is distinct
from author acceptance.

### Durable staging time

A staging store owns its cumulative offset and latest explicitly checkpointed
business time. The additive typed metadata record also retains a pending
maintenance pause. Production ignores this record and rejects clock controls;
ordinary dev retains its process-local clock/reset contract. No release-format
change or filesystem sidecar is needed. Store adapters use their existing
metadata transaction and fencing, including Postgres.

Startup resumes at the maximum of wall plus saved offset, checkpointed time,
and the existing disclosure floor. Without a checkpoint, the latest retained
commit/schedule boundary supplies the legacy recovery floor. Explicit startup
offsets are absolute offsets from wall time, clamped to the resumed floor;
restarting never adds the same offset twice or rewinds saved boundaries.
The resulting effective offset is persisted at startup. Malformed checkpoints
refuse startup rather than silently resetting. Downgrades to older binaries
ignore this additive record and retain their historical process-local behavior.

Each accepted staging advance checkpoints offset, time and paused=true in the
same transaction that preserves eligible sessions and worker leases, before
publishing the process clock or doing maintenance. A storage failure rolls back
all those effects. A lost reply is still ambiguous and never automatically
replayed. drain:false, a failed drain and an interrupted drain retain the pause
across restart. A successful drain durably clears it only after due work has
finished. If that final write fails, report an incomplete drain and retain the
pause. A restart does not shift already-preserved credentials again. Clock
status/advance reports say the offset belongs to this staging store. Coalescing,
eachBoundary, current-window equality and explicit allowHeld keep §11 semantics.

### Rendered and scrollable text

Mounted text inside overflow:auto/scroll ancestors counts even when outside
the scrollport: it can be reached by scrolling. The selector does not scroll
or change application layout. Overflow:hidden/clip remains a real clip, with
character geometry retaining only the displayed prefix; display:none,
visibility:hidden/collapse, opacity:0 and content-visibility:hidden remain
excluded, as do editable/input/script text and layoutless text. This does not
claim occlusion detection or virtualized content that is not mounted. Existing
normalization, smallest matching element and strict ambiguity remain unchanged.

### Upgrade and gate presentation

Upgrade snapshots count security notes alongside compiler notes and report
pending review gates separately, with unavailable previous gate data stated
honestly for old snapshots. The gate status reflects acknowledgments without
writing them during reporting. A refuted invariant cannot be acknowledged:
check explicitly reports that --ack-security was not applied, leaves review
records untouched and explains that the policy/intent must be repaired.
The JSON result carries the same explanation. Gate-only upgrade failures name
check --ack-security <ID> --reason '<spec rationale>'; other failures retain
schema/device remediation. An already published old CLI may still print its
old E_UPGRADE line; the new check child must carry the actionable explanation.
The release card records the 0.4.37 CLI's obsolete closed-door/startDev advice.
The numeric-advance candidate scan requires an actual advance call in the same
local expression/assignment as numeric consumption; unrelated operators or
new Date/assert calls elsewhere in a file do not qualify.

### Protected immutable payloads

A column-read-protected payload may be immutable. On insert its supplied value
is validated normally. On every update/existing-upsert, a supplied protected
immutable field is ignored without comparing it with stored data, for every
viewer, including its readers and the system. Its retained value and asset
placement remain unchanged; absent-upsert still inserts. Compiler advice on an
explicit patch names that behavior. Ordinary unprotected immutability retains
its existing contract. Cap/unique/index/authority/derived dependencies on
protected fields remain refused. This input-independent policy preserves
LLP 3000.036 §22.8's noninterference oracle and needs no new device protocol:
the same interpreter runs it on the server and device.

### Audience helpers and hidden probes

Expression-bodied helpers, or a block containing one return, may appear in
table/column rules when expansion is exactly the existing rule grammar.
Arguments are ordinary typed rule terms, substituted simultaneously without
caller capture. Only parameters, viewer and rule constants may be free in the
helper; a helper's focal dot cannot capture the caller's row. Nested helpers
are bounded to eight levels and a bounded expanded-node budget; cycles,
wrong arity/types, block effects/lets, arithmetic, clock and ordinary reads
refuse with E_QUARRY_RULE_OPERATOR and an actionable repair. No new runtime
instruction, probe semantics, authority or resource allowance is introduced.
Expansion precedes read-through, index inference, audience inversion and
security analysis so every consumer sees the same canonical predicate.

Program exists remains a caller-visible read; rule exists retains its existing
policy probe semantics. N_UNREADABLE_PROBE and N_LOOKUP_FILTERED name the exact
hiding read/read-through rule and source site, including exists directly in a
require. No runtime refusal confirms whether a hidden row physically exists.
Runnable guide recipes demonstrate protected immutable payloads, a role helper
and a hidden parent probe alongside a deliberately minimal readable projection.

### Required evidence

Regression coverage includes repeated startServe/advance/drain runs on one
store, drain:false restart and legacy saved boundaries; no double session
shift; production controls and failed-checkpoint atomicity; mounted below-fold
RN-web text and hidden/clip controls; gate-only and refuted upgrade diagnostics;
real and unrelated advance scan candidates; protected immutable equal/different
patches, upserts, assets and server/device observation equality; helper types,
recursion, capture and authority equivalence; hidden program exists source
advice. Every changed guide snippet executes against the fresh pack. Full
five-crate Rust tests, affected client pool, Mac Studio affected platform tests,
qualify-linux --consumer-only (test.sh is prohibited), published 0.4.35/0.4.37
old-CLI upgrades, refs/docs budget and repository-root checks are recorded in
WORKSTREAM-REPORT.md. No version bump, publication or push.
