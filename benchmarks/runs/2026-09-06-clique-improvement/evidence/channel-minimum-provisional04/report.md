The bounded **actual HTTP/SSE channel text-minimum witness passes 77/77 paired argument cases** against the immutable M5 provisional-04 owner. Both subscribe and publish were exercised for each case: **28 accepted pairs and 49 refused pairs**, giving 154 primary admission responses. The captured streams contain **exactly 83 expected events**, with unique markers and no invalid-publish marker. This is provisional candidate runtime evidence, not publication qualification, a benchmark, or a full integration result.

The new fixture and all witness work live under `/Users/ccheever/clique-improvement/revisions/compiler-text-minimum/candidate-channel-witness` on both hosts. Compilation and the first offline audit ran locally; the actual owner and HTTP/SSE run used `ccheever@100.88.75.121`. The original 74-case API fixture/results were neither replayed nor changed. Complete before/after file hashes verify their preservation on each host. No repository/product edits, current-Q4 compilation, Rust build/test run, main/push/publication action, device access, jobs, or external network effect calls occurred. Network activity was SSH/rsync to the named M5 and private loopback witness HTTP.

The exact e6 compiler source archive was extracted privately and all **188 manifest entries** verified before use and after compilation. The same entries match the e6 Git objects in the M5 engine lane. `bun --no-install compile.ts` invoked `lowerProject` from that extracted source. Dependencies were copied privately: the attested frozen review `ir-contract.json` and cached TypeScript **5.9.2**. All 133 copied dependency files are hash-bound; all 112 TypeScript files covered by the previous dependency attestation match it. The compiler did not import the changing compiler worktree or execute its bundle. Compilation emitted a fresh result for this new fixture; `compiler-replay.mjs` transports that exact saved result into normal owner startup without rewriting IR.

| Binding | SHA256 |
| --- | --- |
| New schema.q | `6b3821c1de78502d0cd503b97007e2e1b3cd8321f87dd580e9c83dbf6337a9ff` |
| New ops.q | `13c2a52046eb2921e6c2bdb77080b531f985d28e2c421dcf61ef1adab5afa89e` |
| Compiler archive (e6c46a2aca7c3fa014ce365dadce667b5e13e509) | `16be9c340e755e93a5d34a35ca56414041a186405ffa2f0ffa5e33eb68ec39d3` |
| Compiler 188-file manifest | `120b925f13529510226e10caa807d2f63d8bca9efdeb19327786db5ed79c568c` |
| Private dependency binding | `e8d2cbd986bbcca73912636bba73952fcfcf11d0511485c9351b24a3c6c70914` |
| Fresh compile-result.json | `b1de901b84c5a1a325f65a89d0b1e138f1f63b92b03f33d1c4254821a41b49be` |
| Fresh emitted project.json | `c08df3dd22ab0ef929bb803c0e85d0164d259fc63a673d44752328650bb46e6c` |
| Immutable M5 owner | `81b1549a8255faa351b90f8908c69ec6a4784409e74cbe08fd39a086ba6eb498` |
| Owner source graph | `7125764886dbf9188e79b51ad6a4683ef7015e66e23e0b4e144b51dc0403c254` |
| Installed certificates.json | `bea22cdbc08d562d389b9a4317cc3a00447f2416cc989a5f96ca2adb72f5eab1` |
| Raw HTTP evidence JSON | `b407b500fd368d57aa4788502138637ceecaa66cff0ef9f2cc749e3a8c2ee16a` |
| SSE evidence JSON (individual wire hashes inside) | `697d09e7940901b46529bebe77241da2247c015674fa2b2952cdd566965f3bc7` |

The owner source binding verifies all **141 archived source-file hashes** and reproduces the requested source-graph digest. The executable hash matches before and after execution on both hosts. The actual supported command `snapback2-owner version` returns `snapback2 0.0.8`; package version is unchanged and is insufficient by itself to identify this candidate. Engine development remained active; no changing engine binary was used.

