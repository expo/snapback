# Grok app corrections

These files reproduce the bounded 2026-09-09 Clique correction without the
grader, credentials, generated output, database state, or provider settings.
The benchmark evidence remains read-only.

Apply the two independent stages from the copied app root:

```sh
patch -p1 < syntax-adapter.patch
patch -p1 < grok-app.patch
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
`3a0dd0181e3b48f2b38376012a56cfc490d48ae4680ec1fb5e9a0638986541d2`.
The corrected copy compiled and certified 65 operations as generation
`6d27e9dfb33ae24a44810b1baa74c9560c94b4ddef171ca41ef02635064e5912`.
Both patch stages pass `patch --dry-run -p1` against their respective inputs.

The first faithful atomic digest at 500 follows and 100 current memberships
needed 4,516,191 closure bytes, 321,887 above the 4 MiB ceiling. Persisting
partial totals would make authorization stale between chunks. The retained
app instead keeps the compact follow mirror equal to `follows` in every
follow/unfollow path and updates a compact author/period counter in the same
transaction as each of its six current original-post insert paths. A future
post delete or key-changing update must adjust that counter in the same
transaction; the copied app exposes neither operation. Post creation remains
constant work regardless of follower count.

The final digest reads all 500 follows and 100 memberships atomically with
current relationships, maintained per-chat period unread counts, and split
transaction-local scratch rows. Its actual app certificate reports 2,763,906
closure bytes, 3,554,237 heap bytes, 1,815 examined/index entries, and 36,857
steps. The original 50-member per-conversation cap is unchanged. The recipe
adds an explicit 100-membership per-principal bound: membership 101 refuses
rather than being silently omitted from a digest. A recipient can have at most
50 pending unread rows per chat, so the existing first-50 read path cannot
leave an admitted 51st period row while claiming the chat cleared. The
configured 120,000 ms period equals `schedule digestPulse every 2m`, and the
digest uses completed `[periodStart, periodEnd)` buckets.

Run each retained case against a copied app and fresh isolated local owner; for
example:

```sh
snapback2 test --journey "digest keeps the 100-membership account envelope"
```

The journeys need no provider configuration and must not run against the
original benchmark owner. On an isolated owner, the adapted baseline failed
following activity with `following activity produced no digest` (2,418 ms,
one schedule firing) and a second quiet period with
`quiet period left 2 digest rows` (553 ms, two firings). The corrected copy
passed expiry (46 ms), the exact stored 80-scalar Unicode preview (40 ms),
following activity (70 ms), and quiet-period suppression (580 ms). The compiled
fixture separately executes the same bounded value through storage and emit;
the focused owner preview case does not inspect the effect payload. A
separate journey committed 99 groups on top of Bob's seeded membership and
passed the real 100-membership digest path in 391 ms.

The local effect returns a deterministic result without `fetch`; no provider
request was made.
