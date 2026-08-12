# Review artifact — LLP 0034 §11 draft amendment (Claude family)

**Round:** 1
**Date:** 2026-08-11
**Target:** `llp/0034-contract-source-seam-provider-side.rfc.md` §11 "Draft amendment: iterator-owned headless live observation (2026-08-11)" (uncommitted working-tree revision, blob `5afd0d4f839242e2cf4f09fba67a4bb32b0f6e14`; tree at `03abba3be`)
**Scope:** §11 only. The rest of LLP 0034 is Accepted and is treated as binding context, not as review surface.
**Context read:** LLP 0034 §§1–2.4, 3, 10.5, 10.8–10.11; LLP 0200 §§ settlement/convergence; LLP 0090/0091 resume rungs as cited; LLP 0187 (evidence claim); `diaries/0075-tiny-triumphs.diary.md`; `issues/closed/20260810-durable-unsubscribe-withheld-behind-shared-connection-demand.md`; `tests/acceptance/axis-parity-harness.mjs`; `guide/clients/headless.md`; `guide/conventions.md`; and the shipped implementation in `packages/snapback-client/index.mjs`, `packages/snapback-client/index.d.mts`, `packages/snapback-contract/keyed-provider.mjs`, `demos/tiny-triumphs/tests/acceptance/headless.mjs`.
**Reviewer runtime:** Claude family, independent read of primary sources; blind to any sibling review.
**Verdict:** NOT READY

---

## Summary

The underlying instinct is right. "Observe this query until I stop" genuinely has no control-flow-shaped surface today, and the shape §11 proposes — cold, single-consumer, latest-value-coalescing, iterator-owned disposal — is the correct shape for that intent. Most of the observation semantics are carefully thought through and match the shipped handle's actual behavior (freshness ladder, authorization precedence, the retained-then-current double yield, the LLP 0200 settlement caveat). If the amendment were only proposing that shape, this would be a short review.

It is not ready, for three reasons that are each independently disqualifying as written:

1. Its stated evidence does not support it, and one of the two data points is used against its own source's meaning.
2. Its acceptance item 4 contradicts a currently-green assertion in the complete battery, silently amends an Accepted MUST NOT in §10.11, and rests on a root cause that the closing ticket explicitly declined to diagnose — while the shipped code shows the low-level handle *already* attempts exactly the retirement item 4 demands.
3. Its cleanup rule ("dispose that handle and await its settlement") is not satisfiable through either publicly typed route, and is factually wrong about what `settled()` awaits.

None of the three requires rethinking the surface. All three require the amendment to say different things before an author can rule on it.

---

## What I verified against the code

Accurate in §11, confirmed:

- `liveQuery()` returns a promise for a mutable handle with `.rows`, `.version`, `.connection`, `.poll()`, `.dispose()` (`packages/snapback-client/index.mjs:10107`, `:10323-10377`; `packages/snapback-client/index.d.mts:569-592`).
- `transport` defaults to `'poll'` (`index.mjs:10111`).
- `startLiveQuery()` is a separate wrapper exposing the not-yet-established handle at `.current`, plus `started()`, `dispose()`, `settled()` (`index.mjs:10049-10093`; `index.d.mts:668-673`).
- The snapshot member vocabulary §11 proposes matches the shipped facts: `connection` union (`index.d.mts:573`), `freshness: 'retained' | 'current' | null` (`:580`), `LiveQueryAuthorizationDenial` (`:563-567`, `:576`).
- Item 5's LLP 0200 caveat is correct: "settlement never awaits fan-out or subscriber evaluation" (`llp/0200-live-evaluation-scheduling-and-settlement.spec.md:83`).
- Item 6's "a `CurrentAsOf` answer does not terminate the iterator" is consistent with the code: `current_as_of` advances `handle.version`, sets `freshness: 'current'`, leaves rows untouched, and still calls `onUpdate` (`index.mjs:11769-11804`) — so §11's "double yield even when rows compare equal" is not only defensible, it is the shipped delivery shape.

Inaccurate or unsupported in §11 — detailed below: the LLP 0187 evidence attribution (B1), the §10.11 inference and acceptance item 4 (B2), the cleanup/settlement rule (B3), the "one client-owned connection label" default (M1), and "changes no Accepted requirement yet" in the revision header (part of B2).

---

## Concerns

### B1 — BLOCKING. The stated evidence does not support a new public surface, and the LLP 0187 citation inverts its source.

