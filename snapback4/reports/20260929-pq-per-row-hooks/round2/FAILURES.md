# Round-2 failure ledger

## Unexpected intermediate failures — ours

- `per-row-initial.log`: 23/25. Both wasm/process 1,000-row count cases
  observed 1,001 evaluations. Their inherited LV fixture mounted an extra
  invalid-input owner and assumed LV would suppress its later evaluations.
  Removed that LV-only owner; the test now actually mounts 1,000 owners and
  retains the exact 1,000-evaluation assertion. Both pass in `regressions.log`.
- `regressions.log`: 113/119. Six clock-memory cases below still triggered
  revalidation using a sync. On pre-LV main that sync clears remembered B,
  defeating the fixture's purpose. They now use the server's advertised
  presence interval to trigger the controlled read and preserve B. The same
  six failed again in `clock-fixed.log` because a working-directory error
  prevented the intended edit from running. All six then pass in
  `clock-memory-fixed.log`; no product retention change or timeout increase.

- wasm keep=undefined: displayed expiry fences an older body while preserving newer memory (active)
- process keep=undefined: displayed expiry fences an older body while preserving newer memory (active)
- wasm keep=true: displayed expiry fences an older body while preserving newer memory (active)
- wasm keep=true: displayed expiry fences an older body while preserving newer memory (lingering)
- process keep=true: displayed expiry fences an older body while preserving newer memory (active)
- process keep=true: displayed expiry fences an older body while preserving newer memory (lingering)

- `affected.log`: 883/884. `createApp keep=true: useQuery and usePage
  preserve inputs through 20 replacements, loaded cursors and removal` failed
  with `window.latest.query` undefined in its browser predicate. Source files
  changed during that run; Vite reload is a plausible cause, not proven by a
  captured trace. No baseline/environmental exemption is claimed. The same
  case passes with stable source in `authority-browser-rerun.log`; the final
  targeted run passes 203/203 in `regressions-final.log`.

## Setup / tooling corrections — ours

- Initial source patch applied with rejects at expected LV/pre-LV conflicts;
  the rejects were manually ported and removed. No rejected hunk is treated
  as an applied change. The premature build after an unavailable `python`
  command reported TypeScript errors from that partial port; rerunning the
  edit with `python3` and finishing the port made the build pass.
- A clock-fixture edit used a repository-root path while already inside
  `snapback4/`; it failed before editing. The repeated six-case red is listed
  above. Corrected the path and ran the intended six cases successfully.
- Initial isolated baseline transpilation omitted `fileName`, causing generic
  TypeScript syntax to parse as JSX (`baseline-setup-error.log`, one failed
  test-file import). Added the real file name. The complete pre-LV source then
  passes both unknown-footprint cases (`baseline-unknown.log`).
- Read-only lookups used several stale paths (an LLP filename, the report after
  switching branches, a clock helper, await-census filename, reads.md and Rust
  wire/dispatcher filenames). Correct paths or `git show` supplied the context;
  no implementation decision or pass claim relies on a failed lookup.

## Expected negative controls

All are ours, deliberate mutations in an isolated SDK copy. Production files
and the running suite were not modified by controls. Expected failures:

| Control | Failing cases |
|---|---:|
| online reset comparison removed | 3 |
| local reset comparisons removed | 6 |
| unknown final drain removed | 2 |
| online floor rejection publishes loading | 3 |
| local floor rejection publishes loading | 6 |
| duplicate scheduling moves owner to tail | 1 |
| active cancellation removed | 9 |
| attempt expiry removed | 3 |
| React keys use raw JSON object order | 1 |
| queued observation publishes loading | 1 |
| due deadline incorrectly takes rollback-floor suppression | 3 |

## Required full run — both failing tests are ours

The client phase reports **4,572 tests, 4,560 pass, two fail, ten declared
skips**. The separately sharded client files pass. These are the two failures:

1. `retention-lifecycle.test.mjs`: `wasm: resubscription delivers saved row
   expiry without an accessor, keep=false`. The port called `reload()` for
   every local queued owner, whereas pre-LV main only does that here when
   `retain` is true. That withdrew the saved detached answer immediately on
   resubscription. Restored the existing `watch.retain` conditional at queue
   entry. Commits still call `LocalReads.committed()` and respect each policy;
   row expiry stays immediate. No retention policy is redesigned.
2. `typing-expiry.test.mjs`: `useQuery expires 4.5 s typing rows aged 0 ms
   before mount on both clients`. The online deadline floor dropped a reply
   even when its deadline was already due under the current clock. That
   bypassed the existing paced acceptance retries and delayed the empty answer
   until later background work. Floor suppression now applies only when the
   withdrawn deadline appears future after rollback; ordinary due replies
   still take the existing expiry retry path. Added three controlled cases,
   one per retention policy, requiring exactly one stale reply and one paced
   retry before the empty answer. Removing that distinction is a negative
   control in `no-due-expiry-retry.log`.

**Both failing files and all per-row/clock regressions pass: 287/287** in
`full-fixes.log`, without changing the failing assertions or timeouts. The
required full run remains red; no second invocation or final-tree green
full-suite claim is made. No baseline or environmental exemption applies to
these two failures. The complete run exits 1 with exactly:

```text
== 1 failure(s) in 1331 s
   client tests
```

Every other phase passes, including models **79/79**. No full-run failure is
baseline or environmental. The earlier affected browser case also passes in
this full client phase. Logs preserve every result; trailing whitespace and
extra EOF blank lines are normalized only for the repository whitespace check.
