

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
deadlines/backoffs remain business time. Real elapsed time still consumes
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
automatically replayed. A failed drain leaves its advanced time intact and its
report explicitly incomplete; pending maintenance may continue normally.

A draining advance whose saved future boundary blocks requested work refuses
E_CLOCK_HELD before clock, session or lease effects. The refusal names the
schedule, saved boundary, next window and recovery duration. Fresh staging
storage and continuing with the original offset are recovery choices; saved
markers never rewind. allowHeld:true (CLI --allow-held) explicitly accepts a
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
the upgrade changelog and explicit upgrade scan remain available. No ancestor
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
selection and explicit witness/API imports. The proof driver installs the
existing witness bridge before app creation; createApp calls a private Symbol
hook only under explicit witness=web. Ordinary app bundles do not include the
bridge. The callback adds no credential or backend authority; it observes the
same authenticated App and ordinary mutation admission. Existing explicit
registrations remain valid. No-API registration may capture only durable
non-ephemeral mutation handles; direct witness mutate still needs generated API.
Multiple app lifecycle and cleanup must retain the existing ownership semantics.

Proof text locators match normalized entire descendant text, including composed
React Native spans and wrapping labels. Choose smallest matching visible,
non-editable elements; independent matches retain strict Playwright ambiguity.
String matching stays exact by default; substring is explicit, never a silent
fallback. A composed label cannot make an unrelated sibling count as success.

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
