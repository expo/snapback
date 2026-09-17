# B1c qualification instrument — 2026-09-17

Initial repaired instrument: `95c326e65b9897880b454b29fd1caaa3c008ad04`.
Later source `1b2178f073ea34f948b42f280c06df3cad840a3d` passed the bounded
actual R4 qualification below. That pass is not full Identity qualification. The historical
attempt in [the identity/C3.2 record](20260916-identity-c32.md) remains an
overall failed command with completed primary assertions and zero completed
raw-authority cases.

## Source qualification

The repaired proxy tracks both forwarding-handler completion and response
terminal state. Proof-origin premature abort/error/close stays fatal even
after teardown begins; only the registered committed-mint cut is exempt.
The listener serves empty 503 responses until proof traffic drains. Failure
paths abort tracked forwarding work and connections with bounded cleanup,
retaining the first failure. Raw-case labels follow successful engine cleanup.
The profile assertion compares an independently provider-obtained subject,
not a subject inferred from the result being tested.

Node 24.13.1 ran 18/18 synthetic checks (phase, loopback HTTP and diagnostic
secrecy). The actual staged qualifier tree was `7b2ad55a6`, with the same
source bytes; its serial test log SHA-256 is
`c0f1e2f30b021a3aa15157d04923e1826713d272ad7ef1708b55f73e9045afea`.
Package build passed, log SHA-256
`66f4201f8e38d47d591bfa776cf5ae0ed01d04c428a5efac75b2a6fa9c401baa`.
Both final source-only reviews are READY:
[Sol](../../llp/reviews/3000.009-b1c-proxy.sol.md) and
[Grok](../../llp/reviews/3000.009-b1c-proxy.grok.md).
The earlier capped/cancelled Grok attempts without substantive verdicts are
not reviews. Advisory limitations and original failures remain recorded.

## External staging failure, not a passed rerun

The next attempt's unchanged outer wrapper SHA-256 was
`65613d8b04889fa9f7cc97699f1442da84b7d7862ad15e79edcf2f25e6b1defc`.
Its `SB4_CUSTODY_MODULE` incorrectly selected the fixture's inner Linux
worker-identity helper instead of the full outer process monitor. The inner
helper exports `captureEngineCustody`, `registerWorkerCustody` and
`verifyWorkerCustody`; the wrapper requires `ProcessCustody`,
`processSnapshot` and `CUSTODY_LIMITATION`. It threw
`TypeError: ProcessCustody is not a constructor` before its start/end receipt
could be written. The wrapper log SHA-256 is
`f23fa4970619a7dd1f97aa3364fb88f92895f55d011eb77591d23669633faede`.

The initial supervisor statement that this occurred before child spawn was
wrong: source order spawns the harness before constructing the monitor.
Private scratch `sb4-b1c-rQZrjK` survived under the r2 qualification root.
Source sequence and read-only aggregate state indicate that the detached child
completed the Keycloak primary journey and entered the raw-authority matrix,
but no final harness JSON or outer custody receipt exists. This is inference
from source and retained state, not a complete observed green run, and does
not establish the full raw matrix or proper bounded custody. A later read-only
check found no matching process or engine/proxy listener. No automatic rerun
was performed.

The correct existing outer module is the byte-identical committed
`benchmarks/runs/2026-09-16-workroom-first/protocol/run-pilot.mjs`, SHA-256
`b0ee4a49874f4d5723d431b7bc0f0e6aab6c61b617da1a201938fedcae429498`.
Root read the complete module and verified its direct-execution guard.
Recovery stages it under a distinct outer-monitor filename and checks the
imported API before any child launch. Inner and outer helper roles must be
separately named in the next manifest. New outputs use a fresh private root;
all failed attempt artifacts remain untouched.

## R3: failed deadline instrument order

The corrected outer envelope ran the 95-source harness for 9.803 seconds,
then exited nonzero at `B1C_DEADLINE_TERMINAL_EVIDENCE`. The primary
Keycloak, lost-reply, profile and diagnostic assertions completed; the raw
matrix did not. Public result collection is intentionally read-only, and the
raw fixture has no worker to drive expiry. The instrument incorrectly expected
collection itself to expire the invocation. This was not a proved backend
failure. R3's receipt SHA-256 is
`23097cf6ee47b7ed04b015b688056a030292090582095153fe493115abed6470`.

Source `1b2178f07` uses the normal service/held-lease status endpoint after the
unchanged deadline wait, requires the exact invocation, attempt and terminal
deadline refusal, then performs public collection and the original mint-refusal
assertion. No database write, longer wait or permissive assertion was added.
All 21 affected synthetic checks passed; both original reviewers returned READY
on their own blind delta. Earlier failed attempts remain preserved.

## R4: actual source-bound pass

