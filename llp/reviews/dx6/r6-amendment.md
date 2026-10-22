## 11. Wave-22 loop repairs (DX6)

Commission: Charlie Cheever's wave-22 fixes #5, #6 and #8 (2026-10-22).
Implementer: Codex in sb4-b22-dx6. This amends §10, the staging clock of
LLP 3000.000.000.002 §4, supplied sessions in LLP 3000.036.004 §15.4,
and the starter application of LLP 3000.013.002 §2. SEC7 owns security advice,
intent, campaigns, upload recipes and the password/roles recipe.
This proposal is subject to the requested fresh Muse and Codex reviews.

### Session input and compatibility

Seeded records preserve the actual signup session's kind alongside its
principal, token and numeric expiresAt. They can be passed directly as Session.
Online createClient accepts a legacy incomplete session literal as token-only
transport credentials: its token must be nonempty; partial principal, kind and
expiry metadata never establishes identity, refresh timing or authority. The
server resolves the bearer; session() is null and there is no refresh timer,
as for the existing token option. Complete shapes remain strictly validated
and privately snapshotted. Local/device session input remains complete-only.
E_SESSION lists every missing/invalid field without values and gives the exact
one-line online repair createClient({ url, token }). An ISO expiry in a complete
shape refuses instead of creating a NaN timer. Restored full sessions retain
the existing restore validation and server expiry semantics.

### Advances, maintenance and retained boundaries

ClockAdvance remains an object reporting now/fired/held; valueOf returns now
for arithmetic, ordering and new Date(result). This is JavaScript numeric
coercion, not strict-equality compatibility; typed callers use result.now.

For classified staging, advance(duration) preserves remaining ordinary session
lifetimes by default. The core advances valid full/read session created/expiry
fields, read caps and recoverable mint receipts by the same checked delta,
in the same transaction as existing worker-lease preservation, before publishing
the new process clock. Expired, capped, revoked or superseded authority cannot
become live. Selection uses the authority kernel and bounded pages; overflow
refuses atomically. Existing action delegated sessions and supervised service
families remain owned by the worker-lease path, without double shifting.
Historical admission timestamps are evidence, not an ongoing cap; application
deadlines/backoffs remain business time.

