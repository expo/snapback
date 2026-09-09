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
`2eab95a76728f18f3beab37de0bc6f6674af87190ddfe91f645e5a62989b50f8`.
The production correction compiled and certified 66 operations as generation
`9b27b0cf485067eb7db45b71040d4ac731fe40f6ed67567868dc80fba7c604d7`.
Both patch stages pass `patch --dry-run -p1` against their respective inputs.

`owner-inspection.patch` is test instrumentation, not application behavior.
After the behavioral patch it grants profiles a test-only replay-mode toggle,
adds two period-unread inspection queries, and adds the total-order index suffix
one of them requires. Its SHA-256 is
`933f2989fa7969d9c1aa3b40bc1a0fd22e898235e1aea961b7b5e6d35f11d7d9`.
The owner cases use it to exercise the private row rule directly; do not ship
it as part of the application correction.

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
message, and chat fields. Its production certificate reports 3,080,636 closure
bytes, 3,758,277 heap bytes, 1,814 examined/index entries, and 37,636 steps.
The distilled compiler fixture reports 3,031,891 closure bytes, 3,708,171 heap
bytes, the same 1,814 examined/index entries, and 37,634 steps. That fixture's
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
id, and an owner job prunes rows strictly older than the last completed bucket.
This does not claim that a non-admin author can erase the app's separate
lifetime receipt rows. The 50-row period cap matches the existing first-50
mark-read path, and the per-message cap bounds author cleanup. The configured
120,000 ms period equals both two-minute schedules, and the digest uses
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
following activity (70 ms), and active/quiet/active suppression (126 ms, three
firings). The compiled fixture separately executes the same bounded value
through storage and emit; the focused owner preview case does not inspect the
effect payload yet. A separate journey committed 99 groups on top of Bob's
seeded membership and passed the real 100-membership digest path in 391 ms. On
the final owner-only count rule, the emission-time exclusion matrix passed in
1,022 ms with 16 schedule firings. The test-only direct privacy/prune journey
passed in 337 ms with four firings: recipient and current author saw the same
custody row, an ordinary peer and the author after leaving saw null, a
removed/rejoined membership contributed zero, the last completed bucket was
retained, and the next prune removed it. The compiler fixture suite passed
282/282. The final all-clients-closed scheduler journey then passed in 879 ms
with one firing: the reconnect drain received the expiry tombstone without the
body, pinned it, and a cold offline restart still had no body.

The local effect returns a deterministic result without `fetch`; no provider
request was made.

The same-period replay journey passed in 1,712 ms with two schedule firings:
one replayed post and follow remained silent after replay mode turned off,
while one later ordinary post survived an injected 503, restart and outbox
drain and appeared exactly once in that period's digest.
