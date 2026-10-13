# DX2 — wave 10

Worktree: `/home/ccheever/projects/sb4-w10-dx2`, branch `sb4-w10-dx2`.
Base: `f9e40ef515` (published 0.4.25 plus records).
No push, publication, other-worktree edits or full `scripts/test.sh` run.

## Context and decisions

Read the wave-10 prioritized list and its R5/R9, DT4/8/9/12/13,
NA3/5/7/9/10 sections; inspected the restaurant-waste-audit schema and proof
lane file inventory read-only. Used llp-orient. Governing context:
LLP 3000 and 2000.000, Snapback 4 AGENTS/NOT-DOING/JOURNAL and rules/RULES;
LLP 3000.011.003.000 §§7–9 (starter custody, upgrade, proof),
3000.011.004.000 (owned launchers), 3000.011.005.000 (native evidence),
3000.008.002.000 (client custody), 3000.031 (absence and fallback),
3000.038 (assets), and the relevant current guide cards.

The semantic amendment is §9 of
`llp/3000.011.003.000-offline-ready-application-starters.rfc.md`.
No interpreter, planner, rules, store adoption or wire semantics changed.
`sentResult` and `otherwiseAll` already existed: document/test them rather than
add another client vocabulary. Ordinary React run waits for terminal settlement;
explicit `{waitSeconds:0}` retains the authored custody boundary used by offline
composers. Keep the App alive to collect a terminal receipt.

The visible proof accepts a mutation entered from the trusted click dispatch remains active for
the exact labelled button, through client or app. It deliberately rejects a
standalone form submit, background autosave, delayed requestSubmit and a handler that starts its write after leaving the event. Short microtasks
inside the active dispatch are permitted; unapproved App calls carry private
witness provenance across readiness to prevent an enclosing click being borrowed. The starter's shared
submit command runs from onClick and prevents duplicate default submission;
keyboard entry keeps the shared command. This is a bounded visible-button proof,
not an arbitrary async journey tracer. Finish validation before enabling submit.

First-account recipe typechecks now consume published `dist` declarations,
matching installed applications. The package source build remains a separate
check. This removes an artificial DOM/React-Native fetch implementation-type
collision from that consumer proof without changing HS-owned package types.

## Item results

### #6 — upgrade as a surface

- Successful check remembers compiler version, source identity, generated API,
  and notes/refusals by code in `.snapback4/check-surface.json`.
- A version change reports added note counts, changed row/operation types
  (including `number → number | null`), and added compiler refusals. Source
  changes are labelled; a missing prior record beside generated types reports
  unavailable comparison. JSON stdout stays a single object; delta uses stderr.
- Compiler refusals preserve the previous snapshot/API. Valid Quarry types may
  already be regenerated if later server/native qualification fails; the old
  snapshot remains until successful check.
- Upgrade captures the OLD installed compiler before installation and calls the
  NEW installed compiler afterward, keeping exact pins/dependency sections.
  A failed new check returns failure while accurately reporting installed pins.
  All `snapback/*.q` modules participate, even without schema.q. Each check
  resolves its compiler in a fresh process, so pnpm-style package symlink
  replacements cannot retain the helper's old Node realpath cache.
- Nullable numeric writes offer authored `EXPR ?? 0`, with the hidden-value
  policy caveat. Guide client/cheatsheet explain hidden null vs authorized zero.
- `guide changes` is packaged, compiler-version-bound and behavior-tested.
- Exact detection prints exactly `bun exact.mjs snapback --rebuild`.
- Commits: `ee5b180f3c`, `a4b4900270`, `de5e8a673c`, `251f83f792`,
  `ee18ff20b6`.
- Tests: upgrade integration (4), guide nullable-count/rewrite behavior, generated
  surface unit coverage, existing npm/bun/pnpm upgrade regressions. Passed.

### #8 — blessed visible browser proof

- Default starter works with guest sign-in and `--as alice` through the normal
  persona option, scoped to the explicit witness flag/dev server.
