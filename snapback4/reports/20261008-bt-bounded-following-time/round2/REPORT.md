# BT round 2 — cover queued timers and another immediate

Base `a9c84614b6c2e4274f39bf1d1ad5c789282178de`, branch
`sb4-intent/bt-bounded-following-time`, eb1000 (`expose-builder-pixel`).
Work uses only this lane's worktree and processes. No product changes, push,
publication or cross-host qualification.

## Finding, reproduction and scope

Astra marked round 1 READY. Grok marked it READY WITH CHANGES: one immediate
does not necessarily run an already-scheduled zero-delay timer or a second
immediate queued by the first. The fast wasm owned-event test could therefore
release POST and then accept the unchanged cached `{ id: "p3" }` answer.
Native's slower execution happened to catch both; it was not an independent
oracle for these schedules.

Before editing the helper, I reproduced both wasm misses with Grok's supplied
loader. Each test passed and logged `BT_RELEASE_HOLD` before
`BT_EARLY_PUBLICATION`. [Exact commands/exits](before-results.json),
[timer trace](before-timeout.tap.gz),
[two-immediate trace](before-two-immediates.tap.gz).
The source review and loader were read from
`~/sb4-intent/reviews/bt-r1.grok.md` and `bt-r1.grok.evidence/`; no reviewer
worktree was accessed.

The helper now awaits one immediate, a zero-delay timer, then one further
immediate **while custody remains held**. It then checks all passed reads and
opens the gate in the same synchronous continuation. No await separates the
checks from the release. The existing call sites still distinguish POST and
apply and include both original and fresh reads at apply.

This is a bounded scheduling checkpoint. It covers the tested queued
microtask, zero-delay timer and two-immediate publications. **No fixed number
of yields can drain arbitrary chains that schedule each next turn from the
previous one, or guarantee that future delayed work has run.** It does not
assert that all possible future work is quiescent. That limitation is now in
the helper comment as well. Actual early settlement remains sticky and is
checked before release. The two real 30-second exhaustion cases remain as
deadline controls.

The four integration files are byte-for-byte unchanged from round 1, including
all 682 explicit assertions, all existing timeout declarations, final values,
and the real deadline checks ([file hashes](integration-file-audit.json)).
Only the helper and its regression test change in the client test directory.
No product source, built SDK, native binary, wasm, timer budget or dependency
lock changes. [Artifact hashes](artifact-hashes.json) match round 1.

## Governing context

