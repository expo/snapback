# Snapback2 0.0.24: Linux runtime and two-platform publication

Status: resumed 18:03 UTC with explicit author approval for real native
ICU-backed Intl in Ibex, followed by publication and Clique. No 0.0.24 package
has been published. No Linux package or unified shim has been staged, and no
Clique actor has started. The earlier Mac artifacts, source commits, reviews
and failed qualification attempts remain preserved; changed source requires
fresh staging, not reuse of those old qualification receipts.

## Resumed scope and orientation

The author answered "go ahead" to the proposed native Intl implementation.
The implementation lane is Codex gpt-5.6-sol xhigh, reusing the Ibex lane and
expo-build-1000 target from the first attempt. An independent Sol lane audits
adjacent declared Intl behavior with the existing executable; root owns
integration and the subsequent mutually blind Sol/Grok reviews. No new
worktree, runtime engine fork, JS standard-library polyfill, publication gate,
or registry is commissioned.

Governing context:

- Ibex LLP 0057 §3.1: native semantics, thin JavaScript object plumbing, and
  an engine-optional Rust consumer; the approved Intl completion replaces an
  engine stub rather than introducing another transport or executor.
- Ibex LLP 0067 §4–§5: installation before hardening, unchanged grant model,
  exact global-surface checks, and the unmodified pinned Hermes artifact.
- Ibex LLP 0068 §3: the no-engine build remains independent of Hermes.
- Snapback LLP 1003 §1 and §3: authored ES2020 effects, unchanged exact Intl
  witness, hardened runtime and enforced deadline at every JS entrance.
- Snapback LLP 1002 §11: actual native consumers must qualify the identical
  final shim before publication. Prior host-only stages are not substitutes.

Risk to resolve: NumberFormat is a known dummy; other ES2020 Intl members
need a bounded audit so a number-format fix is not called complete Intl
conformance. Existing LLPs 0057/0067/0068 and the focused issue are the doc
update targets. No new design document is needed.

Latest Snapback main `b3b063b4e` (including `75a67c92c` ergonomics and
acquisition work) was merged into the release lane as
`04c2a143a814ab7a30c5335e902c0782f960df5e`. The sole manual conflict was the
LLP 1002 revision header; both entries were retained. Product integration
was automatic. Canonical verification of that integrated source passed with
exit 0, separately from the upcoming Intl qualification: 1,335 package tests,
302 compiler checks, 1,127 native tests and four configured skips, plus
evaluator (266 corpus, ten delivery, two visibility) and doctests. EPYC wrapper
PID 1581281 ran 18:07:49–18:09:16 UTC. This first run rebuilt changed source
and took 87 seconds including prerequisites; it is content qualification,
not a warm sub-60-second loop claim. The complete output is retained in
[the canonical log](./snapback-04c2-canonical.log.gz).

### Bounded Intl audit and implementation decision

The adjacent-surface audit used existing executables only. Its
[original inputs, outputs and process receipts](./intl-preimplementation-audit.tar.gz)
have SHA-256
`4f5921e1c265585fc6dc095cee58513402d87e2c625a959286efeb33dce0f5e6`.
Linux's number formatting, locale case mapping and date parts contain actual
stubs; Collator, date text formatting and canonical locale parsing work in the
focused controls. Shared missing constructors and inherited Mac NumberFormat
gaps are tracked in the
[separate surface ticket](../../../issues/20260911-snapback2-effect-intl-declarations-exceed-runtime.md).
Two supplementary probes crashed an older Mac debug CLI; their exit139 logs
remain in the archive and support no positive or new-candidate claim.

The audit's preliminary date-parts seam recommendation was superseded during
design: engine resolved options omit required formatter state, and a delegated
constructor wrapper risks duplicate observable option reads. The implementation
therefore uses one native-owned DateTimeFormat state for both text and parts,
with ordered JavaScript argument coercion and Rust/ICU computation. It does
not reconstruct state from engine output or change Hermes source. Separate
Sol helpers author only new case/date files in the same implementation stream;
the primary implementer owns existing-file integration and all Ibex commits.

