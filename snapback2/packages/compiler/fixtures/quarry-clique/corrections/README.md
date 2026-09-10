# Grok app corrections

These files reproduce the bounded 2026-09-09 Clique correction without the
grader, credentials, generated output, database state, or provider settings.
The benchmark evidence remains read-only.

Apply the backend stages from the copied app root. Add the owner-inspection
stage only when running the retained owner cases. The two frontend stages are
independent of that test instrumentation and apply to the same copied root:

```sh
patch -p1 < syntax-adapter.patch
patch -p1 < grok-app.patch
patch -p1 < grok-current-sdk-auth.patch
patch -p1 < grok-sender-pending.patch
patch -p1 < grok-message-tombstone.patch
patch -p1 < grok-receipt-scheduling.patch
patch -p1 < grok-message-draft-validation.patch
patch -p1 < grok-browser-online-events.patch
patch -p1 < owner-inspection.patch
cp owner-cases.test.ts snapback/tests/recipes.test.ts
```

`grok-current-sdk-auth.patch` moves the copied published-app calls from the
old flat `useAuth()` object to the current `session` and `actions` arms. Its
SHA-256 is
`0f154611149124959656f8bc8ffd4550fcea8078c5daf86953cd42cb93836d6e`.
`grok-sender-pending.patch` removes the web document-capture submitter so the
form and mobile composer are the only submit paths. It assigns one stable
message id to each new text/media intent. Four `defineItems` declarations use
the thread query's own complete/capped page-membership receipt to decide
whether each text/photo/clip/view-once create is still unplaced. They are pure
projections over one shared query transport. The app renders an exact
same-conversation outbox row only while one of those projections still carries
that intent; a raw committed ledger row plus absence from the current page is
not enough, because it would resurrect an observed message after pagination,
expiry, remount, or reopen. The generated mutation target is used when it
resolves; this copied app also supplies the id explicitly because this app's
helper-shaped operations certify with ambiguous presentation targets. Finally,
all `ThreadBubble` hooks run before the nullable-row return, so a mounted
expiry cannot change hook order. The patch's SHA-256 is
`e733e5cffa9d6bb75b41c017e651a6847628c61a0e7abe5f16c54b7b439f02c7`.

Four final patches keep message removal and acknowledgement work aligned with
the certified application state. `grok-message-tombstone.patch` deletes the
message after writing its removed/expired delivery and deletes a companion poll
before either removal; retaining a positive row with `status: expired` would
contradict the delivery table's declared tombstone. Poll deletion admits only
the current message author while that author remains a conversation member;
an ordinary current member is refused by the table rule. Its SHA-256 is
`459c67c6362b54ec56a1e3b62687a33a163c9bb1d54987e9ee349ce90a8a3eff`.
`grok-receipt-scheduling.patch` adds the private, indexed
`pendingDelivered[viewer] first 1` query. The global watcher acknowledges only
that exact row and advances by deletion. Its recipient-owned acknowledgement
accepts an id, returns success when that recipient has no row, and checks the
row's current conversation membership before deletion; it therefore also
dismisses a row whose message has already been tombstoned without widening
receipt visibility. The thread no longer acknowledges all 50 visible
deliveries on every rerender; it runs the existing bounded `markRead` only
while the viewer-specific unread count is positive. The certified first
pending-read id is also an effect dependency so an unread `1 → 0 → 1` cycle
cannot be lost when React coalesces the unobserved zero, including when the
history preview's `(at, id)` ordering stays unchanged. Its SHA-256 is
`27bad354081e99d01990cee4da71af9d43fd2a8905966a9ba3e6d38fe4673b40`.
`grok-message-draft-validation.patch` makes the mounted web input use its
existing draft state and shares one Unicode-scalar validation boundary:
ordinary text and edits admit at most 2,000 scalars, while media captions admit
at most 500. A local refusal or terminal rejection retains the exact draft and
attachment. A queued or committed send clears only the captured draft, never
text typed while that send was settling. Its SHA-256 is
`37a22238197b4dc71126f3c857802216831544db3857b530b7ddd55d0dadce22`.
`grok-browser-online-events.patch` removes the redundant 400 ms `online()`
poll while preserving the initial sync and the browser's online/offline event
listeners. Its SHA-256 is
`b76fbb425cb97c579445bce071734f91e8bc1369284e961af2a6b9e8aa33f144`.