The existing llp-orient context continues to apply: LLP 3000 is the Snapback 4
root, LLP 2000.000 its design brief; LLP 3000.023 §11 governs the event-driven
custody wait and unchanged 30-second one-shot deadline. LLP 3000 §7,
“Publication suite under contention,” governs state-based assertions and
preservation of outcomes; LLP 3000.016 §2.2/§5 governs Following withholding.
The relevant documents remain in `llp/current/`. Existing references resolve.
No contract or authoring-surface change, new LLP, or hand-off is needed.
Documentation updates are this report, links from the earlier reports, and an
append-only JOURNAL entry. The earlier [client file census](../AUDIT.md#other-files-checked)
remains the scope of the timing conversion.

## Permanent controls

The [import-time mutation loader](late-publication.mjs) retains Astra's
cached-answer mutation and adds Grok's `timeout` and `two-immediates` modes.
It enters the real wait, ignores its result, delays by the selected schedule,
then returns the fixture's earlier successful answer. It never mutates disk
product bytes. Exact source matches fail closed. Disabled mode leaves all
modules unchanged.

The two new controls explicitly select **wasm owned-event**, each as its own
Node process. Both must have exactly one early-publication trace, exactly one
`ERR_ASSERTION` / “settled while custody was held” failure with
`releaseCustody` in the stack, and **zero release logs**. Thus a pass, an
inactive mutation, a timeout, a final-answer mismatch, or a failure elsewhere
cannot satisfy the control. The same rules remain for the earlier delayed
POST controls; the apply control permits exactly one prior POST release per
test and refuses apply release.

The helper regression file retains the original 17 cases and adds eight:
timer/two-immediates × fulfillment/rejection × POST/apply. A healthy sibling
is checked alongside the broken read, and the gate must remain closed after
the assertion. The positive original/fresh-read case still checks both final
observed answers after apply. All use the real QueryCustody wait.

## Qualification and timings

| File | Tests per run | Original (s) | Round 1 median (s) | Round 2 runs 1 / 2 / 3 (s) | Median (s) |
| --- | ---: | ---: | ---: | --- | ---: |
| bounded-following | 39 | 1219.176 | 314.208 | 313.997 / 315.826 / 317.562 | 315.826 |
| retained-history | 78 | 192.570 | 68.763 | 68.876 / 69.193 / 68.676 | 68.876 |
| following-routing | 4 | 33.195 | 4.137 | 4.137 / 4.138 / 4.134 | 4.137 |
| client-lifecycle | 57 | 45.256 | 42.930 | 42.929 / 42.961 / 42.557 | 42.929 |

Bounded-following's median is **315.826 seconds**, versus the prior
round's 314.208 seconds and the original 1,219.176 seconds: **903.350 seconds
saved (74.1%)** from the original baseline. Prior timings
are retained measurements, not new baseline runs. [All 178 per-test comparisons](TIMINGS.md),
[machine-readable data](timings.json), [file summary](timing-summary.json).
The slower second/third runs include variation in native response-racing,
inbox and horizon cases; no new deadline exhaustion was introduced.

| Check | Result |
| --- | --- |
| Four complete integration files, three runs | **534/534 pass** |
| Helper regression file, three runs | **75/75 pass**, 25 per run; all 17 previous cases retained and eight added |
| One-shot + dependencies + publication-session | **378/378 pass**, 354 top-level + 24 nested, 146.896 s |
| Admission / receipt / selected-sibling bypasses | **43/43 expected assertion failures** (26 + 9 + 8) |
| Previous delayed-microtask controls | **6/6 expected release-boundary failures** |
| New wasm ownedEvent `setTimeout(0)` control | **1/1 expected release-boundary failure**, one publication, zero releases |
| New wasm ownedEvent two-immediate control | **1/1 expected release-boundary failure**, one publication, zero releases |
| Both real deadline controls | Pass in every run: six real exhaustions, unchanged `E_QUERY_RETRY` and ≥30,000 ms assertions |
| Both mutation loaders disabled | All four full files pass in run 1 |
| `./ref-check` | Pass: 532 LLP docs, 10,593 refs, zero errors/unchecked |
| `git diff --check` | Pass |

The [verification runner](verify.py) exited **0**: all 27 commands produced the
expected exit and exact test counts, with no cancellations or skips.
[Exact commands/results](run-results.json), [validation summary](validation-summary.json),
[all 51 negative cases and traces](mutation-results.json),
[helper case retention audit](helper-case-audit.json),
[reproduction instructions](COMMANDS.md).
All eight delayed controls fail at `releaseCustody`; POST controls log no
release and the apply control logs only the preceding POST release. No hang,
loader failure or final-data mismatch is counted as a successful control.


Dependency preflight ran first in `snapback4/`: `bun install --frozen-lockfile`
installed 597 packages, then `bash ~/sb4-intent/check-sdk-deps.sh` printed
**deps-ok**. No tracked dependency file changed. Existing product builds were
reused after checking the native, wasm and 128 SDK hashes.

The first complete four-file pass uses both import loaders with mutations
disabled and overlaps this lane's independent control and regression jobs.
The second and third passes run sequentially after those jobs complete. Other
lanes may use the shared host; timings are observations, not latency promises.
No other process was inspected or signalled. No Darwin, browser or complete
publication-suite run is claimed for this revision.
