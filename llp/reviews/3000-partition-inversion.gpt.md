**Reviewer family:** GPT (Codex CLI, gpt-6-astra, xhigh)
**Date:** 2026-09-12
**Scope:** LLP 3000 decision 4, mechanism one — partition inversion of read rules (`partition.rs`, `schema.rs` `validate_sync`/`target_prefix_columns`, `engine/write.rs`, `bind/schema.rs`, `replica.ts`, the chat schema) at `ce597c58a06d`.
**Method:** Blind, read-only, one model family; the brief is `snapback4/llp` note in JOURNAL.md 2026-09-12 (week three, day two). Dispositions are recorded in `snapback4/JOURNAL.md` under the same date; no author acceptance is inferred from the verdict.

# LLP 3000 blind review — partition inversion (gpt)

**NOT READY for the disclosure property.**

Below is the `final.md` content. No file was written because this review was explicitly read-only.

Reviewed the specified source files at `ce597c58a06d92643113befa23cffac6cc7da7ef`; those files remained unchanged when the checkout advanced during review. Findings distinguish disclosure failures from failures to hold all authorized rows.

**1. Critical — A principal named `public` turns private delivery into public delivery**

Evidence:

- [partition.rs:18](/Users/ccheever/projects/snapback-sb4/snapback4/crates/snapback4-core/src/partition.rs:18):
  ```rust
  pub const PUBLIC: &str = "public";
  ```
- [partition.rs:101](/Users/ccheever/projects/snapback-sb4/snapback4/crates/snapback4-core/src/partition.rs:101):
  ```rust
  if let Ok(Value::Id(p)) = member.field(principal) {
      out.insert(p.clone());
  }
  ```
- [partition.rs:269](/Users/ccheever/projects/snapback-sb4/snapback4/crates/snapback4-core/src/partition.rs:269):
  ```rust
  let mut public = tx.read_log(PUBLIC, watermark, limit + 1)?;
  ```
- [schema.rs:799](/Users/ccheever/projects/snapback-sb4/snapback4/crates/snapback4-core/src/schema.rs:799) reserves only the system identity:
  ```rust
  Value::Id(id) => id == crate::SYSTEM_PRINCIPAL,
  ```

Scenario using the existing chat schema:

1. Alice administers private conversation `c1`, containing message `m1`.
2. Charlie is not a member and has an existing device watermark.
3. Alice calls `invite(c1, "public")`, using the literal principal ID `public`, not the persona `dev:public`. Principal fields accept this identity; no corresponding account must exist.
4. Membership insertion bootstraps `c1`, its roster, messages, and `messageCounts` into partition `"public"`.
5. Charlie’s next stream request merges that partition into his own.

**Device versus rule:** Charlie receives private message bodies, conversation metadata, and the maintained count. `exists memberships[c1, Charlie]` is false. A fresh snapshot can exclude these rows while an already-running device receives them through the stream.

**Fix:** Give public and principal partitions disjoint representations, such as tagged partition keys. Do not use an otherwise valid principal string as the public sentinel. Reject or migrate colliding stored partition keys.

**2. Critical — Validation ignores the read probe’s index, permitting a different audience and hidden counts**

Evidence:

- [schema.rs:731](/Users/ccheever/projects/snapback-sb4/snapback4/crates/snapback4-core/src/schema.rs:731):
  ```rust
  let sound = table.rules.read.disjuncts().iter().any(|d| match d {
      RuleExpr::Exists { table: t, key, .. } => t == target_name && *key == want,
      _ => false,
  });
  ```
  The `index` is discarded.
- [schema.rs:769](/Users/ccheever/projects/snapback-sb4/snapback4/crates/snapback4-core/src/schema.rs:769):
  ```rust
  let same_name = target.columns.get(column).filter(|target_kind| column != "id" && target_kind.required() == &kind && column != principal);
  ```
  Audience mapping independently prefers the same-named column.
- [bind/schema.rs:24](/Users/ccheever/projects/snapback-sb4/snapback4/crates/snapback4-lang/src/bind/schema.rs:24):
  ```rust
  schema.tables.get_mut(&info.decl.name).expect("bound").sync = Some(Sync { audience: sync.audience, horizon: None });
  ```

Accepted declaration shape:

```q
-- memberships has both conversation references:
by byActual: conversationId, principal
by byOther: otherConversationId, principal
by byPrincipal: principal, conversationId, id

-- messages:
read <- exists memberships[.conversationId, viewer] by byOther
sync to memberships[.conversationId] last 500 by byConvTime

maintain messageCounts: count messages by conversationId
  read <- exists memberships[.conversationId, viewer] by byOther
```

