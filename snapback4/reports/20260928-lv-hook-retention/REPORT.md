# Lane LV — safe default hook retention

Date: 2026-09-28. Branch: `sb4-intent/lv-hook-retention`.
Base after the required `git fetch origin && git merge origin/main`:
`f6ccc4a513b9e5023b340482c992b6234922da78` (already up to date).
Design: [LLP 3000.029](../../../llp/3000.029-hook-retention-with-invalidation.rfc.md),
written before implementation. No push or publication.

## Result and limits

`useQuery` and `usePage` keep their same-key answer indefinitely during plain
revalidation, exposing `revalidating: true`. `{ keep: false }` opts out;
`keep: true` additionally retains the existing 30-second unsubscribed lifetime.
Changed query arguments or client select a new observation with loading. A
withheld response, exhausted retry, or disconnected transport cannot resurrect
an invalidated answer or extend its deadline.

Invalidation is a source operation, before notifications or asynchronous
replacement. Changed dependencies (including rule probes), unknown footprints,
denial, null/empty results, expiry, identity changes, generation changes and
store reset withdraw immediately. Facade approval can retain only an identical
data image with its original deadlines. Accepted one-shot refusals/empty answers
also invalidate the same-key mounted observation, ordered by sequence/ticket on
the local client. A withheld answer preserves the retained answer's dependency
union; unknown dependencies remain unknown.

`useAsset` owns one acquisition, with no automatic re-fetch. Its live handle
withdraws on authority evidence and expiry; changing id/client cannot show the
previous URL even before effect cleanup. Asset GETs carry an additive
`X-Snapback-Asset-Read` header with sequence and earliest row/rule-witness
expiry from the existing authorization transaction. Online asset-only clients
follow changes. A once-view grant is one open view, not an automatic second
request; close/remount cannot reuse it. The social starter and client-card
viewer now use this SDK lifetime instead of copying a URL into application state.

The three EX recipes, client card, reads/social cards, social starter and
`CLIENT-AND-OPERATIONS.md` reflect this contract. Generated `Read` types already
had `revalidating?: true`; the package was rebuilt with the new documentation,
and generated Quarry `Query` operations typecheck through `useQuery`/`usePage`
returning that type. Generated files remain uncommitted as required.

**Precision boundary:** the protocol reports table dependencies, not per-row
authority certificates. A touched dependency conservatively withdraws even for
an innocent same-table write. That may still produce loading. The route witness
covers plain revalidation, not such input invalidation; the starter still owns
navigation by identity. There is no claim of instantaneous remote revocation
while offline: the guarantee starts when evidence reaches the client, plus
locally known deadlines. Older headerless servers remain compatible but provide
no asset deadline certificate. Copied URLs/bytes or decoded pixels outside SDK
ownership cannot be recalled. Authorization rules and runtime meter ceilings
are unchanged. A page invalidated during a held fallback may require one extra
read; its invocation meter and cursor rules are unchanged.

## Census and disclosure witnesses

The exhaustive source/classification table and induction are in LLP 3000.029
§§2–4. The table below maps concrete authority routes to executable witnesses.
`native`/`process` here means the native Rust device over its process ABI; it does
not mean Expo simulator qualification.

| Path | Evidence and witness |
|---|---|
| Plain sync, acquisition and unrelated publication | Real wasm/browser empty same-key sync held 1.6 seconds; property histories; keep-device and retention lifecycle tests. |
| Membership removal, predicted leave, scope transfer, withheld replacement | `answer-withdrawal.test.mjs` on process/wasm plus online: all three keep policies, held/throw/unavailable/exhausted replacement; dependency reset precedes callbacks. |
| Rule change | `asset-lists.test.mjs`: online and wasm held replacement sees row and asset withdrawn; schema discovery and ephemeral incarnation tests. |
| Row deletion / tombstone / replaced inputs | Keep-device, answer-withdrawal, retention-pages, React removal and asset list deletion tests; facade different-image oracle. |
| Asset revocation and membership expiry | Live HTTP asset tests for membership/deletion/sign-out/expiry; rule-witness expiry with `/changes` blocked; original grant deadline and rollback tests. |
| Once-view consumption | HTTP per-element once tests; social browser opens once, survives list remount, closes, receives E_ASSET_VIEWED on second open, revokes late acquisitions. |
| Expiry | Raw-read, held approval, local/server clock, retry, page and asset deadline tests; getters and timers withdraw independently of new traffic. |
| Sign-out, account/backend switch | Online/session boundaries, facade authority tests, social account switch and AssetLifetime in-flight fencing; different hook arguments never reuse old data. |
| Store replacement / restore | Asset lists with held downloads, online terminal-store tests, keep-device and facade fences; the full model stage also passes replacement/restore interleavings. |
| Newer direct-read refusal / empty result | Presence-local direct/background interleavings; cache sequence/ticket ordering prevents an older refusal from withdrawing a newer answer. |
| Arbitrary event order | New property: 200 seeds × 500 events × 3 policies = 300,000 events, plus grouped-notification and asset boundary tests. No plain loading flash after data, no retained row after evidence. |

## Browser and native evidence

The comparative evidence was read only from
`~/clique-cmp-20260928-047/lanes/grok-snapback4/diary.md` and `run-log.md`.
The new browser fixture uses the builder's `EnsureProfile` pattern
(`if (loading) return null`), route state, draft and a mount counter over real
HTTP, wasm and React. Its slow empty sync reproduces the old policy by a Vite
transform that restores only the one-second observation policy; it is not a
separate full baseline checkout. Reproduce with `LV_BASELINE=1 node --test
packages/snapback4/test/hook-retention-browser.test.mjs`; omit the variable for
the implementation witness.