The standalone and installed `ops.ready` certificates are identical and carry `i53-codepoint-bytes-unicode-search-text-min-v4` / `bounded-spike-rust-search-text-min-3`. Their full-schema hash is `87b0cd2180016fa003fb9fcd4dd96dbd574a809e44304ce2eb2baad1b4ca54d7`, equal to the running owner's generation before and after the run. All six installed channel argument descriptors equal the newly emitted descriptors. `installed-binding.json` records ordinary owner serialization differences: root `version: 1`, root auth, and omitted schema auth/empty effects. The paved check/cache output exposes the operation certificate bound to the full schema; **individual publish/subscribe certificates remain internal and were not separately captured**.

The fixture uses public Quarry declarations only. A required empty `records` table and a trivial `ops.ready` query satisfy the compiler's project structure; neither is used to produce events. Each channel has ordinary `allow` publish/subscribe rules and `ttl 5s`. Text argument admission supplies the tested gate.

| Channel | Public argument declaration | Paired cases | Accepted | Refused |
| --- | --- | ---: | ---: | ---: |
| direct | `value: text 2..3` | 17 | 5 | 12 |
| optional | `value: text 2..3 ?` | 16 | 7 | 9 |
| items | `value: [text 2..3] <=2` | 13 | 3 | 10 |
| optionalItems | `value: [text 2..3] <=2 ?` | 9 | 4 | 5 |
| nested | `value: [[text 2..3] <=2] <=2 ?` | 15 | 6 | 9 |
| zero | `value: text 0..3` | 7 | 3 | 4 |
| Total | | **77** | **28** | **49** |

Actual routes were `GET /api/channel/<name>/subscribe?args=<JSON>` and `POST /api/channel/<name>/publish` with `{args, payload}`. Empty or one-scalar text refuses min 2; `😀` and precomposed `é` refuse, while `😀a` and decomposed `e` + combining acute pass. ASCII minima/maxima and three supplementary scalars pass; four scalars refuse max 3. Optional scalar/list/nested arguments admit null and omission, and six additional publishes confirm null/omission route equivalence in both directions. Empty optional text still refuses min 2. List minima recurse into later items and the second outer list. Text maxima, inner/outer list maxima of two, and item types remain enforced. Empty lists, empty inner lists, and min-zero empty text are accepted where declared. No list minimum cardinality was declared or inferred.

Representative raw responses are identical on the subscribe and publish sides for these refusals:

| Input | HTTP / code | Exact message |
| --- | --- | --- |
| direct empty string | 400 / E_INPUT | `E_INPUT: channel direct arg value is below text min 2` |
| direct four scalars | 400 / E_INPUT | `E_INPUT: channel direct arg value exceeds text max 3` |
| direct U+0000 | 400 / E_INPUT | `E_INPUT: channel direct arg value contains disallowed control character U+0000` |
| items three entries | 400 / E_FANOUT | `E_FANOUT: runtime loop exceeded its admitted bound` |

Wrong JSON argument shapes and wrong item types return their format/type messages, separately from minimum failures. U+0000 is tested both below and at the minimum length and is rejected as a disallowed control character before minimum checking. The e6 public syntax probes reject optional list elements and optional inner lists with **E_QUARRY_SYNTAX: `list element types cannot be optional`**. A separate `format handle` probe compiles to plain bounded Text with no format descriptor; this witness does not claim handle-format enforcement for channel arguments. These limits are retained in `syntax-probes/`. No private IR probe or fabricated descriptor was used.

Every invalid subscription returns finite HTTP 400 JSON rather than an SSE response. The owner's authorized `channelSubscriptions` count stays **1 → 1**, accounting solely for the existing valid observer; every corresponding status has durable sequence zero. Each invalid publish returns the expected code/reason, leaves that state unchanged, and delivers **zero events during a 120 ms quiet window**. A valid publish immediately afterward delivers its unique liveness marker on the same observer. The final raw stream sequences contain exactly those expected markers. Invalid arguments necessarily differ from a valid observer's routing arguments, so absence of delivery alone would be insufficient: the admission proof also requires the raw refusal and unchanged subscription/state evidence.

