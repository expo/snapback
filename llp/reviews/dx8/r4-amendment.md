## 10. Wave-25 day-two friction (DX8)

Implementer: Codex / Charlie Cheever, 2026-10-23. Commission: wave-25 fix list
8b #1–#13, building on DX7 and Integration 23/24. This amendment is a reviewed
implementation commission, not author acceptance or a publication claim.
The no-JavaScript migration, atomic activation, job-meter and row-lifetime
custody laws above still apply. Integration 23 owns rollback-view selection and
its trigger; SEC9 owns column-write authority, security gates and adversarial
campaign reach. DX8 changes neither of those lanes' policy.

### Migration interpretation and current-value renames

Backfill arguments and lookups read the assembled pre-patch snapshot, before
any simultaneous rename/backfill writes outputs. Historical argument names
therefore name predecessor fields. A declaration's immutable meaning is its
normalized typed-IR digest. Every changed-meaning refusal, both continuously
carried and after a historical gap, prints old and new full digests. A new name
is a new declaration; pruning does not reset names or immutable definitions.
Prune previews name known down projections whose native/reverse or overlapping
forward-preimages they discard. This warning is privileged operator output;
prune remains explicit and destructive, and unavailable evidence still refuses
subsequent reversal/re-entry. Preview never mutates live history.

For the generated `$rename:down` with identical declared old/new scalar types,
the current renamed cell outranks its non-null retained predecessor cell. This
is an identity spelling change, not a historical computation: v1 must see the
edited v2 quote, not the original quote. Stage it on the existing newer snapshot
and preserve native/reverse evidence in the same transaction. Repeated
rollback/forward cycles retain that current value. Different-type renames still
refuse even when sample values happen to fit. Authored down projections retain
their exact forward-preimage/non-null-native precedence; a generated rename
does not grant another declaration permission to replace protected cells.
Conflicting edits under an older view still require an explicit bridge where
existing receipt custody cannot reconcile them. The change stays isolated in
backfills.rs; it does not alter rollback views or release bridges.

### One child per list element

`extract CHILD from PARENT via REF each: {destination:sourceList}` extends the
existing one-child extraction. Exactly one mapped destination is a required
scalar image/file/video; its historical source is a bounded list with an
identical element type (optionally a nullable whole list). Other mapped fields
retain the existing immutable authoritative scalar-copy law. Empty lists create
zero children. A null whole list remains null after an unchanged empty cycle;
a populated child set becomes a real list. Duplicate asset elements refuse:
one asset cannot acquire two child homes. Unsupported types refuse, never copy
or reupload bytes. Default `extract` keeps its existing whole-cell behavior.

Per-parent element receipts bind current asset IDs to stable child lifetimes
and ordinal positions; new historical elements get deterministic child IDs,
independent destination history refuses. Current child asset edits keep their
child ID. Reverse selection gathers every extant child, including native v2
children with valid captured parent-lifetime evidence, preserving receipt order
and appending native children in ID order. It moves current homes back into the
old list and records the current element-to-child map. Returning forward follows
that map, so old-client reordering preserves child identity and appending a new
asset creates one new child. Removed elements mark their receipt-owned child asset absent (an internal null),
leaving the retained child outside the active population under ordinary narrowing; they do not
silently regain an asset or get deleted. A target list that cannot represent
the full current population follows ordinary narrowing, never truncates it.
Every receipt-owned child and its parent-lifetime evidence is validated before
either forward or reverse processing, including removed elements and intact
dormant nulls. A missing/pruned receipt-owned child or invalid parent lifetime refuses rather
than recreating history or recapturing a reused parent ID. Reverse selection
refuses atomically if a populated child asset home remains in narrowed storage;
it names the retained population and requires a loosened child-domain bridge
that restores those rows before selecting old source. Migration-owned null
removals have no live child asset home and stay dormant across repeated cycles.

A successfully applied element extraction records durable definition custody,
including an empty initial population. Temporarily retiring its child table or
declaration suspends that law when the selected parent no longer declares the
source list. Re-entry with the same definition resumes current child rows and
homes rather than demanding or replaying the consumed list. It validates every
receipt and every restored/current child's existing parent lifetime, captured
authority, immutable scalar copies, ledger home and bytes; it never retroactively
captures independent children born while the declaration was absent. Missing
source plus unknown definition refuses. New parents created while the child
table is retired can have zero children. Ordinary narrowed storage remains
retained; no row or home is synthesized. Resuming, as every activation, is atomic
and metered with the child page and parent image sharing its job allowance.

Source/destination read authority and column gates retain the existing strict
extraction checks in both directions, including captured parent-authority agreement. One extraction owns each child table, avoiding competing sources for native children. No user migration endpoint or broader
asset audience is introduced. Per-parent traversal/allocation/writes use job
meters; a cut aborts the entire activation. Home transfers, row changes,
receipts, ordinary reference/narrowing/uniqueness/cap validation and generation
publication share the existing writer transaction. Successful adoption fences
this law with release-store format 10, including after selecting old source;
formats 8/9 remain readable and failed adoption does not upgrade their marker.
No successful later adoption downgrades the marker. Serialized schemas carrying
`each` also require `release-child-extraction-each-v1`, so older engines refuse
the new interpretation before accepting a compiled schema.

### Operator processes, development clock and real accounts

`snapback4 stop <deployment-dir>` uses the existing same-owner authenticated
local release-control channel, then awaits the kernel lock-release barrier.
Already stopped is success. An unverifiable/live foreign owner refuses: never
unlink a lock or signal a guessed PID. Proof hosts/frontends/tool commands own
an explicit process group, including npm wrappers and children. Stop, failure
and parent exit release that entire owned group through live keeper/pipe
custody; cleanup is bounded and cannot silently leave a serving descendant.
Processes deliberately leaving custody are outside that promise. Scripts whose
stdout is one JSON line use `npm run --silent`; logs remain separate.
Changelog/help qualification treats `run` immediately following npm/bun/pnpm
as that package manager’s subcommand; later explicit Snapback invocations
on the same line still advertise flags and remain checked.