Both conversation columns have the same reference type.

Scenario: membership `mb = {conversationId:cA, otherConversationId:cB, principal:Bob}`; messages `a` in `cA` and `b` in `cB`.

The read rule authorizes Bob for `b`, using `byOther`. Audience inversion selects Bob for `a`, using `byActual`. Snapshot, bootstrap, and live writes therefore deliver `a` and the count for `cA`.

An update also exposes the problem: start with both membership columns equal to `cA`, then change only `otherConversationId` to `cB`. The audience tuple has not changed, so dependent-table processing takes `was == is` and emits no revocation or bootstrap. Bob retains `cA` despite losing read authority.

**Device versus rule:** Bob holds `a` and `count(cA)` although both read rules deny them, and misses authorized `b`. The count reveals the population of a group whose messages Bob cannot read.

The in-memory store and rule interpreter confirmed: inferred audience `[Bob]`, `allowsA:false`, `allowsB:true`, `allowsCountA:false`. Applying the traced events to the actual replica stored the secret body and count.

**Fix:** Bind inversion to the exact resolved probe index and its ordered target columns, including the recipient column. Store that proved mapping in `Audience`; do not reconstruct it independently from names/types. Apply the same proof to inherited aggregate audiences.

**3. High — An oversized commit advances the watermark past undelivered revocations**

Evidence:

- [partition.rs:273](/Users/ccheever/projects/snapback-sb4/snapback4/crates/snapback4-core/src/partition.rs:273):
  ```rust
  own.truncate(limit);
  ```
- [partition.rs:277](/Users/ccheever/projects/snapback-sb4/snapback4/crates/snapback4-core/src/partition.rs:277):
  ```rust
  let complete_seq = own.iter().rev().find(|e| e.seq < last_seq).map(|e| e.seq);
  if let Some(complete) = complete_seq {
      own.retain(|e| e.seq <= complete);
  }
  ```
- [partition.rs:282](/Users/ccheever/projects/snapback-sb4/snapback4/crates/snapback4-core/src/partition.rs:282):
  ```rust
  let next = own.last().map(|e| e.seq).unwrap_or(watermark);
  ```
- [store.rs:421](/Users/ccheever/projects/snapback-sb4/snapback4/crates/snapback4-core/src/store.rs:421) resumes strictly after that sequence:
  ```rust
  let mut statement = self.tx.prepare_cached("SELECT seq, ord, t, kind, id, data FROM _log WHERE partition = ?1 AND seq > ?2 ORDER BY seq, ord LIMIT ?3")?;
  ```

If the first pending commit alone exceeds `limit`, every retained event has the same sequence. `complete_seq` is `None`; the truncated commit is returned with its sequence as the new watermark. Its remaining events are permanently skipped.

Minimal chat scenario: Bob holds `c1`, its roster, messages, and count. Bob leaves at sequence `S`, producing scope events for four tables. Requesting the stream with `limit=1` returns only the first scope and advances to `S`. Subsequent requests cannot retrieve the other scopes.

This also affects the SDK’s 2,000-event page size: one mutation can join Bob to four conversations containing 500 messages each, then remove him from an existing private conversation. Bootstrap puts exceed 2,000 before the final revocation scopes.

**Device versus rule:** The device retains revoked conversation/roster/count rows under `until-revoked` after reaching `S`, and still retains them after later watermarks. Other oversized commits permanently omit authorized puts.

**Fix:** Return complete commits, allowing the first commit to exceed the ordinary page target, or introduce staged chunks with an ordinal cursor. Advance the authoritative watermark only after the complete commit has been applied.

A literal pagination model feeding the actual replica reproduced the skipped-scope result.

**4. High — Temporary membership inside one transaction delivers rows without any committed read authority**

Evidence:

- [engine/write.rs:231](/Users/ccheever/projects/snapback-sb4/snapback4/crates/snapback4-core/src/engine/write.rs:231):
  ```rust
  partition::row_changed(self, table_name, old, new)?;
  ```
- [partition.rs:175](/Users/ccheever/projects/snapback-sb4/snapback4/crates/snapback4-core/src/partition.rs:175):
  ```rust
  runner.events.push(Event { partition: principal.clone(), table: content_name.clone(), kind: EventKind::Put, id, data: Some(row) });
  ```
- [engine/mod.rs:251](/Users/ccheever/projects/snapback-sb4/snapback4/crates/snapback4-core/src/engine/mod.rs:251):
  ```rust
  partition::append(&tx, seq, &events)?;
  ```
