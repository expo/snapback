//! The refusals card. Quarry examples are compiled by tests/guide.rs.
pub(super) const CARD: &str = r##"# Refusals

A refusal explains why an operation could not complete and how to correct it.
Application checks can supply their own codes for the client to handle.

```quarry
query checkedName(name: text <=80):
  require name != '' else NAME_REQUIRED
  return name
```

Every refusal is `{ code, family, message, detail?, site?, rewrite?, guide?, rule?,
retryable? }`: `code` and `family` are stable, `rewrite` compiles, `guide`
names a card, `rule` is the program's own code on a `require` or named unique refusal, and
`retryable` says the same request may succeed later. The engine's families:
input, schema, auth, rule (your `require` codes), constraint, bound, op,
asset, action, route, prediction, generation, store; HTTP admission adds limit.
The client adds link (a transport or HTTP response failure) and client (the client itself refused, as after `close()`).
Reads never raise a rule refusal: a
hidden row is null, and a page omits it.

A read denied by a table's rule answers as an empty page, not a refusal,
and a client cannot tell it apart from an empty readable page — by design,
so that a hidden row cannot be probed. For access UI, use a membership query
the viewer may read, such as a conversation lookup readable by its members:
a member gets the conversation even when its message page is empty.
An explicit `require … else CODE` still refuses with the program's code.
For expiring server scans, `E_BOUND` includes unswept rows. For delivery
reports, `E_BOUND` is an ordinary non-retryable refusal: the SDK calls
`onDeliveryRefused` once and parks the interval until the next start, which
retries with a new id. There is no retry within the session. A committed report
that runs again is a no-op report (`why E_BOUND`, `guide receipts`).

`unique handle else HANDLE_TAKEN 'That handle is taken.'` supplies a
constraint's user-facing code and message. Render `message`; `detail` retains
`profiles.byHandle already has a row where handle = 'alice'` for development.
Omit the literal to use the default `the program refused with HANDLE_TAKEN`.
Omit the hook to keep the existing `E_CONSTRAINT` message. The indexes card
shows the declaration; code validation is the same as `require … else CODE`.

## Operations

Ordinary empty reads are quiet in `dev` and absent from `why recent`.
`snapback4 dev --trace-empty` records unknown EMPTY_READ evidence locally,
without console notices; `snapback4 why EMPTY_READ` gives the commands to
inspect rules, sync coverage and horizons. Emptiness does not prove denial.
Real refusals keep individual `why recent` records. Their console lines combine
identical operation, code and cause for one second, then print once with a count.
Repeats do not extend that window; at 32 distinct groups the oldest prints early.
Normal dev shutdown drains these records and flushes their counts, even with
held polls. It waits up to two seconds; a stalled writer or abrupt termination
can still lose queued evidence and unprinted counts.


`dev` and `doctor` print the 128-connection and two-upload caps and the local
process's inherited file-descriptor soft/hard limits. E_HTTP_LIMIT warns below
1024: use `ulimit -n 1024` and restart dev before a scale run. If the hard limit
is lower, raise the shell/container/service NOFILE limit first. Doctor's shell
may differ from a running server's launcher; dev reports its own limits.
E_HTTP_LISTENER names an OS accept failure, including descriptor exhaustion.
E_RATE_LIMIT at http names connection saturation; at workers it names a full
request pool. Await pending writes or reduce concurrent clients. Cumulative
operator summaries count suppressed refusals and failed wire delivery. Limits are reported, never automatically raised.
E_HTTP_RESPONSE means a request received HTTP with an invalid response
envelope; its status is in the message. An upload's outcome is unknown, so
inspect server/proxy logs before retrying. E_OFFLINE applies when no HTTP
response could be consumed. It retains the host's transport cause when supplied;
otherwise it reports an unspecified transport failure. A received E_RATE_LIMIT
keeps the link online and effect workers retrying. Reads (including schema
startup) and same-ID mutations back off with jitter. Exhausted startup overload
keeps its code even on a fresh device. Ephemeral writes return the refusal
without replay. Uploads and downloads retry only explicit admission refusals,
with jitter after the Retry-After minimum. A probe or sync overload restores
an offline link without establishing store identity or acquisition.
Credential rotation cannot replay an ambiguous once-view download; an ambiguous
token refresh also stops automatic rotation. An undeliverable overload response can still look like a transport
failure; operator counters distinguish the admission layers.

`snapback4 why <CODE>` prints its explanation and diagnostic details,
followed by the full-card command. Every registered code has a dedicated
why page or a paragraph on its default card. Compiler proofs, planner choices,
meter charges and repair eligibility live here when the first-read card
only needs the short limit. A diagnostic may choose another
card for its context. A dedicated why page keeps the code's reference text
and title, with that contextual card's full-card pointer. Otherwise, if the
card lacks a section, explicit `why` labels its fallback to the card's opening. Output is at most 4,096 UTF-8
bytes including the pointer and final newline; a shortened excerpt says so.
When the same code and card occur twice in text `check` or a `dev` save refusal,
a dedicated section prints once under the first occurrence; cards without
one add no inline excerpt. Every site keeps its `guide:` pointer.
At most three excerpts print in diagnostic order: 12,291 extra bytes including
separating blank lines. A single occurrence stays compact; `check --json`
keeps its structured diagnostics. `why` remains available on demand.

`doctor` also reports failed macOS scheduling calls from the running dev host,
including their cumulative count and last OS error. HTTP intake starts at
user-initiated QoS; if a failed raise leaves the startup thread below default
(or unreadable), startup refuses before opening the listener.

