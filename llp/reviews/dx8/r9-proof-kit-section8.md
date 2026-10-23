## 8. Wave 12: honest and bounded proof kit (KIT)

Author authorization: the wave-12 KIT workstream (2026-10-14), fix list 1 and 14,
H4/H7/H8. This amendment supersedes conflicting helper/starter defaults in §§1,
3 and 5; no language, planner, protocol, authorization, sync or expiry changes.

The witness global installs on every registerWebWitness call in a browser.
Claiming/mutate sample ?witness=web at registration and retain that arm across
same-document routes; each new registration samples its URL again. Disabled calls throw E_WITNESS_DISABLED
with the URL repair. beginForm(name, expected | null, button) admits the actual
trusted click and the synchronous submit it causes, keyed to that submitter.
A later task, another submitter, or script click cannot borrow provenance.
The first unclaimable durable mutation resolves failed/E_WITNESS_UNCLAIMED with
an event, operation or canonical-argument reason; it still executes normally.
Expected arguments compare exact canonical JSON including explicit nulls; null
skips comparison. Sent settlement still observes the SDK write id, outside UI
lifetime. A form with no write remains subject to the caller's bounded deadline.
Rearming cancels the old observer. The testing card carries the 15-line contract.

withBrowser launches over Playwright's pipe, opening no TCP listener. Accept the
caller's chromium BrowserType so its matchers receive its own objects. Use an
optional playwright-core peer (>=1.55.1 <2), required for browser helpers, with a
pinned development version. Playwright owns browser process/parent-exit cleanup;
context and browser closes remain bounded. Static exports validate their index
before starting a keeper, so missing-export diagnostics survive group cleanup.
Native/frontend retained-child
custody is unchanged. cli dispatches through the installed JS wrapper for every
published verb. No npm/npx/shell runner is introduced.

renderedText excludes inputs/textareas and accepts a container. waitForFresh
accepts a container while retaining its existing locator/timeout signature.
frontPage activates the page before screenshots. logsDir defaults to an OS
scratch directory outside Exact app/; explicit artifact paths are honored.
The guide adds container scope, disjoint status/row text, no input-value evidence,
and persona-roster seeding with /dev/reset {seed}, plus frontPage guidance.

Every generated frontend proof must observe a fresh terminal durable write and
rendered output. A custom Home without a writer fails with exactly
"no write scenario: replace the Home assertions"; adaptation prints that repair.
Published templates get a concrete write scenario. day2:proof passes
versions/v1 versions/v2; init stores complete current-schema copies outside
snapback/. They are starting snapshots for the builder's real next release.

Single-port inclusive ranges remain valid for schema-only init and individual
proof hosts. UI init needs at least two runtime ports and refuses a single-port
range before writing, because its backend and frontend run together.
PORT_LO/PORT_HI at init are baked into defaults, after explicit port/range flags;
at each launch/config load a current pair overrides those defaults. init reports
exactly the URLs written, even when explicit flags override its environment. Vite and
client environment fallback agree with launchers; --adapt --apply rewrites only
recognized generated legacy literal scripts/configs. Explicit --port defaults
remain available when no runtime range exists. Existing package name/version
remain unchanged. Dependency installation stays explicit: init ends in one bold
npm install line. Bare --adapt (and --dry-run) writes nothing, including proof
files, README and package metadata, then ends with the exact shell-quoted
--apply command. Only --apply mutates recognized files.

Linux packed-starter qualification adds a custom-schema negative proof, a listener audit throughout
every browser proof (proof-owned TCP listeners must stay in PORT_LO..PORT_HI),
and a real form onSubmit write. Read-only listener inspection is scoped to the
proof process tree, never other shared-host lanes. On Linux the audit uses
`strace -f -q -z -yy -e trace=listen`: every successfully returned TCP listen observed by the proof-scoped tracer must resolve its
local port inside the range, including resumed syscalls; unresolved or incomplete
traces refuse. This avoids /proc/fd permission gaps in short-lived Chromium
sandbox helpers without skipping processes or sampling away short listeners.
strace 6.8+ is a qualification-host tool, never a client dependency. The host
preflight refuses older/missing tools before builds; receipts record its version.
Process exits remain visible (-q); the successful-only filter (-z) selects
completed calls. A precisely matched `???(` fragment with no return can occur
when the live keeper is killed. It is accepted only after read-only /proc
corroboration that its process is absent or a zombie, and is retained in the
receipt's nonReturned diagnostics. A live/uninspectable process, any unknown
returned syscall, an unresolved successful listen or an incomplete named listen
refuses. No process is signalled by this audit. This is observation of successful
listens during the proof, with the decoder's non-returned exit records explicit.
DX8 adds one corroborated trace-decoder case: an `outer ???(inner listen(...)`
record may be ignored only when the immediately following nonempty record is
the byte-identical ordinary `inner listen(...)` record. That ordinary record
still undergoes every PID, syscall-result, TCP-address and port-range check.
Missing corroboration, unresolved listeners, out-of-range listeners and other
unknown returned forms still refuse. This recognizes a duplicated strace
representation; it does not omit a listener or expand the admitted port range.
Darwin consumer qualification
still runs the same write/negative cases and explicitly records the listener
audit as not-run; it cannot provide Linux listener evidence. The repository's
`listenerSnapshot` also requires Linux explicitly; its browser assertion skips
with a reason on Darwin while caller-Playwright and rendered-page assertions
still execute. It is not imported or packed by `snapback4/proof`. Synthetic trace
decoding remains portable: non-returned records use `/proc` to recognize Linux
zombies, and a read-only signal-0 existence probe elsewhere; live or
uninspectable PIDs refuse. Non-Linux zombies conservatively remain live.
The client pool statically checks direct Linux APIs and static named/namespace `.mjs`
helper calls for scoped gates (including `/proc`, `strace`, `ss` and affinity
commands). This is a common-case guard, not arbitrary JavaScript analysis;
dynamic/generated paths still need review and affected Mac execution. Retain baseline 0.4.28 reds
and candidate greens separately; no complete publication or npm claim follows
from consumer-only qualification. SURF owns general help generation; REL3 owns
fixture/dev-door testing text; RULES2 owns hidden-row testing text.

### Wave-12 implementation and verification (2026-10-15)

Implemented in KIT commits 155bc71f0a through ac219032c3. The final product
revision has independent [Codex round7](./reviews/3000.011.003.000.000-wave12-kit-r7.codex.md)
and [Muse round6](./reviews/3000.011.003.000.000-wave12-kit-r6.muse.md) READY verdicts.
The final custom-fixture correction has independent [Codex round8](./reviews/3000.011.003.000.000-wave12-kit-r8.codex.md)
and [Muse round7](./reviews/3000.011.003.000.000-wave12-kit-r7.muse.md) READY verdicts.
Earlier findings and responses remain verbatim with provenance.

Fresh packed consumer qualification at ac219032c355d7c55ed8991fa85a409e955d6ceb
passed 28 positive browser writes and two expected custom-schema no-write
failures, with thirty passing listener audits; the custom web writer is actual
form onSubmit. Ubuntu24.04 and Alpine installed round trips and all six starter
toolchains pass. Baseline0.4.28 controls separately demonstrate all three H8
failures. Affected Rust/client tests, ref-check, docs budget and both root gates
pass. Exact source/bytes, commands, test results and preserved failed attempts
are indexed by [qualification.json](../snapback4/reports/20261014-wave12-kit/qualification.json)
and [the workstream report](../WORKSTREAM-REPORT.md). Consumer-only evidence
records suite not-run/publicationQualified false; nothing was published or pushed.

