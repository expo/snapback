# Diary 0046: A5 collaborative AI research room — LLP 0137 improvement sweep, Snapback web arm

**Program:** LLP 0137 Phase 1 (Stage 2, fifth diaried sweep arm)
**Contract:** demos/improvement-sweep/protocol/contracts/a5-research-room.v1.json (13 frozen checks)
**Lineage:** 0102 research-room application (Diary 0031)
**Posture:** external npm consumer of the public `@expo/snapback-*` 0.1.7 closure; guide + public docs only
**Capsule:** demos/improvement-sweep/arms/a5-snapback-web/run-capsule.json

## 2026-08-01 — Snapback web arm, deep budget, complete

### Environment and outcome

External consumer on macOS arm64 (volta node 24.18.0, bun 1.3.12), the
full `@expo/snapback-*` 0.1.7 closure from the public registry, runtime
binary sha256 `6c5c9567…` (byte-identical to the four prior arms).
Fresh isolated local target: sessions mode, app-local SQLite, port 4292
(4287–4291 guard-blocked; the unrelated fleet server that has been
sitting on 4287 since 2026-07-27 was left untouched). Two consumer apps:
`research-app` (the arm) and `probe-stream` (an isolated app that
carries the streamed-action capability probes so their requirements
could never wedge the main artifact).

