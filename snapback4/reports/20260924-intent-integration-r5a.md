LLP 3000.013 integration, round 5 part a — 2026-09-24

Branch `sb4-intent/integration`, worktree `~/sb4-intent/lane-i`.
Read `~/sb4-intent/round-i-5.md` in full. This qualification covers only
main, E, F and the two requested test-only follow-ups; later lanes and the
whole-round qualification remain pending by instruction.

| Source | Merge commit | Conflicts and verification |
|---|---|---|
| Fetched `origin/main`, `0ee488999` | `86de910d1` | Clean. The fetched head includes the new LLP 3000.014 and scheduled backstop records beyond the brief's main reference. Workspace build passed. |
| E, `199964910` | `ef7e3131a` | Clean. Workspace build passed. |
| F, `27a2491fe` | `2ad6be2e8` | Only `JOURNAL.md` conflicted. Concatenated the unchanged E and F entries, all dated September 24. Verified every entry from both parents survives unchanged. Workspace build passed. |

All merges use `--no-ff`. Read E's external rounds 6–8 final reports and
F's rounds 1–3 final reports before merging, together with their committed
reports. The imported file maps, forms, decisions and lane evidence are in
[E options](./20260924-lane-e-041-options.md),
[E storage fences](./20260924-lane-e-round7.md),
[E deferred revocation](./20260924-lane-e-round8.md),
[F feeds](./20260924-feeds-guide-041.md),
[F card leads](./20260924-feeds-and-card-leads-r2.md), and
[F definitions](./20260924-guide-review-r3.md).

Integration changes, relative to `snapback4/`:

| File | Change and proof |
|---|---|
| `packages/snapback4/test/app.test.mjs` | Add `logout retry revokes a discarded login after its token-comparison read throws`. Hold a real server's committed login response; make both epoch and tombstone writes fail; let the original bearer comparison finish; then make the discarded token comparison throw. The unchanged saved bearer is protected and the discarded login remains live during the outage. Repair storage and retry logout: the store clears and the server rejects the discarded token with `E_AUTH`. |
| `crates/snapback4-lang/tests/guide/feeds.rs` | Add `published_following_unrepost_uses_the_reposting_viewer`, executing the exact published Following block. Bob reposts Alice's original; Carol follows both. Verify asynchronous delivery, event identity and actor, then Bob's published `unrepost`. Alice, Bob and Carol retain only Alice's original before and after cleanup; the original source row survives and the repost source row is deleted. Keep the existing same-author unrepost test unchanged. |
| `JOURNAL.md` | Preserve the merge entries and append one dated part-a integration record. |
| `reports/20260924-intent-integration-r5a.md` | Record merge resolution, the reviewer follow-ups, negative controls and affected qualification. |

No implementation or guide example needed a follow-up change. Existing forms
remain exercised: `app.auth.login(email, password)` followed by
`app.auth.logout()`, and the published `delete reposts[viewer, postId]`
inside `mutation unrepost(postId: posts)`. The Following block compiles with
zero diagnostics and notes before the test executes it.

Both requested negative controls were executed and restored byte-for-byte:

- Remove only `deferredRevocations.add(token)` from the failed-comparison
  catch in `src/app.ts`, rebuild the package, and run the new app test.
  It fails because the server still accepts the discarded login after retry.
  Restore the source and rebuild before the affected run.
- Replace only the published deletion with `delete reposts['alice', postId]`
  and run the new Following test. It fails when Bob's unrepost refuses with
  `NOT_FOUND`; the test requires a committed mutation. The initial mutation
  wrapper expected the later row assertion, so its result check was corrected
  to recognize this earlier, valid failure. No product or test change was
  needed. Restore the card before the affected run.

Reproduce the added passing tests:

```sh
node --test --test-name-pattern='logout retry revokes a discarded login after its token-comparison read throws' packages/snapback4/test/app.test.mjs
cargo test -p snapback4-lang --test guide published_following_unrepost_uses_the_reposting_viewer
```

Affected qualification: **529 passed, zero failed**, plus four existing ignored
aggregate cases. Client tests: **237 passed**, zero skipped or cancelled, across
`app`, `app-storage`, `app-online`, `online-session`, `session-security`,
`client-seams`, `asset-blob-lifecycle`, `react`, `readme-examples`,
`first-account`, `web-shell` and `client-lifecycle`. Rust targets: guide **67**,
aggregate copies **64** (four ignored), readauth **81**, CLI check **68** and
feed bridge **12**. No intermittent client failure occurred; no isolated
failure rerun was needed. Intentional mutation failures above are negative
controls, not remaining product failures.

Frozen Bun install, package build/typecheck, whitespace checks and documentation
budget passed. README remains **296/300 lines**. Changed test files are 901 and
417 lines. Reference validation: **505 LLP docs, 9,235 refs, zero errors and
zero unchecked**. No introduced, baseline or environmental affected-test
failure remains. The usual unused `MustBeShareDummy` vendor warning appears
in workspace builds.

`scripts/test.sh` was **not run**, as explicitly requested for part a; there
is no new full-suite summary. WASM rebuilding/measurement, the complete Clique
target rerun, remaining lane merges and the whole-round cross-lane work are
deferred to the resumed round. The complete target fixture is unchanged.
No part-a deviation or new open problem. No new form, version bump, production
behavior, authorization, disclosure, durability or meter change beyond the
imported lanes. No push or publication.

Evidence: `~/sb4-intent/integration-r5a-{main-build,e-build,f-build,e-regression,
e-mutant,e-mutant-build,e-restored-build,f-regression,f-mutant,client-affected,
lang-affected,readauth,cli-affected,docs-budget,ref-check}.log`.