All four patches apply after the auth and sender-pending stages above. The
preceding `c8e95f47f` source remains bound separately at
`.snapback/clique-final-review-snapshot`. The current chain round-trips to the
credential-free eight-file snapshot at
`.snapback/clique-ack-final-review-snapshot`; its `SHA256SUMS` binds
`messages.q`, `schema.q`, `delivery-watcher.tsx`, `thread-view.tsx`, and
`snapback-provider.web.tsx`, plus the unchanged full `groups.q`, root layout,
and settings screen needed to review receipt cleanup and watcher/auth context.
The copied source compiles with the new bounded queries. Browser/owner scale,
draft, and reconnect qualification for these final patches is tracked
separately below; the preceding 3+20 cohort predates them.

`grok-live-proof-instrumentation.patch` is browser-proof instrumentation, not
application behavior. It exposes only operation/state, row-count, target-id,
conversation-match, scalar-count/limit, and projection facts; it never exposes
credentials, tokens, or message text. Its explicit-expiry hook is used only by
the retained browser expiry case. Apply it after
`grok-message-draft-validation.patch`. Its current SHA-256 is
`6448245e222bcad1ce586dc0cf210e06d0c1e9008efbe59cd0b0553cfdc67c92`.
The exact current production and instrumented `lib/thread-view.tsx` SHA-256
values are
`8e4c7e0bbc1fc0ce0aabb7cc78cb43fdc42c21eed18d1c723cbf6202ddf26371`
and
`55fa2a77fd5d7d03937c7ae78c1ddd431ff0cda3a41c21ef6d92ba63bae7fa54`.

`grok-connection-proof-instrumentation.patch` is a separate copied-browser
observer, not production application behavior. It reads the public
`useConnection()` result and appends only connection state and local time to a
global proof array. It makes no client call, adds no timer, and changes no
offline or online policy. The patch SHA-256 is
`a1c7270f6c7319c6dd9ecd94549b2da7a8451f05a9803b90d386b0b778f95105`;
the resulting proof-only provider SHA-256 is
`13fee47e7e3c341dd0af38c6b317b80ce58221ed90944f5c6e7e6d7bb13a9300`,
while the unchanged production provider remains
`93e746ca4b882c4999310be35a0f956c18d356fd21c20166583c316ba4c30ddd`.

`syntax-adapter.patch` is only the raw snapshot's mechanical move to current V2
declaration spelling (`fn`/`maintain` colon headers, job parentheses, and inline
schedule calls). Its SHA-256 is
`400e1450b79e86198ed359cde795eac4fed4e48ca820d3d4b9dd7ce9dcb60d04`.
The raw snapshot produced 28 syntax diagnostics: 6 in `access.q`, 3 in
`admin.q`, 1 in `messages.q`, and 18 in `schema.q`. The adapted baseline
compiled as generation `2a750d42cc003a0f1cd51ab6ec2be911c34706f018180ecb86dd98647523f5d6`.

`grok-app.patch` applies only after that adapter and contains the behavioral
repair. Its SHA-256 is
`025768b03465536329c8356140f9daf861503588578950c47fa753f7d3897440`.
The production correction compiled and certified 65 operations as generation
`dc188a4b0db4a9b3e062a52740af81834a109dfaf4a5143f380e47a07726fa94`.
Both patch stages pass `patch --dry-run -p1` against their respective inputs.

`owner-inspection.patch` is test instrumentation, not application behavior.
After the behavioral patch it grants profiles a test-only replay-mode toggle,
adds two period-unread inspection queries, and adds the total-order index suffix
one of them requires. It also has one adversarial helper that inserts the real
message, delivery, pending-receipt, and unread rows with an explicit delivery
id and time; this forces a `(at, delivery-id)` tie without claiming that two
ordinary production sends happened to share that order. Its SHA-256 is
`db7bfda372dfbe55f1cbe8b1574475610f93fbe2d5f475de0acf79e749fb8b99`.
The test-only inspection also exposes one poll delete solely to prove that a
current non-author member receives `E_RULE`/`rule`; production exposes no such
operation. Do not ship this instrumentation as part of the application
correction. The retained `owner-cases.test.ts` has SHA-256
`0663b541f1bdb5096fd4b203a11964a1607bb3fdd41ec5246fa56f22caf845e7`.