Preservation includes SDK custody, not just raw HTTP credentials. A staging
response for the exact request bearer can publish authoritative session expiry
and read cap beside the same locked business-time/revision snapshot, obtained
through a detached store-identity/liveness-checked authority read. No bearer,
new authority, mint, rotation or refresh is exposed. Production publishes no
such metadata. A failed detached timing read suppresses the clock sample,
including streaming-final samples, instead of publishing advanced business
time with stale credential metadata. A client reconciles only its current
bearer's matching request URL/header and monotonically increases its live
expiry/cap before clock listeners run. Local/device clients await durable
credential custody before publishing or persisting their business clock.
Online clients keep a volatile clock; their existing session listeners may
persist custody asynchronously. Authenticated restoration still validates
expired metadata with the staging probe; no online durability barrier is implied.
Heartbeat final frames carry the same matching-bearer timing or unavailable
evidence as ordinary response headers. Reconciliation and the corresponding
local/device clock publication are serialized: durable credential saves are awaited
before publishing or persisting the advanced clock. A failed save leaves the
clock unchanged, retains dirty credential timing for retry, and surfaces as a
transport failure; rotation/close fences also suppress stale clock publication.
App preparation retains its existing private credential staging: prepared local
clock offsets remain non-durable, including on discard/close, until the actual
App credential commit succeeds. Only then may clock persistence activate before
the scope is published. A later clock-save failure reports a signed-in warning
and retries through ordinary device work; it cannot roll back durable identity.
The existing per-invocation response cutoff (LLP 3000.013 §6 and §12.7) also
spans implicit scope retirement's local credential cleanup. A scope-owned
reference count retains capture before teardown and through each scheduled
local credential task, releasing on rollback or close without waiting for an
auth operation or remote revocation queue.
Capture occurs synchronously when the response decoder validates a body,
before caller Promise continuations can cross that cutoff.
An invocation retains a body validated while live through settlement; a
completed capture owner cannot reopen its cutoff through another begin or hold.
Retention preserves a decoded body, not a stale authentication classification.
An E_AUTH refusal remains scoped to the bearer revision actually dispatched:
rotation supersedes prior and intermediate retiring-bearer revisions, including
when the response was decoded before rotation or arrives after cancellation or
a retryable refresh failure. Recheck that authority when consuming retained
responses. A successor already dispatched during credential persistence remains
current; its own refusal may sign it out. Sign-out alone does not supersede a
same-bearer refusal, and sent outcomes and business refusals retain their ordinary
invocation custody. Retryable refresh failure still permits a same-id retry under
the current credential revision.
Rotated/logged-out credentials cannot be restored by a late response. Client
clocks are isolated, so one bearer's response cannot expire another before its
own timing is reconciled. Read startup verifies before scheduling expiry;
an expired restored metadata image requires a successful authenticated read-only
staging probe with matching viewer/scope and live timing. Production/offline
without this evidence keeps the existing expiry refusal. The local constructor
reconciles bootstrap timing before applying a restored device clock's expiry
check. Tests retain actual read clients and restore them across their old
absolute expiry, compare two independent bearers, and exercise explicit-expiry
and production controls. These headers are staging timing evidence only;
ordinary authority is still checked on every server admission. Real elapsed time still consumes
credentials. sessions:'expire' explicitly tests expiry with the existing
business clock. Dev retains its existing expiry behavior. Production rejects
all clock controls and never calls preservation. Restart keeps the persisted
credential timestamps and drops only the existing process-local business offset.
This intentional staging-only simulated jump also shifts a read family's cap;
ordinary production read-cap immutability is unchanged.

advance(duration, {drain:false}) advances time and pauses background maintenance
before releasing the writer. This covers expiry sweeps, scheduled enqueue,
queued job chunks, asset collection, view recount and delivery maintenance,
so a mutation can exercise its own deadline check. Authorization and logical
row expiry still apply to ordinary queries/mutations. The pause lasts until
host.drain(), another draining advance, or process restart. drain() uses the
same authenticated endpoint with duration:'0ms', drain:true, advancing no time
and resuming normal coalesced maintenance. eachBoundary requires drain:true.
The HTTP report includes maintenancePaused; native CLI spells these controls
clock advance D --no-drain and clock drain. Failed/ambiguous requests are never
automatically replayed. A failed drain leaves its advanced time intact, its
report explicitly incomplete, and maintenance paused. Only a successful explicit
drain resumes it. drain() advances no time and safely continues existing queued
work/checkpoints; never repeat a lost advance to obtain that recovery.

A saved boundary is future-held only when it is strictly greater than the
boundary of the requested effective schedule window. Equality means that the
current window was already processed: report not-due, without consulting wall
time. Repeated advances inside that window and zero-time drains succeed without
allowHeld, including recovery of queued work after a failed drain completion.
Never enqueue the processed window again.
A draining advance whose saved future boundary blocks requested work refuses
E_CLOCK_HELD before clock, session or lease effects. The refusal names the
schedule, saved boundary, next unprocessed window and recovery duration to
reach the saved boundary from the unchanged process clock, not from the rejected
requested time. Relative recovery hints in accepted reports likewise use the
actual process clock, including when a disclosure floor is ahead of it.
A held report sets heldUntil to that saved boundary and
nextBoundary to the next unprocessed boundary. Catching up to heldUntil
reports not-due and never re-enqueues the processed window; reaching nextBoundary
fires once. Fresh staging storage and continuing with the original offset are
recovery choices; saved markers never rewind. allowHeld:true (CLI --allow-held) explicitly accepts a
retained boundary. Intentional drain:false pauses and dev --hold-schedules are
explicit holds. not-due/initialization remains a successful reported outcome.
Control authorization/classification is checked again under the actual writer.

