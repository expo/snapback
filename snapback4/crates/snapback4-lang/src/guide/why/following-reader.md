# Following history refusals

The generated `useFollowing` hook owns the authenticated server history
protocol. It keeps preparation distinct from empty and the original inbox
offline. See `guide feeds` for the frozen-domain guarantee and stalled exceptions.

E_FOLLOWING_INPUT rejects invalid opening arguments or a protocol envelope.
E_FOLLOWING_DECLARATION means the view/query lacks an admitted history binding;
E_FOLLOWING_PAGE_SIZE requires 1–100 events per declared page. Mismatched issued
bindings restart explicitly; the SDK owns tokens and fresh revisions.

E_FOLLOWING_QUOTA refuses session or frontier custody without evicting another
consumer. Four sessions may coexist per viewer/declaration; abandoned state
remains charged until bounded maintenance reclaims it. Close unused consumers
or wait for the five-minute idle expiry and reclamation, then call `retry`.
Large frontiers can still exceed the byte quota; retry cannot bypass it.

E_FOLLOWING_REQUEST_TOO_SMALL means a unit cannot reserve its full work, output
and checkpoint under the unchanged request ceilings. It does not advance.
Use a smaller declared page or simpler card projection, then open a new revision;
retrying identical work does not increase its allowance.

E_FOLLOWING_ROW_TOO_LARGE names an ordered card omission. Keep its event identity
and display the omission; `loadMore` continues beyond that event's key. A fitting
card starts a shorter next page instead of being omitted for the preceding
cards' space. Application code renders items and phases; it never builds heads,
splices inbox cursors or writes its own polling/replay state machine.