R4 ran on idle 450b from 06:52:29.915Z to 06:52:52.504Z on 2026-09-17:
22.589 seconds, exit zero, with both `B1C_OUTER_QUALIFICATION_PASSED` and
`B1C_QUALIFICATION_PASSED`. It used Node 24.13.1, the existing isolated
Keycloak provider on 450a, the unchanged qualified binary and package, and
the separately checked full outer custody module. No production provider
account or publication was involved.

Exact evidence:

- Harness source: `1b2178f073ea34f948b42f280c06df3cad840a3d`;
  staged archive SHA-256
  `6c83ac7d354fb9a7556bd4b11020b9c94944a4c5a29ef2a0629680bbb383379f`.
- Binary SHA-256:
  `7342e869fe475e0a4629c36b87f91beac262d4551b769773574903a4cb32f187`.
- Package 0.2.27 dist inventory (60 regular files, GNU digest lines over
  UTF-8-byte-sorted bare relative paths):
  `32c44791e8972306a6ff27f4df84145da4b55a8fc41e30902a44b993e77c79d1`.
  This is an aggregate, not the identity.js file hash.
- Final outer receipt:
  `dd45c97b42c8cc9808fd939a788923aa1d5121fb9ee2c8ccc1e5325c85f23656`.
- Sanitized stdout:
  `5c8b7a5aa370b68b9723d0862910023191b9c0de474f351216559ad3180d30b1`;
  stderr (SQLite experimental warning only):
  `a2c722ca2eec86395a086d401f8ee61e796ba118848c69bba7280f4e98a0d47c`.

The nine observations cover the actual generated Keycloak helper,
post-commit lost reply and worker crash, same-family/same-expiry replacement
with stale-token refusal, provider-derived own profile, default-diagnostic
redaction, explicit first binding with the recovery flag, the executable
stale/parked/cancelled/settled/deadline refusals, admitting/issued-target/service
refusals, and supported-development-clock family expiry. The outer receipt
records eight adopted process identities, zero custody uncertainties and zero
survivors. The private scratch and all failed-run artifacts remain retained.
The provider and tunnel later ended at their own caps without extension.

This pass covers only the executable cases in source 1b. The new before-mint
and after-mint-step crash modes introduced in `b9fdf94dd` and repaired in
`b29d8ea59` have only synthetic evidence so far; actual execution is separate.
Legacy unpublished receipts and production wall-clock expiry are still gaps.

## Remaining-cut source repair and R5 staging

The initial blind reviews of `b9fdf94dd7f7c7a3e2c04bc7ea3c08204366ece2`
were both NOT READY. The bounded repair
`b29d8ea59cdeb06ad4e5e1706ec65b296ad07faf` explicitly binds recovered mint,
second-worker step-completion cut and distinct final worker. Before the second
kill, a joined read-only observation requires the exact durable mint step and
the still-running, unsettled action. Its exact-path/phase selector latches
once and resolves the invocation only after unrelated traffic is excluded.
The helper and product protocol are unchanged.

Both original reviewers' own-blind delta reviews are READY:
[Sol](../../llp/reviews/3000.009-b1c-crash-cuts.sol.md) and
[Grok](../../llp/reviews/3000.009-b1c-crash-cuts.grok.md).
The initial findings and source-grounded refutation of a mandatory third
step-completion POST remain in those records. A completed step returns its
stored result; the helper performs its recovery mint separately. The repair
does not establish a reproduced backend defect.

The final author checks passed 42/42 on Node 24.18.0. At 18:46Z, the exact
19-file fixture archive was staged on idle 450b and passed the same 42 serial
synthetics on Node 24.13.1 in 294.2313 ms, with zero failures/skips. Five syntax
checks passed. The full outer and inner custody APIs were separately imported
and checked before any child launch. The qualified package/binary pins were
unchanged; full runtime/type dependency inventories were retained. No build
or install ran.

- Source archive SHA-256:
  `31695e6e9227ac2aeffd4b8b24bec2be2f98a3e27126211fc19af62c59611e78`.
- R5 prelaunch inventory SHA-256:
  `9c7f5083df50164fba0b1b4ac805d21c86e8045515fb71ae338d9898b13b5121`.
- Node 24.13.1 synthetic stdout SHA-256:
  `43ad32a78c65ab0723cd018164a21d6b7be96fb55f1bffd91c370017aaedb535`.

This is staged, source-reviewed instrumentation, **not an actual R5 run**.
No new engine/provider/process-cut claim follows. R4 and all failed attempt
directories remain unchanged. The next actual attempt requires the bounded
provider/tunnel/outer-custody envelope and a separately inspected terminal
receipt; it is not implied by staging or either review verdict.

## Limits

Known-secret scanning concerns default `why` stdout/stderr only. One profile
and guest observation does not prove provider-revocation/email chronology,
all crash cuts, production-clock behavior or privilege isolation. Sampled
process ancestry cannot catch every double-fork between observations. No
whole Identity/B, Workroom, publication or production-store claim follows.
