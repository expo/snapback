# LLP 0168 — super-refine run journal

**Target:** `llp/0168-single-origin-dev-edge.rfc.md`
**Invoked:** 2026-08-04 by the author (Charlie Cheever)
**Orchestrator/reviser:** Claude Opus 5 (the session that authored the Draft)
**Round budget:** 3 · **Launch cap:** 6 per family · **Growth budget:** ~20% net

## Authorization

- Document authority (review + revision): the author invoked
  `/llp-super-refine llp/0168-single-origin-dev-edge.rfc.md` directly.
- Outbound disclosure: disclosed before launch. The capsule carries the full
  LLP 0168 text, excerpts of LLP 0030 and LLP 0041, an excerpt of
  `packages/snapback-client/rqs-store-default.mjs`, and an excerpt of
  `src/admin.rs`. No credentials, no `.agent-local-secrets.md`, no secrets.
  Destinations: Anthropic (claude family), OpenAI (gpt-5 family).

## Families and runners

| family | runner | blindness |
| --- | --- | --- |
| claude | `claude -p --model claude-opus-5`, fresh process, cwd outside the repo | structural — no repo access, capsule-only |
| gpt-5 | `codex exec --model gpt-5.6-sol -c model_reasoning_effort=xhigh --sandbox read-only` | structural — capsule-only prompt |

Neither reviewer is the reviser. Neither can see the other's output. The
capsule contains no review artifacts (none existed at round 1) and no run
journal.

## Round 1

- **Entering revision:** `0857e319ef32ffa5451441e98b2edca533b1f93f` (git hash-object)
- **Entering status:** Draft
- **Capsule:** `capsule.md`, sha256 `0c8901f58388f0ed…` (544 lines)
- **Prompt (instructions + capsule):** see `round1-prompt.md` in the run scratch
- **Launched:** both families concurrently, identical prompt bytes

**Status-transition note (honest ordering record):** the skill sets a `Draft`
target to `Review` at loop start. The round-1 capsule was built and launched
from the `Draft` revision above, so round 1's verdicts bind to that hash. The
`Draft → Review` transition is applied together with the round-1 revision
rather than mid-round, so no reviewed revision changes underneath a reviewer.
The only delta between the reviewed bytes and the transition is the `Status:`
line.

### Verdicts

_(recorded on receipt; see the per-family artifacts)_

### Round 1 verdicts — both NOT READY
- claude: 5 MATERIAL, 4 DETAIL · gpt-5: 5 MATERIAL, 3 DETAIL
- **Cross-family convergence:** both independently found that the dev-auth gate
  is *not* inherited — a reverse proxy destroys the loopback signal
  `resolve_profile` derives from.
- Revision 1 applied → `56ea200052f6a70c8d11e292423202c21c253375`
  (Draft → Review applied with this revision, per the ordering note above).

## Round 2 (delta)

- **Entering revision:** `56ea2000…` · **Capsule:** `35cb827d71620735…`
- **Verdicts:** both NOT READY
- **Delta convergence on pre-existing text: ACHIEVED — 0 PRE-EXISTING MATERIAL
  from either family.** All MATERIAL concerns were IN-DELTA, i.e. defects in
  the loop's own revision.
- Both families again converged: the round-1 fix *relocated* the gate hole
  rather than closing it (a TLS tunnel fronting a loopback-bound edge bypasses
  a bind-derived gate — and D2 recommended that topology).
- Revision 2 applied → `0cc2b73ced8253eb2a47ccf46bdb454e97192613` (net −12
  lines).

## Round 3 (delta, final)

- **Entering revision:** `0cc2b73c…` · **Capsule:** `e4ca2bbb326ba9b1…`
- **Verdicts:** both NOT READY
- claude: 4 MATERIAL (1 PRE-EXISTING), 5 DETAIL · gpt-5: 3 MATERIAL (0
  PRE-EXISTING), 3 DETAIL
- Both families converged a third time on the same two roots: the
  **loopback-direct exemption** is a third bypass topology, and the E3
  credential **attests provenance, not policy compliance** (any local caller
  could mint it).

## Terminal state: round-budget exhaustion with open MATERIAL concerns