Passage: "The types and Guide document those facts. They have nevertheless produced two independent wrong mental models: LLP 0187 records `.rows` versus `.current` confusion that accurate type declarations rescued; and Diary 0075 initially treated the promise-resolved `liveQuery()` handle as an async iterator…"

LLP 0187 records that item under the heading **"What routed correctly — the control group"**: "**Accurate type declarations**, which rescued at least one wrong mental model (`.rows` vs `.current` on a started live-query handle)" (`llp/0187-agent-discoverability-routing.rfc.md:166-167`). In its own source this is an example of a mechanism *working*. §11 recruits a control-group success as evidence of a surface defect. That is not a small citation slip: it is one of the two legs the amendment stands on, and §11 even concedes the rescue ("that accurate type declarations rescued") while still counting it as a wrong model the surface produced.

The second leg is weaker than §11 admits. Diary 0075 says: "The headless guide does document the actual handle (`rows`, `poll()`, `dispose()`) and the need for a `connectionId`, so this was an implementation mistake rather than a guide gap" (`diaries/0075-tiny-triumphs.diary.md:29-34`). The diary does not ask for a new API and did not file a `guide-gap` ticket for it (it filed one for the npm Contract typecheck instead). §11's rebuttal — "The second case is not a Guide gap… Repeating more handle prose does not remove that API-model translation" — asserts the conclusion rather than arguing it, and never considers the cheap alternatives on the table: a `for await`-shaped recipe in `guide/clients/headless.md`, an `openLiveQuery()` naming fix (which §11 itself defers), or a one-line "this is not an async iterator" note beside the existing handle description.

This matters because the amendment's own thesis is that the durable-live family is already too large to model correctly. That family is already seven public members (`guide/clients/headless.md:564`: `liveQuery`, `startLiveQuery`, `subscribeLive`, `unsubscribeLive`, `openLiveStream`, `liveStreamManager`, `acknowledgeAuthorizationInvalidation`), plus `AssetClient.watch`/`watchStore` and `ExternalQueryScope.watch` in adjacent families. Adding an eighth on two data points — one of which is a documented success and the other a self-diagnosed implementation mistake — is a design bet, not an evidence-driven fix, and the amendment should say so plainly.

The honest evidence §11 *should* be citing is sitting in the same diary's landed proof, and it is better than either bullet it uses:

```js
// demos/tiny-triumphs/tests/acceptance/headless.mjs:25-30
const live = await app.client.liveQuery(api.recentTriumphs, { args: { limit: 10 }, connectionId: 'tiny-triumphs-live', transport: 'stream' });
const streamedId = (await app.client.mutate(api.celebrate, { ... })).result;
const deadline = Date.now() + 5_000;
while (!live.rows.some(({ _id }) => _id === streamedId) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 50));
```

A hand-rolled 50 ms sleep-poll against a *push* subscription, with a hand-rolled deadline, in the corrected proof written by an agent that had read the guide. That is a real ergonomic defect the guide cannot fix with prose, it recurs across headless acceptance suites, and it is exactly what `for await` removes. Cite that.

**Minimal fix:** delete or correct the LLP 0187 bullet (it is a control-group success, and saying so strengthens rather than weakens the case: the type surface is *not* the problem); restate Diary 0075's bullet as the diary states it; add the sleep-poll pattern in landed acceptance code as the load-bearing evidence; add two sentences comparing against the documentation/naming alternative and saying why it does not remove the busy-wait; and frame the decision as a design bet with a named usage-evidence review point rather than as an evidence-forced conclusion.

### B2 — BLOCKING. Acceptance item 4 contradicts a green complete-battery assertion, amends an Accepted MUST NOT without saying so, and demands behavior whose root cause was deliberately left undiagnosed.

Passages: "§10.11 proves that today a durable registration can remain server-side when another consumer keeps the same connection alive. The `watchQuery()` acceptance bar therefore requires explicit retirement of its exact durable subscription on iterator cleanup even while a sibling watch or ephemeral consumer retains socket demand." / Acceptance item 4. / Revision header: "the amendment is pending author ratification and changes no Accepted requirement yet."

Three separate problems, in ascending order of seriousness.

**(a) It contradicts a green assertion.** The D-8 harness does not merely record the observed topology; it *asserts it as invariant*:

