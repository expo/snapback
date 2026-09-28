# EX round 2 — protect owner keys and publish the remaining instructions

2026-09-28. Worktree `/home/ccheever/sb4-intent/lane-ex`, branch
`sb4-intent/ex-social-example`. Local commit only; no push or publication.
Read both prior prompts, reports and journal entries, and Astra's complete
round-1 READY WITH CHANGES review. Grok was checked at startup, during work
and before completion; its file still contains only review progress, with
no findings or verdict. It was not awaited.

## Integration and orientation

Fetched and merged `origin/main` **ea7ecc896** (EQ landed) in **9f4bef13f**.
Only the journal append and LLP 3000.028 Revised line conflicted. Both complete
parent journals remain as ordered line subsequences, and all revision notes
survive. No other conflict required semantic resolution. OS is not landed;
its adoption remains for round 3.

Read-only `llp-orient` scope: generated social schema, public-client starter
witnesses, compiled cards, package prose and publication file membership.
Governing context: LLP 3000 §4 (fence); LLP 3000.028 §3.2/§3.4/§8 (normalized
history, owner coverage, recipes); LLP 3000.022 §2 (SDK delivery); LLP
2000.000 §7 (partition coverage). These Snapback 4 documents are in current,
not foundation. Read the actual sync, client, receipts, social and feeds
cards alongside the records. Constraints remain ordinary history, principal
coverage before absence, SDK-owned delivery and independently owned visible
seen reporting. No new design or hand-off was needed. The scoped corpus
audit updates §8 and its Revised line; native Expo qualification stays open.

## Changes

- **Cold owner-key regression in the generated starter.** Native/process and
  wasm clients start after 2,001 likes are seeded. The public partition holds
  exactly 2,000 rows, all newer than the caller's own like. Before that caller
  acquires coverage, `postState` stays loading with no Boolean. After sync,
  transport disconnection and disconnect discovery, the old own key answers
  true and a never-queried absent key answers false, both `complete: true`
  and `fresh: false`. The absent key differs from the pre-acquisition probe.
  The fixture creates its post through the actual mutation; no Following
  source bypass or warm device stream supplies the missing image.
- **Sensitivity is proved.** `mutate-starter.mjs` wraps only temporary
  `new --template social` output and removes `with own keys .principal`.
  Both cold tests fail at the old-like assertion, returning E_OFFLINE instead
  of a complete true answer. The production source/binary is never mutated.
- **Published adoption instructions.** `FOLLOWING-ADOPTION.md` is in the npm
  `files` list and contains the full existing instructions: paused writes,
  owner-context calls, dependency-ordered bounded backfill, replay/removal
  rules, bridge functions and the compiling example. The repository document
  forwards to that canonical copy; existing guide and bridge tests compile it.
  The feeds card links the package document. README now points to the CLI
  receipts card, the native reference explains the public process adapter,
  and the extra worker-demo/server-report/test pointers are replaced by the
  explanations themselves. No publication version is changed.
- **Positive path guard.** Every compiled card and every shipped Markdown
  document is scanned for prose links and file paths. Targets must be in the
  manifest-derived shipped-file set. Exact documented application inputs,
  generated outputs and HTTP file endpoints are distinguished from checkout
  dependencies; there is no broad `src/`, `crates/` or reports exemption.
  Code snippets and explanatory source annotations retain their separate
  semantics. Tests include Astra's exact GitHub adoption URL, its bare path,
  novel unlisted names, reference-style links, traversal and remote file
  links, and removal of the published adoption document from the allowed set.
  The original lane/report hygiene guard remains. An actual npm pack dry-run
  independently confirms the new document among **203 shipped files**.
- **Receipt ownership is current.** The client card explicitly assigns
  delivery to the SDK and visible `seen` to the screen, removing the obsolete
  background hook/acquisition advice. Audited client, receipts and sync; the
  latter two have no equivalent obsolete instruction. A guide regression
  pins the positive contract and rejects the old sentence.
- **EQ adoption.** Starter history and receipt pages use
  `messages where .conversation = conversation ... by byConversationOrdinal`,
  matching the idiomatic sync card. Both share the history cursor and retain
  their original scope/order. The starter README and social card explain the
  form. `why history` selects `byConversationOrdinal (conversation =
  conversation)`. Per-chat search and the explicit all-chat split are unchanged
  pending OS; no premature ordinary all-chat claim is made.

## Qualification

Existing Node 24.13.1, Bun 1.3.14, Rust 1.97.0 and wasm-bindgen 0.2.127.
All caches and temporary outputs stayed inside this worktree or existing
self-cleaning test directories. No shared tool installation.