The first faithful atomic digest at 500 follows and 100 current memberships
needed 4,516,191 closure bytes, 321,887 above the 4 MiB ceiling. Persisting
partial totals would make authorization stale between chunks. The retained
app instead keeps the compact follow mirror equal to `follows` in every
follow/unfollow path and updates a compact author/period counter in the same
transaction as each of its six current original-post insert paths. A future
post delete or key-changing update must adjust that counter in the same
transaction; the copied app exposes neither operation. Post creation remains
constant work regardless of follower count.

The final digest reads all 500 follows and 100 current membership incarnations
atomically with one transaction-local scratch row containing explicit post,
message, and chat fields. Its production certificate reports 3,080,678 closure
bytes, 3,758,319 heap bytes, 1,814 examined/index entries, and 37,636 steps.
The distilled compiler fixture reports 3,032,303 closure bytes, 3,708,397 heap
bytes, the same 1,814 examined/index entries, and 37,635 steps. That fixture's
tables intentionally use mechanical `public`/`allow` policies; it proves
lowering, bounds, membership-incarnation selection, and owner pruning, not the
production privacy rule. The separate owner inspection proves that rule.
The original 50-member per-conversation cap is unchanged. The recipe adds an
explicit 100-membership per-principal bound: membership 101 refuses rather
than being silently omitted from a digest.

Replay suppression applies at source admission, not only at the later sweep.
Post writers skip the compact period counter while replay mode is active, and
new follows retain their current-relationship mirror while marking the period
activity ineligible. Otherwise replay mode could turn off before the same
period ends and leak replayed writes into an ordinary digest.

Period unread custody is separate from the app's lifetime delivery/read
receipts. Each row binds the recipient, chat, exact membership id, and source
period. Its table rule admits the recipient or the message author only while
that author still has a current membership; the maintained count is
owner-readable only. Send, mark-read, author unsend, owner expiry, and
self-leave update that custody in their transaction. An admin removal may
leave an old-incarnation row, but the digest counts only the current membership
id. The timer passes its immutable logical `.periodEnd` into one two-stage job:
the profile sweep derives the epoch bucket from that pinned cutoff, then the
later stage prunes rows strictly older than the last completed bucket. The
argument survives continuation and restart, and cleanup cannot overtake the
digest that still needs the bucket.
This does not claim that a non-admin author can erase the app's separate
lifetime receipt rows. The 50-row period cap matches the existing first-50
mark-read path, and the per-message cap bounds author cleanup. The configured
120,000 ms period equals the two-minute schedule, and the digest uses
completed `[periodStart, periodEnd)` buckets.

Run each retained case against a copied app and fresh isolated local owner; for
example:

```sh
snapback2 test --journey "digest keeps the 100-membership account envelope"
```

The journeys need no provider configuration and must not run against the
original benchmark owner. On an isolated owner, the adapted baseline failed
following activity with `following activity produced no digest` (2,418 ms,
one schedule firing) and active/quiet/active with
`active/quiet/active left 3 digest rows` (72 ms, three firings). The corrected
copy passed configured expiry (46 ms), the exact stored 80-scalar Unicode preview (40 ms),
following activity on the logical-cutoff build (295 ms, one firing), and
active/quiet/active suppression (654 ms, three firings). The compiled fixture separately executes the same bounded value
through storage and emit; the original focused owner preview case does not inspect
the effect payload. The separate executed matrix below closes that distinction.
A separate journey committed 99 groups on top of Bob's
seeded membership and passed the real 100-membership digest path in 969 ms. On
the final logical-cutoff build, one completed period simultaneously excluded
an unfollowed post and read, unsent, expired, removed/rejoined, and
leave/expire/rejoined message custody while admitting one current followed
post; the emission-time matrix passed in 2,784 ms with four schedule firings.
The test-only direct privacy/prune journey
passed in 337 ms with four firings: recipient and current author saw the same
custody row, an ordinary peer and the author after leaving saw null, a
removed/rejoined membership contributed zero, the last completed bucket was
retained, and the next prune removed it. The compiler fixture suite passed
283/283. The final all-clients-closed scheduler journey then passed in 879 ms
with one firing: the reconnect drain received the expiry tombstone without the
body, pinned it, and a cold offline restart still had no body.