A password-authenticated development host exposes clock status/advance with
fixture/persona doors closed. It requires an exact full `service:operator`
bearer token minted through the existing local store authority. Ordinary users,
other seats, read-scoped sessions, unauthenticated requests and production
hosts cannot use it. Staging keeps its existing full-service-seat authorization;
explicit unsafe development and guest-schema development retain their existing local fixture behavior.
Authenticated development jumps preserve live full/read session families and
worker leases by default in the same store transaction as the jump's durable
authority effects; expired/revoked families never revive. Explicit
`sessions: 'expire'` requests expiry testing. Header/SDK reconciliation keeps
current clients alive across the jump. The development offset is process-local
and returns to wall time on restart; staging retains DX7's persistent checkpoint
and paused-drain behavior. A failed/ambiguous jump is never automatically
replayed. `startDev` exposes operator-backed now/advance/drain without opening
fixture doors. Production uses wall time and refuses clock control.

`provisionAccounts` shares seedAccounts plan validation, generated credentials,
identity retry/deadline behavior, result shape, selected seat and provision
mutation. It accepts production through real signup/login and
ordinary authorized mutations; it refuses development and uses no seed/system
bypass; staging continues to use seedAccounts. Custom per-user args retain seedAccounts' existing merge precedence.
A minted service seat is only that exact principal, not a superuser. The served schema exposes `service_identities`, a list of explicit positive
viewer/service equality facts and declared route/schedule seats, excluding result
and enum literals. Both local CLI minting (live or stopped) and the production
helper warn on stderr when a seat has no matching explicit authorization identity.
This is conservative diagnostic evidence, never a proof of admission or denial;
public rules and dynamic application roles still decide actual authority. The mutation's actual read and write rules decide.

### Inspection and saved artifacts

Default active sql/data/releases announce the retained dormant row count when
nonzero. Missing active-table errors identify a retained table and its row count
and name a concrete dormant inspection command. Inspection remains a privileged
read-only consistent snapshot, outside application rules. Only direct,
schema-proven media cells in `sql --json-objects` decode to their ordinary wire
JSON values; positional `--json` remains compatible. Truncation and dormancy
notices go to stderr, preserving JSON stdout; existing limit/more fields stay.

An identical-source deploy with --save-version can refresh an existing saved
version only if the complete Quarry source set and exact bytes match. Differing
source refuses. Generated client artifacts are emitted from that saved source's
Bound, independently of the working tree; fixtures/source evidence stay intact.
Refresh follows successful adoption/no-op and records the correct retained
release identity. Replaying an old source never silently emits the current API.

### Paging, proof assertions and contract advice

Board/roster starters and list recipes use newest-first `last N by .id`, while
explicit oldest-first examples remain labelled. The language's ordering default
does not change. Cursors are opaque evaluator-issued positions: send next back
unchanged; a row id/projection is not a cursor. `exhaustPages(readPage)` begins
with null, gathers array pages, follows next, and refuses denial/loading,
malformed/repeated cursors or its explicit page bound. It never turns a capped
or partial read into complete evidence. Projections change fields, not cursor
meaning/order/completeness.

Day-two recipes compare by stable id across stages and declared common fields,
not list position or whole differently-shaped row images. IDs created by a
frozen v1-client replay are recorded and excluded from preservation baselines.
V2-native IDs may be absent from an exact v1 view; they must reappear unchanged
on forward. Domain-specific synthesized old values need an authored projection
assertion, not an equality claim for incompatible representations.

renderedText(..., null) equals omitted options. Whitespace normalization,
case-sensitive exact matching by default, explicit substring matching and DX7's
legal scroll reachability remain unchanged. The lane-031 full-line regression
must match mounted reachable `Pump logged.` text, without widening hidden clips.
Write-authority hints explain that a mutation require and the caller's table
rule are separate gates. The captured-vs-live-parent card describes existing
lifetime/audience semantics; it grants no new authority.

Old-client INPUT BREAK advice follows accepted wire identities, including
references through declared table renames and lowered aliases/defaults. Real
removed/required/narrowed inputs still warn. Pure object-result field additions
are RESULT NOTE, not RESULT REVIEW or an adoption hazard; changed/removed fields
and domains retain review. These remain conservative advice, not a proof of
unchanged business behavior. No runtime input validation is weakened.

### Required evidence

Tests cover edited historical/native renames over repeated cycles, identical
and incompatible types, authored-down precedence, continuous/gapped digest
refusals and read-only prune warnings; authenticated dev clock with fixture
doors closed, real SDK sessions and expiry mode; graceful/foreign/idempotent
stop and npm descendant cleanup; production real-account provisioning and seat
warnings; media/truncation/dormancy inspection; saved-source client refresh;
additive results and renamed-reference input advice; list fan-out over edited/native children, old-client reorder/append, empty/null lists, invalid lifetimes, duplicate homes, pruning and atomic refusals; paging progress/failures,
null/full-line rendering and newest-first starter execution. Every changed
guide/starter snippet runs as written against fresh packed artifacts.

Before completion, replay the relevant wave-25 commands on copied stores
without owner/token files and delete scratch. Run the requested five-crate,
client, difftest, packed Linux, wasm/docs/reference and root guide/inventory
checks. Report original failures and scoped reruns independently. Mac is skipped
per the coordinator; integration owns it. Both required independent families
must review the same frozen amendment as READY, with verbatim provenance.