```js
// tests/acceptance/axis-parity-harness.mjs:493-501
// The empirical rule commissioned by LLP 0189 D-8: while another lane
// holds the shared connection, durable release is not an independently
// deliverable operation. If this assertion flips, LLP 0034 §10.11 says
// the keyed surface should return to one connection.
assert.equal(stillRegistered, true, 'shared-demand behavior changed: revisit the one-connection keyed surface');
assert.ok(retainedFrame, 'retained registration did not receive the post-disposal sentinel');
assert.equal(retainedFrame.kind, 'authorization_invalidation');
const traffic = this.unsubscriptionsFor(registration.id);
assert.equal(traffic.length, 0, 'shared-demand constraint is withholding, not a late/failed HTTP unsubscribe');
```

A successful implementation of item 4 turns the complete battery red at `:497` and `:501`. §11 never mentions the harness, never schedules its amendment, and never says who re-decides the keyed Contract surface's connection topology when the constraint it was built around dissolves. Under LLP 0189 this is exactly the kind of cross-lane consequence a ratification must carry explicitly, not discover during implementation.

**(b) It does amend an Accepted requirement.** §10.11 states a **Constraint** in MUST NOT form: "consumers that require independent durable re-key or disposal MUST NOT share that durable connection id with an ephemeral demand holder." A watch is by construction an independently disposed durable subscription (`break` disposes one watch while siblings continue). §11 both defaults watches onto a shared connection label and requires independent retirement under shared ephemeral demand. The revision header's "changes no Accepted requirement yet" is therefore inaccurate: ratifying §11 as written necessarily overturns §10.11's constraint, and §11 should say that in the header and in §10.11 itself.

**(c) The premise is undiagnosed, and the shipped code contradicts the natural reading of it.** The closing ticket asked the question and did not answer it: "Decide the intended rule: is a durable unsubscribe supposed to be delivered independently of other consumers' demand on the same connection? If yes this is a kit defect; if no, the constraint needs to be stated where composers can find it" (`issues/closed/20260810-durable-unsubscribe-withheld-behind-shared-connection-demand.md`, Desired resolution). The resolution took the second branch — stated the constraint — without establishing that the first branch is false.

Meanwhile the shipped low-level handle already attempts precisely the retirement item 4 demands, unconditionally, with no reference to connection demand:

```js
// packages/snapback-client/index.mjs:13051-13057
// Unmount-safe server-side disposal (ENG-22478 review fix F): without
// this, unmounting a handle while the connection lives leaves the
// §10.1 zombie fanning out until connection teardown. Ignoring the
// returned task remains safe; awaiting it preserves typed failures.
const unsubscribeTask = unsubscribeLiveForLifecycle(staleSubscriptionId);
disposalTask = Promise.all([activeDemandRelease, unsubscribeTask])
  .then(([, result]) => result);
```

`POST /live/{name}/unsubscribe` exists and works per-subscription on a live connection (`src/server.rs:9303-9308`, `:26725`; `src/local.rs:15484-15573`), and the harness's *isolated* arm proves the same client path retires the same registration through the same route. The keyed provider reaches this code (`packages/snapback-contract/keyed-provider.mjs:462-468` → `record.upstream?.dispose?.()`). Yet the harness observes **zero** unsubscribe requests. So the shared-demand behavior is a *pre-dispatch refusal that nobody has identified*, silently swallowed at `index.mjs:13062` (`void disposalTask.catch(() => {})`), not a designed withholding. One candidate I can point at but cannot confirm without running it: `#req` throws `staleAuthorityError()` **before** dispatch when the caller's `expectedAuthorityCapture` no longer matches the fence (`index.mjs:4340-4343` and `:4382-4385`), and `unsubscribeLiveForLifecycle` passes `authorityCapture: retirementState.capture` (`:11515-11523`) — an ephemeral subscribe on the same connection performs its own authority publication (`index.mjs:9150-9155`). Another: the terminal-blank path marks a subscription locally retired and short-circuits the request (`:12597-12598`, `:11509-11511`).

The consequence for §11 is not "the bar is impossible" — it is "the bar is probably already met by the low-level surface, and where it is not, the cause is a kit defect nobody has scoped." Either way §11 is asking the wrong question. As written it presents item 4 as a heroic new requirement that "crosses the §10.11 shared-demand boundary" when the actual work is: diagnose the swallowed refusal, then decide whether §10.11 records a constraint or a bug.