| Command/check | Final result | Evidence |
| --- | --- | --- |
| `cargo build -p snapback4` | Pass | `build.log.gz` |
| `bun run --cwd packages/snapback4 build`, `typecheck` | Pass | `client-build.log.gz`, `client-typecheck.log.gz` |
| `node --test packages/snapback4/test/social-starter.test.mjs` | **5 passed, 0 failed, 0 skipped** | `starter-qualified.log.gz` |
| Generated new/check, full Expo app + four guide snippets typecheck, public-client smoke | Included in those five; pass | Also explicit `starter-new.log.gz`, `starter-check.log.gz`, `history-plan.log.gz` |
| Social browser + existing init recipes | **14 passed, 0 failed, 0 skipped** | `affected-browser-init.log.gz` |
| `cargo test -p snapback4-lang --test guide` | **97 passed, 0 failed, 0 ignored** | `guide-final.log.gz` |
| `cargo test -p snapback4 --test feed_bridge` | **12 passed, 0 failed, 0 ignored** | `feed-bridge.log.gz` |
| Owner-policy removal | Both native and wasm fail at intended assertion | `mutation-qualified.log.gz` |
| `npm pack --dry-run --json --ignore-scripts` | Adoption document shipped, 203 files | `package-dry-run.json` |
| `node scripts/docs-budget.mjs` | README **300/300**; first-account test passes | `docs-budget.log.gz` |
| Root `./ref-check --verbose` | Pass, 0 errors/unchecked | `ref-check.log.gz` |
| Whitespace/source caps/merge preservation | Pass | `audit.json` |

**128 passing tests** across the four non-overlapping suites above. The docs
budget's one repeated guide test is not added again. The public smoke checks
real receipt paging/cursor compatibility and retained history after leave
using the adopted equality form. Browser tests retain all prior lifecycle
and two-send recovery assertions. No affected runtime behavior was weakened.

**Did not run `scripts/test.sh`, as instructed.** No complete-suite claim or
new full-suite summary is substituted for the affected checks.

## Every failed attempt and attribution

Every failure this round is **ours**, corrected or an intentional negative
control. **Baseline test failures: 0. Environmental test failures: 0.**
Earlier rounds' recorded full-suite failures remain historical; this round
does not rerun or resolve them.

| Attempt | Failure and disposition |
| --- | --- |
| Merge | Expected two textual conflicts. An initial preservation script wrongly required both journals to have an identical byte prefix; earlier merges interleaved appends. Its failed assertion was followed by an unintended local merge commit with markers. Immediately repaired with both complete parent line sequences verified and amended to 9f4bef13f before implementation. No bad merge was pushed. |
| `starter-initial.log.gz` | 2 failures: fixture tried importing Following-mapped posts, correctly refused E_TIMELINE_IMPORT. Create one post through the public mutation and seed likes only. |
| `starter-corrected.log.gz` | 2 failures: expected E_OFFLINE before acquisition, but the record-shaped `postState` correctly stays loading. Require loading and no data. |
| `starter-final.log.gz` | 2 failures: toggling transport loss alone had not updated link freshness. Perform an offline sync to discover loss before requiring `fresh: false`. `starter-qualified` passes both complete stale answers. |
| `guide-initial.log.gz` | 2 failures: the new positive guard exposed unpublished SERVER pointers and overclassified app output names; its bare-path sensitivity case caught trimming the terminal backtick incorrectly. Corrected parsing, explicit app examples and prose. |
| `guide-corrected.log.gz` | 1 failure: decimal timing ratios and HTTP/1.1 were misclassified as files, and several documented generated output names were missing. Require an alphabetic file suffix for slash paths and enumerate those outputs. No unshipped repository path was allowed to clear the test. |
| `mutation-no-owner-policy.log.gz` | Both intended assertion failures occurred, but the initial wrapper's synchronous child launch orphaned its dev servers after teardown. Recorded and terminated only the two owned PIDs (`mutation-processes.json`); fixed wrapper to exec non-new verbs. The completed `mutation-qualified` run exits 1 normally with exactly the two intended failures. |
| Setup/read commands | Guessed nonexistent helper/schema paths, an empty npmignore glob and one overly broad corpus search; no edits resulted. After successful explicit starter creation, a redundant version command used the wrong relative binary path (exit 127); reran check/why using the absolute binary. |

No test/assertion was deleted to make an exploratory failure green. Expected
negative controls are sensitivity evidence, not a product failure being hidden.
Logs retain all failed attempts, including the misleading exploratory filename
`starter-final`. `logs.json` records uncompressed lengths and SHA-256 hashes;
compression changes no log content.

## Wasm and remaining limits

Fresh production `bash scripts/build-wasm.sh`: **2,018,847 B raw /
585,970 B GNU file-input gzip-9**, unchanged cap **586,193 B**, **223 B**
headroom. SHA-256:
`9609882339d4e5d73065c5d608c90da71efaa27c824a7d92d32ebed5ee581bd1`.
See `wasm-build.log.gz` and `wasm.json`.

This measures the combined merged main/EX tree, not EQ's standalone prior
branch artifact. EX changes no core/device/build/budget input relative to
merged main (`wasm-input-diff.log.gz` is empty). Compared with EX round 1,
the integrated artifact is +939 raw / +870 gzip bytes after the EQ merge;
that inherited integration is not an EX source change. No independent
pre-edit rebuild was performed, so no invented before/after byte comparison
is claimed. The final artifact hash remains the recorded build's hash.

Native Expo/Hermes/iOS/Android lifecycle evidence remains outstanding for the
three recipes. The browser mounts actual route code with controlled DOM
hosts/read races; typechecking is not native qualification. No new scale,
calibration, publication or complete §8 qualification claim is made.
