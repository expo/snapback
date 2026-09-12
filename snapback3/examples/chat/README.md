# Commonroom

A small, functioning Snapback 3 reference application: member-only group and
direct conversations, live messages, unread counts, edits, and recoverable
offline work. The React interface uses independent resources for the inbox,
messages, people, and read summary. Useful messages remain visible when the
summary is unavailable.

From `snapback3/`:

```sh
bun install --frozen-lockfile
cargo build -p snapback3-worker
node build.mjs
node examples/chat/build.mjs
node packages/snapback3/dist/cli.mjs dev examples/chat --port 4383
```

Open [Commonroom](http://127.0.0.1:4383). The app signs in as fictional local
persona Alice. The account selector also offers Bob and Erin; their private
conversations differ. The server seeds a fresh database once and preserves it
across restarts. The dev owner reloads accepted Quarry changes; rerun the example
build for interface changes.

The room details panel has a working offline toggle. Sending first saves an
operation on this device, then clears the composer. Queued messages survive
reopening and send on reconnect. A server rejection retains the submitted
words; **Restore draft** saves them back into the composer before dismissing
the result. Restoring a conflicting edit loads the latest message for review
and preserves its body as the next conditional edit base.

After a successful first online visit and service-worker installation,
Commonroom can reopen with the network offline. Its app-owned shell cache
contains only the built HTML, JavaScript, and CSS; cached conversations and
queued writes stay in the SDK's IndexedDB stores. Installation is progressive
enhancement on HTTPS or localhost: if the browser cannot install the shell,
the existing page remains usable but offline navigation is not promised.
This does not provide an offline first visit or installation after storage
has been cleared.

Each shell version hashes the exact emitted assets and verifies their
integrity while installing. Updates wait for old tabs to close, then remove
only older Commonroom shell caches. The app never reloads a page to install
an update, and the service worker never caches authentication or API data.

Unsent drafts and edit bases are saved in local storage separately for each
account and conversation. Storage errors stay visible with a retry action.
These drafts are local to this browser. Selecting a different person opens that
person's drafts and resource state.

Conversation and message pages are bounded at 50 and 40 respectively. Search
filters the loaded conversation page. Unread counts have their own completeness
and freshness state; offline values are marked as last known. Read markers
advance only through a displayed message. This specimen does not yet create
rooms, change membership, attach files, or offer production sign-up.

Build and focused verification:

```sh
node examples/chat/build.mjs --check
bun test examples/chat/tests
bun test tests/browser.test.ts
node packages/snapback3/dist/cli.mjs check examples/chat
```

The actual Quarry compiler writes inferred declarations to
`.snapback3/build/api.d.ts`; TypeScript checks the React application against
those declarations. Rolldown builds React and the browser SDK, and the build
copies the two authored stylesheets into one CSS asset. There are no hosted
fonts or image assets.

For the deterministic large seed, from `snapback3/`:

```sh
node scripts/generate-hub.mjs
```

This writes ignored JSON and metrics beneath this example's
`.snapback3/fixtures/`: 100 group conversations, 900 direct conversations,
100,015 messages, 6,800 membership rows, and 1,000 hub read cursors. Persona
`u0001` (`dev:u0001`) belongs to every room. Groups contain 50 members; there
are 4,901 personas in total. The metrics include the byte count and SHA-256 of
the exact seed bytes. The worker can consume this artifact with `--seed` and
a fresh, separate database; it does not replace the normal development seed.

The fixture measures chat acquisition cost. It has no feed or follow schema,
and does not stand in for the full Clique application or its M1–M8 comparison.
