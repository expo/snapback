# Muse grade: Snapback4 client attribution audit

Date: 2026-09-14

This is a bounded static orchestration audit of the most material product candidates in the received Muse grade. It preserves Muse's public findings and separately attributes them against the frozen Snapback4 0.2.6 contract. It is not another assertion grade or a rerun.

## Baseline and evidence

- Published product baseline inspected with `git show`: `342c53d306d7484cd64e820ee27a151e02eb4b0b`, where `snapback4/packages/snapback4/package.json` is version `0.2.6`.
- Later comparison inspected with `git show` only: `0d7b77bb3c577366ac81bf159e57524c613c9e12`. Mutable delivery files were not used to establish 0.2.6 behavior.
- Received `lanes/muse-snapback4/grading/grader-report.json`: `sha256:e4e031cc1757c0a892fd172c9b232588cba2118db6ed55eabd3f6ab517893f88`.
- Received `lanes/muse-snapback4/grading/trace.md`: `sha256:096712905023f7c081b126ad8ccb22fd5d91f44372916bcefb592ad928d25be6`.
- Only public report, trace, evidence, graded app source, and pinned product source were read. No probes, builds, or lane/product edits were performed, and no private reasoning body was read.

## d-02: foreign digest rows are a real app privacy defect caused by explicit app rules

**Muse finding.** The later public API probe counted `foreignDigestRows: 20` in an unrelated fresh account's sync snapshot. An earlier retained sample contains nine rows across `digestTotals` and `digestUnread`, owned by four other principals. That is a real privacy failure in the delivered application.

**Attribution.** It is not a Snapback read/sync isolation failure. The app's own `snapback/schema.q:334-362` declares both accumulator tables with the table-level read rule `public`, permissive insert/update rules, and `sync public`. The nearby comment claims only the owning user may read them, but the executable declarations say the opposite. Snapback4 0.2.6 documents the exact result:

- `snapback4/packages/snapback4/README.md:524-535` says `sync public` means everyone holds the same rows and requires the sync audience to match the read rule.
- `snapback4/crates/snapback4-lang/src/guide.rs:440-450,451-462` says a table-level `public` declaration is the read rule and shows `sync public` as the all-viewers form.

The engine therefore delivered precisely the audience the app authored. The app appears to have made the tables public so cross-principal upserts collide readably, but that is an app data-model tradeoff and violates its own private-activity requirement. It could instead use owner-targeted append-only activity rows or an authoritative job/service-owned update path that does not expose the counters. The later delivery revision also adds write-authority support whose guide says an upsert into another principal’s row may be admitted by that table’s update rule (`guide.rs:1404`); that later capability simplifies a private counter rewrite, but it does not make the 0.2.6 engine’s execution of an explicitly public schema a contract violation.

Evidence: `grading/evidence/api-probes-crossuser.json` (`sha256:a55f0a9eb64309ff419633b3f2fe7a1beb4a49c76069cb8108047fa8e9080474`) and `sync-leak-digest-rows.json` (`sha256:93226d4e5b710e11aa9b7a9a3c55532f954dccca0ce00fefe13c83d8f786beda`). App schema: `sha256:e2d9f902b1385a7f4cc3c3dac9abf648f04ffa15f51467b956e31797a511a01a`. Published README: `sha256:eaa5d557bcb3a0e77b8a3f804d0f555d1aa9fa01dcf47beb970628d8e1e64072`; published guide source: `sha256:783d36cb0fee55003ecd5e1f30752bb57e2a7d88d7e9828c96a85c422c6aa8ad`.

**Disposition:** application defect; no Snapback product issue.

## d-05: two-success/three-refusal login burst is documented KDF admission, with an app/harness retry gap

**Muse finding.** In each of two five-browser concurrent-login rounds, exactly two contexts reached the app in about 472–531 ms and three remained on auth with “too many identity requests; retry later.” The frozen choreography starts all five logins with one `Promise.all` (`grading/h/i/choreography/choreography.mjs:3137-3145`) and its login helper waits only for the authenticated surface (`:890-903`); it does not retry an explicitly retryable refusal.

**Published policy.** Snapback4 0.2.6 `crates/snapback4/src/auth.rs:15-74,95-109` has two independent limits:

1. a 60-second counter of 30 attempts per socket peer and 10 per normalized email; and
2. exactly two concurrent Argon2 KDF slots, with excess work immediately returned as HTTP 429 `E_RATE_LIMIT`, `retryable: true`.

The five simultaneous requests use distinct accounts and are far below the minute counters. The repeatable two-success/three-refusal split matches the two KDF slots, rather than showing exhaustion of the 30/min peer bucket. The retained evidence has no server-side admission trace, so this is a high-confidence source-and-shape attribution, not a direct internal-counter observation.

The 0.2.6 personas guide explicitly says password hashing is limited to two concurrent slots (`snapback4/crates/snapback4-lang/src/guide.rs:1192-1198`) and defines `E_RATE_LIMIT` as bounded admission being full with the action “Retry later” (`:1238`). The public auth helper preserves the structured `Refusal` on its `SignIn` result (`packages/snapback4/src/auth.ts:17-35,43-50`). The graded app immediately converts that result to an ordinary thrown `Error` and discards `retryable` in `app-host/clique/src/sb.tsx:64-79`; neither its UI nor the frozen harness retries.

