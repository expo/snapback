# Snapback2 0.0.24: Linux runtime and two-platform publication

Status: resumed 18:03 UTC with explicit author approval for real native
ICU-backed Intl in Ibex, followed by publication and Clique. No 0.0.24 package
has been published. A Linux package and identical two-platform shim passed
both native consumers at Snapback `6c7f81ace` / Ibex `02cf5b12`, but final
runtime review requires a corrective candidate before publication. No
Clique actor has started. The earlier Mac artifacts, source commits, reviews
and failed qualification attempts remain preserved; changed source requires
fresh staging, not reuse of those old qualification receipts.

Current final product candidate: Ibex
`49fa9841212cf1fc119a3f8dcd246b1f9ab71ea8`, pinned by Snapback
`5f115db401a41954f10dc3737e5b03872470a4eb`. The only executable change after
the correction checkpoint below is `checked_time` truncation, plus its tests.
Focused tests passed (PID2421391,20:36:09–20:36:12 UTC); full Linux Hermes
passed481/0failed/13ignored across30 summaries (PID2424964,
20:36:37–20:36:49 UTC). Snapback's unchanged75-test effects suite also passed
at this pin (PID2439826,20:40:59–20:41:11 UTC). The
[TimeClip source/process evidence](./ibex2-intl-49fa98412-evidence.tar.gz)
has SHA-256 `e32aefb16d8ae0572a98031e4cfb1e11af1a4d62c7868a554f7ec9fa6ec63172`.
Independent Sol and blind Grok addendum reviews are both READY; no required
correction remains. Their unchanged responses are under
`llp/reviews/1003-native-intl-timeclip-20260911.*.md`. Later-spec fractional
second fields are not added merely to strengthen the optional positive test;
the exact Rust999.9→999 assertion and negative public-path regressions cover
the correction. Signed zero is not exposed by the formatter's public results.
Final production artifact qualification is pending. No npm write has occurred.

The broader correction-delta reviews are complete and preserved in
`llp/reviews/1003-native-intl-20260911.r3.*.md`: Grok READY, Sol NOT READY
solely for missing full option-alias canonicalization. Root accepts that
technical gap but defers it beyond the bounded ASCII-case correction rather
than treating it as a release blocker. Canonical calendar names work; aliases
such as `islamicc` do not. This predates the reviewed correction delta and
is not evidence of complete ES2020 conformance. Sol's verdict is not rewritten
or represented as READY. The existing
[Intl follow-up](../../../issues/20260911-snapback2-effect-intl-declarations-exceed-runtime.md)
records alias behavior, the unchanged constructable String case wrappers,
and a stronger nonconstructability test pattern suggested by Sol. No fourth
whole-Intl review or new conformance program is started. Ibex's docs-only
child `cafe2429280ee4b6dd309e397b3dac8715864dbd` makes the same limits explicit;
its product source is identical to the pinned49fa revision.

Reviewed correction checkpoint: Ibex
`12dfbf3fd20fe0986768a3a5443972d38e69566c`, pinned by Snapback
`1c940d58a93fb21f5be1037c6f0bfecb268c0364`. The exact correction passed
22 focused tests (two separate known ignored constructor cases), full Linux
Hermes30 binaries /480 passes /0 failures /13 ignored, and clippy/static
checks. All correction code is Linux-gated; Mac compiled/runtime inputs are
unchanged. The original Snapback effect witness passed75/75 at this exact pin,
EPYC PID2351497,20:27:53–20:28:05 UTC, exit0. Fresh mutually blind Sol xhigh
and Grok4.6 xhigh correction-delta reviews started20:27 UTC; production
staging overlaps them. No main landing or npm write has occurred. The
[retained correction evidence](./ibex2-intl-12dfbf3-evidence.tar.gz) has
SHA-256 `88d595f9e303790aae51e8a3ff5ed97e5d42666ef1b235c36b15e2bff1f29eca`.
Its manifest records exact commands and source/HBC hashes, including the
comment-only difference between the tested overlay and committed source.

One R2 optional finding proved observable in root's bounded follow-up:
`checked_time` passed fractional milliseconds through to ICU. The existing
12df debug CLI formats `-0.1` milliseconds as Dec31,1969 and `0` as Jan1,1970,
including different day/second parts. The selected TimeClip conversion must
truncate toward zero first. Root authorized a central conversion correction
and focused positive/negative fractional regressions as a small addendum,
with its own two-family delta review, not another whole-Intl review. The
original reproduction is retained in the archive above. The 12df Linux
production package passed all19 consumer steps, but is preserved as a
checkpoint and will be replaced by the corrected candidate before npm writes.

