# B1a actual-provider qualification fixture

This fixture uses ordinary generated actions and the one supervised `dev`
process. It adds no callback or backend listener. Its fixed development
configuration is the parent-provisioned Keycloak 26.7.4 realm:

- issuer `http://127.0.0.1:38971/realms/sb4-b1a-20260917`
- confidential client `snapback4-b1a`, code flow only, S256 required
- frontend callback `http://127.0.0.1:38972/auth/callback`
- frontend origin `http://127.0.0.1:38972`

Copy the `snapback/` directory into a disposable application, install this
workspace package, supply `OIDC_CLIENT_SECRET` to `snapback4 dev`, and run
`check` before `dev`. The browser first creates a real guest session, creates
and retains at least 32 random bytes as its binding secret, sends only
`base64url(SHA-256(binding))` to `beginOidc`, and navigates to the returned
authorization URL. The frontend callback then POSTs `{ code, state, binding,
error: null, iss }` to `completeOidc` with that same guest session, preserving
the RFC 9207 `iss` response parameter when present. It adopts only
the returned standard `Session`.

`qualify.mjs` is a credentials-gated actual-provider witness for this exact
fixture. Run it with Node 24 while the generated app is live, setting
`SNAPBACK4_OIDC_QUALIFICATION_CONFIG` to an outside-repository mode-0600 JSON
file and, if needed, `SNAPBACK4_URL`. It drives Keycloak's browser login form
and code flow without starting a callback listener; it never uses a password
grant and emits no credential, code, binding or session value. It also proves
the returned Session on an ordinary generated query, logs that token out, and
checks that revoked/unrelated guest authority cannot collect the completed
action result.

Do not commit or print the client secret, binding, authorization code, provider
tokens, or returned session. No provider credential is stored in this
repository; the dated Journal records the local external-credential witness,
which a downstream checkout does not inherit. Google qualification remains
credentials-pending. The deterministic signed provider in
`test/identity.test.mjs` is a protocol double, not actual-provider evidence.

The prior actual-provider record used the published 0.2.26 engine and qualifies
only the B1a healthy path described above. That engine predates the bound
session-mint wire and must not be used to run a B1c flow: it may silently take
the legacy unbound mint path. Unpublished prototype `oidc.mint` receipts do not
migrate: the current helper binds `protocol: "oidc-mint-bound/v1"` in the step
input, so either a started or completed old-input receipt refuses before any
mint request. It leaves an existing legacy unbound token untouched; use a fresh
login and fresh action invocation to enter the bound protocol. B1c's actual
repaired-engine primary lost-response/process-crash path completed, but the
historical command then failed before its raw authority matrix. The complete
outcome and limitations are in the [integration record](../../../../../reports/20260916-identity-c32.md).
Google
credentials remain absent, so Google, production HTTPS and a real browser are
also unqualified.

The B1d.1 recipe now binds the helper's issuer/subject-derived principal to a
service-written trusted profile in the same mutation that settles the matching
transaction. Its service-only counter assigns login-start order, and managed
`now` stamps the proof start; callers supply neither. A fixed five-minute
window makes only a present email with `email_verified: true` eligible. Newer
false, missing or unverified evidence clears eligibility, while an older
delayed completion cannot replace newer evidence. Profile reads are own-only
apart from the recipe service. The mutation grants no membership, performs no
email uniqueness/linking and provides no editable verification field.

Login-start order is not provider email-change chronology, and another login
is required to observe provider revocation or email changes. A pre-B1d
`identityVerified` write receipt has different input because it lacks the
required derived principal; it fails closed and is not migrated or backfilled.
Use a fresh login/action invocation. Provider recovery and the organizations-
and-invitations recipe remain later identity work; this fixture is not full
Identity/B.

The in-package signed-provider protocol double additionally exercises the v2
marker, public-metadata discovery reconciliation, conservative refusal of an
unfinished legacy exchange without that marker, and the non-reconcilable
one-time token phase. In particular, discovery failures before any token POST
can recover, while a JWKS outage after a consumed code parks without another
POST. Those deterministic assertions do not add actual-provider or repaired-
engine evidence to this fixture.

## Prepared B1c real-engine qualification

`qualify-b1c.mjs` is a diagnostic harness for the final parent-supplied B1c
package and repaired Linux binary. Its current two-stream secrecy revision
has not been executed against a provider; the historical partial result is
recorded below. It is deliberately not
compatible with the published 0.2.26 binary. In addition to requiring the
executor's expected SHA-256 digest, it exercises the bound wire itself; an
unbound legacy engine cannot satisfy the fixed-expiry/family and stale-claim
assertions.