The later product revision `0d7b77bb3c577366ac81bf159e57524c613c9e12` exempts loopback `dev` from the minute counters but retains the two Argon2 slots (`auth.rs:25-57,95-109`), and its guide states that distinction explicitly (`guide.rs:1357-1365`). That later change does not alter the observed five-way KDF burst, which remains intentional bounded admission.

Evidence: `grading/evidence/concurrent-login-repro.json` (`sha256:ee773e861824280a28b1e502a8bccb3c2849963d28b97b60463299767da6fa74`). App auth wrapper: `sha256:f62ce5ed0242bc15ebc6b6e96910c2f8ca50586cea6f357374f9932cb13eceea`; frozen choreography copy: `sha256:cc600295f80d40b89910a1bf01eb3c7d8b9c24625c9741035ca3844f80418fcc`. Published auth host: `sha256:13a5212f76771d6d87507c9e524dde1db10403b82b989f9c84125d926bf761fe`; published auth client: `sha256:78d327b3523022b38ce881b3dfc9c0889e987d6c30a0464180e0d9fc8e322ded`. Later auth host: `sha256:e61588c5020679ba100bf597b73e54154d40f783fb9bf828c231eaa6f2e0af25`.

The grader's broader statement that ordinary users behind one NAT would be refused is not established by this local simultaneous-five-login evidence. It demonstrates burst admission and missing retry; it does not measure staggered users, proxy topology, or recovery time.

**Disposition:** documented product capacity policy plus application/harness retry handling gap; no new product issue. The original auth-hardening ticket already chose and tested a two-worker KDF ceiling, so another ticket would duplicate that accepted design.

## d-01: disappearing-message TTL mixes seconds with millisecond time

The app config stores `ttl24h` and `ttl7d` as seconds, and `schema.q:787-792,807-814,840-845` adds those values directly to `now`. The evidence observes 180 ms and 300 ms expiry deltas for shortened values 180 and 300. Snapback4 0.2.6 documents `time` and `now` in milliseconds and `time + int` as time (`guide.rs:83-88,296-304,348-353`; README `:118-125,161-169`). The same app already multiplies edit/delete window seconds by 1,000 at `schema.q:894-909`, reinforcing that the TTL paths omitted their unit conversion.

Evidence: `grading/evidence/ttl-unit-probe.json` (`sha256:dea0e00b711d248a6703c25b42d3a40ccd5d66ee8499bda2bb4eeb4fd23ca76f`) and `disappearing-browser.json` (`sha256:383776aaed622d50e964360d60d9ec9a01a1f57aafeebdf8e22a706aeb98dd62`).

**Disposition:** application schema/config bug; no product issue.

## d-03: trending ranks only an app-selected recent pool

The app's `schema.q:421-422` requests only the newest 200 posts by time. `app-host/clique/app/feed.tsx:276-288` then sorts that already-truncated pool by likes and takes ten. The retained probe shows the previously top-liked post disappears after 205 newer posts and the 200-row pool's top like count becomes zero. Snapback did exactly the bounded query authored by the app. The 0.2.6 feed guide describes the appropriate product idiom for this scale: compute a shared ranked candidate table from maintained counts, rather than client-sorting a recent page (`crates/snapback4-lang/src/guide.rs:890-933`).

Evidence: `grading/evidence/trending-probe.json` (`sha256:484d342d2d0b35d394acd67793fe47caa5140b75b0a24aecc97d4a7b445fd5a3`). App feed source: `sha256:ef7f083ec993665e24f882a12c5e998c2c1328e3c7a7af5b0a81743b0f3a2c8e`.

**Disposition:** application query/modeling bug; no product issue.

## d-04: digest counters intentionally ignore later read/delete/expiry/membership facts

The app's `sendTail` increments `digestUnread` and `digestTotals` at message-write time (`schema.q:751-777`). `markRead` only advances `chatReads` (`:872-876`), `deleteMessage` only tombstones the message (`:900-910`), and membership removal/row expiry has no decrement path. The digest job then emits the stored values without rechecking those facts (`:949-974`). The retained evidence correspondingly reports two unread messages after both were read, one after a tombstone, and one after membership removal.

This is the direct semantics of the app's write-only accumulator design. No Snapback client/host guarantee says a custom counter is automatically reconciled with separate rows or later mutations.

Evidence: `grading/evidence/digest-probe-periods.json` (`sha256:bc7be4a910ecda519de667b93f92c80d5e67abde70006dad08703c940828ef70`).

**Disposition:** application schema/job bug; no product issue.

## Result and limits

None of the five audited clusters establishes a new Snapback4 product defect. The foreign digest rows are serious, but they follow the app's explicit `public` read and `sync public` declarations. The concurrent-login failures match a documented two-slot Argon2 admission ceiling and expose missing app/harness retry handling. The TTL, trending, and digest-count failures follow directly from application code.

Muse's d-06 reduced scale fixture, d-07 application `API.md` ordering mismatch, and d-08 acceptance-runner reporting were outside this product-attribution focus and are visibly lane/application harness or documentation issues from the received report. Already tracked video prediction, offline-link detection, and pending-GET/request-line issues were intentionally excluded.
