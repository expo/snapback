# Descriptive authoring pilot (N=1)

CLI: published local `./snapback4`, version 0.3.0.
Start UTC: 2026-09-24T03:39:23Z.
End UTC: recorded in `pilot-status.txt` and the command/output diary.
All task work used SSH in `/Users/ccheever/cal18-modeling-pilot-control`.
No server, package installation, CLI modification, web research, or other repository inspection was used.

## Sources and behavior

- `snapback/schema.q` declares public original posts and public replies, and the three requested operations. Original-post body limit 1000 is a local modeling choice; the requested reply body limit is 100.
- `snapback/diagnostic.q` holds the separate diagnostic operations.
- `snapback/generated/api.ts` is the CLI-generated result and argument contract, inspected after `check`.
- `command-output-diary.txt` records exact command arguments (shell-escaped with `%q`), complete combined outputs, and exit codes. `diary.sh` is the local recorder bootstrap.

`openReply(replyId: replies)` explicitly reads `replies[id = replyId] by byId`. It accepts a reply identity and returns that reply row or null when absent. The read rule is public.

`thread(postId: posts)` explicitly reads `replies[postId = postId] by byPostId`. The `(postId, id)` index groups and orders replies by their original. The schema declares `cap 10 by postId`, so this whole-group query returns at most ten replies in ascending id order. The cap constrains rows per group; it is not merely a display limit.

`optionalReply(replyId: replies ?)` guards `replyId != null` before its explicit by-ID read and otherwise returns null. The guide says an omitted optional argument is also null. A present but missing reply also produces null.

## The diagnostic distinction

In `diagnostic.inferredThread(k: posts)`, `return replies[k]` is not an open-reply-by-ID operation. The key is a posts reference, matching the `postId` column exactly. The reads guide says a single exact-type match is chosen before the full-unique-key tie-breaker. Thus this positional key selects the prefix of `byPostId`, whose schema cap supplies the ten-row bound. `why diagnostic.inferredThread` confirms a page of at most ten reply rows and a `replies.byPostId` scan.

The explicit same-meaning spelling is:

```quarry
query explicitThread(k: posts):
  return replies[postId = k] by byPostId
```

That preserves the posts reference as a posts reference. Opening one reply instead requires the actual reply identity, as in the separate `openReply(replyId: replies)` operation. A parent post identity alone cannot identify one of its up to ten replies.

## Validation evidence

`./snapback4 check --cost` succeeded: two tables, zero synced tables, five operations, no problems.

`why` was run for all five operations and the replies table. It confirmed:

- `openReply`: optional reply row; one `byId` point read.
- `optionalReply`: optional reply argument, optional reply row; one conditional `byId` point-read site.
- `thread`, `diagnostic.inferredThread`, and `diagnostic.explicitThread`: page of at most ten replies; `byPostId` scan, bounded by the schema cap.
- Public replies, implicit unique `byId`, declared `byPostId`, and online-only residency.

The generated TypeScript contract is:

```ts
openReply: Query<{ replyId: string }, Rows["replies"] | null>;
thread: Query<{ postId: string }, Rows["replies"][]>;
optionalReply: Query<{ replyId?: string | null }, Rows["replies"] | null>;
inferredThread: Query<{ k: string }, Rows["replies"][]>;
explicitThread: Query<{ k: string }, Rows["replies"][]>;
```

There was one check invocation, zero failed checks, and zero source corrections after validation. No check --fix was used. No failed commands occurred. Two guide cards were reread because the initial batched tool response was truncated; the diary retained the full original output.

Help/guide command reads, in order: `--help`; `guide`; `guide language`; `guide types`; `guide reads`; `guide indexes`; `guide bounds`; `guide rules`; `guide types` again; `guide reads` again. Total: one help read, nine guide reads (including the card listing), ten combined. `--version` was also read. There were six `why` invocations.

## Discoverability observations and uncertainty

The guide listing made the relevant cards discoverable. The language card offered usable table, cap, query, and null-guard examples, but its length made a broad multi-card read unwieldy in this tool interface. The reads card explicitly explained exact-type selection, which was essential for the diagnostic. The types card distinguished table references from rows and explained optional-argument narrowing.

`check --cost` and `why` exposed the chosen index and point-versus-page distinction directly. `why` retained the source-level table-reference type and the page bound. The generated TypeScript made row-or-null versus array results easy to verify, but represented both reference types as strings and did not encode the array length cap; clients cannot recover those distinctions from the argument TypeScript alone.

This was compile-time validation and diagnostic inspection only. Runtime rows, cap rejection on the eleventh insert, body-length rejection, wire-input behavior, and device completeness were not exercised. The guide states references do not implicitly check target existence or cascade deletion; no write operations or target-existence policy were requested or added. Omitted write rules deny writes. The model has no sync declaration, so the CLI classifies these reads as server operations. No runtime performance claim or comparative score follows from this one descriptive attempt, and the CLI-reported check duration was not used as a measurement.
