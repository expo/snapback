# SR round 2 — retire unused associations and bound route recovery

Merged `origin/main` `a2e3876b60` first in `afe6c62d92`, keeping both journal
histories and the KR keep-remount/macOS fixes. Read both prior prompts/reports,
Astra's complete round-1 review and Grok's complete round-0 review. Context and
scoped LLP reconciliation: [CONTEXT.md](./CONTEXT.md). Local commit only;
nothing pushed or published.

## Result

An association now belongs to a saved send. Saving a provisional send atomically
saves its peer before SDK dispatch; opening/navigation alone creates no journal
entry. Successful, failed and abandoned openings without sends leave no storage.
Every save prunes associations with no remaining saved send; mounting a conversation
also prunes old orphan entries. Success or Dismiss removes a send; removing the
last one removes its association and an empty journal removes the storage key.
There is no age/count eviction of pending, failed, restoring or unknown intents.
Multiple sends on one proposal preserve the link until the last one is removed.

The conversation mounts at most one `directPeer(conversation)` recovery lookup.
Its private replicated key resolves the current route's peer even after leave;
it never fans out over every unresolved peer. `why directPeer` confirms device
execution, no horizon and a constant bound of at most two examined rows
([explanation](./direct-peer-why.log.gz)). Existing opening-route settlement still
observes its own forward key and write receipt. Unrelated recoverable sends keep
all their associations; admitted arguments are neither rewritten nor resubmitted.

Grok's Send edge received a small defensive fix: null membership blocks Send only
when complete, fresh and non-revalidating (or when denied). An injected incomplete
null must permit custody. The current point-read publisher normally withholds
unknown coverage as loading. LLP 3000.028 §8 records that former dependency and
Grok's remaining key-rule limitation: `openDirect` is the only key writer and
inserts both memberships atomically, but the key insert rule does not independently
require owner membership. Existing membership/key rules remain unchanged.

No SDK, engine, device, retention, delivery, typing or media implementation changed.
The only schema addition is the private reverse query and its inferred index.
The social card embeds the final code; the installed README and LLP §8 agree.

## Verification

| Check | Result / evidence |
| --- | --- |
| Affected starter/browser suite | **32 passed, 0 failed**, [log](./affected-final.log.gz) |
| Both process/native and wasm hosts | Concurrent opposite HTTP requests held before either commits; equal returned IDs; losing and offline-losing proposal rows absent in raw SQLite; private keys; offline forward/reverse lookup; leave/reopen does not restore membership, inbox, protected content or send access |
| Storage lifetime | Final dismissal removes the key; two sends share an association safely; 1,101 legacy orphan proposals retire while the one recoverable send/link stays; account/backend isolation and inactive-owner refusal remain |
| Browser recovery | Failed provisional sends survive Profile/reload/bare route and unmount before settlement; terminal failed/abandoned openings save nothing; one route lookup despite 100 unrelated unresolved peers; arguments unchanged; no automatic resubmit |
| Whole guide | **99 passed, 0 failed**, [log](./guide.log.gz) |
| Generated starter check | **17 tables (15 synced), 30 operations, no problems, 6 notes**, [log](./check.log.gz) |
| Generated web/Expo and guide TypeScript | Pass in affected tests; installed app also passes, [log](./typecheck-installed.log.gz) |
| Production web export | Pass, [log](./export-web.log.gz) |
| Production iOS export | Pass, **Hermes v98**, [export](./export-ios.log.gz), [format](./hermes-format.log.gz) |
| Existing line budgets | Client **130/130**, package README **300/300**, starter README **107**, [counts](./budgets.log.gz) |
| LLP references | **524 LLPs, 9,931 refs, 0 errors, 0 unchecked**, [log](./refs.log.gz) |
| Full suite, exactly one invocation | **`== 0 failure(s) in 1269 s`**, exit 0; [log](./suite.log.gz) |

The full run passed every stage: **4,341 Rust passes / 33 declared ignores**,
**5,197 client passes / 10 existing skips / zero cancellations**, **nine fixture
passes**, and **79 model passes**, including the full configured session and
online-client sequence counts. Both app typechecks, docs/release checks and package
build/typecheck passed. Full-run failures: **ours 0, baseline 0, environmental 0**.
The inherited nominal 60-second process budget was exceeded; no ceiling, timeout
or model count was relaxed. The affected product source, tests and LLP text match
[their pre-run hashes](./source-before-suite.json) after the full run. It was invoked
exactly once, with no subsequent source/test changes requiring another full run.

