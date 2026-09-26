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
asset, action, route, prediction, generation, store; the client adds link (the server is
unreachable) and client (the client itself refused, as after `close()`).
Reads never raise a rule refusal: a
hidden row is null, and a page omits it.

A read denied by a table's rule answers as an empty page, not a refusal,
and a client cannot tell it apart from an empty readable page — by design,
so that a hidden row cannot be probed. For access UI, use a membership query
the viewer may read, such as a conversation lookup readable by its members:
a member gets the conversation even when its message page is empty.
An explicit `require … else CODE` still refuses with the program's code.

`unique handle else HANDLE_TAKEN 'That handle is taken.'` supplies a
constraint's user-facing code and message. Render `message`; `detail` retains
`profiles.byHandle already has a row where handle = 'alice'` for development.
Omit the literal to use the default `the program refused with HANDLE_TAKEN`.
Omit the hook to keep the existing `E_CONSTRAINT` message. The indexes card
shows the declaration; code validation is the same as `require … else CODE`.

## Operations

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
INT, TERM and HUP report immediately; with an application worker they clean
it up and exit 128 + signal. Otherwise, and for fatal signals, the process
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
client error repaired before retrying.

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

E_STORE means the database operation failed, such as a SQLite writer lock
held by another process. For example, starting a second writer during
adoption may prevent the first host from committing. Inspect the underlying
message, release an unintended competing writer or repair disk access, then
retry the same request when the cause clears. `dev` retries failed adoption
and reports recovery in `doctor`. Keep an uncertain mutation's original ID
so a successful commit with a lost reply is not repeated as new intent."##;
