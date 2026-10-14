# KIT — wave 12

Worktree `/home/ccheever/projects/sb4-w12-kit`, branch `sb4-w12-kit`.
Started clean at `c22dfefc9c`; `git log sb4-loop..HEAD` was empty.
Local commits only. Nothing pushed or published.

## Scope and decisions

Implemented fix list #1 and #14, H4/H7/H8 from the prioritized list,
verification ledger and cited sections of wave12/analysis/patterns.md.
Evidence lanes were read-only. Governing orientation: Snapback4 fence and
rules, LLP 3000, LLP 2000.000, starter LLP 3000.011.003.000 §§8–13,
packaged-kit LLP 3000.011.003.000.000 and publication LLP 3000.021 §3.3.
The semantic amendment is packaged-kit §8; starter §12 points to its replacement
preview contract. Backend authorization, protocol and custody remain unchanged.

Installation stays explicit: one final bold `npm install` line, never an implicit
install. Browser launch uses a pipe; caller Playwright wins, with an optional
playwright-core peer and lazy loading. Runtime ports are read when launching,
never captured from init's environment. Existing application metadata/edits are
preserved. UI starters need two ports; schema-only init and individual hosts
still accept one. The coordinator owns the shared 0.4.29 version change; this
lane deliberately keeps the base's 0.4.28 manifests for exact source-bound packs.

Other lanes: REL3 owns fixture/dev-door testing text; RULES2 owns hidden-row
text; SURF owns generic help generation. One-line ownership pointers remain.

## Per-item delivery

| Item | Change | Commits | Verification |
|---|---|---|---|
| #1/R9 witness | Always install global; URL-gated claiming with E_WITNESS_DISABLED; trusted click/its submit; canonical arguments including null; first unclaimable durable write settles E_WITNESS_UNCLAIMED with event/operation/arguments reason; SDK terminal receipt outside component lifetime; 15-line testing contract | 155bc71f0a, 26993cfb0f, 57002d88cc | Wave-10 real browser regressions, new submit/null/reason/pending controls; 0.4.28 submit red; candidate green |
| #1/R4 custom-schema proof | Home with no Task/writer fails `no write scenario: replace the Home assertions`; adapt prints the repair; chat sends a seeded room message and social saves a profile | 155bc71f0a | Custom-schema browser red on baseline, candidate green; complete packed matrix passed at ac219032c3 |
| #1/R2/R3/H4 bounded browser/caller version | Pipe launch, optional playwright-core peer/lazy load, caller chromium wins; independent bounded context/browser close | 155bc71f0a | No-listener/caller regression; actual @playwright/test@1.64.0 matcher PASS; driver SIGKILL exits all 7 observed browser processes |
| #1/R5 CLI verbs | Installed JS wrapper handles every verb, including web-shell; native resolver still used for owned dev/serve hosts | 155bc71f0a | Native CLI and web-shell tests pass |
| #1/R8 runtime ports | Launchers/config read current environment, init prints range URLs; recognized legacy backend/frontend literal scripts/config migrate and retain explicit defaults | 155bc71f0a | Init range URL/manifest tests and legacy explicit 4517/4600 regression pass |
| #1 day two | Script passes versions/v1.q versions/v2.q; both initial snapshots copy the current complete schema outside snapback/; npm-appended caller pair overrides defaults and malformed lists refuse | 155bc71f0a | Snapshot/argument/invalid-source controls pass. Edit v2 and add business assertions for a real application evolution; initial copies are starting snapshots |
| #1 helpers/guide | renderedText excludes editables and scopes to container; waitForFresh container form; frontPage; external logsDir; four added assertion/seeding rules | 155bc71f0a | Browser helper, default-log, API-index and guide tests pass |
| H8 qualification | Every Linux browser attempt audited over the owned process tree; custom Home must fail before adding a visible writer; custom web's only writer is onSubmit; strict receipt checks reject omitted/out-of-range/missing-negative/missing-submit evidence | 364efcb494, 157ada9dc4, ac219032c3 | Qualifier/audit unit 34/34; all three baseline controls fail (listener 41837 outside assigned 29130–29139); candidate controls pass. Exact packed run passed at ac219032c3 |
| #14/H7 starters | One final bold npm install line, no implicit install; existing package name/version retained; bare adapt/dry-run write nothing and end in shell-quoted exact --apply command; smoke trigger documented; missing scripts/ repaired | 155bc71f0a, 26993cfb0f | Web/Expo manifest/no-write snapshots pass; missing-entire-directory Rust regression passes |


`57002d88cc` additionally samples witness arming per registration, retaining it
across SPA routes after social Expo Router removes query parameters. A fresh
registration samples its own URL. Native window aliases without location are
ignored. Real browser pushState → submit → sent and native-window controls pass.

`ac219032c3` gives the custom qualification fixture a separate Home writer
component and scoped rows. Both generated web and Expo fixtures typecheck and
repeat application refuses without writes. This prevents Account/Home insertion
drift while preserving the actual web form onSubmit case.

## Commits

| Commit | Change |
|---|---|
| 155bc71f0a | Witness, helpers, honest starters, init/adapt/ports, guide and semantic amendment |
| 364efcb494 | Extended qualification, baseline controls, tests and reviews |
| 26993cfb0f | Repair missing proof directories during adaptation; clean-pack TypeScript fix |
| 157ada9dc4 | Trace returned listen calls across proof descendants; strict evidence validation and static-host preflight |
| 57002d88cc | Retain witness arming across routes, ignore native window aliases, regressions |
| ac219032c3 | Correct custom Home qualification fixture, real web/Expo typechecks and reviews |