The generated-helper portion uses actual Keycloak once. A qualification-only
injected fetch sends worker-to-engine HTTP through a parent-owned loopback
fault proxy on `127.0.0.1:38974`. Provider fetches remain direct. After the
actual engine returns the first committed bound Session, the parent keeps that
Session only in memory, closes further provider access, verifies the reporting
PID's registered Linux `/proc` UID, start-time identity and finite ancestry
belong to the owned engine, revalidates that exact custody immediately before
signalling, kills that PID, and drops the reply. The replacement attempt must
use `replaceLostDelivery: true`, the same invocation/intent/immutable inputs
and one completed provider code exchange.
It must preserve expiry, replace inside the inspected original family, make
the old bearer fail `identityWhoami`, and make the returned bearer pass it.
The proxy is a fault instrument, not an application backend or provider
double.

The proxy has an explicit fail-closed lifecycle. Requests accepted during the
proof retain that classification through late socket and upstream outcomes,
including outcomes observed after teardown starts. After the Keycloak
assertions and two-stream diagnostic check, the harness checks the retained
failure latch, stops admitting proof traffic, answers newly arriving
background or polling traffic with a fixed empty 503, and allows already
active proof requests up to 30 seconds to finish while the engine remains
live. It then closes proxy connections before stopping the owned engine. A
drain or close timeout is fatal. Proxy failures expose only a fixed
phase/category code; exception text, paths, URLs, headers and bodies are not
included. The response deliberately destroyed by the registered post-commit
fault is the sole narrow expected proof cut.

The authority portion uses a separate disposable app without a generated
handler. It drives the actual engine's service-authenticated action, step,
session, cancellation, revocation and development-clock HTTP doors directly.
It never writes SQLite. Internal family and plaintext-absence assertions open
the store read-only with Node 24's SQLite API because the public `sql` command
correctly hides internal tables. The expiry row is development-only: it
requeues the long-deadline invocation before `clock advance +25h`, then obtains
a fresh current claim while the admitting guest and 30-day service authority
still stand. It does not infer expiry from a stale held lease. `serve` and
production/release clocks remain wall-only.

Run only on the isolated Linux executor after the parent has assembled and
reviewed the final package and binary. Every path must be absolute. The
private parent and credential file must have no group/other permission bits;
the harness creates one marker-owned mode-0700 child beneath it. That directory
is deliberately retained after both success and failure for root-controlled
evidence extraction and cleanup. Its engine databases contain protected action
arguments and the legitimate final protected Session result: the directory is
a private diagnostic workspace, never a public artifact.

The command below is only the harness payload. Do not run it bare. The parent
must place it inside an external ProcessCustody envelope with a hard five-minute
whole-run deadline. That envelope must register the harness and its owned
engine/worker descendants and clean up those registered owned processes on
timeout. The harness has no internal whole-run cap. ProcessCustody invocation
syntax is intentionally not invented here; the parent supplies and owns the
envelope.

```sh
PATH=/absolute/path/to/node24/bin:$PATH \
SNAPBACK4_BIN=/absolute/path/to/final/snapback4 \
SNAPBACK4_B1C_BINARY_SHA256=<64-lowercase-hex-from-parent> \
SNAPBACK4_PACKAGE_DIR=/absolute/path/to/prepared/packages/snapback4 \
SNAPBACK4_TYPESCRIPT_DIR=/absolute/path/to/node_modules/typescript \
SNAPBACK4_NODE_TYPES_DIR=/absolute/path/to/node_modules/@types/node \
SNAPBACK4_QUALIFICATION_PRIVATE_PARENT=/absolute/private/mode-0700-parent \
SNAPBACK4_OIDC_QUALIFICATION_CONFIG=/absolute/private/mode-0600-keycloak.json \
node ./snapback4/packages/snapback4/test/fixtures/identity-recipe/qualify-b1c.mjs
```

The harness is Linux-only and refuses to start without `/proc`, the current UID,
or free ports 38973 and 38974. It never starts, stops or
kills Keycloak, a tunnel or a process selected by name. It starts one owned
engine at 38973, captures the engine's UID/start identity, and registers each
worker's UID/start identity and ancestry on first observation. Immediately
before the fault SIGKILL it re-reads both identities and the ancestry and also
requires the worker PID in that engine's log. This sharply bounds custody but
does not claim to close the kernel-level PID-reuse race between the final read
and `kill(2)`. The harness terminates only owned children. It never emits
the client secret, credentials, provider code, state, browser binding, PKCE
material, action lease or Session bearer. Its only output is one structured
JSON object: status, stable code, known stage, validated retained-scratch path,
and non-secret digest/observation/custody fields. Unexpected exceptions map to
one generic stable code; arbitrary error messages, stacks and HTTP/provider
bodies are never printed. Before scratch creation, the path is null.
Owned-child cleanup treats either an exit code or signal code as terminal,
subscribes before signalling to avoid missing exit ordering, and bounds both
the exact owned child's TERM and KILL waits.

### Fault and observation matrix — source checkpoint

The table describes source coverage. All rows remain **PENDING for this
corrected revision** until the parent executes it against the combined Linux
artifact. The earlier `682a834d5` primary assertions completed, but its command
exited 1 before any raw authority case. Syntax checking this harness is not
qualification evidence; consult the integration record for historical results.

