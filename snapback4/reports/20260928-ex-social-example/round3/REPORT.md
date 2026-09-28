# Lane EX round 3 — adoption prerequisites and typing renewals

2026-09-28. Branch `sb4-intent/ex-social-example`, based on round-2 commit
`4d132df9c`. Read all three earlier prompts, reports and EX journal entries,
Astra's full round-2 review and Grok's completed round-1 review. No merge,
push or publication. Main was not fetched or integrated during this round;
the supervisor's round-2 landing suite remains separate. OS adoption waits.

## Scope and governing context

Read-only `llp-orient`: LLP 3000 §4 supplies the Snapback 4 fence;
LLP 3000.028 §8 owns the online-arm lifecycle and published example;
LLP 3000.017 §2.4 defines failed/sent ephemeral calls and their ordered lane;
LLP 2000.000 §7 retains partition custody. These are current documents,
not foundation entries. Read the social, ephemeral and feeds cards and the
published adoption text. The recipe's reference to §8 still applies. Scoped
corpus reconciliation adds this round's notes and revision below; no new
design, hand-off, runtime contract, budget or publication version is needed.

## Changes

- `FOLLOWING-ADOPTION.md` distinguishes a plain installed module from an
  installation already containing the separately generated app bridge.
  Only the latter uses `feedApp*`. Module-only installations go directly to
  manual wiring, with paused writes, owner-context bounded checkpoints,
  ordered backfill, preserved timestamps and replay/removal rules stated
  there. The package offers no bridge generator or installer.
- The published-text guard strips Markdown emphasis/code delimiters before
  path classification. GitHub and raw links must identify the actual
  `expo/snapback` package directory and a shipped file. Repository-root
  README links cannot borrow the package README's basename. Numeric LLP
  references include hyphen, underscore, compact and colon spellings.
  All four exact Astra examples are negative controls, alongside positive
  formatted package-file and full-package-URL controls.
- Every typing renewal captures a generation; stopping invalidates it.
  Only a live, current generation's failure may stop renewal. The browser
  witness holds an older interval renewal's outcome, completes a newer
  renewal successfully against the server, then releases the older failure.
  It requires another renewal and an idle `stopTyping` before expiry. The
  current generation's failure still stops without cleanup and expires.
  No hint enters the durable outbox.

## Published-package-only installation

Downloaded integrity-verified `snapback4-darwin-arm64@0.2.33` and ran its
original public `init <dir> --recipe feeds --prefix feed` on the Apartment
101 Mac mini. This predates installer retirement. It emitted the plain module
without app-bridge options, repository source or either repository generator.
The original output is retained in `plain-0233.tgz`; `feed.q` SHA-256 is
`865ca6b52332ea934138e3d2e2049602214bc2fa50f7dd4069fe9b2d79a8a54a`.
All downloaded tools stayed in task-owned directories, including the remote
`~/sb4-intent/lane-ex/target/round3-published-module`; nothing was installed
on a shared tool path.

`npm pack --ignore-scripts` packed the candidate package locally (203 files).
The test extracts the manual Quarry directly from that tarball. With the
unmodified installed module and the published **0.2.33** compiler, that manual
passes; adding `feedAppPublish(postId)` fails with `E_QUARRY_UNKNOWN`.
`published-install.log.gz` and `published-0233-check.log.gz` retain both runs.

The published **0.4.7 Linux** compiler initially refuses ambiguous positional
unique keys in this old module (see failure ledger). Five explicit-key
replacements, affecting ten occurrences, preserve the intended existing
principal/reader/id keys. No helper definitions, caps or bridge are added.
With those source spellings updated, the same packed manual passes and the
same `feedAppPublish` control fails with `E_QUARRY_UNKNOWN`.
`published-current-qualified.log.gz`, `published-metadata.json`, and
`check-published-module.py --named-keys` record that independent check.
This is not a claim that an untouched 0.2.33 module compiles on 0.4.7.
The permanent bridge regression separately verifies the prerequisite prose,
manual-only compilation and unavailable-helper diagnostic without invoking
the bridge generator on its plain-module path.