**Result: 11 pass / 1 explicit GAP / 1 fail** on the 13 frozen checks,
with the suite running in **5.0 seconds** wall. The GAP is vector
retrieval (A5-05, per the check's own wording). The fail is A5-02's
collaborative file-sharing leg — the known non-owner-viewer chain, not a
new defect. Timeline: closure install 13:05Z, backend authored by
~13:20Z, first full 13-check run green at 13:26Z (on its *first
complete execution*), streamed-lane refresh rework green 13:34Z, final
v.json-shape verification 13:36Z, tsc/vite/jsdom re-proof 13:44Z.
Roughly 40 active build minutes and 78 tool calls to final verification
— far inside the deep ceiling (8h/400), budgets acting as instruments
only.

Three findings filed (`0137-a5-f1..f3`), three prior tickets got dated
re-verification/refinement addenda, zero posture breaks, zero Stop-class
defects.

### The headline: the streamed lane reverses the 0031 blocker — and is the only egress that works

Diary 0031's frozen Snapback arm is the harshest document in the 0102
series: the research room was **product-blocked** (1 pass / 2 GAP / 12
fail) because sessions cold-start preflight refused
`bounded_response_stream_v1`, and its "lessons" section demanded a
sessions-plus-streamed-actions fixture as proof of repair. This arm is
that proof, from the outside: an artifact carrying the capability
**admits and serves on a sessions target**, `ctx.streamAttempt` gives
lease + crash-safe terminal-winner custody (`effectMayHaveExecuted`,
`settledBy`, idempotent rejoin returning the winner verbatim), and
`ctx.fetchStream` drains a real chunked upstream through the one-pull
reader — with an authorization Bearer value staged from `ctx.secrets`
arriving at the provider. The A5-12 scheduled refresh runs the whole
documented pattern end to end: cron tick → attempt keyed by the run's
dedupe key → streamed GET with the secret → drain → settle → receipt.
The strict provider 401s without the secret; every arrived request
carried it; the canary never appeared in any of six client-visible
surfaces.

The same probe re-verified that plain `ctx.fetch` still dies with
`SNAPBACK_HANDLER_HOST_CALL_UNKNOWN: unknown handler host call
host.fetch` — byte-identical to A4's observation. So a4-f1's "outbound
effects unauthorable in every action form" **narrows**: the streamed
lane works; the ordinary lane doesn't; and the guide teaches the broken
one first. Filed as `0137-a5-f1` with a dated narrowing note on the A4
ticket. The practical consequence for a consumer is absurd but real: on
0.1.7 you author a plain GET refresh *as a stream* and it works
beautifully.

### What felt good

- **The research-room state machine fit the mutation model like it was
  designed for it.** One serialized mutation (`assistStep`) advances the
  question pipeline exactly one stage; the in-transaction `status ===
  'running'` check is simultaneously the resumability guard, the retry
  fence, and the cancellation fence. The action loops it. That's the
  whole workflow engine: four separately committed durable progress rows,
  each delivered to the second member's live thread query in 35–85ms.
  Convex needed scheduled mutations for this shape in 0031; here it's
  read-check-write made correct by commit order.
- **Cancellation fencing produced an audit trail, not just absence of
  damage.** Every late lane I injected after the confirmed cancel
  (worker step, direct progress append, answer commit with valid
  citations, re-settle) wrote exactly one `fenced` receipt into the
  append-only attempt ledger and nothing else; the terminal record was
  byte-stable. A5-08 is the strongest cancellation evidence any arm in
  this program has produced.
- **The five-outcome matrix was expressible without ceremony.**
  complete / cancelled / failed / timed-out / ambiguous stood
  simultaneously distinct on the live feed, with `settledAt` +
  `terminalDetail` settlement records, hard-terminal vs retryable split
  enforced in one mutation, and the retried ambiguous question
  converging to exactly one answer.
- **First complete suite execution was green.** All the fail-closed
  iteration happened at *generation time* (three refusal loops, below);
  once the artifact loaded, every product behavior worked on the first
  try — including the concurrent double-ask converging on one question
  and the jsdom render streaming a question to `complete` inside the
  DOM through two nested provider-owned live-query groups.
- **Secret custody is clean where the 0031 Convex arm had its
  Stop-class defect.** No credential in argv, loopback binding, config
  status reporting `set/secret` but never bytes, canary absent from
  receipts/ledgers/tick responses/dev output/evidence — while the
  secret provably reached the external provider server-side.
- **The versioned-seed ledger guarded my own evidence.** Changing seed
  bytes under a reused `seedVersion` was refused with both digests
  named (`SNAPBACK_SEED_VERSION_REUSED`); the bump to `.2` was a
  30-second fix and the receipts stayed honest. Two receipted
  reset-installs restored the literal fixture (deleted 77 + 13 rows) to
  close the arm.

### What felt bad or hard

- **The egress split is undocumented and backwards-facing.** Following
  the actions-and-fetch guide takes you to `ctx.fetch`, which cannot
  work on this closure; the only working egress (`fetchStream` +
  `streamAttempt`) lives on a page pitched at token streams. Without
  the probe app I would have shipped A5-12 as a fail, as A4 shipped
  A4-10 (`0137-a5-f1`).
- **The inline handler subset is discovered by refusal.** Three
  generation loops, one restriction each: dynamic computed member
  access refused (`lower[i]`, `vec[slot] += d` — a tokenizer and an
  embedding accumulator are the *first* things a research-room backend
  writes; the rewrites are `charCodeAt`/`charAt` walks and
  index-matched `.map()`), an empty `writes: []` refused on a read-only
  helper mutation, and `v.array()` refused on table fields. The
  positioned diagnostics (file/line/column) are excellent; the missing
  subset documentation is the cost (`0137-a5-f3`, guide-gap).
- **The `v.array` field refusal hides `v.json()`.** The diagnostic
  names the internal Json primitive but not the documented column type
  that works. I shipped a stringify/parse detour on two natural columns
  (citations, embedding vectors) before a probe showed `v.json()`
  round-trips arrays natively — partly my miss (it *is* in
  getting-started's validator list), mostly a diagnostic that stops one
  sentence short (`0137-a5-f2`). The retained app uses the documented
  shape.
- **Collaborative file sharing is still broken on 0.1.7.** The member
  (not the uploader) gets 403 on the shared source's bytes; signed-url
  issuance 404s; typed attach refuses — the a1-f2/a1-f3/a4-f3 chain
  re-verified, so A5-02 fails its download leg. The app's split (text
  corpus in rows, member-readable; raw bytes owner-locked) keeps the
  *retrieval* product working, but a research room where teammates
  can't open the PDF is not done. One bright note: the
  `application/octet-stream` accept lane uploads markdown bytes
  cleanly, so a1-f10's text/plain trap has a usable spelling (dated
  note added to that ticket).
- **Search visibility still can't say "room members".** The native
  search index (a3-f2, cited) only knows public-read and owner
  partitions, so keyword retrieval is a membership-gated handler query
  — which the contract's `index-or-query-proof` evidence anticipates,
  and which passed with a frozen expected set, but the native lane
  remains unusable for the most common visibility in this program.
- **Trusted time is two different clocks inside one catch-up run.** The
  epoch-0 everyMs catch-up (a4-f4) reproduced, but with a refinement:
  the *action's* clock is the nominal (0) while its *nested mutations*
  see real time — my dedupe keys were real-timestamped even in the
  slot-0 run. Sound here, but the inconsistency deserves documentation
  (dated refinement on the a4-f4 ticket).