The configured expiry matrix passed again in 638 ms with six timer firings after routing polls through
the same message helper as text, photo, video and view-once sends. `off` stored
null, an explicit deadline kept precedence, all configured kinds stored the
selected window, and expiry removed the poll's question/options row. The six
original-post branches passed in 682 ms with two
schedule firings. The ordinary-member-author unsend passed in 4,892 ms with
two firings under the preceding retained-row version: the message became a
bodyless removed row, its recipient's period custody disappeared, and the
later digest counted zero unread messages/chats without widening lifetime
receipt access. The final hard-delete patch updates this journey to require
absence; its rerun is a separate final-generation witness.

The final production poll rule certified 66 operations as generation
`b44b2b2167d349a13283e0b0ddaf7bcfe43eb09605e96c4a4f72fe10e10fb0c8`.
With test-only inspection, the targeted poll-unsend journey passed in 123 ms
as generation
`d94e6249ddb6d245e113f1021fa395768e745050a805b3ff7a7c4f1159ed6ece`:
the current non-author member was refused with `E_RULE`/`rule`, that refusal
preserved the poll, and the current author then removed both the poll and its
message. The retained receipt has SHA-256
`58085962f73423e0a9c44f633e7ddbfcb987d7c5fb17fc7680c9a3afa7a4b50a`.

Two headless receipt-scale journeys passed on the same instrumented
generation. An exact one-row private cursor acknowledged 51 distinct pending
deliveries across 51 chats in 1,700 ms and then returned an empty page; its
receipt SHA-256 is
`81238fcc6c554da659da9f425fc7a7403be8e45c6b3f5ad3b321f90d9dca1317`.
After 50 messages in one chat were read, message 51 entered the still-capped
50-row thread while `conversationView.unread.count` advanced from zero to one;
the existing bounded mark-read then returned it to zero. That journey passed
in 1,284 ms and its receipt SHA-256 is
`c85f0264f2d7f565c3380cf6a48682cf2ac96fea0fc37a8b450fd5411a5bafc3`.
These are backend state-contract witnesses; the browser watcher qualification
is separate.

The ordinary-author-unsend-before-ack control failed on the preceding source
in 106 ms: the recipient's exact first row remained after the hard delete, and
`markDelivered` rejected `NOT_FOUND` at the old message lookup. Its receipt
SHA-256 is
`5c9591a51b773872188f418419c1aaf89156521a8c283cbf1423a00240f8a402`.
The recipient-owned version first passed the extended case in 151 ms; the
retained final run additionally asserts the hard-deleted message is an explicit
successful null before acknowledging its orphaned recipient row. It passed in
159 ms, including an outsider no-op that did not clear the recipient's row,
exact recipient cleanup, duplicate and missing-id idempotency, a reopened
client advancing to a successor from another chat, and member-removal cleanup
followed by a former recipient no-op. The last item proves cleanup/idempotency,
not an otherwise unreachable stale-row `NOT_MEMBER` branch. The initial and
final passing receipt SHA-256 values are
`b7faae1a287afa246c58b5e09b35cd17c4c3414b43441b4cc0d8b3fced58920e`
and
`a1198d3b79f8a948d9f88dca966cff8b0c04ec27540ffe31eb9017246f092d07`.
The simpler owner observation around a deliberately unobserved intermediate
zero saw both snapshots at unread count one while the exact preview message id
changed; that superseded preview-only seam passed in 172 ms. Its receipt
SHA-256 is
`6149b902627769853a9f84ff9ae1be10da594456bc2915c07a7e721158ef49cf`.
The stronger adversarial ordering witness held delivery time equal, made the
second delivery id sort below the first, and observed unchanged unread count
and preview id but a changed first pending-read id. It passed in 181 ms; its
receipt SHA-256 is
`57ec4492f83e85b9943fb1c1a598ef717189b28756b41ea8801983c2ec4dcb9e`.