The latest main also contains an independent package-size issue. Its measured
client/React/Expo closures are 145,189 / 155,056 / 158,589 gzip bytes; complete
local runtime is 88,053 below the existing 90,000 ceiling. The earlier recovery
2% exception does not automatically cover these later changes. The author
explicitly approved the disclosed release-only size exception: "Allow this
release; retain size cleanup." The existing checks, accepted baseline and
cleanup ticket remain unchanged. This resolves only the package-size trade;
native/runtime qualification and exact staged consumers still gate publication.

Before staging, main advanced to `1917a7964700b7f29976fe6fb0406e50e477da44`:
the other agent's foreground-admission repair, pending-receipt projection and
shared evaluator leaves. Those completed changes were merged as
`ab0a693f84f7cdd57d21ae720fe39db1dc28f043`; product integration was automatic.
Only the size ticket conflicted, and both the author ruling and incoming
attribution/reduction evidence were preserved. Its canonical measurements are
now **139,450 / 149,260 / 152,792** public gzip bytes and **88,086** complete
runtime bytes. These smaller public closures fit within the disclosed release
exception; normal growth guards still fail and the cleanup ticket stays open.
The other agent's [completed work and evidence](../2026-09-11-snapback2-followup-diagnostics/README.md)
are reused, not reimplemented. Integrated release qualification is separate.

The remainder records the initial attempt and its hold, not new qualification
claims for the resumed candidate.

### Native completion checkpoint and review disposition

The integrated checkpoint is Ibex
`62241df63462c22635207dc9d58e5e175a3ac3b8` (tree
`e7da1f3141973ba41bb1325a0fe66f1628a36ada`), parent
`011924c05ded174a42e5b97db5ba0ec19cdfc498`. The full SHA was verified with
Git after an initial message mistyped its suffix; no export or qualification
is bound to that nonexistent spelling. Linux full Hermes no-fail-fast passed
19:14:44–19:15:02 UTC (PID 2013824, exit 0), the combined focused suite passed
31/31, clippy passed, and the separate EPYC no-engine suite passed. The final
Mac shared-code regression and production staged consumers remain pending.

The subsequent Mac shared-code regression of this same `62241df63` source
passed every affected target: 300 library passes (four ignored), embedding
5/5, hardening 5/5, and 183 no-engine library passes (one ignored) plus all
integration targets. Both full commands exit 101 only for the unchanged
noninteractive Keychain test, `User interaction is not allowed`; neither full
suite is called wholly green. Engine PID 36594 ran 19:20:19–19:20:29 UTC;
no-engine PID 37341 ran 19:20:57–19:21:11 UTC. The complete source export has
SHA-256 `788d0e22164ee24be2881a64400e31743643b2c105e55039634dc9f7b92a1cbc`;
all six shared source-file hashes matched the control-plane source. Linux-only
constructor corrections do not change those tested Mac semantic inputs.

Mutually blind [Sol](../../../llp/reviews/1003-native-intl-20260911.r1.sol.md)
and [Grok](../../../llp/reviews/1003-native-intl-20260911.r1.grok.md) reviews
of the earlier exact NumberFormat/case checkpoint completed with NOT READY
and READY respectively. Root dispositions, based on concrete inspection:

- Accept the non-object `newTarget.prototype` fallback finding; correct both
  NumberFormat and DateTimeFormat with an exactly-once prototype lookup and
  regression coverage. Final integrated source gets both-family review.
- Locale private-use and complete Unicode numbering-type parsing were already
  corrected and tested in the integrated checkpoint.