- [replica.ts:117](/Users/ccheever/projects/snapback-sb4/snapback4/packages/snapback4/src/replica/replica.ts:117):
  ```typescript
  if (!definition || definition.leave === "delivered-history") return;
  ```

Scenario using chat tables and a composite mutation:

1. Bob has never belonged to `c1`.
2. Alice, its administrator, inserts Bob’s membership and deletes that same membership within one successful mutation.
3. Insertion queues bootstrap puts for existing messages. Deletion queues scope tombstones.
4. All events are appended under the mutation’s single commit sequence `S`.

**Device versus rule:** Bob is unauthorized both before and after `S`, but the stream contains private message bodies. Chat’s `delivered-history` policy makes the device retain those bodies after applying the scope.

With `until-revoked`, final storage is cleared, but the unauthorized bodies still cross the device boundary in the response. Atomic client application does not undo disclosure.

The actual replica retained the supplied message after a same-page `put, scope` sequence under `delivered-history`.

**Fix:** Derive delivery from transaction-boundary authority and final row images. Coalesce physical changes before publishing; suppress bootstrap caused solely by temporary grants. Delivered-history retention must refer to delivery authorized at a committed state.

**5. High, core API — A synced aggregate can count unreadable source rows without an authority check**

This finding concerns directly supplied core `Schema` values. The current Quarry inheritance path does not produce this particular configuration.

Evidence:

- [engine/mod.rs:120](/Users/ccheever/projects/snapback-sb4/snapback4/crates/snapback4-core/src/engine/mod.rs:120):
  ```rust
  let issues = crate::schema::validate(&schema);
  ```
- [schema.rs:674](/Users/ccheever/projects/snapback-sb4/snapback4/crates/snapback4-core/src/schema.rs:674), at the end of `validate_maintain`:
  ```rust
  if !target.indexes.values().any(|index| index.unique && index.columns() == maintain.by) {
      issue(issues, format!("maintain target {} needs a unique index over {}", maintain.target, maintain.by.join(", ")));
  }
  ```
  Its preceding checks cover source/target existence, columns, types, and target shape; none relates source read authority to aggregate recipients.
- [engine/write.rs:299](/Users/ccheever/projects/snapback-sb4/snapback4/crates/snapback4-core/src/engine/write.rs:299):
  ```rust
  MaintainKind::Count => i128::from(direction),
  ```

Concrete core-schema scenario: take the compiled chat schema and set:

- `messages.sync = None`;
- `messages.read = (.authorId = viewer)`;
- `messageCounts.read = Allow`;
- `messageCounts.sync = Public`, without a horizon;
- maintain `readable = None`.

Keep the existing count grouping and target columns/indexes. These changes satisfy the shown validation. Insert two messages authored by Alice in `c1`.

**Device versus rule:** Bob’s public partition receives `messageCounts(c1)=2`. Bob may read neither source message, including through online queries. The aggregate row’s own public read rule does not establish the claimed source-disclosure property.

**Fix:** Validate synced aggregates against source authority: every recipient must be permitted to read every contributing source row. Reject configurations for which that implication cannot be established. Enforce this at the core schema boundary as well as during Quarry inheritance.

**6. Medium — Horizons are acquisition limits, not maintained partition limits**

Evidence:

- [partition.rs:186](/Users/ccheever/projects/snapback-sb4/snapback4/crates/snapback4-core/src/partition.rs:186):
  ```rust
  Some(horizon) => (horizon.by.clone(), horizon.last as usize, Dir::Desc),
  ```
- [partition.rs:130](/Users/ccheever/projects/snapback-sb4/snapback4/crates/snapback4-core/src/partition.rs:130), in ordinary row-change delivery:
  ```rust
  runner.events.push(Event { partition: partition.clone(), table: table_name.to_owned(), kind: EventKind::Put, id: id.clone(), data: Some(image.clone()) });
  ```
- [replica.ts:101](/Users/ccheever/projects/snapback-sb4/snapback4/packages/snapback4/src/replica/replica.ts:101):
  ```typescript
  await tx.put(event.table, row);
  ```

Scenario: a group has messages `m1,m2,m3`, ordered oldest to newest, and `last 2`. A snapshot delivers `{m2,m3}`.

- Insert `m4`: the stream delivers `put(m4)` without evicting `m2`. The device holds `{m2,m3,m4}` instead of `{m3,m4}`.
- Starting again from `{m2,m3}`, delete `m3`: the device holds `{m2}` instead of `{m1,m2}`.
- Updating an old, excluded row delivers it regardless of horizon position. Moving a row between groups likewise does not repair either group’s boundary.

