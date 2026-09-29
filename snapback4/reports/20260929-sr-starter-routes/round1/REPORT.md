# SR round 1 — Astra review fixes

Merged `origin/main` (`aee0273561`) first, producing `0c5ac3e3f7`. The only
conflict was the append-only journal; both sides remain. EA's bounded identity
wait and NP's native witness are retained. Local work only; no push/publication.
The round 0 prompt/report and complete Astra review were read. Context and scoped
LLP audit: [CONTEXT.md](./CONTEXT.md).

## Changes

Send now blocks only on denial or fresh, non-revalidating negative membership.
Stale/offline, loading, withheld and revalidating answers permit custody with the
quiet hint. The server still authorizes the send. LLP 3000.028 §8 and the social
card no longer treat offline absence as current confirmation. `seen` is unchanged.

Before opening a DM, the starter saves its proposed ID and peer in the existing
account/backend-scoped journal storage. A ready, non-pending private key durably
associates every proposal for that peer with its canonical conversation. Every
conversation mount resolves unfinished associations, so leaving before settlement,
Profile reopening, a bare canonical route and full reload all recover failed sends
with text, Edit and Dismiss. Admitted arguments remain byte-for-byte equal; recovery
never resubmits. The storage test covers two proposals, account/backend isolation,
retained associations after dismiss and refusal of writes by an inactive owner.

No server rule, SDK, engine, retention, delivery, typing, once-media or native
witness implementation changed. The route's existing replicated-key fallback stays.
The automatically merged client card was 131/130 lines; condensing two existing
prose lines preserves both EA and SR content within the unchanged budget.

## Verification

| Check | Result / evidence |
| --- | --- |
| Affected starter/browser tests | **30 passed, 0 failed**; [log](./affected-final.log.gz) |
| Whole guide | **99 passed, 0 failed**; [log](./guide-final.log.gz) |
| Generated starter check | **17 tables, 29 operations, no problems, 6 notes**; [log](./check.log.gz) |
| Generated web/Expo TypeScript and embedded snippets | Pass in affected suite; installed TypeScript check also passes; [log](./typecheck-installed.log.gz) |
| Production web export | Pass; [log](./export-web.log.gz) |
| Production iOS export | Pass, Hermes v98; [export](./export-ios.log.gz), [format](./hermes-format.log.gz) |
| Budgets | Client card **130/130**, package README **300/300**, starter README **107**; [counts](./budgets.log.gz) |
| Full blocking suite, one invocation | **`== 0 failure(s) in 1277 s`**, exit 0; [log](./suite.log.gz) |

The full run passed every stage: all Rust targets/doctests, both app typechecks,
fixture tests, **5,195 client passes / 10 skips / 0 failures**, and **79 model
passes / 0 failures**. The inherited round-0 keep-remount assertion passed this
time; no baseline or environmental test failure occurred. The nominal 60-second
budget was exceeded; no count, timeout or budget was relaxed. Final test-fixture
refinements finished before this run reached its client phase; the suite was
invoked once and never restarted.

Wasm: **2,040,531 B raw / 592,979 B gzip**, cap **593,719 B**, headroom **740 B**.
Measured by this round's full suite, not copied from round 0. Source/export/wasm
SHA-256 bindings and merged-main identity: [artifacts.json](./artifacts.json).
The installed export workspace reuses round 0's installed dependencies with this
round's exact scaffolded sources and locally built client dist; no package was
published. The optional macOS runtime witness was not run here. An iOS Hermes
export and browser DOM hosts do not claim native runtime qualification.

## Regression and mutation evidence

[mutate-starter.py](./mutate-starter.py) wraps the built CLI and changes only its
temporary generated app. Non-scaffolding commands exec the actual CLI. Reproduce
from `snapback4/`, setting `SR_MUTATION` to the named mutation and `SNAPBACK4_BIN`
to the absolute wrapper path, then run the indicated Node tests. No repository
product source is mutated; no schema or test budget is weakened.

