# LV round 9 — refusal authority follows origin

Branch `sb4-intent/lv-hook-retention`, base `364ae21f1ddb17ba127bdc3c75804aa6d893035d`.
Read rounds 0–8's prompts, reports and lane journal entries, LLP 3000.029,
the Snapback 4 fence/rules and current client/reads guide, and the complete
Astra rounds-7–8 review. Applied `llp-orient`: LLP 3000 §4 governs scope;
LLP 3000.029 §§8–11 govern dependency fences, footprints, epochs and refusal
classification. The latter remains Implemented and archived. No new LLP or
skill hand-off is needed.

Fetched origin; main advanced to `74fee301b56e9b905eb889f7641c3e2d18c017e9`.
`git merge-tree --write-tree HEAD origin/main` returned without conflicts, so
**no merge was performed**. No push, publication or `scripts/test.sh` invocation.
The supervisor owns the full landing qualification.

## Fix

The shared classifier no longer excludes any refusal code. The transport and
decoder attach a private, non-enumerable origin field to the refusal itself;
that field survives the existing online, local and composed publication paths
without changing public diagnostic JSON. SDK transport/decoder failures and
HTTP admission failures preserve retained answers, remembered data, dependency
fences and original deadlines. Evaluated native denials remain evidence even
when they spell an SDK diagnostic.

The server query error reply now carries `refusalOrigin`, set at its existing
transaction/cut boundary. Evaluated origin overrides an admission HTTP status.
The decoder recognizes the HTTP 429/503 admission lane when no evaluated origin
is supplied, including older servers and the connection acceptor. Both query
transports distinguish decoder-generated 5xx diagnostics by their origin rather
than `E_HTTP_RESPONSE`. Existing FU code-based retry policy remains separate
from authority classification. The final audit also removed the residual local
`code !== E_OFFLINE` replacement guard, after proving it still suppressed a
native denial. No authority classifier infers origin from a code string.

[LLP 3000.029 §11](../../../../llp/3000.029-hook-retention-with-invalidation.rfc.md#11-round-6-admission-and-authority-are-separate-evidence)
replaces round 7's incorrect precedence table with the origin rule and updates
Revised. The guide's existing retention/withdrawal promise remains unchanged.
No meter, authorization rule, public option/type, dependency, wasm source or
budget changed. No production await was added or moved. The three-line server
change leaves `serve.rs` at 1,499 lines; `local.ts` remains 1,480.

## Regressions and controls

The new real native module reads an online-only authorization flag and returns
`Error::new(code, …)` after that flag is deleted. With `/changes` held, direct
calls must deliver the actual denial and message and replace the mounted secret
before returning, on online, process and wasm clients.

- The requested **six** `E_HTTP_RESPONSE`/`E_STORE_BUSY` cases fail against the
  existing round-8 builds before rebuilding either client or server, at the
  mounted-secret assertion. All pass after the fix.
- Three further native `E_OFFLINE` cases expose the residual local exclusion:
  process/wasm fail and online passes before its removal; all three pass afterward.
- The existing **30** malformed-200/404 and admission regressions remain green,
  preserving direct/opt-out diagnostics, retained owners, deadlines, remembered
  recovery and unfenced aliases. Composed-search synthetic HTTP-200 admission
  fixtures now explicitly label their origin; codes alone cannot stand for it.
- A transport regression varies seven codes independently of origin, including
  evaluated HTTP 503 replies, malformed 200/404/503 and actual transport failure.
  Public refusal objects remain unchanged by the private origin field.

## Verification and every failure

| Check | Result |
| --- | --- |
| Final affected run, sources frozen | **1,031/1,031**, zero failed/cancelled/skipped, 113.2 s. Includes all nine native cases, decoder/admission tests, FU overload, retention/fencing/footprint/ephemeral/property/cost/expiry/search/transport suites. [Command](./affected-command.json), [log](./affected-final.log.gz), [result](./affected-final-result.json). |
| Delivery matrix, included above | **333/333**, all 166 inherited classifications unchanged. |
| Browser witnesses, included above | **3/3**. Both profile gates keep one mount and zero loading flashes; FU's overload witness passes. |
| Whole guide | **98/98**, `cargo test -p snapback4-lang --test guide`. [Log](./guide.log.gz). |
| Server overload | **3/3**, `cargo test -p snapback4 --bin snapback4 overload -- --test-threads=4`. [Log](./server-overload.log.gz). |
| Scoped HTTP/server suite | **159 pass / 4 ignored / zero fail**, `cargo test -p snapback4 --bin snapback4 serve:: -- --test-threads=4`. [Log](./server-queries.log.gz). |
| Client build/declarations, typecheck; server build | Pass. [Client build](./build-final.log.gz), [typecheck](./typecheck-final.log.gz), [server](./server-build.log.gz). |
| References / whitespace | Ref-check and `git diff --check` pass. [References](./ref-check.log.gz). |

An earlier affected run was **1,027 pass / 1 fail**: the process ephemeral
buffered-reply case timed out waiting for its **initial** owners, before the
revocation under test. The unchanged full file passes **20/20** and the exact
case passes **10/10** repeats; the final affected run also passes it. Its cause
remains unconfirmed. It is **ours**, not a baseline/environmental exemption or
claimed fixed by this round. No inherited timeout or assertion was relaxed.

The initial native fixture had six Rust compilation failures (`Ctx::get` was
incorrectly treated as returning `Json` instead of `Option<Map<…>>`); correcting
the fixture's types resolves them. These are **ours**. Expected negative runs,
all failing names, orientation path errors and their dispositions are recorded
in [FAILURES.md](./FAILURES.md). No baseline or environmental exemption is claimed.
Counts overlap and must not be added. No green full-suite or new Expo UI claim.

## Wasm and custody

Existing canonical wasm: **2,042,203 B raw / 593,641 B GNU file-input gzip-9**,
byte-identical to round 8, **zero growth**, **78 B below the unchanged 593,719 B cap**.
SHA-256 `d82c05104aaab6954278a37c1962ac6735b5e4cf91bdc7ddd7f75eafd4458466`.
Only server-side Rust changed; no new wasm build is claimed.
[Measurement](./wasm-measurement.json), [prompt/review inputs](./inputs.json),
[qualified sources](./qualified-sources.json).

Native guest fixtures compile under this worktree's existing `target/native-fixture`;
no tools were installed or shared paths modified. Generated outputs stay ignored.
One append-only journal entry accompanies the local commit, carrying
`Co-Authored-By: GPT-6 Astra <noreply@openai.com>`. Nothing pushed or published.