Prior reviewed native candidate: Ibex
`02cf5b12dc2f3ebe2b64327fd57457eb0ae68485`; staged Snapback integration
`6c7f81aceeafa98b4fd064770adc25068b9e07bc`. Both are on named branches;
main landing and npm writes remain held for corrections and renewed native
consumers. Sol xhigh and Grok4.6 xhigh reviewed the same final delta from
19:37 UTC and both returned NOT READY. Their unchanged responses are retained
under `llp/reviews/1003-native-intl-20260911.r2.*.md`.

### Second native review disposition and staged checkpoint

Accept unsupported calendar/numbering options retaining a supported requested
extension; restrict time-zone matching to ASCII; make built-in non-constructor
callables nonconstructable and correct Date method lengths. The matching
NumberFormat callable defect is included in the same bounded correction.
Both reviewers independently accepted deferral of primitive-newTarget fallback
without claiming it fixed or finding a clean public-JSI alternative.

The disputed hour12 case is resolved against the selected 2020 specification:
InitializeDateTimeFormat sets the hc option to null, which is a supported
locale-data value and clears a requested hc extension in ResolveLocale.
Accept Sol's finding and reject Grok's advice to retain that extension.

Reject the proposed case-sensitive calendar change. Root's source check found
that the actual 2020 ResolveLocale algorithm canonicalizes string-valued
Unicode options before membership comparison. Keep calendar canonicalization
and correct the inconsistent NumberFormat/DateTimeFormat numbering option
oracle instead. This differs from later-edition behavior; a modern Node
result is not the selected-spec oracle. Sources:
[2020 ResolveLocale](https://402.ecma-international.org/7.0/#sec-resolvelocale),
[frozen es2020 source](https://raw.githubusercontent.com/tc39/ecma402/es2020/spec/negotiation.html),
and [2020 DateTimeFormat locale data](https://402.ecma-international.org/7.0/#sec-intl.datetimeformat-internal-slots).
The frozen negotiation source SHA-256 is
`a7e43d1fbaaaafc8b6d2c6addeeb1f9250d533e4f6481e7a39643c35b6b059f6`.
Root's initial acceptance of the calendar finding was withdrawn before the
correction was committed. Reviews remain historical, not silently rewritten.

At this superseded checkpoint, Linux B PID2227541 ran
19:51:56–19:56:13 UTC, exit0, all19 production consumer steps passed. Silver
A2 PID54498 ran20:11:04–20:11:39 UTC, exit0, all19 steps passed against the
same combined shim bytes: SHA-256
`dbb2c3ce953bc9eae903faa24997794632e4e0a47d2f609a0fb11ae71d475733`,
SRI `sha512-4l9lsHD3I+IJyJkKGa3866SBkzD6JBc3pnO+PuXobc/0T7eXyxGNN8UB2wr1MC6O0ElSH4y4WHd+UY1DMeooWA==`.
Linux native SRI:
`sha512-g5aQZDKraNWhX/9FYYTE4Ef3m2SWYBDeSjbL/KwduV47lB3u95pFJtMtaekw/GwVHpxzpIY/HfYXJUMQ0BOI3Q==`.
Darwin SRI remains the A1 value recorded below. Linux binary bytes:
engine47,829,752, no-engine6,744,216, media3,922,184. ELF dependencies are
ordinary system libraries only; engine maximum versions GLIBC2.39 /
GLIBCXX3.4.30 / CXXABI1.3.9, media GLIBC2.38 / GLIBCXX3.4.31 /
CXXABI1.3.13. No older-distribution compatibility is inferred.

The earlier Linux B failure was a publisher allowlist omission of glibc's
ordinary `ld-linux-x86-64.so.2` loader. Commit `6c7f81ace` admits only that
exact name and extends the existing positive fixture. Self-test and all16
publisher tests pass; independent Sol and blind Grok delta reviews are both
READY, with no required correction. The original failed B log and all successful
checkpoint stages remain preserved, not reused as qualification of future
changed native bytes.

The exact immutable combined shim at this checkpoint measures client139,450 /
React149,295 / Expo152,792 gzip bytes with prescribed Node24.18.0,
TypeScript5.9.3 and gzip9. React adds35 bytes over the earlier acquisition
measurement because the latest starter fix adds its refusal callback. The
complete-runtime semantic inputs did not change; its latest prescribed
measurement remains88,086 below90,000. These public closures are below the
author-approved release-only amounts, but the ordinary growth check and
cleanup ticket remain unchanged and open. Exact package measurement evidence
travels with the B/A2 receipts, not as a new baseline.

Retained compact checkpoint evidence:
[Linux B](./snapback2-6c7-linux-b-checkpoint-evidence.tar.gz), SHA-256
`d36b35c9bc2d879ca4efefdbf53d822f3aa4ae352092fce52e9b1a8aa77a612c`;
[Mac A2](./snapback2-6c7-mac-a2-checkpoint-evidence.tar.gz), SHA-256
`7a176ad558aa84c298a7e52e412e35d2360a939a1bf5ca4b6f78c79d75f59e66`.
These retain process logs, identities, stage/resume/tarball hashes, closure
measurement and Linux ELF findings; full native tarballs stay in the
preserved host stages. `closure-measurement.json` is identical on both hosts,
SHA-256 `6ec786cd58ab6e003be09c3735b07ab7bd87183f6d6f9a27638261b219477854`.

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

The integrated `ab0a693f8` canonical suite passed on EPYC, PID 2086045,
19:24:29–19:25:30 UTC, exit 0: 1,340 JavaScript tests, 1,127 native passes
across the exhaustive 1,120+7 split and four configured skips, 302 compiler
checks, evaluator and doctests. This 61-second run does not establish the
separate 60-second budget. The [source, process and original run evidence](./snapback-ab0-canonical.tar.gz)
archive has SHA-256
`9cd7a1734fa9426f034acc1b22ee9ee67d91a53b5291cee826935b3ff51840ee`.

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
The [original Mac process and test evidence](./ibex-mac-62241-evidence.tar.gz)
archive has SHA-256
`31a089c3d0d4c098d991b27ce32e0f6c0c9632936893642a55d669dcf4c1a301`.

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

The constructor finding above was subsequently **deferred, not fixed** after
the three-round stop rule. Pinned Hermes allocates and reads the newTarget
prototype before every Proxy construct trap; the clean JS factory would then
perform a second observable Get. Public JSI lacks a custom constructor seam.
Root rejected descriptor heuristics, private-VM coupling and a Hermes fork;
the ordinary constructor path remains, with normal/custom-object behavior
preserved and primitive-prototype fallback explicitly unimplemented. The
existing surface ticket and packed guide disclose it. The exact expected-
correct regression and failed experiments remain retained, and final reviewers
receive the trade for independent assessment. This decision does not weaken
the original effects witness or claim a complete Intl implementation.

### Final native-content evidence

`02cf5b12` changes only two test files and the existing issue/LLP0067 from
`62241df63`; production and shared Mac inputs are byte-identical. The stronger
number/date assertions pass (11 and nine tests), with two isolated expected-
correct primitive-newTarget tests explicitly ignored as unimplemented. The
parent-content full Hermes suite passed 478 tests across 30 binaries, with
11 pre-existing ignored tests; no-engine passed 188 across 29 binaries with
one ignored test. The combined number/case/date/SQLite suite passed 31/31.
Do not count the two newly deferred cases as passes or claim blanket Intl
conformance from those totals.

The unchanged Snapback engine-effects suite now passes **75/75 plus doctests**
at the final pin: EPYC PID 2150728, 19:37:21–19:37:33 UTC, exit 0. The final
existing release boot-floor executable's dynamic closure contains only normal
system C/C++ libraries, not shared Hermes, ICU, JSI, Boost, curl or TLS. Its
observed floors remain GLIBC 2.39 / GLIBCXX 3.4.30 / CXXABI 1.3.9. This is
the tested Ibex boot-floor executable, not the subsequently packaged Snapback
binary; the publisher inspects that artifact separately.

The [native evidence archive](./ibex2-intl-02cf5b12-evidence.tar.gz) retains
source/hash identity, full/focused/no-engine/clippy/boot results, exact process
receipts, HBC reconciliation, original constructor failures and ELF inspection.
SHA-256: `2130924bdae44952ba3b6f2002b2767f66e04294a64082cbe0c5b9c5f5af4270`.
Root verified every internal checksum after transfer. The complete candidate
Git archive tar stream (not the compressed review capsule) is 185,518,080 bytes,
SHA-256 `8c9483c815b6404614b903b1631174c7595b663eff16f6af9b561c3548cc60ba`.

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