The JSON test receipts' `generation` field is the schema-only
`Generation.hash()`, so it intentionally stays constant when only operation
bodies or test-only operations change. The non-overwriting binding at
`.snapback/clique-final-proofs/program-binding/receipt-program-binding.json`
(SHA-256
`7c4401a33f9fc4d188a246e27211f44b2d5647d7f68477eba91f90c1c69f73c2`)
records the exact source, compiled project/IR/test, compiler, binary, manifest,
and full `programGeneration` hashes. The final production program generation
is `6f7b82ef54cb7beca68eba9c79509e759e84cf1fc63c28abe5bc7604e831b672`;
the test-instrumented program generation is
`15c43fb41996e86e3d43e6f3034535dd516410f1fa209ccbef452f0581f2a7f8`.
The older failing receipt remains bound to its reported schema generation,
the preceding `c8e95f47f` source snapshot, and its literal `NOT_FOUND` site; a
full program manifest was not captured during that already-preserved run.

The local effect returns a deterministic result without `fetch`; no provider
request was made.

The preceding copied-web qualification used two fresh local-only accounts through
the actual signup and profile UI, two independent Chromium contexts, the
preserved 400 ms online bridge and `DeliveryWatcher`, and no operation filter.
Signup returned a grant and no login or reload occurred, but three/four
automatic `/api/resume` requests preceded the first profile write; this is a
post-resume profile success, not an immediate-signup-grant claim. The first
corrected revision passed six of six measured text sends. The final
query-owned-membership revision then passed 3 warmups plus 20 of 20 measured
sends. Every measured intent made one mutation request and produced the same
exact authoritative id once in the sender and recipient DOM, with zero
terminal pending bubbles. Exact sender-settled, sender-delivered and
recipient-DOM p95 were 2,436.3 ms, 10,160.0 ms and 2,958.3 ms. One offline send
rendered one queued exact-id row, replayed that same id once, remained visible
through a committed-before-query interval, and settled/delivered once. An
oversize input showed the local error with zero mutation requests and no
pending row. The ordinary cohort had no request retries, but delivery receipt
lag—not owner acceptance or recipient rendering—dominates its tail: delivered
p95 trails recipient DOM p95 by about 7.2 seconds. The preserved 400 ms bridge,
`DeliveryWatcher`, and application receipt work were not filtered, so 20/20 is
a functional qualification, not a claim that live-send latency is solved.

The deterministic real-carrier seam demonstrates the projection decision on
both file and IndexedDB stores. The former raw `committed && page-missing`
predicate still projects after a fresh page excludes the observed row and
again after cold reopen. The query-owned item projection remains visible
before that fresh answer, then stays retired across page movement, partial
coverage, remount, and cold reopen. Its ledger entry has the copied helpers'
literal ambiguous semantic target plus the explicit `args.messageId`; it does
not substitute a resolved `ids[0]` target. The two carrier cases passed in
229 ms; the full item-projection file passed 22/22 in 636 ms.
The preceding browser source separately passed a mounted-TTL case: one exact id
committed, disappeared when its deadline fired, left the composer usable, and
produced no React hook-order error or stale draft.

The original six-send artifact is
`grok-live-proof.mBoW5Q/evidence/grok-live-dm.final-019.json` (SHA-256
`d176b5b8973d4e707ae45c445ddbeb2755ff0ca2be276b2ebbe26a42a5927c4c`).
The final mounted-expiry artifact is
`grok-live-proof.mBoW5Q/evidence/grok-live-dm.mounted-after-028.json`
(SHA-256
`012b28938d1ace72f000d469edd269ddddb1b9f6766988b7fdce317f37a1b1ad`),
and the final 3+20 artifact is
`grok-live-proof.mBoW5Q/evidence/grok-live-dm.final-after-029.json`
(SHA-256
`189c09295f5241c731b8fb907200ba6e77ba2a729bee5cfeccf24f8896f65bdc`).
The final harness SHA-256 is
`59261216aecebe5a96af1f8b875ea30be0d244fd55a8be855e6c044d736c8578`.
Chromium 151.0.7922.34 and Node v24.18.0 ran the final cohort against generation
`dc188a4b0db4a9b3e062a52740af81834a109dfaf4a5143f380e47a07726fa94`,
Hermes binary SHA-256
`21d0bd8a270501fc79d916679e2ad9d82e6f2bdc8dc4d4cd5abdd79f849d6104`,
and exact SDK dist composite SHA-256
`539556108369957b57578a9cdc2fa18e9d430e530ccae81ac826500646ba5c96`.
The owner was local port 51200 behind proof-only gateway 51203 and frontend
51202; the browser, gateway and frontend were stopped after the run.