## Verification

Node 24.13.1, Bun 1.3.14, Rust 1.97.0; existing local toolchain.

| Check | Result | Evidence |
| --- | --- | --- |
| `cargo build -p snapback4` | Pass | `build.log.gz` |
| Package `typecheck` | Pass | `typecheck.log.gz` |
| Whole guide (`cargo test -p snapback4-lang --test guide`) | **97 passed, 0 failed** | `guide-final.log.gz` |
| Bridge tests (`cargo test -p snapback4 --test feed_bridge`) | **13 passed, 0 failed** | `feed-bridge.log.gz` |
| Browser + starter + existing init tests | **20 passed, 0 failed, 0 skipped** | `affected.log.gz` |
| Final browser with current-failure control | **11 passed, 0 failed, 0 skipped** | `browser-final.log.gz` (included in the 20, not added again) |
| Starter `new --template social`, `check`, app/four-snippet typecheck, public-client smoke, native/wasm owner-key tests | **5 passed** | Included in `affected.log.gz` |
| Remove typing generation fence in temporary generated output | Fails exactly the new older-renewal subtest | `mutant-typing.log.gz`, `mutate-typing.mjs` |
| Package contents / README budget | 203 files; **300/300 lines**, account guide test passes | `package-pack.json.gz`, `docs-budget.log.gz` |
| References / source caps / whitespace | Pass: 0 errors/unchecked; append-only journal | `ref-check.log.gz`, `audit.json` |

**130 passing tests** across the non-overlapping affected suites. The
intentional unavailable-helper refusals are passing negative controls and
are not included in that count. No full-suite claim: **did not run
`scripts/test.sh`**, as instructed.

## Every failure and attribution

| Class | Attempt | Result and disposition |
| --- | --- | --- |
| **Ours, corrected** | `guide.log.gz` | 96 passed / 1 failed: emphasis normalization newly recognized the documented `[backend.json]` application input. Added that exact input to the existing application-file list. No repository path was exempted. Final whole guide is 97/97. |
| **Baseline legacy-source incompatibility** | `published-check.log.gz` | Published 0.4.7 rejected four ambiguous point-read sites in the unmodified published 0.2.33 module and emitted one cascading schedule diagnostic (five problems). No EX code participates in either published compiler. The unchanged module passes with its original compiler. |
| **Ours, incomplete fixture update** | `published-named-keys.log.gz` | After making the first reported keys explicit, two more sites in a newly reached helper were refused. Added the intended `readerId` key at both sites. Final published-current pair passes. No production source changed to clear either legacy check. |
| **Intentional negative control** | `mutant-typing.log.gz` | Missing next renewal after the stale failure: one failed subtest plus its parent (9 pass / 2 fail). Every other browser subtest passes. Production source was never mutated. |
| **Intentional negative controls** | Both qualified published-compiler logs | `feedAppPublish` is unknown without the bridge; expected exit 1 in each. |

Environmental test failures: **0**. Setup reads encountered the absent Linux
fleet document/SSH config and a guessed `social.md` filename (the card is
`social.rs`); no edits or test claims resulted. The fleet document was then
read on the known Mac host. Earlier rounds' failures remain historical;
this round neither reruns the full suite nor claims to resolve those failures.

## Wasm and limits

Remeasured the existing round-2 production artifact, **not rebuilt**:
**2,018,847 B raw / 585,970 B GNU file-input gzip-9**, unchanged **586,193 B**
cap, **223 B** headroom. SHA-256
`9609882339d4e5d73065c5d608c90da71efaa27c824a7d92d32ebed5ee581bd1`;
byte-identical to round 2. This round changes no device/core/build/budget input.
`wasm.json` records the measurement.

Native Expo/Hermes/iOS/Android lifecycle qualification remains outstanding.
The browser uses real route/hook code and SDK/server calls with controlled
host views and deliberately reordered caller outcomes. The remote Mac ran
only the published legacy installer/compiler; it adds no native UI claim.
No scale, calibration, publication or complete §8 qualification claim.