### Modeling, auth, realtime, settlement

Eleven tables, 25 operations, one scoped-role membership declaration
carrying the entire authority model; the outsider was denied uniformly
across 11 surfaces including the live subscription, and the action
boundary still collapses refusal codes (a4-f5/a3-f3, cited). The
composed thread live query (question + ordered progress + answer with
citations in one registered result) is the kind of read the React arm
wants and it worked in both the acceptance client and jsdom. Citation
integrity is transactional: `completeAnswer` validates every cited
source against the question's room inside the commit, and the invalid
citation was refused with a clear message. Vector search is an explicit
GAP with the capability-index row and LLP 0132 cited; the 32-dim
embeddings fixture is stored and inventoried without being mislabeled
as retrieval — exactly the honest posture 0031 demanded.

### Longitudinal comparison vs the frozen 0102 Snapback arm (Diary 0031)

The frozen arm: product-blocked before listener readiness, 1/2/12,
"Not for this application at the frozen commit." This arm: the same
product shape passes 11 of 13 checks in a 5-second suite on the public
packaged closure, and the exact composition that blocked it —
sessions + streamed actions — is now the arm's strongest surface. Of
0031's two "separate table-stakes capability gaps": assets went from
wholesale GAP to a working owner lifecycle with a broken sharing lane;
semantic/vector retrieval remains a GAP with an Accepted design (LLP
0132). Against the 0031 competitor field: Convex's 14/1 with a
Stop-class secret-custody defect versus this arm's clean custody story
is now a genuine differentiator; Supabase's first-party
pgvector/full-text remain ahead on retrieval capability; nobody in the
frozen field matches the attempt-custody settlement vocabulary
(`effectMayHaveExecuted`, receipted fences) this arm exercised.

### Would I choose it?

For this application on 0.1.7: **yes, with two carve-outs** — the AI
research room's core loop (durable streamed progress, cancellation
fencing, retry convergence, outcome distinctness, secret-custodied
scheduled egress via the streamed lane) is the best expression of this
product shape I have built on any backend in this program, and the
5-second deterministic acceptance loop is a real development asset. The
carve-outs: raw source-file *sharing* needs the a1-f2 chain fixed
before a real team could use the room, and semantic retrieval needs
LLP 0132 to ship (keyword-over-rows carried this contract but not the
product ambition). The build cost that remains is documentation, not
capability: the three authoring-subset refusal loops and the hidden
streamed-egress idiom are each one guide section away from free.

### Lessons for Snapback

1. Ship the a5-f1 resolution: register `host.fetch` or teach the
   streamed lane as *the* egress idiom — an agent following the guide
   must not land on the one broken lane first.
2. Document the inline_handler_v1 subset with its standard rewrites;
   every retrieval-shaped app hits it in the first hour.
3. Make the `v.array`-field diagnostic name `v.json()`.
4. The membership visibility kind for search indexes (a3-f2's fix)
   would have made A5-04 native.
5. Keep the 0031-reversal protected: a packaged-closure conformance
   fixture for sessions + streamAttempt + fetchStream (the probe app in
   this arm's evidence is a ready-made template).

## 2026-08-01 — RE-VERIFICATION against 0.1.8 (fix-loop entry, not a rerun)

Packages: all @expo/snapback-* at 0.1.8 (fast-path publication from
main 5d5c6b71; ledger fastpath-ledger-0.1.8-5d5c6b7183af).
Evidence: demos/improvement-sweep/arms/reverify-0.1.8/ (capsule +
evidence + drivers).

- **a5-f1 (streamed lane was the only working egress): VERIFIED as
  fixed, with the must-not-regress half intact.** Plain `ctx.fetch` now
  executes in the inline action lane, AND the streamed lane
  (`ctx.streamAttempt` start/settle + `ctx.fetchStream` reader) still
  completes with terminal settlement (RV-A5-F1, RV-A4-F1-*). The
  0031-reversal surface this diary asked to protect survived the fix.
- Papercut while re-verifying a6 nearby: the guide's own
  `defineJobStatusQuery` declaration draws a degraded-result advisory
  (new ticket
  issues/20260801-0137-reverify-jobstatus-declaration-degraded-advisory.md)
  — same advisory class as the g1-f1 template noise this program already
  tracks.
