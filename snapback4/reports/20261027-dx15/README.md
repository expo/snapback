# DX15 evidence

Product commits: `960a7692ef` and `4d4f6f276c` (plus the evidence commit).
Base: `a699f02b2c`, DX14 plus origin/main. No push, publication or version bump.
LLP 3000.037.000 §7 records the implemented bounds and links actual reviews.

## Five items

| Item | Change | Lane-shaped evidence |
|---|---|---|
| Production proof | Production card leads with startServe/provisionUsers, startStatic, private roster/account shapes, rerun/login and SIGTERM lifetime. Plan mismatch prints validated supplied/pinned fields before auth requests. | 007/014/021/030/042 original-schema copies provision each declared role, restart without replacing principals, inspect complete rosters and refuse changed plans. Literal installed production serve fence runs twice. |
| Inspection | Administrative data --all uses one read transaction; capped default names its repair. snapshotAll certifies every active durable row, refuses incomplete/ephemeral results. Generated client.query comments name the existing next field. | 042 regression creates 63 rows, sees the 50-row cap, inspects all 63 and drains generated API pages 20/20/20/3. Rust CLI regression independently inspects 63 rows. |
| Proof residue | serveCheck then preserves upMs; withServeScript keeps callback-scoped semantics. waitForFresh trigger arms a stable-element browser observer and bounds cleanup. Upgrade/testing route inherited drivers to serve-check --then. | 048 Codex/006 Muse fast command and callback still wait, early exit fails. 023 covers transient text, hidden text, strictness, shadow roots and later nested roots; blocked-page cleanup is bounded. Upgrade regression checks the emitted continuation. |
| Model time | One production entry avoids assembling three guides/source. Complete inspection avoids rereading a capped prefix. Roster/auth refusals include the concrete recovery. | Original Muse transcript aggregate plus fresh native-usage discovery replays. See limits below. |
| RATE / empty page | Signup keeps a stable why for malformed and lost replies, preserves delivered refusal codes, and advises login without resubmitting unknown signup. Reads documents matchRead absent for complete empty lists. | 006 original schema applies a real signup and deliberately loses its reply, then login recovers. Mock 429→lost reply proves no ambiguous resubmission. 047 complete-empty and partial-empty reads take different arms. |

## Reading and model measurements

`survey-muse.py` reads the original `.agent.ndjson` files without writing to any
lane. Command/output classification is heuristic. It finds Snapback 2,975 model
calls / 414,503,675 input tokens versus Convex 2,809 / 351,684,694; the source
analysis counts 2,977 turns using its lifecycle accounting. The native usage
counter used here explains that two-call difference. Snapback has 100 repeated
guide-card calls and 2,345,558 guide-output bytes in parseable command results.
Release/language repeats lead the whole corpus; REL3 owns release semantics.
DX15 targets the three owned mechanisms: recipe output re-reading, repeated
guide discovery, and refusals requiring a second explanation command.

Same production-discovery intent, identical prompt and guide wrapper:

| Measurement | Before | Final-card after |
|---|---:|---:|
| Fresh Muse model calls | 9 | 3 |
| Native input tokens, including cached | 410,157 | 97,541 |
| Guide commands read | 12 | 2 |
| Guide output bytes read | 136,608 | 31,191 |

The final-card replay still chose production --full after its default card;
this is a measured reduction, not a claim that models never reread. Input tokens
fell 76.2%, guide bytes 77.2%. The preliminary after-run used 2 calls / 59,751
tokens and one 4,423-byte guide read; it precedes a minor opening-sentence
correction and remains separately labelled. This is one before run and two after
runs, not a fresh app bakeoff, statistical wall-time claim or causal attribution
of the entire Muse deficit. Raw transcripts are compressed verbatim; prompt,
wrapper, usage, read logs and snapshot hashes are retained.

A deterministic discovery path separately reads 102,563 bytes in three full-card
commands before versus 4,473 bytes in one default production card after. This
scripted path is not model input tokens. `dx15_guides` regenerates these values
from baseline Git blobs and the current guide renderer.

## Verification and provenance

- `packed-consumers.json`: actual affected publication consumers using installed
  client/Expo/Linux tarballs, with per-artifact hashes. The binary uses the lean
  dev/test profile; these are consumer proofs, never publication qualification.
- `literal-production.json`: exact marked production serve script, generated API,
  real user grants, SPA fallback, repeated lifetime/SIGTERM/lock release.
- `lane-replays-final.json`: six original-schema copies, source hashes, results
  and explicit preliminary harness correction (006 uses staff, not roles).
- `packed-consumers-preliminary.json`: shared npm cache failure. The next starter
  attempt exposed a real stale qualifier assertion after replacing Home; the
  transported custom proof now drops only removed default control assertions,
  retaining its Task write, SDK receipt and rendered-row assertions. Its actual
  failed result is retained in `packed-consumers-starter-failure.json`.
- Independent Muse/fresh Codex responses, briefs and full raw Codex transcripts
  are under `llp/reviews/3000.037.000-dx15-*`. Earlier NOT READY findings remain
  unchanged. Both final nested-shadow reviews are READY.
- `run-scoped.mjs`: conservative full selector plan retained; execution uses the
  disclosed DX14-style scope override because the full plan selects seven whole
  Rust packages and 448 client files, forbidden by the brief. It uses the
  selector's own runPlan/receipt machinery and declares
  fullSelectorPlanExecuted:false, qualification:false. The root inventory
  prerequisites are bootstrapped and its unchanged-input receipt is reused;
  source-relevant Rust/client/guide/ref checks execute on the final commit.

Original apps/stores were never opened for mutation. Replays live under
/tmp/dx15-replay and are removed after verification. Mac/native publication,
full crate/client batteries, difftest, qualify-linux and release/rollback/security
implementation changes are outside this workstream. A direct post-arm
attachShadow with no observed DOM mutation is outside the observer contract;
existing and subsequently inserted nested open roots are covered. Signup's
original why-less report was not reproduced on the inherited SDK; malformed
and real lost-response outcomes are tested instead of inventing that cause.