- `--field Task --value TEXT --button Add` fills a labelled input, clicks the
  accessible button and waits for its actual durable terminal receipt. Optional
  `--mutation/--args` verifies the submitted operation/arguments. No extra SDK
  mutation is injected. App and client entry points are covered; early receipts
  and repeated observer cleanup are tested.
- `stopChild` accepts ChildProcess or `{url,stop}` and rejects unknown shapes.
  `startServe` shares the owned `startHost` launcher with startDev.
- Web/Expo/chat/social starters receive a favicon. README/client/testing carry
  networkidle, fresh-per-write signal and RN-web keyboard/button/sent-before-rows
  guidance. CHROME and SNAPBACK4_CHROMIUM are recognized.
- Commits: `1eece86313`, `be46ad0790`, `f0e7fa6199`, `62c13a27de`, `04eb94487f`, `8dee1bfa84`, `1e1494a46f`.
- Tests: real guest/persona Chromium forms, argument mismatch, SDK-only persona,
  old sent-state control, direct background-write refusal, click-owned App write,
  delayed/synchronous requestSubmit refusal, script-click refusal and
  active-dispatch microtask success (10 final witness cases, also preserving inherited/non-enumerable custody/retry options), owned serve teardown,
  existing startup interruption and credential-redaction cases. Passed.

### #9 — wire envelopes

- One full guide-testing JSON block covers `/m/add`, a null-returning mutation,
  a located refusal and `/q/list`, including generation/store/head/seq metadata
  and the dev-only meter. README describes the SDK Read envelope.
- Existing omission of absent request ids is retained and re-tested: no
  top-level `id:null`; supplied intent ids are echoed, result.id is row identity.
- Commit: `be46ad0790`.
- Test: all four complete example bodies compared with real HTTP responses,
  including explicit intent id and null result. Passed.

### #10 — portable starters

- `--port-range A-B` / PORT_LO+PORT_HI select client URL, Vite dev/preview,
  backend/Expo launchers and web/native proof commands. Explicit ports have
  precedence and must fit a selected range. Invalid/overflow ranges refuse
  before writing. The web witness confines both owned servers to its range.
- Expo README and client use the same sync detection; no-sync Todos/Home
  README uses journal wording and adaptation works in both directions.
- Native smoke uses generated guest/password/persona sign-in; password prime
  receives a disposable random account from the owned launch, with restoration
  and non-prime/ordinary-launch guards. No credentials are embedded in source.
- Untouched wave-9 screen/client variants are recognized exactly; edited
  application pairs remain owned. README adds a web-first tutorial.
- Commits: `1eece86313`, `de5e8a673c` (tutorial also `be46ad0790`).
- Tests: starter integration (9), three Expo identity/no-sync typechecks,
  guest→password adaptation, sync→journal→sync README/client, highest-port
  refusal, prior-wave exact-byte unit, existing periphery fresh installs. Passed.

### #12 — client recipes

- useAuth members, role-gated `{skip:!granted}`, empty-complete-list absent code,
  sentResult null/replay narrowing and compact otherwiseAll/matchRead recipe.
- Ordinary run owns its per-intent settlement observer independently of query
  subscribers and React effects; concurrent/early results stay isolated and
  unmount cannot strand the promise while its client lives.
- Commits: `fea0ba9954`, `bf33abd121`.
- Tests: client recipes (3) plus React file (74, including terminal-after-unmount
  with no read subscribers). Passed. Explicit custody cases retained.

### #16 — all requested guide gaps

- Assets lists WAV/MP3/FLAC and puts raw POST /assets/auth/placement in the card;
  deletes stale DX ownership prose.
- Jobs documents periodEnd, half-open periods, UTC epoch/Thursday anchoring of
  every 7d, and daily weekday gating for other weekdays.
- Types lists handle/url; email validation belongs to application/identity.
- Programs gives a labelled, compiled loop-write example; reads states projection
  id omission and explicit inclusion. Aliases cover optional param, mutation
  default and service seat. Non-TTY canonical cards print complete.
- Commit: `a4b4900270`, with final wording/test repairs in `f0e7fa6199` and
  `62c13a27de`.
