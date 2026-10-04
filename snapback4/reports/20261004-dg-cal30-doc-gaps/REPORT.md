# DG — calibration #30 worker and quote recipes

2026-10-04. Local work on eb1000 (hostname `expose-builder-pixel`), branch
`sb4-intent/dg-cal30-doc-gaps`, base `abafa9af9cd58e30a3b0dc6461cd4ab339c3cb83`.
No other machine contacted. Commit only; no push or publication.

## Evidence and changes

Inputs: `~/sb4-intent/cal30-items/grok/run-log.md:43,54`, its diary/essay and
worker; `astra/Chats.tsx:53`, `grader-report.json` defect d-01 and `trace.md`.
Grok wrote the push log beside a private worker copy. Astra rendered a terminal
missing-quote string while the point read was loading; its test raced the read.

`guide effects`, the published worker reference, social/web starter READMEs and
both shipped worker-file comments now explain source copies, imports, cwd,
package lookup, environment selection and application file output. The executable
recipe writes `data/push-log.jsonl` beneath the new `SNAPBACK_PROJECT_DIR`, injected
by every supervisor. It is the canonical project root in dev and active release
root in serve, equal to initial cwd and stable across child `chdir`. A parent
setting cannot override it. Cross-release files still require an explicit durable
location; the completion ledger retains its separate store-owned lifetime.

The social starter now ships the small `QuotedMessage` component, embedded
verbatim in `guide social` and linked from `guide client`. The existing
`messagePhoto` query returns a whole message by ID, independently of history
pagination. `readPresentation` branches explicitly: loading placeholder, present
text, proven-absent unavailable, denied hidden, and partial uncertain. The outer
box stays mounted; no application cache retains withdrawn text. This starter has
no reply composer, so the component is provided for mounting when adding replies.

## Worker execution, with source locations