### Upgrade advice and future formats

Advice is scoped to actual version transitions and each behavior's introduction
version. A fresh init/check is silent. Delivered stderr is acknowledged durably
for non-TTY callers too; baseline checks neither emit nor acknowledge advice.
The new upgrade helper retains warning stderr even under --quiet. Published
older quiet CLIs discard their check child's stderr without signalling this;
that historical capture cannot be distinguished from normal non-TTY delivery.
Advice from that old quiet path may therefore be acknowledged without display;
guide changes remains available. No ancestor
process inspection or script mutation is introduced.

The bounded candidate scan covers partial session literals and numeric advance
uses, explicit persistent startDev calls and data --json consumers. Explicit
nearby refusal assertions do not become dev-door warnings. Candidate paths,
never source or credentials, are printed; incomplete scans remain disclosed.
Future known-family store formats refuse with 'a newer Snapback (FORMAT)'.
Read-only SQL inspection validates the format before exposing rows and exits
nonzero on refusal. Already published old binaries cannot be repaired.

### Starter and proof rendering

Both list starters render through the packaged ReadState. Proven absence and
partial empty results retain distinct text, with existing freshness and
pagination semantics unchanged. Rename the docs' local ReadState example to
ReadNotice so it does not shadow the export. Password clients omit persona
selection and explicit web witness/generated API imports. The proof driver installs the
existing witness bridge before app creation; createApp calls an immutable Symbol observer only under explicit witness=web.
This is a public same-origin test channel, not a secret or an authentication
boundary. A witness URL alone installs no observer and exposes no App global.
The driver installs its nonconfigurable/nonwritable observer before application
scripts and locks/freezes the selected witness bridge; the first App remains
selected for that page. Same-App explicit API registration can enrich it;
a different explicit App refuses E_WITNESS_APP_SELECTION and requires a separate
page. Later automatic Apps cannot silently redirect the proof. Application JS
remains trusted to implement the application: same-origin code can forge its
own test observer outside a driven page, just as it can read web session storage.
The observer grants no new credentials or backend authority. Ordinary bundles
carry only the creation dispatch, not the witness implementation. No-API
registration captures only durable non-ephemeral mutation handles; direct
witness mutate still requires generated API.

Proof text locators match normalized entire descendant text, including composed
React Native spans and wrapping labels. Choose smallest matching visible,
non-editable elements; independent matches retain strict Playwright ambiguity.
Whitespace normalization collapses runs and trims both ends; case is preserved,
with no Unicode normalization or input value matching. Exact strings are case-sensitive;
explicit substring strings are case-insensitive and regex follows its pattern/flags.
String matching stays exact by default; substring is explicit, never a silent
fallback. A composed label cannot make an unrelated sibling count as success.
Text ranges outside overflow clips do not contribute evidence to a visible
ancestor. Layoutless wrappers may forward their visible descendants; a clipped
suffix cannot manufacture a complete status label.

### Required evidence and review

Unit/HTTP/browser tests cover safe legacy input, seeded account sessions,
non-TTY warning receipts, fresh init, refusal tests, future formats, numeric
coercion, saved-boundary no-effect refusal, maintenance pause/resume and session
preservation versus explicit expiry. Execute changed guide snippets and all
changed starters against the fresh packed tarball, including upgraded copies
of wave-21 025 acceptance and 002 prod:serve. Record three copied wave-22
frontend non-whitespace counts before/after, preserving app behavior.
Run complete crate tests, affected client and assigned Mac Studio tests,
qualify-linux consumer qualification (full test.sh is explicitly prohibited),
refs, docs budget and repo-root checks. Report exact results and limitations
in WORKSTREAM-REPORT.md; no version bump or push. Review readiness and factual
implementation status are recorded separately from author acceptance.