- Tests: guide suite 122, including file-type registry comparison, schedule
  boundary, generated projection identity, versioned changes card; check CLI
  98 with existing section/find and executable recipes restored. Passed.
  Existing 114-line/1,200-word client and historical guide word budgets retained.

## Verification ledger

- Required setup: frozen Bun install; CLI build; wasm build (698,386 B gzip,
  budget 698,886); package TypeScript build — passed.
- `cargo test -p snapback4-lang --test guide`: **122 passed**.
- `cargo test -p snapback4 --test check`: **98 passed** after restoring unrelated
  section/find/recipe assertions.
- `cargo test -p snapback4 --test cli_friction`: **27 passed**.
- Previous-wave adaptation unit: **1 passed**; generated-surface unit: **1 passed**.
- Client recipes + wire + wave9 + wave10 starter/upgrade/witness JS files:
  Final combined run: **38 passed**, 0 failed/skipped, including the symlink-swap
  upgrade and all 10 witness cases (nested/delayed submit, synthetic click,
  active microtask, option preservation).
- `react.test.mjs`: **74 passed**.
- `periphery.test.mjs`: **28 passed**.
- `first-account.test.mjs`: **4 passed**, both online/local profile/avatar/reopen
  and refusal journeys; consumes built package declarations.
- `periphery.test.mjs` + `witness.test.mjs` final combined run: **36 passed**.
  Initial consumer-declaration, favicon-expectation and RN live-region failures
  were corrected; no affected red remains.
- `./ref-check`: **passed**, final review-record rerun passed: **543 LLP docs, 11,121 refs, 0 errors,
  0 unchecked**.
- Every direct Cargo invocation carried CARGO_INCREMENTAL=0 and both debug=0
  profile flags. No full battery was run. One initial Cargo command at the root
  stopped immediately on the absent Ibex dependency; all product builds/tests
  ran through snapback4's workspace afterward.

## Reviews

All briefs and both verbatim reviewer outputs are preserved with model, immutable
revision, amendment digest and invocation provenance under `llp/reviews/`.
Round 1 on a4b4900270: Muse READY, Sol NOT READY (four material findings; fixed).
Round 2 on f0e7fa6199: Muse READY, Sol NOT READY (delayed submit; fixed).
Round 3 on 62c13a27de: Muse READY; Sol NOT READY (active-dispatch/App
readiness provenance finding, fixed). Sol also disclosed seeing disposition
prose; that limitation is retained verbatim and it is not treated as final blind
approval. Round 4 on 04eb94487f: Muse READY; fresh Sol NOT READY (supported options
with inherited/non-enumerable values were dropped by spread; fixed). Round 5
on 8dee1bfa84: Muse READY; Sol NOT READY (enumerable getters read twice;
fixed with single-read destructuring). Round 6 on 1e1494a46f: **both READY**
for final witness behavior. Round 7 on ee18ff20b6: **both READY** on the same
final revision, including the fresh compiler resolution after pnpm-style
symlink replacement. No review or implementation remains pending.
No reviewer was asked to read another family's feedback or author conversation.
The coordinator's explicit pre-approval of extra rounds was used to close every
material finding, including getter preservation and compiler symlink caching.

## Other lanes and limits

- HS: Exact device stamps/header handshake, DOM-free declarations and Vite Node
  types remain HS-owned; DX2 supplies only the Exact rebuild pointer.
- REL2: release lifecycle narration/help/activation remains REL2-owned.
- DIAG: general lints and diagnostics remain DIAG-owned; DX2 changes only the
  commissioned nullable numeric write hint.
- PAGE2: planner/rules language remains PAGE2-owned; no planner changes here.
- No requested DX2 implementation is deferred. No iOS/Android simulator, physical
  device, publication or release-promotion claim is made from these Linux proofs.


## Completion

Final product revision reviewed by both families: `ee18ff20b6`.
Final committed code/docs/review-record HEAD: `e68c740e2f`.
21 small commits after the supplied base; every commit uses the requested author.
All affected checks above passed. Only this report remains uncommitted, as allowed.
No push, no deferred DX2 item, no outstanding review or material finding.
