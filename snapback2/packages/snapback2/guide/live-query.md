# Live query

A commit intersecting a query's read trace makes it live. Bound every scan.
Cursor indexes end in intrinsic `id`; pass a `cursor ?` argument to `after`.
`null` means page one.

```q
query thread(conversationId: conversations, c: cursor ?):
  require exists memberships[conversationId, viewer] else MEMBERSHIP_REQUIRED
  page = deliveries[viewer, conversationId, 'message'] after c last 50 by byRecipientConversationKindAt
  return page { *, message: messages[.messageId] }
```

`complete` and `capped` receipts carry `next: Cursor | null`. Pass that opaque
token back as the cursor argument for the next page. It represents the last
returned row, is bound to the table/index/order, and must not be inspected or
constructed by application code. A conditional query can return a different
range or merge from each branch, through aliases and shapes; `next` follows the
branch that returns. Reset the cursor to `null` when switching index or order.

Subscribe through `client.subscribe(api.deliveries.thread, args, listener)`.
Each SSE data frame is a query response or refusal.

## Reading a query

`useQuery(op, args)` returns one snapshot: `data`, `status` (`loading`, `ready`,
`unavailable`), and at most one `reason` (`code` plus a sentence). `ready` means
readable data, not server confirmation. The facts stay one property down:
`receipt` (`outcome` complete/capped/partial/denied, `source` server/twin,
`seq`, `next`), `freshness` (`live`, `staleSince`, `connection`),
`local.predicted` (rows a queued write predicted: table, id, intent), `refusal`.
A partial composite is `ready` with reason `partial`; check it before trusting
nested fields. `summarize(view, connection)` is the same projection headless.

## Channels

`channel name(args):` declares ephemeral events with `publish` and `subscribe`
rules and `ttl Ns`. Use channels for transient signals such as typing;
subscriptions carry events, not durable rows or replayable history.
A heartbeat table remains a workaround for recent activity such as foreground use
when `connected` is not enough; its lag is the heartbeat interval plus the expiry
delay; disconnects are seen late. Do not gate delivery solely on it: use durable receipts and a delayed
check for an unacknowledged message.

## Connected

`connected` is a read-only virtual table: `exists connected[p]` tests whether
principal `p` has a live connection; `#connected[p]` counts connections. Pass one
nonoptional principal (for yourself, `viewer`) in a query or mutation. Programs
choose what to expose; rules and maintains cannot read it. Do not declare this
built-in in your schema. For a rule refusal, move the named probe into a program
and keep the rule based on durable facts. It counts authenticated
SSE transports (including personas via `--as`), once per transport regardless of query/channel subscriptions,
from identity establishment until stream close; revocation cuts that session's
streams. A silent partition is detected on a failed write, with no latency
guarantee. Each read charges one probe and touches `_connected` at that principal.
Each program sees one immutable snapshot per program run. Connect/close is
visible to the next execute; live reruns wait up to 1 s to coalesce changes. Offline,
a program reading `connected` is `hydrating` and never predicted, even with a
cached answer. Connections say nothing about foreground/idle state or delivery
guarantees; this adds no channel kind or subscriber-set broadcast.

## Whole-word search

`words(text)` returns whole `[A-Za-z0-9]+` runs, lowercase, deduplicated in
first-occurrence order. Whole-word matching, not prefix search; non-ASCII splits
words. Empty input yields `[]`. For `text <=N`, the list/`for` bound is
`floor(N/2)+1` (2000 → 1001). `words(a ?? b)` uses the larger declared text
maximum. Index columns must fit whole runs or the program must filter.
`tokens(text)` extracts `@` mentions.

Messages have `conversationId`, `author`, `body: text <=2000`, and `at`:

```q
table searchWords:
  messageId: messages
  conversationId: conversations
  term: text <=2000
  at: time
  unique byMessageTerm: messageId, term
  by byConversationTermTime: conversationId, term, at, id
  public
  insert <- allow
  update <- allow
  delete <- allow
```

```q
mutation index(messageId: messages, body: text <=2000):
  m = messages[messageId] !
  require m.author = viewer and m.body = body else STALE_OR_NOT_AUTHOR
  for term in words(body):
    upsert searchWords[messageId, term] { conversationId: m.conversationId, at: m.at }
  return true

mutation edit(messageId: messages, body: text <=2000):
  old = messages[messageId] !
  require old.author = viewer else NOT_AUTHOR
  for term in words(old.body):
    delete searchWords[messageId, term]
  update messages[messageId] { body }
  for term in words(body):
    upsert searchWords[messageId, term] { conversationId: old.conversationId, at: old.at }
  return true

query search(conversationId: conversations, term: text <=2000):
  return searchWords[conversationId, term] last 20 by byConversationTermTime { messageId }
```

Index at creation; editing an unindexed nonempty body refuses `NOT_FOUND`.
`search` takes an already-lowercased ASCII word. Public-conversation rules.