| Mutation | New failing assertion | Fixed evidence |
| --- | --- | --- |
| `stale`: remove `member.fresh` from Send gate | Real stale-negative test fails waiting for the quiet hint; Send remains disabled. Alice leaves, syncs, disconnects; Bob re-invites. Both direct query and the actual screen observation must be `{data:null, complete:true, fresh:false}` without revalidation before the UI assertion. [Log](./mutation-stale.log.gz) | Same test passes; send enters custody offline and reaches server after reconnection. |
| `association`: omit saving the proposed ID before open | Profile reopen hides Edit; leaving before settlement then reloading a bare canonical route also hides Edit. [Log](./mutation-association.log.gz) | Both pass, including saved argument equality and an empty canonical server history (no automatic resend). |
| `public`: make DM keys legally public (`read <- true`, `sync public`) | Both process/native and wasm outsider replicas acquire **2 rows instead of 0**, after acquisition completes. The previous outsider query still asks for its own nonexistent pair. [Log](./mutation-public.log.gz) | Both hosts acquire zero keys in the affected suite. |
| `fallback`: remove replicated-key route recovery | A successful receipt without `result` cannot replace the proposed route with the canonical ID. [Final log](./mutation-fallback-final.log.gz) | Release the held real key; the URL settles and draft survives. |

`node --test --test-name-pattern='social DM'` over `social-starter.test.mjs` and
`social-browser.test.mjs` runs the mutations. The public final run uses the starter
file only; the fallback final run uses the browser file with pattern `social DM routes`.
The recovered-receipt witness observes a real successful write and removes only its
optional historical `result`; it holds/releases the real replicated-key observation.
It proves the receipt supplied no destination before releasing that key. It does
not fabricate success or inject membership loading.

The unmodified fixed-source affected suite passes all 30 tests. Round 0 itself
also failed the two new reopen assertions before implementation
([initial regression run](./regressions-before.log.gz)).

## Every failure and disposition

No failure is omitted below; parent test-group failures are counted with their
failing children, not as independent defects. Raw logs are retained verbatim as gzip.

| Classification | Failure | Disposition |
| --- | --- | --- |
| Ours, corrected | Guide `client_aliases_keep_typing_on_ephemeral`: merged card was 131/130 lines | Both parents were 130. Condensed existing prose without dropping either lane's additions; final guide 99/99. [Initial log](./guide.log.gz). |
| Ours, expected negative controls | Round 0 reopen regressions; stale gate, missing association, public keys and missing fallback mutations | Fail at the requested behaviors; fixed suite passes. See mutation table and logs. |
| Ours, test setup | First stale-negative regression could pass while the UI was still revalidating | Now waits for the screen's actual completed stale-negative observation before asserting; removing freshness fails. No injected membership state. |
| Ours, test setup | Intermediate observed-answer run lost harness globals (`membersDM`, then `connectDM`/`finishDM`) while fixtures/builds were being edited | Final stable fixture/build run passes. [Intermediate log](./regressions-before-observed.log.gz). |
| Ours, mutation-runner setup | Initial wrapper spawned dev/device children instead of replacing itself, leaving cleanup waiting | Non-scaffold commands now use `execv`; owned processes cleaned up. Incomplete [initial log](./mutation-stale-wrapper-initial.log.gz) is not counted as qualification. |
| Ours, mutation setup | Changing only `sync public` conflicts with the private read rule and fails `check` with `E_SYNC` | Final valid public mutation widens the matching read rule too and fails both actual acquisition assertions. [Rejected schema log](./mutation-public-invalid-schema.log.gz). |
| Ours, test assumption | Initial fallback mutation run also saw leave return `pending` rather than `sent` | Test now waits for that write's terminal receipt before sync/absence checks. Final fallback control fails only its intended recovery assertion. [Initial log](./mutation-fallback.log.gz). |
| Environmental, non-blocking | Optional `~/Dropbox/APIKeys/MACHINE_FLEET.md` is absent on this host | Used the warm local Linux lane; no required check was omitted. |

Other setup errors were ours: read commands used nonexistent guide/helper paths, two
edit scripts used the wrong working directory, and export setup had a bracket typo
and a wrong binary path. All were corrected before their intended operation ran;
no product change or verification claim depends on those failed commands.
The final fallback negative-control log includes a React render-time update warning
from the inherited SDK/HistoryPage path; it is not a passing product qualification.

Full-suite failures: **none** — no SR-owned, baseline or environmental test
failure. Exact final summary: **`== 0 failure(s) in 1277 s`** (exit 0).
The earlier corrected and intentional negative-control failures above remain
part of the record; the passing full run does not erase them.