Failed attempts remain evidence. In particular, attempt 017 proves that one
oversize submit and one stable message id received two HTTP 400 requests about
374 ms apart while the durable row remained queued as the online bridge
retried. The final app avoids acquiring custody for this schema-known invalid
input; it does not claim to resolve or discard the SDK's inherited
malformed-400 queue classification.
That unresolved custody classification is tracked in
`issues/20260909-snapback2-http400-outbox-intent-remains-queued.md`.

Attempts 021–026 also remain preserved. The first mounted-expiry attempt
exposed the copied app's pre-existing conditional-hook return; moving the
existing hook before that return fixed it. Attempt 026 passed that mounted
expiry, then its long 51-send browser fill encountered 584 current-client
`conflicting durable fact` page errors and never supplied a projection
verdict. It is not counted as old/fixed evidence. The deterministic carrier
case supplies the causal old-fails/fixed-passes page lifecycle without hiding
that separate failure.

The same-period replay journey passed against the logical-cutoff build in
3,721 ms with two schedule firings:
one replayed post and follow remained silent after replay mode turned off,
while one later ordinary post survived an injected 503, restart and outbox
drain and appeared exactly once in that period's digest. The direct privacy,
membership-incarnation and ordered-prune journey passed in 2,797 ms with two
firings; its ordinary peer is a current chat member, not merely a nonmember.

The raw old-owner expiry capture is
`grok-live-proof.mBoW5Q/fact-trace/old-owner-envelope-trace.json` (SHA-256
`20de2e63a6bb25e2233c4c144c6727ed56c0ec6d3079be433a4a498902bee243`).
Warm seq 5433 and cold seq 5438 each contain an expired delivery and the same
message as a positive `status: expired`, body-null row at that sequence. The
one-shot controls did not themselves throw, so this proves the real emitted
pattern, not the exact key behind browser attempt 026. Its field named
`sourceGeneration` was mislabeled: it contains manifest
`programGeneration=22948199c45477476f73669bb8da7dab389baaface399bdb0e691ae090739e8d`;
the unchanged owner's actual manifest `generation` is `dc188a4b...`. A
non-overwriting correction sidecar retains both values and exact source hashes.
The automatic unclocked store regression installs the schema-derived negative,
then presents the positive expired row and expired delivery at the same seq. It
returns `E_OFFLINE_DELIVERY` and rolls back byte-identically on File, SQLite,
and IndexedDB, warm and cold (7/7 including the parent test).

## Actual local effect execution

`owner-preview.test.ts` is an additional retained proof, not production code.
Copy it into the isolated app's `snapback/tests/` and set
`CLIQUE_EXPECTED_GENERATION` and `CLIQUE_PREVIEW_RECEIPT` as its header describes.
Each named case runs independently under the existing five-second journey
deadline. A default `NoEngine` binary cannot qualify this check; use the
Hermes-featured owner and its configured media helper.

Root executed the final instrumented generation
`faa570f446e53781cdd6cc80dd522d3da9d63917072c39a4bde4481d501b47da`
on BLACK with binary `rust64:046d2b2aabe0ca35` (SHA-256
`21d0bd8a270501fc79d916679e2ad9d82e6f2bdc8dc4d4cd5abdd79f849d6104`).
All nine scalar/media cases pass: 0/79/80/81/223 scalars in 51/52/60/52/70 ms,
emoji boundary in 132 ms, photo/video fallback in 220/243 ms and view-once
hidden-body exclusion in 228 ms. Every trace is `sent`, one attempt, with
stored target/preview equal to effect arguments and the settled result; the
returned provider id equals the outbox id. The exact compiled effect only
returns payload/meta fields. This is executed local-effect evidence, not an
instrumented network observation or real-provider delivery/idempotency claim.