Rounds run: 3 of 3. Launches: 6 (3 per family), under the cap of 6 per family.
Growth: ~250 → 350 lines (≈40%), over the ~20% guideline — driven entirely by
MATERIAL fixes; revision 2 was net −12 lines.

**Final verdicts bind to revision `0cc2b73ced8253eb2a47ccf46bdb454e97192613`.**
No later unreviewed revision exists.

## Disposition ledger (round 3, the open set)

No concern is summarized away; each is carried with its disposition.

### MATERIAL — open

| # | family | class | concern | disposition |
| --- | --- | --- | --- | --- |
| 1 | both | IN-DELTA | **The loopback-direct exemption is a third bypass topology.** A public tunnel can front the loopback *server* directly, and "loopback-direct" is indistinguishable from a local proxy connection. | OPEN — unfixed. The gate has now been bypassed in three distinct topologies across three rounds. |
| 2 | both | IN-DELTA | **E3's credential attests provenance, not policy compliance**, and "loopback-minted" does not authenticate the edge — any local caller could mint it. | OPEN — unfixed. Needs a mint-time gate and a compliance assertion, not just an identity. |
| 3 | claude | IN-DELTA | **E6's hostname mechanisms do not cover the carriers E6 exists to serve**; the cheapest option (public DNS name + DNS-01) is missing, with its real costs. | OPEN — unfixed. |
| 4 | gpt-5 | IN-DELTA | **Q1 contradicts D2 on tunnels** — Q1 subtracts "a tunnel" from the residual while D2 correctly states a tunnel alone satisfies only the secure-context axis. | OPEN — internal inconsistency introduced by revision 2. |
| 5 | claude | **PRE-EXISTING** | **E11's access capability — the only control preventing an off-loopback dev server from being LAN-writable — has no decided form**, and its hard part is surviving bundler-generated URLs. | OPEN. Proposed shape on record: capability-bearing first navigation setting an origin-scoped `Secure`, `SameSite=Strict` cookie, redirect to a clean URL, plus `Referrer-Policy: no-referrer`. |

### DETAIL — dispositioned, implementation-phase

| # | family | concern | disposition |
| --- | --- | --- | --- |
| 6 | both | E12–E13 version **skew** (edge and adapter each on a different individually-valid version) is unhandled; the prior runtime-fetch design was skew-free by construction. | ACCEPTED as implementation-phase; fix is normative version advertisement in the descriptor + refuse-on-mismatch. Recorded, not applied (budget). |
| 7 | claude | E3 rotation has no re-acquisition protocol; a stale credential's handling is unspecified. | ACCEPTED as implementation-phase. |
| 8 | gpt-5 | E7–E8 wording does not describe the tunnel-fronted topology where public host/port differs from the loopback listener. | ACCEPTED as wording; folds into concern 1's fix. |
| 9 | gpt-5 | E11 carrier undecided (query/path conflict with the no-leak clause). | Same root as MATERIAL 5. |
| 10 | claude | E8 × Q2 interaction. | ACCEPTED as implementation-phase. |
| 11 | claude | Header/Decisions framing. | ACCEPTED, cosmetic. |
| 12 | claude | E15 changes an observable string (`no-durable-backend` → `insecure-context-no-web-locks`). | ACCEPTED — worth a compatibility note; the string is a dev diagnostic, not a protocol field. |

## Recommendation to the author

**Proposed: stay `Review`.** Do not revert to `Draft` — the document improved
materially and round 2 proved its pre-existing text clean. But do not treat it
as close to `Accepted`: the security model has sprung a new bypass in each of
three rounds, which is itself the finding.

The loop's substantive conclusion is that **0168's real open question is
authorization, not design**. Two concrete next steps, in order:

1. **Split D6 out and ship it.** The client-side insecure-context diagnostic
   (`insecure-context-no-web-locks`) was uncontested across all three rounds by
   both families, is independent of everything else, and fixes the silent
   failure on the path where it actually occurred. It does not need the edge.
2. **Answer Q1 (go/no-go) before any further review round.** If the edge is not
   built, its security model is moot and three rounds of bypass-hunting stop. If
   it is built, the next round should be scoped to the security model alone,
   with concerns 1, 2 and 5 as its agenda.

This skill does not set `Accepted` and has not done so.