- [Counterfactual reproduction](./browser-baseline-reproduction.log.gz): the old
  policy unmounts the signed-in route and resets `/conversation/bob` to `/`.
- [Passing browser witness](./browser-qualified.log.gz):
  `{"route":"/conversation/bob","mounts":1,"loadingAfterData":0,"profile":"alice"}`.
- [Social browser qualification](./final-social-qualified.log.gz): 16 tests pass,
  including draft/focus preservation, in-flight media withdrawal and account
  reset; starter generated operations and recipe snippets typecheck.
- [Native Expo attempt](./native-expo.log.gz): environmental failure,
  `WITNESS_UDID must name your dedicated booted iOS simulator`. This Linux
  worktree cannot supply that simulator. Expo app typecheck passes in the full
  suite; native-process/device tests pass. No native UI success is claimed.

## Verification

The required complete suite was run **exactly once**, with `bash scripts/test.sh`
from `snapback4/`. Exact final summary:

```text
== 1 failure(s) in 1655 s
   client tests
```

[Complete output](./test-sh.log.gz). This was an intermediate implementation
run: fixes and assertion migrations continued while it ran. It is not a green
complete-suite qualification of the final tree. Cargo/build/wasm/release guard,
docs, package and both app typechecks, fixture wrapper tests, Rust tests, and the
79-test full model stage passed. The model stage retains its 5,000-sequence
online, 5,000-sequence local and 3,000-sequence online programs and scheduled
regressions. Two already-failing client children were terminated to release
broken teardown; both their fixtures and their product cases now complete.

Every captured failing name, its log/line and classification appears in
[FAILURES.md](./FAILURES.md) and [failures.json](./failures.json). All client,
fixture, assertion and scheduling failures are **ours**; none is claimed as a
baseline failure. The absent iOS simulator is **environmental**. The inventory
also records operational missteps and initial type/build corrections.

The broad affected run found one final product bug: direct `E_OFFLINE` was
incorrectly broadcast as authority evidence. It now checks the transport marker;
all three opt-out host cases and 38 targeted transport/refusal cases pass. The
831 other cases in that run passed, including the longer facade models. No known
failing affected case remains; neither aggregate run is relabelled green.

Affected verification (commands run from `snapback4/`):

| Check | Result / evidence |
|---|---|
| All modified client test files plus new property/browser witnesses | 831 pass / 1 fail (832 total); the failure was the direct transport-refusal bug fixed below. Run recorded in [final-affected.log.gz](./final-affected.log.gz); exact command in [final-affected-command.txt](./final-affected-command.txt). |
| Final transport/refusal distinction, online presence/session | 38 pass / 0 fail, [transport-qualified.log.gz](./transport-qualified.log.gz); includes three new direct-offline policies and actual denial/null/empty evidence. |
| Corrected opt-out cases on online/native/web | 3 pass / 0 fail, [optout-qualified.log.gz](./optout-qualified.log.gz). |
| React, deadlines, read observation, social and sync-scale | 93 pass / 0 fail, [final-surface-tests.log.gz](./final-surface-tests.log.gz). |
| Latest social templates and browser | 16 pass / 0 fail, [final-social-qualified.log.gz](./final-social-qualified.log.gz). |
| Approval independent oracle + lifecycle | 484 pass / 0 fail, [approval-qualified.log.gz](./approval-qualified.log.gz). |
| Full ordinary-search oracle, process and wasm | 8 pass / 0 fail, 300 seeds per host, [search-oracle-qualified.log.gz](./search-oracle-qualified.log.gz). |
| Query expiry/session/store regressions | 52 pass / 0 fail, [final-query-regressions.log.gz](./final-query-regressions.log.gz). |
| Presence-local / presence-online | 26 + 10 pass / 0 fail, [presence-qualified.log.gz](./presence-qualified.log.gz), [presence-online-qualified.log.gz](./presence-online-qualified.log.gz). |
| Rust core asset list authorization | 28 pass / 0 fail, [rust-assets-qualified.log.gz](./rust-assets-qualified.log.gz). |
| Rust HTTP asset placement and once consumption | 3 pass / 0 fail, [rust-asset-serving-qualified.log.gz](./rust-asset-serving-qualified.log.gz). |
| Whole guide (`cargo test -p snapback4-lang --test guide`) | 98 pass / 0 fail, [guide-final-qualified.log.gz](./guide-final-qualified.log.gz). |
| Client declarations/build; Rust binary | Pass, [client-build-final.log.gz](./client-build-final.log.gz), [final-rust-build.log.gz](./final-rust-build.log.gz). |
| Docs budget / reference audit / whitespace | README 300/300; ref-check 0 errors; git diff --check passes. |

The exported/generated flag is verified in `dist/contract.d.ts`; the generated
chat API imports the shared `Query` contract, and `dist/react.d.ts` returns
`Read<R>` from both query and page hooks. No generated publication leaf is added.

## Wasm and custody

Canonical `scripts/build-wasm.sh` (also passed inside the one full suite):
**2,040,999 bytes raw / 593,213 bytes GNU file-input gzip-9**. Unchanged cap:
593,719 bytes; headroom: 506 bytes. SHA-256:
`001b4f9e47acead1dc202060f35e409c4ae31826d972e88965489b3e3cd8c436`.
[Machine-readable measurement](./wasm-measurement.json). Settlement now returns
touched tables from its existing restore/replay work, avoiding new scans or
meter allowances. Asset grant additions are server-only. No per-component byte
attribution or separately rebuilt baseline delta is claimed.

Dependencies were installed only in this worktree. No shared tool installation,
push, deployment or publication. LLP 3000.029 is implemented and archived from
`llp/current`; one journal entry accompanies the code. The commit carries
`Co-Authored-By: GPT-6 Astra <noreply@openai.com>`.