Raw JSON and CLI receipts remain on BLACK as
`/tmp/clique-20260909-preview-<label>.json` and `.stdout`; the 80-scalar label
is `scalars-80-attempt2`. Its raw SHA-256 is
`b52d15af51dc750f12127f2f4aa08e3c34005cb0855e507ec4ad4d4c140d4ab4`.
The emoji raw SHA-256 is
`004899dc0e9776048021b196ec58ab59b527f1bb7517c1288ce05a62a3f7873b`;
view-once is
`2ecfdeb6bf535e281fdcf624f4a2ff17a619098841c883c6569d7859bc5bdd7d`.
An earlier source-copy race failed project-root discovery before execution.
The response-loss case writes a successful equality receipt but then fails
cleanup with `client is closed`; its journey is still **failed**, and a
corrected lifecycle rerun was required. Its preserved raw hash is
`44fa99140bcde06d18996f1c42c908b3965aab8fa175fc9a10af99d477ae1b45`.

The first lifecycle revision still closed the current durable client before
the harness's automatic offline-derived check, so it also failed after writing
its equality receipt. The retained correction leaves that client to the runner.
Source SHA-256
`81a149146b55ec7da1872f558d6d8e9f5a9011d6c83d093940ab84994c4e2b2f`
then passes the response-loss/restart journey in 692 ms and the mandatory
one-query offline-derived check in 52 ms. The effect has one stored row and
one executed attempt despite the injected post-commit 503. Raw
`/tmp/clique-20260909-preview-retry-derived.json` has SHA-256
`62091123eb969457e88c1a793b4891bd175b946fa4691e7780d4cc7a045238a8`.
All ten named actual-effect cases have now passed; the earlier failures remain
retained and are not included in a manufactured all-attempts-green claim.

## Standalone follower-scale proof

`follower-scale.mjs` and `follower-scale-runtime.mjs` retain a separate real-owner
driver. Use a corrected **production** handoff, without `owner-inspection.patch`,
and an output directory that does not yet exist:

```sh
node follower-scale.mjs \
  --handoff /path/to/copied-corrected-app \
  --generation dc188a4b0db4a9b3e062a52740af81834a109dfaf4a5143f380e47a07726fa94 \
  --binary /path/to/current/snapback2 \
  --compiler /path/to/current/dist/compiler.mjs \
  --client /path/to/current/dist/client.mjs \
  --work /path/to/new-proof-output
```

The handoff must already contain the matching generated project/certificates.
The driver copies only its `snapback/` source into three fresh variants with
empty `.snapback` directories. Generated principal rows are setup fixtures;
follows themselves are created through the current headless client. Every
variant's syntax, compiled generation, certificates and unchanged schema bounds
are checked before any owner is launched. Keep the driver and its sibling helper
together. Each child is owned by exact PID and its output is retained.

The explicit 120-second setup budget is outside the measurement interval; it
does not change a product cap or the existing five-second journey deadline.
The timing arms each use three warm-ups and twenty measured post writes at
five and nine hundred actual followers. The separate digest arm creates five
hundred actual follows and checks activity at the last sorted follow edge in
the source post's own period. That arm observes a durable digest row, not
effect execution, so a no-JavaScript-engine owner cannot turn it into an
external push-delivery claim. A successful final receipt is still required;
source presence or a syntax check alone does not qualify these scale claims.

Root's final EPYC receipt now passes: three warm-ups and twenty measured writes
per arm give p95 13.216021 ms at five followers and 11.655974 ms at nine hundred,
a 0.881958 ratio against the 3× ceiling. The separate 500-follow account includes
exactly one post from its last sorted follow edge in the matching source period.
All owned processes exit normally. The receipt at
`/home/ccheever/lanes/clique-20260909-recipe-proofs/run-root-final.oppWQ6/scale/follower-scale-receipt.json`
has SHA-256 `ea144b7e000265715e4272ef07fa6fd599eae9ee2b0e5b33d1108ea3054129ce`;
it binds actual setup, all samples, certificate sites, copied source, binary,
client and process output. Earlier count-shape, oversized seed and typed-site
assertion failures remain preserved rather than counted as product timings.