These outcomes were reproduced with the actual replica.

**Device versus rule:** Membership still authorizes these rows online, so this is not independently a read-rule disclosure. It violates the claimed exact horizon and makes snapshot and streaming devices disagree.

**Fix:** Maintain each affected group’s before/after horizon sets, emitting evictions and replacement puts for inserts, deletes, ordering changes, and group moves.

**7. Medium — Deleting one of several membership rows revokes a still-authorized group**

Evidence:

- [schema.rs:722](/Users/ccheever/projects/snapback-sb4/snapback4/crates/snapback4-core/src/schema.rs:722) requires an audience index, but not uniqueness:
  ```rust
  if !target.indexes.values().any(|index| index.columns() == wanted_index) {
  ```
- [partition.rs:166](/Users/ccheever/projects/snapback-sb4/snapback4/crates/snapback4-core/src/partition.rs:166):
  ```rust
  if let Some((principal, group)) = &was {
      runner.events.push(Event { partition: principal.clone(), table: content_name.clone(), kind: EventKind::Scope, id: canonical_json(group), data: Some(Value::Array(group.clone())) });
  }
  ```

Scenario: declare a nonunique index over `(group, principal)` and the required reverse index. Two target rows, `b1` and `b2`, both contain `(g1,Bob)`. Content reads under `exists members[.group, viewer]`, syncs to that audience, and uses `until-revoked`.

Bob acquires message `m1` in `g1`. Delete `b1`, leaving `b2` unchanged. The engine emits a scope for Bob without checking whether another qualifying membership remains.

**Device versus rule:** The replica removes `m1`; the read rule remains true through `b2`. No bootstrap restores unchanged content, so the loss persists.

The existing chat schema’s unique membership index prevents this case there; the generic validator accepts it.

**Fix:** Require uniqueness of the complete audience tuple, or emit join/leave events only on transitions between zero and nonzero matching rows.

**8. Medium — A matching disjunct does not establish the claimed complete audience**

Evidence:

- [schema.rs:696](/Users/ccheever/projects/snapback-sb4/snapback4/crates/snapback4-core/src/schema.rs:696):
  ```rust
  if !table.rules.read.disjuncts().iter().any(|d| **d == implied || **d == implied_flipped) && !table.rules.read.is_uniformly_readable() {
  ```
- [partition.rs:141](/Users/ccheever/projects/snapback-sb4/snapback4/crates/snapback4-core/src/partition.rs:141):
  ```rust
  .filter_map(|(name, _, sync)| match &sync.audience {
      Audience::Target { table, .. } if table == table_name => Some((name.to_owned(), sync.clone())),
      _ => None,
  })
  ```

Scenario:

```q
read <- exists memberships[.conversationId, viewer] or .authorId = viewer
sync to memberships[.conversationId]
```

Use `until-revoked`. Bob authored `m1` and initially belongs to its conversation. Bob then leaves.

**Device versus rule:** The scope removes `m1`, although the author disjunct still authorizes Bob. A fresh snapshot also omits it. More generally, a principal authorized only through an additional disjunct receives no corresponding partition.

**Fix:** For the claimed exact-row property, require equivalence between the complete read rule and the declared audience, or invert the union and maintain all branches. Matching one sufficient disjunct establishes only a potentially incomplete audience.

**What remains undetermined**

- I executed current TypeScript replica/store/rule code in memory with constructed scenarios. Rust schema admission and event production were traced from source; the pagination execution used a literal model, not the compiled Rust function. No new end-to-end server tests were built or run.
- Snapshot replacement has an additional suspicious behavior: [replica.ts:94](/Users/ccheever/projects/snapback-sb4/snapback4/packages/snapback4/src/replica/replica.ts:94) performs only `await tx.setMeta(WATERMARK, 0);`. Directly applying an empty replacement snapshot retained old rows in my test. I did not establish an ordinary transport sequence reaching this with stale authoritative rows: the generation-change path separately calls `await this.store.clearRows();` at [replica.ts:71](/Users/ccheever/projects/snapback-sb4/snapback4/packages/snapback4/src/replica/replica.ts:71).
- I did not verify crash recovery, IndexedDB transaction failure, authentication changes, or generation-transition ordering.
- For the unmodified chat audience, a count greater than the 500-message horizon is not by itself a hidden-row disclosure: current members may read older messages online. The count disclosures established above arise from incorrect recipients or missing source-authority validation.