| Question | Verified behavior and code |
| --- | --- |
| Which entry runs? | Dev discovers conventional server/worker entries; serve can select an explicit external entry. Both also supervise named worker declarations. [serve.rs:334](../../crates/snapback4/src/serve.rs#L334), [dev_worker.rs:47](../../crates/snapback4/src/dev_worker.rs#L47). |
| Named-worker copy | Every regular file in `snapback/workers/`, including unimported files and nested helpers; top-level `.mjs`/`.mts`/`.ts` files are entries. Neither just the entry nor a computed import graph. [worker_declarations.rs:89](../../crates/snapback4/src/worker_declarations.rs#L89). |
| Conventional dev copy | All of `snapback/`, including generated modules, plus present project files in the server checker's dependency graph. Missing candidates and installed package files are excluded. [worker_declarations.rs:138](../../crates/snapback4/src/worker_declarations.rs#L138), [checked_imports:161](../../crates/snapback4/src/worker_declarations.rs#L161). |
| Explicit serve entry | Runs the operator's canonical entry in place, without a snapshot. [dev_worker.rs:192](../../crates/snapback4/src/dev_worker.rs#L192), [launch selection:287](../../crates/snapback4/src/dev_worker.rs#L287). |
| Paths | Child cwd and `SNAPBACK_PROJECT_DIR` are the canonical active project/release. File-relative Node URLs and relative module imports resolve within the private copy for automatic entries. [dev_worker.rs:341](../../crates/snapback4/src/dev_worker.rs#L341). Copies live under private `.snapback4/worker-*` scopes and are removed after their launch lifetime. [worker_declarations.rs:199](../../crates/snapback4/src/worker_declarations.rs#L199), [Drop:234](../../crates/snapback4/src/worker_declarations.rs#L234). |
| Environment | Cleared, then `PATH`, `HOME`, `TMPDIR`, `LANG`, `LC_ALL`, `TZ` if set; `SNAPBACK_URL`, `SNAPBACK_SERVICE_TOKEN`, `SNAPBACK_PROJECT_DIR`, `SNAPBACK_WORKER_LEDGER`, `SNAPBACK_WORKER_SUPERVISED=1`; selected declared secrets for named entries, all declared secrets for conventional/explicit entries. Parent `NODE_OPTIONS`, `NODE_PATH` and arbitrary app settings do not pass through. [command:466](../../crates/snapback4/src/dev_worker.rs#L466), [secret selection:10](../../crates/snapback4/src/worker_environment.rs#L10). |
| Packages | Host-installed dependency links preserve helper/worker-local, schema-local, project and ancestor Node lookup. Numbered releases use the nearest ancestor's schema-local packages. Manifests are regular-file copies. [walk:61](../../crates/snapback4/src/worker_declarations.rs#L61), [scope:213](../../crates/snapback4/src/worker_declarations.rs#L213). |
| Isolation | Source paths use descriptor-relative no-follow opens; replacing originals does not replace launched bytes. Dependencies remain host-owned. The watchdog owns process-group lifetime. Trusted Node still has filesystem/network access: this is not a sandbox. [open:7](../../crates/snapback4/src/worker_declarations.rs#L7), [worker_process.rs:49](../../crates/snapback4/src/worker_process.rs#L49). |

The [symlink control](symlink-before.log.gz) passed project-root and schema-local dependency links before
this change, but failed worker-local and helper-local links with the reported
ELOOP message (4 pass / 4 fail). Discovery/packaging traversed those `node_modules`
as source. The shared walker now excludes them from source validation and deploy
packaging; launches link their existing host installation. The extended test also
covers conventional dev entries and relative package symlinks inside the linked
installation. Existing source and manifest symlink refusals remain tested.
The supplied evidence does not retain the replay instance's symlink targets, so
this report does not assert that its exact root-level layout was reproduced.

## Governing context and verification

Scoped orientation: [LLP 3000.009 §5.3](../../../llp/3000.009-general-purpose-backend.rfc.md#53-supervision-and-isolation)
owns trusted workers, validated launch bytes and host dependencies;
[LLP 3000.031 §7](../../../llp/3000.031-presence-proven-absence-in-the-client-contract.rfc.md#7-read-presentation-lane-a-2026-10-03)
owns the presentation helper; [LLP 3000.028 §8](../../../llp/3000.028-one-query-online-or-offline.rfc.md#8-recipes-that-must-ship-with-the-example)
owns executable starter recipes. Existing LLP sections were updated in place.
No client contract, read routing, authorization or package budget was changed.

- `cargo test -p snapback4-lang --test guide`: **112 passed**. All guide caps
  remain unchanged; client text is 110 lines / 1,198 words (caps 114 / 1,200).
  The initial guide run caught one missing heading separator and a five-word
  overrun; both were corrected. [Guide log](guide.log.gz).
- Affected client/starter/worker run: **119 passed, 2 failed, 0 skipped**.
  Quote browser transitions and all eight emitted social TS/TSX blocks passed
  (compiled against generated API); all 12 dependency layouts and four executable
  file-output recipes passed. [Initial run](affected-initial.log.gz).
- The two restart tests overlapped my CLI rebuild. The running executable was
  observed as `(deleted)` and the failing restart repeatedly reported ENOENT.
  This is an execution-order error in that run, not a passing result. Both tests
  passed on the stable binary, **2/2**, without a product change.
  [Repeat](worker-lifecycle-repeat.log.gz).
- Full `scripts/test.sh`: **1 failed stage in 1,656 seconds**, retained as failed
  ([log](full-suite.log.gz), [exit 1](full-suite.exit)). All Rust targets/doctests,
  builds/typechecks, nine fixture wrappers and **79/79 serial models** passed.
  The client pool completed **311/311 files: 6,202 passed, 2 failed, 11 skipped**;
  the worker regression file passed **77/77**, including source/manifest refusals.
- Both full-suite failures were existing explicit-environment allowlists in
  `worker.test.mjs` and `server-e2e.test.mjs` that omitted the new documented key.
  Corrected both; their complete files passed **44/44**, with no skips or process
  leaks ([rerun](environment-rerun.log.gz)). No runtime code changed after the full
  suite's build. The full suite was not repeated after these test-only fixes.
- Final path assertions use canonical expected paths for temporary-directory
  aliases. The focused dependency/environment/file-output cases passed **18/18**
  ([log](paths-final.log.gz)). No Mac execution is claimed.
- `ref-check --verbose`: **0 errors, 0 unchecked**; `git diff --check`: clean.
  [References](ref-check.log.gz). Wasm: **639,750 B gzip / 639,887 B budget**.

The quote browser witness uses React Native host-view stubs; it proves rendered
states and lifetimes, not native-device layout. No Mac or iOS run was attempted.
Node 24.13.1, Bun 1.3.14; all execution on eb1000.
