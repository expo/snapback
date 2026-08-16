# Diary 0086: Coterie Exact/Contract backendless baseline

**Date:** 2026-08-15

**Run:** First backendless Coterie client and provider seam

**Client:** Exact/Contract

**Provider:** deterministic process-memory `ContractDataProvider`

## Build entry

Coterie now carries the social-messenger presentation vocabulary into a
separate Exact/Contract client rather than changing Clique's accepted
React Native/Expo baseline. I ported the reference kit's palette, spacing,
component states, fixture media, and stable `sm-*` automation IDs into reusable
`.contract` components, while giving Coterie its own mark and product identity.
The initial shell exposes feed tabs, text/media posts, likes, polls, chat lists,
conversation details, typing/read/reaction treatments, search, profiles,
profile editing, follow state, insights, settings, auth, and a media viewer.

The backend boundary felt good. One provider declaration generated typed
Contract bindings, metadata, conformance fixtures, and documentation. Both
web and native entry points configure the same provider, and no presentation
component imports a backend client. Exact's paved row-level boundary made a
deterministic local provider with live invalidation small enough to understand;
the generated conformance suite and a mutation/invalidation test both passed.
That is a useful baseline for later Snapback and competing adapters because the
UI and semantic selectors can remain fixed while the provider changes.

Contract itself was pleasant for the mostly declarative component port. Plain
values and callback actions kept the UI pieces backend-neutral, and the same
source compiled web and native artifacts. Exact's native Acto surface was
particularly useful: the final iOS simulator run exposed a 165-node Coterie tree with
the expected `coterie-*` and `sm-*` identifiers, accepted text into the
composer, and returned a native-reachability receipt for the Post action. That
run caught two real portability problems that the web compiler did not: native
alignment enums require `flex-start`/`flex-end`, and the native media loader did
not load the SVG mark from its public path. A deterministic 512-pixel PNG of
the same mark fixed the latter.

The same tree also caught a more consequential authoring error. Contract
curries `press=likePost(post.id)` when that expression is on an actual event
attribute, but the identical-looking expression is eager when assigned to an
ordinary component prop. My first port passed curried actions through props,
so every rendered feed card toggled its like state during render. The
composition guide does explain the distinction, but it is easy to miss while
mechanically extracting a reusable component. I changed those components to
accept the row identity separately and pass the parent action bare; the leaf
button now performs the curried bind on its event attribute. The lesson is
useful for future agent-authored ports, and a compiler diagnostic for action
application in function-typed component props would prevent an especially
subtle class of side effects.

The native controlled-input path needed one workaround. After Post, Contract
state was empty and the button correctly became disabled, but UIKit retained
the submitted glyphs in the text field. Coterie now double-buffers the
composer's native input identity and flips to the inactive copy when it resets;
the final Acto run showed an empty input, a disabled Post button, and the new
unliked/count-zero feed row. This adds seven presentation nodes and produces
inspector warnings for the inert hidden copy, so it is tracked for removal
rather than treated as free abstraction. The same run still reports keyboard-
avoidance and safe-area warnings around offscreen scroll content despite the
renderer safe-area declarations; those warnings are not being converted into
a clean-layout claim.

The rough edges were mostly in the surrounding Exact development loop. The
scaffold command had to come from the sibling Exact checkout, and a direct
`exact contract check` from the new app expected repository verification
configuration that the scaffold does not create. `bun run typecheck` follows
the linked Exact source graph: an early run stopped on two errors inside that
dirty sibling checkout rather than Coterie-owned code, while the final rerun
passed after the sibling changed. That makes its outcome partly nonlocal.
Repeated native hot reloads could coalesce into a rejected `ViewNotFound`
protocol frame; a clean scoped simulator relaunch restored a valid tree. The
runtime also logged an Image-alt warning even though every rendered image in
Acto carried an accessibility label. Those are development-surface frictions,
not Snapback findings.

macOS proof is not yet earned. `exact run macos --url
http://127.0.0.1:8085` selected a verified prebuilt host but displayed its
embedded Caltrain bundle instead of the external Coterie URL; the direct Acto
tree confirmed `caltrain-shell-root`. The command and guide made the selected
artifact look usable, so this is recorded as a guide/tooling gap rather than a
Coterie platform claim. The physical iPhone path was also unavailable because
the paired iPhone was locked/not ready and Developer Mode readiness could not
be established. The iOS simulator run succeeded. Web production compilation
succeeded, but the in-app browser connector failed during its own setup before
it could attach, so this entry does not claim a live browser interaction run.

Compared with React plus Convex or Supabase, this baseline pays more up-front
schema/provider-generation ceremony and currently inherits React/React DOM as
Exact scaffold internals even though the application UI is not React-authored.
In return, the provider boundary is much harder to accidentally bypass than a
collection of direct client hooks, the host-neutral component source is
smaller than maintaining separate web and native views, and backend swaps have
an explicit conformance target. The important next comparison is not whether
the in-memory provider feels reactive—it does—but whether a real Snapback
adapter can supply persistence, authority, multi-client live delivery,
ephemeral typing, and offline recovery without leaking backend concepts back
into the Contract UI.

## Snapback observations

Snapback was not attached in this entry. There are therefore no Snapback
ergonomics, correctness, or performance claims yet. The checked-in provider
seam is the input to that future work.