This source correction does not change the historical evidence. The prior
actual run remains partial positive / overall negative, and its default-
diagnostic secrecy observation cannot be established retroactively because it
scanned only stdout. A new run under the required external envelope is needed
to exercise the corrected two-stream assertion.

| Row | Scope / injected cut | Required actual observable | Source status |
| --- | --- | --- | --- |
| Keycloak authorization code + S256 | Actual provider and generated helper | Begin completes, browser-form login returns the fixed callback, complete settles | PENDING; executable |
| Lost initial mint acknowledgement | Parent proxy drops the response only after actual `/auth/session` returned a Session, then SIGKILLs that registered supervised worker PID | A different supervised worker PID claims the same invocation; exactly one provider token POST total | PENDING; executable |
| Explicit committed-mint recovery | Generated helper's actual recovery request | Same invocation, `identity-session/v1`, fixed principal/kind/days, `replaceLostDelivery: true`; no unbound/new-family fallback | PENDING; executable; instrument is field-agnostic to the helper's durable `protocol` input |
| Replacement authority | Public query plus read-only store | New bearer passes `identityWhoami`; old bearer returns `E_AUTH`; binding family equals the initial bearer's SHA-256 digest; one final live digest remains in that original family; original `expiresAt` unchanged | PENDING; executable |
| Provider-independent exchange replay | Provider gate closes after the committed-mint cut | No provider fetch is attempted after the cut; token endpoint POST count remains one | PENDING; executable |
| Explicit first binding with recovery flag | Direct actual-engine bound request with `replaceLostDelivery: true` and no prior binding | First binding is created and its bearer passes the public query | PENDING; executable authority-contract row; not a transport/crash witness |
| Before-mint-commit HTTP fault | Actual generated helper request cut before core commit, followed by a new-process recovery | Recovery creates the first binding without provider replay | PENDING; not implemented in this bounded source checkpoint |
| Stale claim | Explicit retry settlement followed by its declared backoff and a fresh actual claim | Old lease refuses `E_ACTION_LEASE`; no target mint | PENDING; executable; retry settlement, not timer expiry, makes the old lease stale |
| Parked work | Real step begin, retry/reclaim, unreconciled second begin | Step returns `E_STEP_PARKED`; mint under that claim refuses `E_ACTION_LEASE` | PENDING; executable |
| Cancelled / settled / deadline | Public cancel, real done settlement, and a 2-second declared deadline under a 10-second lease | Cancellation/done commit; collection records `E_ACTION_DEADLINE` before the deadline mint refuses `E_ACTION_LEASE` | PENDING; executable |
| Admitting-family logout | Public logout of the guest that admitted the invocation | Bound mint refuses `E_ACTION_LEASE`; a fresh sign-in is not substituted | PENDING; executable |
| Issued-family logout | Initial actual bound mint then public logout | Recovery refuses `E_ACTION_AUTHORITY`; no replacement | PENDING; executable |
| Target revocation | `/auth/revoke` from a separate live service | Recovery refuses `E_ACTION_AUTHORITY`; no recreated target family | PENDING; executable |
| Service revocation | Separate operator service revokes `service:worker` | Mint/recovery using the revoked worker credential refuses `E_AUTH` | PENDING; executable |
| Expired issued family | Requeue, supported dev `clock advance +25h`, then fresh current claim; target lifetime one day, invocation 30 days, authorities still live | Recovery refuses `E_ACTION_AUTHORITY`; expired bearer returns `E_AUTH` | PENDING; executable; development-clock evidence only |
| Receipt/default-diagnostic secrecy | Read-only `_action_steps`, binding/session tables and default `why` | Mint step has delivery metadata but no bearer; old bearer occurs nowhere; final bearer occurs only in protected `_requests.result`; default `why` contains none of the known secrets | PENDING; executable; `why --values` is intentionally sensitive and is not run |
| After mint-step done / before action settlement | Actual second process cut after durable `oidc.mint` step completion | A third claim explicitly replaces the lost final handoff with the same family/expiry | PENDING; not implemented in this bounded source checkpoint |
| Legacy unpublished mint receipt | Old done `oidc.mint` receipt plus an existing real unbound Session, followed by the repaired helper whose step input includes `protocol: 'oidc-mint-bound/v1'` | `E_STEP_INPUT` before initial/recovery mint; zero new binding/family; old bearer remains live | PENDING root-engine witness; not seeded here because doing so through the public helper also requires a complete compatible private transaction/exchange record |
| Production/release expiry | Wall clock only | Long-window issued-family expiry refusal | UNAVAILABLE in this bounded run; no fake clock or database edit is substituted |

The before-commit HTTP cut, after-step cut and legacy-receipt row are explicit
gaps, not inferred from the direct first-binding row or other cases. The parent
may add them in the integration tree if it can do so through the same public
engine/worker mechanics without private writes.