**Minimal fix:** split item 4 into a precondition and a requirement. Precondition: the root cause of the zero-request observation is diagnosed and recorded (a new `issues/` ticket, reopening the closed one's unanswered question), *before* implementation is authorized. Requirement, stated conditionally: if the cause is a kit defect, the fix lands in `liveQuery()`'s disposal path (where the attempt already lives) and `watchQuery` inherits it — and the same landing amends §10.11, flips `axis-parity-harness.mjs:497/501`, and re-decides the keyed surface's topology; if the cause is a genuine protocol/server property, item 4 is impossible as written and `watchQuery` must instead refuse (or diagnose) ephemeral cohabitation on its connection. Also correct the revision header, and note in §10.11 that a Draft amendment proposes to overturn its constraint. Finally: item 4's "sibling **durable**… consumer" half has no evidence in either direction — the D-8 harness measured durable+ephemeral only — so either add that arm to the acceptance list or drop the claim.

### B3 — BLOCKING. The cleanup rule is factually wrong about what `settled()` awaits, and neither publicly typed route can express it.

Passage: "`return()` (including a `break` from `for await`), `throw()`, an abort signal, or a terminal failure must dispose that handle and await its settlement before the iterator reports cleanup complete."

`handle.settled()` does **not** await the disposal-time unsubscribe:

```js
// packages/snapback-client/index.mjs:13069-13074
handle.settled = async () => {
  await Promise.allSettled([
    freshSubscribeTail,
    pauseReleasePromise,
    cleanupTail,
  ]);
```

`cleanupTail` is appended in exactly one place — `bestEffortUnsubscribeLive` (`:11582`) — and `dispose()` does not use that path; it calls `unsubscribeLiveForLifecycle` directly and parks the result in `disposalTask` (`:13055-13057`). So `dispose(); await settled()` returns while the server-side retirement is still in flight, or after it has already failed silently. The only route that awaits retirement is the promise **returned by** `dispose()`.

That promise is not expressible in the published types. `LiveQueryHandle` declares `dispose(): void` and has **no** `settled()` member at all (`packages/snapback-client/index.d.mts:569-592`) — while the guide documents the opposite: "`dispose()` performs local teardown synchronously and returns an awaitable cleanup task. UI unmount code may safely ignore it; acceptance and operations code should await it when typed server cleanup failures matter" (`guide/clients/headless.md:400-402`). `StartedLiveQueryHandle` does declare `settled()` (`index.d.mts:668-673`), but its implementation discards the disposal task too: `current.dispose(); cleanup = Promise.resolve(current.settled?.())` (`index.mjs:10077-10086`) — i.e. it awaits the member that does not await retirement.

Net: **no publicly typed surface today awaits server-side subscription retirement.** Acceptance items 2 ("leaves no live registration or timer") and 4 both depend on that awaitability. `watchQuery` can reach it internally (it owns the handle and can await the untyped `dispose()` return), so this is not architecturally blocking — but the amendment states a rule that is false about the code it composes over, and item 8's "existing `liveQuery()` and `startLiveQuery()` behavior/**type** suites remain unchanged and green" forecloses the type correction that the same amendment's item 9 (typechecking against published declarations) makes desirable.

**Minimal fix:** replace "await its settlement" with "await the cleanup task returned by `dispose()` (which `settled()` does not cover — `settled()` awaits establishment, pause, and best-effort tails only)". Add a bullet stating the intended composition seam: `watchQuery` should be built on `startLiveQuery()`, which already owns the abort-during-establishment contract (`index.mjs:10049` and its `@ref LLP 0114#closed-connection-and-cancellation-protocol`; `:10062-10072` disposes a handle that arrives after cancellation) — otherwise acceptance item 3's "abort-during-establishment" case is a reimplementation of a solved problem. Then either relax item 8 to "behavior suites unchanged; the `LiveQueryHandle` declaration is corrected to match the guide's documented `dispose()` return and to declare `settled()`", or state explicitly that the iterator uses an internal seam and no public type changes.

---

### M1 — MATERIAL. The default connection label is a new client-wide behavior, not "local plumbing", and it instantiates the topology §10.11 forbids.

Passage: "Omitting `connectionId` uses one client-owned readable connection label so ordinary watches multiplex over the managed socket. That label remains local plumbing, never granted wire identity or authorization evidence."

Today a missing connection id is a typed refusal, not a default:

```js
// packages/snapback-client/index.mjs:3800-3806
if (!connectionId) {
  return Promise.reject(clientCodedError(
    new TypeError(
      'SNAPBACK_CONNECTION_ID_REQUIRED: Snapback connectionId is required for connection-scoped operations',
    ),
    'SNAPBACK_CONNECTION_ID_REQUIRED',
  ));
}
```

So the proposal removes a refusal and introduces a client-wide shared lifetime. §11's "never granted wire identity" half is right and consistent with LLP 0031 (`index.mjs:3788-3798`: the kit adopts a readable label in non-prod and mints an unguessable id in prod). The "local plumbing" half is not: a connection id is the unit of socket demand, of server-side subscription reaping, and — per §10.11 — of durable-retirement independence. Sharing one across every watch in a client means every watch in a client shares custody blast radius, which the guide names as an anti-pattern in the same page the amendment proposes to lead with `watchQuery`: "**Do not reuse a connection id across unrelated custody/lifecycle owners**" (`guide/clients/headless.md:616`). §11's own option list makes heterogeneous custody on one label trivially reachable, because `userId` is a per-watch option.

**Minimal fix:** either (a) require `connectionId` in the first slice and defer the default to a follow-up gated on B2's diagnosis, or (b) specify the default as *per client custody/authority epoch* (rolling with the existing grant lifecycle) rather than per client process, and state the refusal that prevents an ephemeral demand holder from adopting the watch default label while §10.11's constraint stands. See OQ4 below.

### M2 — MATERIAL. `watchQuery` has no answer for background/foreground, which is an Accepted §2.4 obligation.

§2.4 records, as an Accepted obligation mapped to Exact 0284 §2.1 rule 4: "the kit exposes pause/resume; pausing closes or quiesces the socket, resuming re-enters through fresh subscribe + `resubscribed`. **Policy is a provider/kit fact, not app code.**" The shipped handle carries `pause()`/`resume()` (`index.d.mts:588-589`) and the guide instructs hosts to wire them once in the framework binding (`guide/clients/headless.md:407-413`).

§11 routes pause/resume to `liveQuery()` ("route to `liveQuery()` when a caller needs… pause/resume") — which means an Expo/React Native consumer that takes the paved `watchQuery` path silently loses the lifecycle policy §2.4 says is not app code's business. §11 does not say whether a watch participates in a client-level pause, what the iterator yields across a pause (a `connection` snapshot? nothing?), or whether a paused watch's `next()` simply never settles. There is no acceptance item.

**Minimal fix:** one paragraph stating whether a watch's underlying handle participates in client/kit-level pause and what the iterator observes across it; one acceptance item exercising pause→resume→converge with one iterator identity (the natural sibling of item 7).

### M3 — MATERIAL. Items 2 and 4 name outcomes without naming the instrument, so they are not yet testable as written.

"leaves no live registration or timer" and "retires the exact server subscription" are exactly the claims that the D-8 work proved cannot be trusted to a client-side or UI-side observation — the pointing-room browser arm reported a correct UI while four registrations survived server-side. The battery's answer was to measure at `admin.inspect()` plus raw unsubscribe traffic (`tests/acceptance/axis-parity-harness.mjs:136-141`, `:445-451`, `:486-501`), and to make the classification *causal* rather than a quiet-time guess (`:474-491`). §11's items restate the outcome in prose that a weaker test would satisfy.

**Minimal fix:** pin the instrument in items 2 and 4 — server registration absence via `admin.inspect()`, zero-or-one exact unsubscribe request observed at the wire, and a post-disposal committing mutation as the causal probe — and name the axis harness (or a sibling) as the home, since it already owns both topology arms.

### M4 — MATERIAL. The yielded `version` needs a stated meaning, or every consumer will misuse it as a convergence watermark.

Item 5 correctly cites LLP 0200's rule that settlement does not imply the iterator has yielded matching state. But the natural thing a consumer does next — and the thing the tiny-triumphs proof was reaching for — is `for await (const s of w) if (s.version >= mutationVersion) break`. LLP 0200 §"Convergence" defines that precisely, and requires *every* subscription to carry a watermark advanced by skips and no-change evaluations via `current_as_of(V)` envelopes (`llp/0200-…spec.md:95-113`). In the shipped client, `handle.version` advances on `current_as_of` without touching rows (`index.mjs:11779-11781`) — but `current_as_of` is a resume-ladder answer (LLP 0090/0091), not something every subscription receives today.

So §11's `version` is a content version for some subscriptions and a watermark for others, and the amendment says nothing about which. Given the amendment exists largely to serve headless acceptance code, this is the member most likely to be misused.

**Minimal fix:** one sentence stating whether `version` is the last delivered content version or the LLP 0200 convergence watermark; if the latter is intended and not yet universal, say so and route the "wait for my write" idiom to whatever LLP 0200 lands, rather than leaving readers to infer it.

### M5 — MATERIAL. Item 9's ordering is unstated, and as written it cannot gate the landing it appears in.

The mechanism exists — `scripts/snapback-package-cold-install.mjs`, `scripts/published-closure-boot-smoke.mjs`, `scripts/guide-published-closure.test.mjs` — so item 9 is realistic in kind. But "against **published** package declarations" is only runnable after `watchQuery` is published, which under the rapid-publish posture (LLP 0041 ruling, CLAUDE.md) happens after the surface lands. And the guide change §11 requires ("the headless Guide should lead with `watchQuery()`") cannot land naming an unpublished surface without the `unreleased:` fence machinery (`guide/conventions.md:66-94`; `guide/published-closure.json` currently pins `newestPublished`/`newestQualified` at `0.1.19`).

As listed, item 9 sits in a flat list of nine acceptance items and reads as a landing gate. It is a post-publication gate.

**Minimal fix:** split the acceptance list into pre-landing items (1–8) and a post-publication item (9), state that the guide snippet lands behind an `unreleased: <next version>` fence swept by the promotion lane, and bind the capability claim to the post-publication run per LLP 0189's claim-snapshot rule.

### M6 — MATERIAL. Two lifecycle rules have no acceptance coverage and no diagnostic codes.

(a) "An iterable may be consumed only once; a second iterator acquisition refuses rather than creating hidden sibling subscriptions." No acceptance item covers this, and no `SNAPBACK_*` code is named. The repo's convention is that refusals are contract (§10.11's `SNAPBACK_CONTRACT_EPHEMERAL_UNSUPPORTED`, §2.4's `resubscribed` reasons, the whole `SNAPBACK_LIVE_*` family). It also interacts with a common idiom worth naming explicitly: `while (retry) { for await (…) { … break } }` refuses on the second pass.

(b) Abandonment. A manually acquired iterator that is dropped without `return()` holds a live subscription with no finalizer. `for await` always calls `return()`, so the paved path is safe, but the amendment claims the iterator "owns exactly one underlying handle" without stating that ownership has no GC backstop. The handle API does not have this hazard because callers necessarily retain the handle.

**Minimal fix:** name the refusal code and add it to acceptance item 3's list; add one sentence on abandonment recommending `signal` or `await using`, and state that no finalizer reclaims an abandoned iterator.

---

### N1 — MINOR. The "no async-iterable `LiveQueryHandle`" argument reaches the right conclusion by the wrong route.

"a handle may already have callback observers and an independently owned lifetime, so `break` would have ambiguous authority to dispose it." The ambiguity is resolvable by construction — `handle[Symbol.asyncIterator]()` can return a *view* whose `return()` detaches only the view, which is what most iterable-over-shared-source APIs do. The genuinely good reasons to decline are different and stronger: a handle iterator would need its own buffering/backpressure policy layered on a surface that already coalesces in place, and it would create a second lifecycle owner over `dispose()` without the cold-start guarantee that makes `watchQuery`'s ownership unambiguous. Same conclusion, defensible reasoning; the amendment should use the better argument since a reader can dismantle the stated one in one sentence.

### N2 — MINOR. "Immutable snapshot" is true, but for a reason worth recording.

§11 says later yields "may produce a new immutable snapshot". This works because the handle *reassigns* rather than mutates: `handle.rows = nextRows` on delta application (`index.mjs:11839`) and on replace, so a snapshot capturing the array reference at yield time stays stable while the handle moves on. That is a load-bearing property of a surface §11 does not own, and a future in-place optimization inside `liveQuery` would silently break every retained snapshot. One sentence pinning it (and requiring the snapshot object itself to be frozen with all members captured by value) makes it a checked invariant rather than a coincidence.

### N3 — MINOR. Post-establishment offline/unavailable establishment is unaddressed.

`liveQuery()` rejects establishment with `SNAPBACK_QUERY_OFFLINE_UNAVAILABLE` when no retained answer passes the LLP 0166 D-4 witness (`index.mjs:13096-13108`, `:1939-1979`). §11 item 6's "terminal establishment… failure rejects `next()`" arguably covers it, but the interaction with item 2's retained-first yield is worth one explicit sentence: a watch that starts offline with an admissible retained answer yields `freshness: 'retained'` and continues; one without rejects the first `next()` and cannot later recover. Consumers will assume a watch retries.

### N4 — MINOR. A Draft proposal inside an Accepted RFC that Exact 0284's acceptance gates on.

LLP 0034 is Accepted, and Exact LLP 0284's acceptance is gated on it (§Summary). §11 is clearly labelled Draft and the revision header is honest about ratification, which is good practice — but a reader loading 0034 for *obligations* now finds an unratified public-surface proposal in the same document, and (per B2) one whose acceptance bar contradicts §10.11's Constraint. The corpus precedent for §10.x is dated amendments recording shipped or accepted facts. Consider hosting the proposal as its own numbered RFC (or an `issues/` ticket) with a one-line pointer from §10.11, and folding it into 0034 as a dated §10.x amendment on ratification.

### N5 — MINOR. `reason: 'resubscribed'` overlaps `reason: 'connection'`, and neither is tied to the existing receipt vocabulary.

The shipped subscription-event vocabulary is `established` / `disposed` / `resubscribed` with `reason: 'reconnect' | 'overflow' | 'permission-epoch' | 'resume' | …` (§2.4; `index.mjs:12993`, `:11491`). §11 introduces a parallel five-value `reason` on the snapshot with one member (`'resubscribed'`) colliding in name and none of them mapping to the receipt reasons. Either derive the snapshot `reason` from the existing vocabulary or state that it is a deliberately coarser presentation axis and that receipts remain the audit surface (§11 already says the latter for frames; say it for reasons too).

---

## The four open questions

**OQ1 — `watchQuery` vs `observeQuery`. Recommendation: keep `watchQuery`, but the draft's reasoning is incomplete and the real hazard is elsewhere.**

`observeQuery` is not clearer; both verbs read as "current-state observation", and the draft is right that neither avoids a noun split. But the shipped surface already uses `watch` for **callback- and store-shaped** observation: `AssetClient.watch(assetId, options)` and `AssetClient.watchStore(…) → AssetRecordWatchStore` with an `AssetRecordWatchSnapshot` type (`packages/snapback-client/assets.d.mts:174`, `:185-193`), and `ExternalQueryScope.watch(start, observer)` (`packages/snapback-client/external-store.d.mts:107-110`). So `watchQuery` would make `watch*` mean two different *shapes* on the same client family — precisely the "same word, different mental model" failure this amendment exists to remove. The draft does not notice this.

Keep the verb (consistency of *meaning* — "observe current state" — is worth more than shape encoding, and `LiveQueryWatchSnapshot` then reads as a sibling of `AssetRecordWatchSnapshot`), but require the amendment to (a) record the `watch*` family rule explicitly in §11 and in the guide, and (b) type the return as a **named** interface — e.g. `LiveQueryWatch<Rows> extends AsyncIterable<LiveQueryWatchSnapshot<Rows>>` — carrying `[Symbol.asyncDispose]` so the shape is legible from the type and from `await using`, not only from the call site. An anonymous `AsyncIterable<…>` return in the declaration is the one place where `observeQuery` would genuinely be safer; a named type removes that advantage.

**OQ2 — Should connection-only transitions yield? Recommendation: yes, agreeing with the draft, with two constraints it should state.**

The draft's justification is correct: a sequential consumer with no second observer otherwise cannot render `stale`/`disconnected`, and forcing it to install `onConnectionChange` to get that would rebuild the exact split the amendment removes. The bounded latest-value slot makes the extra yields nearly free, and because each snapshot is *whole state*, a connection-only yield can never lose a pending row change — there is one slot holding everything.

Two constraints the draft must add, or the yes becomes a defect:
1. Yield only when the `connection` **value changes** (not on every transport event that re-affirms the same value); a `live → live` re-affirmation must not produce a yield, or a flapping socket becomes a hot loop in a consumer that renders per yield.
2. `reason: 'connection'` must be reliable enough for `if (s.reason === 'connection') continue;` to be a correct, cheap skip — which means a yield that carries *both* a row change and a connection change must report the row change, not the connection change. State the precedence.

**OQ3 — Terminal authorization denial: one final snapshot then remain observable, or complete? Recommendation: split it. The draft's blanket "remain open" is wrong for the terminal case.**

The draft's parity argument holds for *recoverable* denial: a blank/quarantine that a later authority replacement can lift should yield the denial snapshot and remain open, matching the handle's freeze-for-rendering behavior and the custody-transition path that clears `authorizationDenial` on the next successful fresh subscribe (`index.mjs:10358-10364`).

It does not hold for **terminal query-scoped deletion**. There, the exact server subscription and its fence are already retired; the client marks the id retired and short-circuits further retirement (`index.mjs:11505-11508`, `:12597-12598`), and any later frame for that instance is diagnosed as `SNAPBACK_AUTH_QUERY_FENCE_STALE` reuse rather than delivered (`:10433-10445`, `:11726`, `:11776`). The guide records the same: "the same local-only outcome applies after this query's own terminal authorization deletion, whose exact server subscription and fence have already been retired" (`guide/clients/headless.md:396-398`). An iterator left open there parks `for await` forever on a subscription that is provably dead — the single worst failure mode for the sequential-consumer intent the amendment exists to serve, and one the callback surface does not have because a callback consumer is not blocked.

Recommended rule: yield the denial snapshot, then **complete** (`done: true`, not a rejection — the denial was delivered as state) when the denial is terminal for the query instance; **remain open** for non-terminal blank/quarantine. Add an acceptance case for each; item 6 currently covers only the ordering rule.

**OQ4 — Is one client-owned default connection label safe for every custody transition? Recommendation: no. Do not ship the client-wide default in the first slice.**

Three grounds, in order of weight:
1. Under §10.11's Constraint as written, a shared durable connection label is the forbidden topology for independently disposed durable subscriptions the moment any ephemeral demand holder joins it — and B2 shows the mechanism is undiagnosed. Shipping the default before that diagnosis bakes the hazard into the paved path.
2. Custody. `userId` is a per-watch option, so a single client-wide label routinely carries watches with different principals and different lifetimes — literally the guide's anti-pattern "Do not reuse a connection id across unrelated custody/lifecycle owners" (`guide/clients/headless.md:616`). Grants roll on bearer/custody transitions (`refreshConnectionGrant`, `__externalBearerTransition`), so a process-lifetime label is the wrong epoch.
3. It converts a typed refusal into a default (`SNAPBACK_CONNECTION_ID_REQUIRED`, `index.mjs:3800-3806`) — a real behavior change to connection-scoped operations that §11 describes as plumbing.

The draft's closing sentence ("The readable label must never become the opaque granted wire id") is correct and already how the kit works (`index.mjs:3788-3798`), but it answers a narrower question than the one asked. Recommended answer: in the first slice, require `connectionId` (or default it per *authority/custody epoch*, not per client process), and refuse — with a named diagnostic — an ephemeral subscription that adopts the watch default label while §10.11's constraint stands. Revisit the multiplexing default after B2's diagnosis, at which point one shared label may become straightforwardly safe.

---

## AUTHOR-DECISION

Two items need the author, not the amendment:

1. **The §10.11 rule itself.** The closed ticket's first bullet was never ruled. Is independent durable retirement under shared connection demand a kit obligation (making §10.11 a recorded defect) or a genuine composition constraint? Every part of §11's connection story — item 4, the default label, the keyed surface's topology, and whether the axis-parity assertions stand — hangs off that single ruling. It should be made before ratifying §11, not discovered during implementation.
2. **Whether the surface is worth its slot.** B1 dissolves the stated evidence but not the design case (the sleep-poll pattern is real and recurring). This is an eighth member of the durable-live family added on ergonomics judgment. That is a legitimate call and it is the author's, but the amendment should ask for it as a judgment rather than presenting it as evidence-forced.

---

## Verdict

Three BLOCKING concerns (B1 evidence attribution and justification; B2 the §10.11 / axis-harness / undiagnosed-root-cause conflict in acceptance item 4; B3 the false settlement rule and the untyped cleanup route), six MATERIAL, five MINOR. B2 is the one that must not be waved through: as written, ratification authorizes an implementation whose success turns a green complete-battery assertion red and silently overturns an Accepted MUST NOT, on a premise the shipped code suggests is a swallowed defect rather than a design property.

None of this touches the proposed shape, which is sound. The distance to READY is one diagnosis (B2's root cause), one honest re-framing of the evidence (B1), and a set of localized text corrections.

**VERDICT: NOT READY** — confidence high (~0.85). High on B2 and B3, which I verified line-by-line against the shipped client, the harness, and the closed ticket; high on B1's citation inversion, which is directly checkable in LLP 0187's own section heading; moderate only on the *cause* of the shared-demand withholding, which I could not establish without running the harness and which is precisely what B2 asks the amendment to require.