## Verification

Setup performed: Snapback4 frozen Bun install, constrained native build,
wasm build (707,674 gzip B <=708,174 budget), client build. Root Integration11
setup: frozen Bun install, ensure-workspace-hoist.mjs, check-generated-artifacts.
Every cargo invocation carries the incremental/debug limits; full test.sh was
never run. Final root repetition encountered a missing node_modules tree
(environment precondition); restored the same frozen setup and reran checks.

Affected checks passed:

- Rust binary: 427 passed, zero failures, five existing opt-in ignores.
- Rust init: 50 passed; init_dx3: seven passed; language guide: 123 passed.
- Focused client: 34 passed; additional API/init/typecheck/helper: 16 passed.
- Final audit/helper suite: 24 passed; routed witness controls: 22 passed.
- Qualifier/listener audit: 34 passed; real starter typechecks: nine passed,
  including custom web and Expo components with repeat-application refusal.
- Clean TypeScript build and noEmit typecheck pass.
- Actual caller @playwright/test@1.64.0 matcher passes with its own chromium.
- Driver SIGKILL probe: all seven observed Chromium processes exit.
- ref-check passes (546 LLPs, 11,833 refs, zero errors/unchecked); README
  documentation budget passes 320/320 and its named test.
- Root inventories pass: 365 package tests, 35 script tests, 31 demos, 487
  publication leaves, 162 guide pages /1,937 snippets.
- Root guide: 22 passed, zero failed/skipped/preconditions; 121 inherited warnings.

Independent baseline controls at c22dfefc9c (0.4.28) all fail as intended:
custom Home silently succeeds without writing; browser launchServer opens TCP
41837 outside assigned29130–29139; actual onSubmit receipt times out. The copied
baseline binary and git-extracted/transpiled modules are digest-recorded.
The syscall observer also rejects the original browser's out-of-range listener
(36209) in a separate negative control. Candidate focused controls all pass.
Baseline failures and candidate successes are separate logs, never a reused
qualification claim.

## Packed qualification

Fresh `publish.mjs --prepare-client` passes at ac219032c355d7c55ed8991fa85a409e955d6ceb.
Client SRI:
`sha512-of7rmYpEkhGjp9urI/m1P6/1hJZp2m1qHSIE39dCeGyxjT/sI4XjR+ljIilVOHYg/KaCea6krREmfNoFf2LahQ==`.
Expo SRI:
`sha512-xrZQCiga5iarZEd0j/BO897v2h5EvTl3Zk6hWxNe1/KnLMQmbHRGTtM6bWrmCCAOCAZFwbOiR9SWVlNHSnHFCw==`.
The fresh complete consumer run PASSED (exit0) in target/wave12-kit-linux-complete.
All twelve generated frontend attempts, sixteen further starter/adapted write
attempts and two expected custom no-write failures passed: thirty listener audits,
all observed TCP ports inside their assigned range. Custom web uses only an
actual form onSubmit writer. Both Ubuntu24.04 and Alpine pass their installed
CLI round trips and all six starter toolchains, including custom adaptation.
The final evidence was checked against prepare.json, both client/Expo SRIs,
platform SRI and the actual binary SHA256:
`d585057677f16e698df3a143b8f6e8793985394c6d0647c5268db3fe46089142`.
consumer.json explicitly records suite not-run/publicationQualified false;
no publication receipt was generated. Committed qualification.json indexes the
source/byte bindings, commands, summary and evidence hashes.

Linux observation uses proof-scoped strace >=6.8, tracing returned listen calls
throughout every proof. TCP ports must fall in that proof's inclusive range.
Malformed/unresolved/incomplete named records refuse; exact no-return decoder
fragments require read-only absent/zombie corroboration and are retained in
nonReturned. Receipts require nonempty PID/port evidence and matching ranges.
This is observation of proof-owned listeners, not network isolation. No browser
flags or sandbox behavior changed. Darwin explicitly records this audit not-run.

Earlier unsuccessful attempts are preserved and supply no qualification claim:

1. Initial preparation caught a redundant terminal-only onWrite/pending TS
   comparison; removed without weakening early-event buffer checks.
2. First full consumer run: frontend write passed, /proc/fd sampler refused
   transient Chromium-helper EACCES. Replaced sampler with syscall observer.
3. Next run: ten frontend attempts passed; social refused after routing removed
   the witness query. Registration lifetime fixed and tested.
4. Next run: all12 frontend attempts passed; custom fixture typecheck caught
   JSX inserted into Account with Home variables. Separate component fixes it.

## Independent reviews

All responses are verbatim with provenance under llp/reviews/; retained earlier
NOT READY findings became code/tests (nested script-click provenance, appended
day2 arguments, legacy port defaults, retained logs, template registration,
complete trace parsing and strict receipt validation). Final product revision:
Codex round7 and Muse round6 READY at57002d88cc. Final fixture delta: fresh Codex
round8 and Muse round7 READY, committed as ac219032c3. Earlier audit revision has
paired READY at157ada9dc4. Muse's prescribed wrapper used its Meta fallback
after subscription quota429; this session never read or printed the key file.
These are code/design verdicts, not substitutes for actual packed qualification.

## Evidence and boundaries

Logs, baseline digests, failed runs, paired reviews and final consumer evidence is under
snapback4/reports/20261014-wave12-kit/ and llp/reviews/. No product item is
intentionally deferred. Linux `--consumer-only` honors the explicit ban on the
full test.sh and cannot produce a publication receipt. Mac/iOS qualification,
full publication qualification, shared version coordination, npm publication
and git push belong to integration/release and were not run here.
