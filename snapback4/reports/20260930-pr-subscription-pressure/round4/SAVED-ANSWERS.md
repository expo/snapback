# Saved-answer and evidence audit

The detach epoch continues to cover all accepted evidence, even a quiet empty
notification. Saved memory is scoped by actual evidence, independently of the
live owner map. Empty known footprints remain disjoint, preserving the prior
contract; unknown footprints stay conservative.

| Evidence channel | Remembered server answers / old evaluations | Detached or facade-held answers |
| --- | --- | --- |
| Accepted `/changes` | `notified` clears intersecting tables (all if omitted); nonempty/unknown evidence advances the existing authority revision, retiring first/in-flight replies and copied recovery candidates too. Empty table list retains memory. | Epoch discards saved raw snapshot; resumed cut only intersects notified tables, unknown dependencies match all. Live owners retain their existing change version and bounds. |
| Local `apply`, `admit`, `settle` | `committed`/`clear` use touched tables without requiring live owners, and advance revision. Known disjoint memory survives. | Epoch handles closed owners; affected live owners reload under the existing bounded episode. |
| Sync publication | Successful apply performs the commit rule first. `applied` clears pending notification/scope cuts through the actual watermark and advances epoch even with empty touched tables. Online-only answers were already retired at notification acceptance; no live owner is required. | Getter discards saved state; resumption reads the actual watermark. Publication clears waiting live owners even with a disjoint footprint. |
| Scope tombstone, staged or published | `withdraw` matches table/audience metadata and ticket-fences affected remembered answers; the enclosing apply advances revision before any completion. | Epoch covers detached owners; pending group cuts fence every evaluated answer and one-shot result. Live followers withdraw synchronously. |
| Terminal change-feed or partition refusal | `refuse` clears all memory; evaluator and final publisher check the terminal refusal. Partition refusal now uses the same path. | Epoch and raw refusal validation; reset/withdrawal followers retire facade approval before callbacks. |
| Credentials | Rotation clears memory and advances existing authority revision plus evidence epoch before asynchronous rotation. Pending notification/scope cuts remain. Credential revision still fences HTTP responses. | Existing raw reset, expiry cleanup, and follower invalidation apply. |
| Viewer, store, schema, generation, sign-out | Existing incarnation/session reset clears memory and advances revision/epoch; hard reset clears pending cut maps. | Raw hard reset, facade validity/approval checks, and stable terminal denials. |
| Expiry | Existing per-key expiry barrier rejects older bodies; row/server deadline checks remain at evaluation and publication. | Raw/access-time deadlines, facade follower and fixed closed-deadline checks remain. |
| Ephemeral notification/reset | Ephemeral answers are never remembered (`remember = !ephemeral`). Existing request/incarnation validation rejects old ephemeral candidates; mounted changes use `changed`. | Raw change/reset and facade followers apply; accepted durable feed response also advances the detach epoch. |

`evaluateLocal.recover` reads the same RememberedAnswers map; it does not own a
second persistent store. A copied candidate rechecks authority after each await
and at publication. New regressions hold its final queued read across a
notification. A separate test holds a first server reply before it has ever
entered memory. Both fail on round 3 on wasm and process.

`guardClient` consults `source.getSnapshot()` before exposing its approved held
answer; that validates the detached epoch. ReadApprovals shares the source's
reset/withdrawal followers, expiry and episode. A one-shot facade result held
behind authority approval still calls approveDelivery's current predicate.
The new pending-approval tests fail on round 3 and pass with the same revision
fence as the recovery test. A closed facade and a newly queried facade are also
checked in the no-owner revoked-memory regressions. No facade-specific epoch
or saved-answer registry was added.

`peekObservation` reads only the live map, where synchronous withdrawals and
change bounds apply. Lingering observations remain live; the existing raw/facade
retention, close, expiry, scope and key tests cover them. React page caches follow
source withdrawal/deadline metadata and remount with new observations; they are
not another server-recovery store.
