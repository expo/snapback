# Result and saved-answer publication audit

This audit follows the final merged implementation. It covers ways an existing
answer or an asynchronous result can become visible again, rather than only the
storage maps. The full suite is a regression check, not a proof of every schedule.

One LocalReads.revision now replaces the two global evidenceEpoch/authority
counters. `evidence()` advances it for every change notification, commit, publication, scope loss, refusal and
reset. A known empty poll without a sequence advance carries no change evidence
and leaves authority unchanged; this avoids exhausting bounded query retries. Credential
rotation calls that same method. `refuse` advances it on every invocation,
including repeated refusals and no live owners. Clearing `partitionDenied` is
not a revision reset. The test holds successful apply *after* that clear and
releases older raw HTTP and facade candidates on both device hosts.

| Route back to publication | Fence before exposure or a saved write |
| --- | --- |
| First server response, including a key never remembered | `evaluateLocal.checkpoint` captures authority/incarnation before evaluation and checks after every wait, before memory mutation, and before return. `publishLocal` checks again at final publication. |
| Server answer saved in RememberedAnswers | Only the evaluator's final `publish` writes it after authority, credential, prediction, deadline and pending checks. Every apply/publication now clears the map irrespective of replica footprint. Notification/local-commit invalidation operates independently of mounted owners. |
| Candidate already copied from remembered memory | `recover` uses the same map; subsequent `blocked`, `pending`, `followingPending`, and final evaluator/publisher checkpoints compare authority. There is no second recovery store. |
| Raw one-shot, including retry after temporary denial clears | Main's settledQuery retains four rounds/30 seconds. Every round captures a fresh authority revision; final publication rejects the old one synchronously. Terminal selectors and scope cuts still apply. |
| Facade one-shot held at final app approval | Main's queryAttempt closure invokes the raw publication predicate after asynchronous approval, then approveDelivery checks validity. No await follows the final synchronous publication. A later successful sync cannot bless the older revision. |
| Normal observation completion, requeue, lifetime retry | Global revision plus owner reset/change versions, signal, live-map identity, pending cut and incarnation checks reject the retired attempt. Requeue gets a new attempt; it does not restore an older result. |
| Quiet presence completion | runLocal and publishLocal share authority checks; unchanged snapshot/owner/change version and `answers.current` also qualify the sample. Ephemeral request revision/expiry remains independent. |
| Detached raw getter and resubscription | `restore` checks terminal refusal and compares the revision recorded by `detach` with the same global authority counter. Mismatch discards saved answer/cuts before exposure. Getter never parks an unregistered owner. Resumption reconciles the actual device watermark through cancellable `duringRead`. |
| Closed handle during staged scope loss, then publication | Same revision rule; publication clears reached cuts. Staged group cuts fence evaluated new/resumed/direct answers before data publication. `restore` removes obsolete detached cut/wait state. |
| New observation / `keep:false` / reacquired `keep:true` | Shared observeWatch registration and raw validation precede reuse. Nonretention resets immediately; lingering owners remain live and get evidence. Linger expiry resets before a late timer can revive it. |
| Live server/composed answer later detached | Every apply revalidates owners with serverRead or remembered-wakeup provenance, even for disjoint replica tables. Their prior answer keeps its existing episode/row limits while current work runs; saved recovery memory is already retired. |
| peekObservation | Only current live owners are eligible; terminal checks, raw deadline checks and synchronous withdrawals run before exposure. It does not register detached owners. |
| Mounted app facade / shared approved answer | Raw source validation runs before exposure. ReadApprovals follows source resets, refusals, loading, expiry and episode changes; approval generation and refresh version reject pre-withdrawal completions. These protect per-owner app approval, not a second global evidence epoch. |
| Closed app facade | Consults validated raw source; cannot adopt a new identity. First exposed deadline is latched and can only shorten. A source withdrawal clears the saved facade value. |
| React hooks and usePage's earlier pages | Raw/facade snapshot authority plus source withdrawal/deadline metadata. First-page withdrawal clears all displayed items; later-page withdrawal removes its suffix. Cursor/key replacement retires that cache. |
| Freshness-only copy at sync completion | No new row contents are computed. Server/composed/remembered owners now revalidate through the apply path; purely local copies require current incarnation, caught-up identity and no pending-cut/kept condition. |
| Late delivery acceptance / app approval of a manifest | publishDelivery/offerDelivery carry the same current predicate; collection rechecks it. A collection retry cannot publish or unaccept a read. |

Evidence boundaries:

- **Sync:** committed apply invalidates before media, metadata and other fallible
  post-commit work, including apply-plus-throw. Final observed publication repeats
  invalidation after reading the real watermark. Empty, unknown, housekeeping,
  nonempty, staged and no-op footprints cannot authorize saved server data.
  Lost apply acknowledgment followed by a successful no-op sync is tested.
- **Notification:** a known nonempty table list invalidates intersections;
  omitted tables or an empty advancing list invalidates all and supplies an
  unknown inherited cut. An empty nonadvancing poll keeps completed memory and
  preserves pending/detached authority as well. Unknown/nonempty notifications
  still fence even without a sequence advance; store/generation/restore changes
  use their separate reset paths.
- **Local admit/settle:** known disjoint memory survives; unknown dependencies
  are conservative. Every commit advances authority for pending/detached data.
- **Scope loss:** audience precision chooses immediate live withdrawal; staged
  cuts block replacements until publication. Sync's broad memory invalidation
  does not widen this immediate audience withdrawal.
- **Terminal refusal:** all memory cleared, revision permanently advanced,
  live owners reset and callbacks delivered synchronously. Repeated refusal is
  still a boundary; success only clears temporary denial.
- **Credentials/viewer/store/schema/program/sign-out/close:** existing transport,
  incarnation, session and public-scope fences remain. Resets clear memory and
  cut maps before reuse; stale refreshes cannot restore authority.
- **Expiry:** per-key ticket barriers prevent old bodies from reentering memory;
  local/server deadline checks at access and publication prevent clock rollback
  or an in-flight completion from restoring expired contents.

Counters retained for distinct purposes: incarnation binds the device/store;
credentialRevision binds HTTP requests; per-watch change/reset versions bind
owner scheduling and withdrawal; memory tickets/cuts order concurrent replies
and expiry; facade approval generation binds a particular shared owner. The
redundant global detached-evidence counter is deleted. No new fence state,
watermark mirror, closed-owner registry or recovery cache was introduced.
