# Diary 0090: Expo local-first carrier

**Date:** 2026-08-16

**Run:** LLP 0270 Expo SQLite code landing and supporting qualification tier

**Client:** Expo 57 / React Native 0.86 / `expo-sqlite`

**Provider:** `SnapbackExpoProvider` with an empty publication manifest

## Build entry

The pleasant part was the existing store boundary. Materializations, legacy
entries, outbox settlement, ACK custody, and store metadata already shared one
contract, so the SQLite carrier could reuse the same validators and outbox
state machine instead of inventing an Expo data model. An injected SQLite
namespace also made Node's built-in engine a useful supporting runner without
putting a native import in the universal client package.

The harder part was ownership, not SQL. Expo's convenient exclusive
transaction helper opens another connection, which is incompatible with a
connection-lifetime EXCLUSIVE lock. The carrier therefore owns one dedicated
connection, one non-reentrant JavaScript mutex, and explicit
`BEGIN IMMEDIATE` transactions. Provider acquisition also had to happen after
binding established the canonical origin but before either app-client branch;
branding that async result preserved the user-visible `source: 'default'`
fact while a global refcount kept Strict Mode and multiple roots on one
connection.

Migration was intentionally less convenient than copying JSON. The legacy
file carrier lacks the publication cut, so valid rows still cannot be promoted
into SQLite. Fencing exact predecessor identity, deleting, confirming absence,
and forcing a fresh fetch is more work, but it avoids manufacturing durable
provenance. Pending settlement or ACK custody stays on the real legacy writer;
unreadable bytes remain untouched.

The Node harness made crash cuts and lock takeover fast enough to iterate. It
records the exact `sqlite_source_id()` and proves old-or-new whole-domain
recovery under each observed SQL boundary, but the receipt is deliberately
supporting-only: Node says nothing about the Expo bridge, mobile VFS,
`F_FULLFSYNC`, or true device power loss. Compared with React Native plus
Convex or Supabase, this is substantially more persistence metrology, but
those systems also do not usually ask application code to prove a local
settlement-publication boundary before enabling an offline queue.

The device probe keeps qualification mode loud and separate from the empty
shipping manifest. It can build a release app and direct the seven named
process/power phases, while a missing hard-power witness yields an incomplete
receipt. No Guide-gap ticket was filed: the missing iOS/Android receipts are
the chartered qualification tail, and the code-stage Guide now says so
directly.

## 2026-08-16 review correction

The first review exposed an important difference between a plausible crash
harness and a falsifiable one. Announcing a phase after its write meant the
director could only kill an idle owner. The corrected probe announces `armed`
before the operation, pauses at an instrumented transaction/COMMIT boundary,
and waits for the external kill. The Node tier now uses child-process
`SIGKILL`, while both directors project the recovered store and server ledger
through the same eight-invariant evaluator. A deliberately hybrid store is a
negative control and must fail that evaluator.

Migration had a similar authority lesson. Reading and deleting the legacy
blob directly was not enough even when the bytes were empty: the old writer
could still enqueue between those actions. Reusing the file carrier's actual
writer lock across inspection, successor fencing, deletion, and absence
confirmation made the transition legible and race-free. The durable SQLite
fence, rather than a remembered registration call, now drives every crash
replay. Compared with a React Native app backed by a remote-first service,
this is extra local custody machinery, but Snapback's explicit settlement and
predecessor invariants made the failure modes testable instead of implicit.

The Guide overclaim was real rather than a missing-guide discovery: memory is
volatile, the registered Expo file arm reports `durable: false`, and explicit
`queue: true` refuses. The existing page was corrected and regenerated, so no
new `guide-gap` ticket was needed.

## 2026-08-16 round-2 review correction

The second review showed that evidence closure needs to be executable all the
way down. The admitted target is now the exact runtime cell — OS, OS/API
version, architecture, release distribution, and real-device/emulator class —
resolved by the ordinary Expo environment through React Native plus
`expo-device`. The receipt hashes the installed content of every material
package, including Expo and React Native, rather than treating the probe
manifest as the `expo-sqlite` artifact. This is more exacting than the usual
React Native package-version report, but it makes the eventual publication row
reproducible instead of nominal.

The negative control now earns its name: a child worker uses a broken store
implementation that omits one generation-section write, is killed, and then
runs through the same recovery, settlement/ACK, observation, and verdict path
as the real crash cases. That caught a weakness hidden by the earlier shortcut,
which fabricated a bad observation only at the final predicate. The other
important lifecycle correction was keeping a failed SQLite close registered
and retryable. Losing the registry row after a thrown native close could orphan
an exclusive connection; the typed close-failed state is less convenient but
honest and recoverable. No Guide gap was found: these were implementation and
qualification-falsifiability defects inside the already documented pending
carrier stage.
