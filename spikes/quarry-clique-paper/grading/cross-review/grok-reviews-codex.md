I'll start by reading the full offloaded prompt so the review is against the complete spec, M3 brief, and design.The design continues past the schema; I'll read the rest of the programs and notes next.I’ll inspect the workspace and any extra spec notes so findings stay tied to the language and M3 acceptance, not guesses.1. **CRITICAL**  
`#conversationMemberCount` is not a uniqueness key, and Quarry only promises maintained aggregates are exact at commit, so two `addGroupMember` transactions can both observe count 49 and commit a 51st (and further) member. `sendText` / `sendQuotedText` then take `conversationMembers[conv] first 50 by conversationUser` and never inspect `.more`, so the extra member is omitted from `messageReceipts` and from `conversationStates` fan-out: they are not in the send-time recipient set, their chat-list preview/unread never moves, and group ticks can show delivered/read without them — violating the 2–50 cap, send-time recipient set, and acceptance 4.

2. **CRITICAL**  
`seedMessagingDemo` inserts `messagingSeedRuns` and then has a nested `match dmPairs[lo, hi]` whose `some` arm is the bare expression `pair.conversation`. That is not a legal mid-body statement (bindings, guards, writes, `if`/`for`/`match` only), and the arm type (`conversations`) also disagrees with the `none` arm (last write is a `conversationStates` row) and with `-> bool`. If the arm is treated as a value/return — the same shape as `startDM` — a first seed after an existing Alice–Bob DM yields out before `+conversations` for the group while the seed gate row is already written; later runs hit `some prior` and return `false`, so the group is never created and acceptance 7’s “second run: no duplicates” gate blocks repair.

3. **MATERIAL**  
`startDM` still check-then-inserts `dmPairs`. Sequential reuse works; concurrent `startDM` on the same pair both take `none` and one transaction is refused by `unique lo, hi` instead of returning the surviving channel. The spec is “starting a DM with an existing counterpart opens the existing channel,” not “loser gets a unique-key error,” so acceptance 1 fails under overlap; `dmPairs` insert also never requires a canonical `lo < hi`, so that uniqueness is only “ordered pair,” not “unordered user pair,” outside the hope that `sorted(viewer, counterpart)` typechecks on references.

4. **MATERIAL**  
`conversationActivity` and `conversationStates` last-message/activity writes are last-writer-wins with no `next.at >= old.at`. `at` / `activityAt` are client `now` (`time!intent`), which cannot be compared to stored `time` at the call site and is stored unsanitized. A later send with an earlier clock, or two concurrent sends, can rewind every member’s list ranking and leave `lastMessage` pointing at a message that is not the newest `messages[c]` row, so chat-list order and preview disagree with history.

5. **MATERIAL**  
History and chat-list pagination cursors are a single `time` (`before`/`after` on `conversationTime` / `userActivity`). Equal intent timestamps are normal: one mutation uses one `now` (seed writes Alice’s DM and group states at the same `activityAt`; a send patches every member to the same `message.at`; two clients can send with the same clock). `after cursor` / `before cursor` then skip or duplicate rows, so “full prior history on join” is not actually reconstructable and `chatListBefore` can drop conversations. `messageById` can still fetch a quoted target by id, but paging to it in the thread can miss it.

6. **MATERIAL**  
`leaveGroup` deletes the caller’s membership with no remaining-admin check, and `promoteGroupAdmin` / `addGroupMember` / `removeGroupMember` all require an existing admin. The last admin leaving (or the sole admin leaving a still-populated group) is allowed by the delete rule (`r.user.id = viewer.id`) and leaves a group in which spec-required admin effects — add, remove, promote — are permanently impossible; remaining members can only send or leave.

7. **MATERIAL**  
`maintain unreadMessageCount = count messageReceipts by membership where r.state != 'read'` uses `r` without a rule binder. Maintain-`where` is only “a predicate over the row”; `r <-` is defined for table rules, not `maintain`. If that clause does not parse, the aggregate counts every receipt including `read` and chat-list badges cannot go to zero after `markRead`. If it parses as an unbound name, the where is not the intended filter either.

8. **MATERIAL**  
`myUnreadReceiptBatch` is `merge(...) first 50 { ... }`. The language only lists `merge(t[a], t[b], ...) last N` over one ordering; `first N` is specified for ordinary range reads, not merge. If the query is invalid, the only bounded way to collect send-time receipt ids older than the latest 50 history rows disappears, and the client cannot drain delivered/read for deeper unread (acceptance 4) without scraping history pages that themselves skip equal-`at` rows.

9. **MATERIAL**  
`markDelivered` / `markRead` refuse the whole `<=50` batch on `messageReceipts[receiptRef]! else RECEIPT_NOT_FOUND` and `require exists conversationMembers[receipt.membership]`. That incarnation check is the dropout mechanism, but it is not per-item: one stale id (leave/rejoin replaced the membership row; live-query still holding old ids) aborts the other valid transitions, so a client can get stuck unable to advance ticks or clear `#unreadMessageCount` on the current incarnation.

10. **MATERIAL**  
The schema update rule allows `sent → read` directly, and `markRead` does so (`if receipt.state = 'sent' or receipt.state = 'delivered'`). Delivered is defined as “fetched by the recipient’s client,” and acceptance 4 is the three-tick sequence. A client that only calls `markRead` (or races it before `markDelivered`) never produces `delivered`, so the group min-state can jump sent → read and the double-check state is unobservable even when every required recipient has “viewed.”

11. **MINOR**  
`conversations.read` is `createdBy = viewer or current member`. After the creator leaves, `sendText` / `sendQuotedText` still do `conversations[c]!` before the membership check, so a former creator gets `NOT_MEMBER` while a stranger gets `CONVERSATION_NOT_FOUND` — an existence leak. Non-creator former members fail the read rule and cannot even bind `c`.

12. **MINOR**  
Group `name: text <=50 ?` and `createGroup(name: text <=50)` accept `""`; there is no `require` on name, and the notes claim a 1-character minimum cannot be enforced. Spec is name 1–50 characters. Empty is a present `text` value, not absent, so this is an unenforced spec bound, not a Quarry impossibility of the same kind as missing substring.

13. **MINOR**  
Acceptance 6’s “still sees pre-removal history” is implemented only as an “offline client cache” and “live-query transport” in the boundary prose. Neither is declared as a schema kind (`use` / `channel` / `schedule`); every history program is `conversationMembers[c, viewer]! else NOT_MEMBER`. A removed member who re-queries, uses a new device, or had not already fetched the page gets `NOT_MEMBER` and no rows — the data plane cannot satisfy the acceptance item without that undeclared client.

14. **MINOR**  
`createGroup` / seed rely on `unique conversation, user` to reject duplicate `otherMembers` entries or overlap with `firstMember`/creator by aborting the entire transaction. There is no pre-insert `require` and no stable refusal code, so a duplicated id in the capped list (easy with a 48-list) fails group creation instead of creating the distinct group acceptance 2 cares about.

15. **MINOR**  
`channel typing` declares only membership predicates and `ttl 5s`. Appearance-within-2s, payload `{conversation, viewer, typing}`, chat-list vs thread fan-out, and an explicit stop (vs waiting out ttl after the last keystroke) live only in boundary comments. The engine kind in the schema cannot, by itself, be shown to meet acceptance 3’s “expires when he stops” except by 5s expiry.