- Decline the currency maximum-only default change for this selected 2020
  behavior. [ECMA-402 2020 §12.1.1](https://402.ecma-international.org/7.0/#sec-setnumberformatdigitoptions)
  steps 12.2–12.4 prescribe the implemented currency-minimum default and
  maximum's lower bound. The review requested newer-spec behavior.
- Strengthen the optional compact/percent output assertions; their ICU
  skeletons were correct, but permissive regular expressions could miss a
  regression. Other nonblocking suggestions do not expand release scope.

Date `formatMatcher: "basic"` still shares ICU best-pattern selection, as in
the pinned predecessor. The existing surface ticket records this limitation.
SQLite's exact construction-anchored integrity check admits only the four
trusted locale-method replacements before first validation, not a wholesale
snapshot refresh; later authored tampering remains refused. This security
delta is explicitly included in final review. None of these records claims
complete Intl conformance or qualifies a package for publication by itself.

The author requested npm publication followed by Clique on expo-build-1000,
using Astra at the previous builder effort. After the Darwin-only 0.0.23
publication exposed the missing full Linux runtime, the author explicitly
authorized porting Ibex2, publishing the Linux-capable package, and continuing
the benchmark. The existing vanilla Hermes source pin is unchanged:
`6badada762121682b5481b6124e6c3a991ae6046`.

## Source and work custody

- Ibex final review candidate:
  `3182a9d7767ca199438d4b7ed114e74c29458944`, based on upstream
  `9cbf9e62d6434b4e3f4d49eddacb337218d256a3`.
- Snapback final publisher review candidate:
  `2849b5cde3976301ffa3114200620495d76fd36a`, based on
  `bf84508494d3671a2037766bfef33cbb62c690dc`.
- Exact dependency-pin integration:
  `a3976b8d98dd9b2b517dd53c736548683d728942`. Its only delta is the manifest
  and lockfile pin from 9cb to the reviewed Ibex 3182 candidate. Locked
  offline Cargo metadata resolves successfully. Final native qualification
  at b8 below blocks Snapback landing and publication.
  Ibex 3182 is now on upstream main, landed by fast-forward with no semantic
  integration change.
- Ibex limitation documentation and open issue:
  `0019691e87f120a33cfec9b7dd22b6d98f49d420`, landed on upstream main.
- Final Snapback source candidate:
  `b8cedb3088234a33fa1ac0a9fe635f20351c27e2`, retained on
  `release/snapback2-linux-integration`, not landed on main.

Existing named worktrees were reused. The primary Snapback worktree's
unrelated unresolved merge was untouched. The dirty primary Linux Ibex
checkout was not used. When the initially considered Linux Snapback lane
acquired another owner's edits, it was left untouched; a clean existing
footprint-baseline lane was reused after preserving its detached commit under
a named ref. Review/build source archives are exact Git exports, not new
clones or authored parallel implementations.

## Runtime qualification

The Linux Hermes source build completed all 423 Ninja steps with Intl enabled
and the Ibex patch set absent. The static installation contains seven archives
and no shared Hermes runtime. Linux HTTP remains the existing Rust-owned
rustls transport with the same grants, redirects, cancellation and bounds.

The full Linux Ibex suite at `e0a5324c7` passed 286 library tests (three
intentional ignores) and every integration target, including 23 deadline,
21 fetch-limit, five streaming, 46 loader, 34 resolution and five embedding
tests. Clippy passed. A production CLI executing an explicitly granted real
HTTPS request returned HTTP 200. The final two commits only normalize and
document the vanilla Intl guard; actual mixed-case truthy acceptance and
false-setting rejection were checked separately.

The qualified standalone Ibex binary has SHA-256
`c14809eac4259c0c99d8b4f42ece1fd702549356a06affaac6b85ef843bcb061`.
Its ELF dependencies are ordinary system C/C++ libraries, not shared
Hermes, ICU, terminfo, curl or TLS libraries. Its observed maximum required
versions are GLIBC 2.39 and GLIBCXX 3.4.30. This is qualification on
Ubuntu 24.04.4 x64/glibc 2.39, not a claim for musl or older distributions.
The final Snapback executable's closure must be inspected separately.

On Silver/macOS arm64, the integrated runtime at `0563d5a56` passed every
affected engine integration and all 23 deadline tests. The full engine and
no-engine suites each retained one inherited failure:
`secrets::darwin::tests::the_keychain_round_trips` reports "User interaction
is not allowed" under noninteractive SSH. Its source blob is identical to
the upstream base. No Keychain settings were altered and neither full suite
is claimed entirely green. Subsequent changes affect build/receipt scripts,
whose updated receipt parser was exercised against actual Mac and Linux
artifacts.

Retained original evidence: [Linux suite](./ibex-linux-qualification.log.gz),
[Linux release CLI](./ibex-linux-release.log.gz),
[exact-tip builder](./ibex-linux-builder-final.log.gz),
[Mac qualification](./ibex-mac-qualification.log.gz),
[Linux receipt](./ibex-linux-hermes-receipt.json) and
[Mac receipt smoke](./ibex-mac-receipt-smoke.json). The Linux receipt SHA-256
is `355013f1a29ac3541d6531bf9a0784c67d4c6d90eb19fadc6f7362815f02f374`;
compiler SHA-256 is
`4c8904c59c69fa1ebc24b1369cb6afb976e45bf1dd9505a67aa7710e734f661a`;
engine archive SHA-256 is
`d8e4f46cb503c78b7d2964a200bf8edaa00dc53370a26b0abc998a602dfaff8d`.

The original local Ibex checkout was stale. Before integration, the port was
rebased without conflicts onto current upstream 9cb, preserving both shipped
deadline fixes; all five port commits compared equal in `git range-diff`.

## Review and publication invariants

Sol xhigh and Grok 4.6 xhigh independently reviewed exact frozen source
capsules, without peer findings, additional agents, builds, remote commands,
or edits. First-round corrections include exact compiler selection, required
vanilla Intl, case-sensitive test portability, recoverable staging mismatch
handling, and exact canonical client-tarball custody. Both final reviewers
returned READY for both source candidates:
[Sol r1](../../../llp/reviews/1002-linux-publication-20260911.r1.sol.md),
[Grok r1](../../../llp/reviews/1002-linux-publication-20260911.r1.grok.md),
[Sol r2](../../../llp/reviews/1002-linux-publication-20260911.r2.sol.md),
[Grok r2](../../../llp/reviews/1002-linux-publication-20260911.r2.grok.md).

Dispositions: adopted the material compiler/Intl/fixture/staging/shim
corrections. Rejected the first Sol prompt's unintended interpretation that
stage-only must prohibit read-only dependency downloads; clarified the
contract for the independent final reviews. Kept compiler-null for normal
engine-only installations while requiring explicit missing overrides to
fail. Declined speculative builder-digest cache expansion without a concrete
missing semantic input. Grok's claim that fresh npm-pack mtimes necessarily
change the tarball was not established; exact canonical-shim custody was
adopted without making that empirical claim. Final non-blocking diagnostic
and fixture-strength suggestions are not treated as release blockers.

The publisher's 16 tests pass, including an actual packed-tarball A→B→A→B
roundtrip. This is not evidence that production native consumers have run.
Before publication, both native hosts must successfully consume the same
final shim integrity, alongside their exact platform artifact. Imported
foreign-native artifacts are checked but never executed on the wrong host.
`--stage-only` permits dependency downloads but performs no registry writes
or publication convergence. Mismatched durable stages are not silently
overwritten: publication refuses; explicit restaging preserves the old
directory first.

## Native release qualification: held

Silver's initial Darwin-only stage at exact integrated a397 passed from
15:13:41 to 15:15:59 UTC (owned PID 53208): all four media CLI tests,
production engine and helper, doctor, package exports, both templates,
live React query roundtrip and receipts. The separate Mac effects suite
passed all 74 tests. The engine is 7,813,744 bytes, its no-engine comparison
4,461,008 bytes, and media helper 2,147,984 bytes. The actual engine's Mach-O
dependencies are system libraries/frameworks only. The separate Mac receipt
parser smoke above is for the framework input, not a claim about the variant
of the static archive linked into this shipped executable.

This initial host-only shim is not the final shared client artifact. The
intact Darwin stage was transferred to Linux with hashes checked; Linux
will assemble the full selected-platform shim and both native hosts must
qualify those exact bytes before any npm mutation.

Linux canonical check attempts are retained separately from product claims.
The first attempt passed all 1,124 native tests but failed one of 1,307
package fixtures with `E_OWNER_TEST_IO`. The reused lane's untracked
`target` symlink pointed into a different active worktree. The symlink was
preserved as `target.shared-integrated-link`, its referent left untouched,
and a lane-local target built successfully. The exact failing fixture then
passed. On the isolated canonical rerun, all package and native tests passed,
but compiler checks exposed a second inherited lane precondition: missing
workspace dependencies and a package-local node_modules symlink into that
other worktree. Full-suite retries were paused for a complete bootstrap
audit and frozen dependency installation, preserving that link as well.
No product code was changed in response to either environment failure.

After a frozen local dependency install and complete lane bootstrap audit,
the isolated compiler check passed 302/302; every phase of the third
canonical run reported status 0 (package 1307, native 1124, compiler 302,
evaluator and doctests). Its wrapper did not retain the process exit status,
so this record does not invent one.

The final corrected-source canonical run at exact b8 completed in 55 seconds
with an explicitly retained exit status of 0 (PID/PGID 1115161): compiler
302 passed, package 1307 passed, native 1117 plus seven isolated tests passed,
and evaluator/doctests passed. The separate full Hermes effects run
(PID/PGID 1112816) retained exit status 101: 74 passed and one failed, only
the unchanged Intl witness. These are different suites; the green standard
suite does not override the affected runtime failure.

Final evidence: [canonical log](./snapback2-final-b8cedb30-canonical.log.gz),
[canonical exit](./snapback2-final-b8cedb30-canonical.status),
[effects log](./snapback2-final-b8cedb30-hermes-effects.log.gz), and
[effects exit](./snapback2-final-b8cedb30-hermes-effects.status).
All owned build, qualification, transfer and review processes have exited.

### Effects integration correction

The first real Linux Snapback effects run at a397 passed 27/failed 47. Every
failure stopped at startup with the same `DebuggerInternal` missing-global
error. Unlike the qualified Mac debugger-enabled engine, the qualified
Linux release engine omits that internal property. Pinned Hermes source and
a probe against the actual Mac static engine agree that the debugger
property is non-writable/non-enumerable/non-configurable, so deleting it
cannot normalize the two profiles.

The focused correction is
`438dfa64cc8011302c2343a28333cbed62ae2d69`: permit precisely the existing
audited host surface with or without this one non-authorable engine internal.
All other globals remain mandatory; unexpected surviving globals still
refuse; frozen-global verification and its ordering before authored code are
unchanged. No compiler allowlist or Hermes build profile was expanded.
Regression coverage checks both accepted profiles and unknown/missing
required names, including Intl, fetch and the timer host channel.

The corrected Mac engine suite passed 75/75. Fresh independent
[Sol](../../../llp/reviews/1003-engine-profile-20260911.sol.md) and
[Grok](../../../llp/reviews/1003-engine-profile-20260911.grok.md) reviews
returned READY for that exact global-profile correction. The initial
a397 Mac stage and its transfer were preserved under a separate pre-fix name
and explicitly excluded from the final publication flow. Final native
artifacts must be rebuilt from the corrected source, not resumed merely
because their version is still 0.0.24.

### Remaining blocker: genuine native Intl, not a build setting

After the global-profile fix, Linux effects reached the actual programs and
reported 71 passed/four failed. Three failures were legitimate wire-format
variation: Linux's transport supplies `Content-Length: 0` for an empty
request, while the Mac transport omits it. The tests now admit exactly
absent-or-zero in that case, retaining exact nonempty body lengths, body
rewrites, credentials and grant checks.

The fourth is a real capability failure. At the pinned engine commit,
`PlatformIntlICU.cpp` implements `NumberFormatDummy`: locales, grouping,
currency, percent and fraction-digit options are ignored. Actual Linux
observations include plain 7→`7.000000`, grouped 1234567.89→`1234567.890000`,
USD 7→`7.000000`, percent 0.25→`0.250000`, and a bogus single integer part.
The original compile-and-execute witness expects the ordinary en-US
formatting of 7 to be `7`, and correctly fails.

The implementation agent briefly committed a numeric-equivalence witness
in 5eaea298 before the orchestrator's hold arrived. Corrective commit
`b8cedb3088234a33fa1ac0a9fe635f20351c27e2` restored the original exact
Intl witness without resetting history. The net 438→b8 delta is only the
wire-header fixture correction. The relaxed witness is not accepted as
qualification, and no publication was attempted with it.

The pinned source, available upstream objects and build-option audit found
no real ICU NumberFormat implementation behind another switch. Upstream's
[ICU source](https://raw.githubusercontent.com/facebook/hermes/main/lib/Platform/Intl/PlatformIntlICU.cpp)
also retains the dummy implementation; its
[platform selection](https://raw.githubusercontent.com/facebook/hermes/main/lib/Platform/Intl/CMakeLists.txt)
routes non-Apple/non-Android Intl builds there. Static ICU linkage alone
does not implement the missing semantics.

The proposed next step is genuine ICU-backed Intl behavior in Ibex's native
layer while keeping Hermes unmodified. This requires an author scope choice
before implementation; no native replacement, JS polyfill, Hermes patch,
compiler surface reduction or weakened witness has been adopted. The Ibex
filesystem issue is `issues/20260911-linux-hermes-intl-numberformat-stub.md`.

### Preserved Mac stage

Exact 438 source stage: Silver PID 62198, 15:36:54–15:38:00 UTC, exit 0;
[stage log](./mac-stage-438dfa64.log.gz),
[effects log](./mac-effects-438dfa64.log.gz),
[portable receipt](./mac-438dfa64-stage-receipt.json), and
[actual static-engine descriptor probe](./mac-debuggerinternal-probe.log).
The final host-only stage remains at
`/Users/ccheever/projects/snapback/snapback2/dist/npm/publish-snapback2-darwin-arm64-0.0.24`
and an intact hash-matched copy is at
`/home/ccheever/release-inputs/snapback2-0024-roundtrip/darwin-a1`.

Darwin platform SRI:
`sha512-8dNK1yA1cuREbmzghpxmGgSlNGB8yYH9DhCyxsUmAeRD9z7FWEpiAttV/nKCt2xAYPzXjV10c0BtIXYtyH4dxg==`.
Host-only shim SRI:
`sha512-EBce3NWm480F5a4Y1UAsuuURG+4+TSp417fVDoIQFRkDc28Z4RPZmZf+LTz/mW+XLURb24mo94iZ1pk1qKfpbg==`.
Neither is evidence for a Linux or final unified publication. Owned Mac
build/stage/transfer processes have exited; no registry write occurred.

## Clique preparation, separate from results

The requested host is expo-build-1000 (`expose-builder-pixel`, Ubuntu x64).
Run root: `/home/ccheever/clique-ri-20260911`.
Builder and fresh M7: `gpt-6-astra / medium`. Independent grader:
`claude-opus-5`. Final absolute-rubric scorer: `gpt-6-astra / xhigh`.
Sequence: M1→M2→M3→M4→M5→M6→M8, independent grading, fresh M7, scoring.
The separate prior messaging-day2-evolution add-on is excluded.

Only the frozen 170-file instrument at
`f40559f37722c79178be664a11f8a6485f1508fd`, required sibling helper and
generic run wrappers were transferred. No prior app, diary, findings,
scores, results or transcripts were supplied. Live Astra, independent Opus
authentication, Playwright 1.62.1/Chromium 151 DOM execution and raw Codex
root/descendant usage retention were preflighted successfully. No benchmark
actor has started at this stage of preparation.

Two original unmodified choreography self-tests timed out waiting for a
retained poll selection before entering offline mode. Three separate
diagnostic-copy attempts and one final unmodified attempt passed. All
attempts are retained; the frozen instrument and timeout are unchanged.
This is a disclosed N=1 calibration/diagnostic run, not evidence of
comparative magnitude or variance. The intermittent fixture observation
alone is not attributed to Snapback or Linux.

The lightweight runner retains raw native usage but lacks authentic
milestone-boundary joins: report `raw-retained-not-joined`, with cap/boundary
adjudication unavailable. No holdouts were committed. Native Apple simulator
proof is unavailable on Linux and cannot be replaced by a web run or export.
