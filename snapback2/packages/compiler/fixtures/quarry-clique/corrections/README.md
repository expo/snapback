# Grok app corrections

These files reproduce the bounded 2026-09-09 Clique correction without the
grader, credentials, generated output, database state, or provider settings.
The benchmark evidence remains read-only.

Apply the two independent application stages from the copied app root. Add the
third, test-only stage only when running the retained owner cases:

```sh
patch -p1 < syntax-adapter.patch
patch -p1 < grok-app.patch
patch -p1 < owner-inspection.patch
cp owner-cases.test.ts snapback/tests/recipes.test.ts
```

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
one of them requires. Its SHA-256 is
`dd46868429b1dae631e1d8e032caad322d09ec07c0cb7f93929f78cd49ac93c9`.
The owner cases use it to exercise the private row rule directly; do not ship
it as part of the application correction. The retained `owner-cases.test.ts`
has SHA-256
`61909786b276675d0eb9b1f03f6d494a28dc878eddd3b76e1d19791bcfabffbc`.

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
two firings: the message became a bodyless removed row, its recipient's period
custody disappeared, and the later digest counted zero unread messages/chats
without widening lifetime receipt access.

The local effect returns a deterministic result without `fetch`; no provider
request was made.

The same-period replay journey passed against the logical-cutoff build in
3,721 ms with two schedule firings:
one replayed post and follow remained silent after replay mode turned off,
while one later ordinary post survived an injected 503, restart and outbox
drain and appeared exactly once in that period's digest. The direct privacy,
membership-incarnation and ordered-prune journey passed in 2,797 ms with two
firings; its ordinary peer is a current chat member, not merely a nonmember.

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