The full run rebuilt wasm: **2,040,531 B raw / 592,979 B gzip**, cap **593,719 B**,
headroom **740 B**. SHA-256:
`76ffca354815401fdf2f29ed59d9a4a2b14d3abbbdf76cda9bc8c4f4efaefc95`.
Source/export/review/wasm bindings: [artifacts.json](./artifacts.json).
Installed exports reuse the earlier locally installed app dependencies and this
round's exact starter sources plus locally built client dist; no npm publication.
Optional native runtime smoke was not run on this Linux host. Browser DOM hosts
and Hermes export do not qualify native lifecycle behavior or a calibration score.

## Detecting controls

The [scaffold mutation runner](./mutate-starter.py) changes only the temporary
app emitted by the real CLI. From `snapback4/`, set `SR_MUTATION` and
`SNAPBACK4_BIN="$PWD/reports/20260929-sr-starter-routes/round2/mutate-starter.py"`,
then invoke the indicated Node test. Product sources remain fixed throughout.

| Control | Detecting assertion / evidence |
| --- | --- |
| `cleanup`; `--test-name-pattern='social proposal'`, starter file | Retaining orphan associations fails the last-send pruning assertion, **2 instead of 1**; [log](./mutation-cleanup.log.gz) |
| `fanout`; `--test-name-pattern='social DM routes'`, browser file | Restoring per-peer lookups mounts **101 forward lookups instead of one reverse lookup**; [log](./mutation-fanout.log.gz) |
| `association`; same browser command | Omitting the atomic peer association hides both reopened failed sends; the later empty-store assertion also fails because those sends could not be dismissed; [log](./mutation-association.log.gz) |
| `orphan`; `--test-name-pattern='social DM'`, starter file | Both replies still return the same canonical ID, but creating the losing proposed conversation fails the raw-row absence assertion on **both hosts**; [log](./mutation-orphan.log.gz) |
| `complete`; `--test-name-pattern='social recipes'`, browser file | Removing `member.complete` disables Send for incomplete null; quiet-hint/custody regression fails; [log](./mutation-complete.log.gz) |
| [rejoin-control.mjs](./rejoin-control.mjs) | Seeds the forbidden restored membership immediately after successful reopen; both hosts fail **reopening must not restore the caller's membership**; [log](./mutation-rejoin-final.log.gz) |

The concurrency barrier receives both complete HTTP mutation bodies before
forwarding either to the actual dev server. It asserts zero completed calls and
neither proposed row present before release. It does not depend on Promise.all
winning a timing race or pretend SQLite runs two writer transactions simultaneously.
The raw SQLite assertion is necessary: an authorization-filtered null alone could
hide an orphan. The rejoin control is explicitly a behavioral fixture injection;
it does not claim the existing insert rule permits self-rejoin.

## Every failure and disposition

Parent test-group failures below repeat their failing children's cause; they are
not independent defects. All logs retain their raw contents as gzip.

| Classification | Failure | Disposition |
| --- | --- | --- |
| Ours, merge resolution | `JOURNAL.md` conflict when merging main | Preserved both append-only entries; no product-source conflict. |
| Ours, corrected test setup | Failed-opening browser check waited for `mutate(waitSeconds:0)` to return the terminal `SELF_DM` refusal; two runs timed out | Custody may return pending. Now waits for the same opening ID's terminal receipt. [Initial browser](./browser-initial.log.gz), [affected before correction](./affected-before-receipt-fix.log.gz); [fixed DM run](./dm-fixed.log.gz) passes 7/7, final affected passes 32/32. |
| Ours, rejected negative-control setup | First rejoin mutation widened membership insertion with `.principal = viewer` | Compiler independently refuses `E_SYNC` before runtime. [Log](./mutation-rejoin.log.gz). Replaced by the explicit post-reopen seed control; it reaches and fails the membership assertion on both hosts. This rejected schema is not claimed as a runtime detection. |
| Ours, expected negative controls | Cleanup, fanout, missing association, orphan conversation, incomplete-null gate and restored membership | All fail their intended assertions; see table above. Missing-association control's later cleanup failure is a consequence of its inaccessible saved sends. |
| Ours, setup | Export check initially used paths relative to the app while the shell was still at the Snapback 4 root | Redirection failed before the check ran; reran from the installed app. Final check/typecheck/exports pass. A preliminary LLP read used the wrong filename; corrected before orientation/editing. |

Full-suite failures: **none** — ours **0**, baseline **0**, environmental **0**.
The merged KR keep-remount check passed. Exact summary: **`== 0 failure(s) in 1269 s`**,
exit **0**. No final affected-test failure remains; the corrected setup errors and
intentional negative-control failures above remain part of the record.
