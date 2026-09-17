# B1c qualification instrument — 2026-09-17

Final instrument source: `95c326e65b9897880b454b29fd1caaa3c008ad04`.
This record is not an overall actual-provider qualification. The historical
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

## Limits

Known-secret scanning concerns default `why` stdout/stderr only. One profile
and guest observation does not prove provider-revocation/email chronology,
all crash cuts, production-clock behavior or privilege isolation. Sampled
process ancestry cannot catch every double-fork between observations. No
whole Identity/B, Workroom, publication or production-store claim follows.