Accepted subscription cases establish exactly one authorized channel, then deliver the matching publish. Payloads are `{marker: <unique string>, value: ""}`: **channel argument constraints apply to `args`, not to the independently shaped message `payload`**. The empty payload field is intentionally delivered even on min-2 channels, and marker strings exceed the argument maximum. Events report `from: "dev:channel-minimum-private"`, an integer timestamp, and SSE `id: 0`. The ID is the durable commit sequence, not a distinct per-message counter; marker order and exact counts establish the observed event sequence.

Counts reconcile as follows: 83 subscribe responses = 49 refusals + 28 primary accepts + 6 valid observers. 166 publish responses = 49 refusals + 28 primary accepts + 49 liveness controls + 6 null/omission controls + 34 socket-cleanup triggers. Thus there are **249 channel HTTP responses**, plus 267 status and two snapshot responses: **518 captured responses total**. The 83 observable events are 49 liveness + 28 primary valid + 6 null/omission events. Cleanup triggers run only after closing the relevant owned client socket and contribute no observed events.

`streams/*.http` retains every subscription's raw HTTP headers/body and chunked SSE bytes. `sse-results.json` records stream boundaries, events, and bounded observation windows; `http-results.json` retains raw bodies/statuses and request JSON for all other calls. `audit-results.py` independently decodes the retained chunked bytes, checks event order/counts, re-parses response bodies, and verifies quiet-window event counts at their recorded byte boundaries. **All 2,658 offline checks pass** on both hosts. Accepted events have a four-second arrival deadline and a 40 ms quiet tail. The absence claim is limited to these observed windows and retained stream lifetimes; it is not an indefinite delivery guarantee.

The two owner-created `/control/fork` snapshots and stopped-store verification all show **zero rows, index entries, commits, jobs, outbox entries, and effect attempts**. There are no effects or jobs in the fixture; the owner reports `effects.engine: "none"`. All channel subscriptions are removed before shutdown. No private credentials or full databases were mirrored locally; stopped owner state and snapshots remain only in the private M5 witness root.

Two harness details are preserved explicitly. The first compile attempt omitted a table and received the compiler's project-placement refusal; `attempts/compile-01/` retains it, and the new fixture adds the required empty table. The single runtime run completed all cases, but its sender assertion expected the unqualified persona name. All 77 initial false flags were solely that assertion: the actual sender is the documented `dev:<name>` principal. `attempts/runtime-01/` retains the script, initial summary, flags and log; all raw responses remain unchanged. The independent audit uses `Principal::persona`'s identity mapping and verifies the exact payloads and senders. **No runtime replay, product fix, or genuine candidate red was hidden.**

The private whole run took **12.611 seconds** under a 60-second alarm, with eight-second startup and four-second HTTP/SSE deadlines. Scoped commands used 30-second deadlines. Ports **50870–50875** and the old replay's **50864/50865** were verified free on both hosts before use and after cleanup. Only M5 port **50870** was used, by recorded owner PID **37765**. PID-specific SIGTERM stopped it with exit 0 within the three-second cleanup deadline; SIGKILL was unnecessary. The PID is gone, the port is connection-refused and bindable, and no other server/process was signalled.

`phase.json` is the scoped handoff; `evidence-manifest.json` binds the report and detailed evidence. `cross-host-verification.json` verifies the mirrored evidence and phase bytes. `final-answer.md` is separate from this report. The result establishes the requested bounded channel-admission witness for this exact frozen compiler/new fixture/immutable owner combination. It does not qualify publication, production bearer authentication, rule revocation, reconnect/replay, concurrency stress, or unsupported public syntax.