`dev` keeps failed schema adoption visible in `doctor`, repeats its reason on the first failing job or sweep, and retries locked stores and generation failures without another save. `doctor` compares the live host generation with the store; `--no-watch` hosts need a restart after another process adopts.
While that adoption failure is pending, identical background store and generation failures are suppressed. Changed reasons print at most twice per error code in each 60-second window; further changes count as suppressed too. Recovery or a changed adoption failure reports the suppressed count and resets it.

E_RUN_BUSY means local `run` spent its 15-second contention deadline waiting
for SQLite BUSY/LOCKED during store opening or schema adoption. It reports the
operation and elapsed time; no operation was admitted. Inspect `snapback4
doctor` and the dev adoption log, wait for the writer or stop your dev host,
run once, then restart dev. Watching dev reopens after external adoption;
`--no-watch` needs that restart. Other store errors keep their original code.
The deadline bounds contention retries; it cannot cancel an atomic activation
already running or limit an admitted operation. An activation can complete
while the operation remains unadmitted after a timeout or source edit, and
total process time can exceed 15 seconds. Jobs and mutations are never retried
by this mechanism. An interruption after admission may have committed work;
inspect the job/operation before invoking it again.

E_RUN_SOURCE_CHANGED means `run` saw a source edit or could no longer read
its source before admission. Check the source and rerun with the intended
arguments. No operation was admitted, although an activation that finished
before the edit was detected may already be persisted.

`dev` and `serve` also report process events on stderr: SNAPBACK4_EXIT
(a returned startup/listener error or normal stop), SNAPBACK4_PANIC (any
thread, with its name, location and abort/unwind action), SNAPBACK4_SIGNAL
(signal name and number), and SNAPBACK4_THREAD_EXIT (watcher/maintenance
stopped; an unexpected stop ends the server). Each is one line with verb,
generation and reason; generation 0 means this process has not served yet.
INT, TERM and HUP report immediately; dev flushes its refusal writer and
cleans up any application worker, then exits 128 + signal. Serve does that
worker cleanup when configured. Otherwise, and for fatal signals, the process
terminates immediately with its OS signal status. SIGKILL,
power loss and an unwritable stderr cannot report from inside the process.
Inspect the verb, generation, reason and any panic stack before restarting;
a normal requested stop needs no repair.

## Refusals

E_CLIENT means a client exception prevented the expected write or asset
outcome. For example, a custom client's `mutate` throwing instead of
returning a `Write` makes the mutation hook report this refusal. Inspect
the original exception in `message` and repair the client adapter to return
the declared outcome. A missing write reply does not establish whether the
server admitted it; collect with the original intent ID before starting
another write. An asset hook's exception likewise needs its underlying
client error repaired before retrying. SDK asset wait deadlines and failures to
retain or display downloaded bytes also use E_CLIENT, without declaring the
device offline. Reduce concurrent transfers for a queue timeout; inspect the
host storage/Blob error for a construction failure. Ordinary ranged downloads
can recover on a later focus/reconnect event; one-view construction failures
remain non-retryable because their view may already be consumed.

E_CLOSED means the client closed while a request was in flight. For example,
calling `client.close()` immediately after starting an online mutation
can end the wait before its reply. Keep the client alive until the request
settles; after closing it, create a new client. The server may already have
committed, so collect with the same write ID instead of sending duplicate
intent. A durable local write remains pending and can settle after reopen.

E_DEVICE_VERSION means JavaScript opened a device module missing the
required sync receipt protocol. For example, updating `snapback4` while
retaining an older Expo development build cannot be fixed by reloading JS.
Rebuild with the matching `snapback4-expo` package using `npx expo run:ios`.
On the web, serve the wasm shipped by that package version and refresh the
app. Keep the JS client and its device module from the same build.

E_GENERATION means the caller's assumed backend differs from the store's
active backend. For example, a queued write can carry the old generation
after a schema adoption; let the client adopt the current backend and
resend under that generation with the same intent ID. If the message names
a release mismatch, serve the activated release; a deployment-owned store
cannot be opened as an unrelated dev project. Use `snapback4 doctor` to
compare the live and stored generations before restarting the right host.

E_SCHEMA means the runtime's schema or stored backend is inconsistent.
For example, a raw program referring to a table absent from its backend
cannot be installed as a working pair. Run `snapback4 check` on the matching
source, fix the declaration named in the message, and regenerate the
backend and programs together. If checked source still fails on an existing
store, preserve that store and the diagnostic for investigation; deleting
application data is not a schema repair.

E_STORE_BUSY at store.sqlite means a live host or another CLI owns this database.
`token` normally asks a live dev/serve owner to mint over loopback with its
private store proof. Its E_STORE_BUSY means that path is unavailable: restore
access to the named server and proof, or stop it, mint offline, then restart.
After a lost mint reply, an unused session may remain until expiry.
`run` beside a responsive dev is forwarded over its wire as the persona, so it
refuses only with `--now`, a non-persona principal, a `serve` or stopped host;
that refusal prints the equivalent curl to run beside dev.
Other offline writers admit no work: stop the named host (the message includes
its address), run the command once, then restart it; for another CLI, wait for
it to finish. The presence of an old lock file alone does not refuse work.
Leave `<database>-owner` in place: deleting or replacing it while a process runs
ends exclusion and can admit a second owner without stopping the first.

E_STORE means the database operation failed, such as a SQLite writer lock
held by another process. For example, starting a second writer during
adoption may prevent the first host from committing. Inspect the underlying
message, release an unintended competing writer or repair disk access, then
retry the same request when the cause clears. `dev` retries failed adoption
and reports recovery in `doctor`. Keep an uncertain mutation's original ID
so a successful commit with a lost reply is not repeated as new intent."##;
