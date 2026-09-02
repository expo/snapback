1. **CRITICAL — Ordinary DM and non-admin group sends are rejected by the `members` update rule.**

The `send` mutation patches every active recipient’s membership row, but the non-admin authorization branch requires `next.historyThru = old.historyThru`. For initial memberships both optional values are absent; Quarry propagates absence and makes a guard predicate over it false. The self-update branch saves the sender’s row, and the admin branch saves admin-originated group sends, but Alice cannot update Bob’s DM membership and Bob cannot update Alice/Carol when replying. The whole transaction therefore refuses, directly breaking acceptance items 1 and 4.

2. **CRITICAL — `#lastSeq + 1` is not a safe sequence allocator, yet message confidentiality depends on it.**

Concurrent sends can read the same maintained maximum and insert identical `seq` values because there is no `unique conv, seq` key or serialized counter row. A removal can then snapshot a duplicated value while one same-sequence send commits afterward, making that post-removal message satisfy `seq <= historyThru`. This can expose new messages to a removed member and violates the monotonic cutoff on which the read rule relies.

3. **MATERIAL — Receipt acknowledgements can mark arbitrary future messages delivered or read.**

`markDelivered` and `markRead` accept an unconstrained client-supplied `time` and never verify that it identifies an existing message in `c`, was returned by a fetch, or is no later than the fetched page. A client can submit a far-future value once, after which all later messages compare below the watermark and appear delivered/read without being fetched or viewed. Monotonic field updates do not make the represented fact monotonic or truthful.

4. **MATERIAL — The design does not record the send-time recipient set and cannot reconstruct it reliably.**

The UI is told to infer recipients from current active memberships with `joinedAt <= message.at`. Both timestamps originate from different clients’ intent clocks, which Quarry explicitly does not treat as a comparable authority: a recipient’s join timestamp can be greater than a later sender’s message timestamp under ordinary clock skew. Such recipients disappear from the aggregate, potentially making a group message appear delivered/read vacuously. A commit-ordered membership epoch or explicit bounded recipient rows are required.

5. **MATERIAL — Group creation permits fewer than two members.**

`people` may be empty, contain only `viewer`, or contain duplicates that collapse through upsert. Neither `createGroup` nor `ensureGroup` requires at least one distinct additional user, so both can create a one-member group despite the mandatory 2–50 cardinality.

6. **MATERIAL — Message pagination can permanently omit history.**

The only conversation ordering is `(conv, at)`, while pagination passes just `at` to `before`. Distinct messages may share the same client-intent timestamp; after one such message becomes the cursor, its peers are excluded from subsequent pages. Arbitrary client clock ordering compounds the problem. Consequently, the backend cannot guarantee that a new member can page through the group’s full prior history.

7. **MATERIAL — No declared capability delivers durable messages live.**

Comments saying to “subscribe” to `conversation` are non-operative: Quarry defines queries as reads and only declares subscription semantics for boundary channels. The sole channel here is ephemeral typing, and no durable message channel, reactive-query boundary, or other delivery contract exists. Polling can fetch messages eventually, but the backend as specified cannot satisfy the “both see messages live” acceptance requirement.

8. **MATERIAL — `memberCount` is used as an undeclared disclosure.**

A former member can still read the conversation and their tombstoned membership, but cannot read current active members. Both `conversation` and `chats` nevertheless return `#memberCount[c]`, which aggregates those hidden active rows, without the required `(readable: ...)` declaration. Under the spec this must either be rejected or explicitly declared as information disclosed to former members.

9. **MATERIAL — `markRead` destroys unread accuracy beyond the acknowledged watermark.**

Every call sets `unread: 0`, even when `at` covers only an older fetched page. Messages received after that point—or racing with the call—remain above `lastReadAt` yet disappear from the unread counter. Receipt watermarks and the chats-list unread state can therefore contradict each other.

10. **MATERIAL — `ensureMessage` violates the restricted-point-read rule and creates an existence oracle.**

`messages[id]` is restricted, so its `none` arm cannot distinguish an absent row from a hidden row. The mutation nevertheless treats `none` as absence and attempts to insert the same explicit ID. A hidden existing message causes duplicate-ID refusal, while a genuinely absent ID succeeds in a conversation the caller belongs to, revealing whether an otherwise unreadable message ID exists—the exact inference the Quarry spec prohibits.

11. **MATERIAL — The 50-member maximum is only a racy precondition.**

Two admins can both observe `#memberCount[c] = 49` and add different users. No schema constraint enforces the cap at commit, and the inserts touch different membership rows, so both may commit with 51 active members. `send` then processes only `last 50`, silently omitting one member from previews, unread updates, and effective receipt handling.

12. **MINOR — Concurrent DM opens and seed ensures are not operationally idempotent.**

The match-then-insert paths rely on unique-key refusal at commit. Concurrent `openDm` calls for the same pair, or concurrent `ensureGroup` calls for the same key, can both take `none`; one succeeds and the other refuses instead of reopening/returning the winner. The uniqueness invariant survives, but the requested “open existing” and idempotent behavior requires a retry or atomic get-or-create primitive.

13. **MINOR — The typing declaration does not guarantee the two-second appearance bound.**

`ttl 5s` establishes expiry only. Neither the channel declaration nor another boundary contract gives a maximum publish-to-subscriber delivery latency; the notes merely prescribe a client heartbeat and assert engine delivery. Thus the five-second expiry is represented, but the acceptance requirement that another member sees the indicator within two seconds is not guaranteed by the backend contract.
