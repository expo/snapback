I'll classify this corpus myself in this session only. First I'll verify the frozen hashes, then read the rubric and RFC so every unit is counted the way §7 specifies.The rubric and §3 are the instrument. Next I’ll verify the frozen hashes and parse the nine SQL files with Postgres’s own AST.The distro Postgres parser is in place. I’ll inventory every top-level statement and plpgsql body node, then classify from that AST rather than from semicolon splits.The Postgres parser is available locally. I’ll encode §7’s counting rules and §3’s spellings in one script, then classify every AST unit from that.Hashes match `freeze.json`. Classification is in `out/units.jsonl` (1293 units), `out/summary.md`, `out/verified-hashes.json`, and `out/parse_classify.py`.

The parser is pglast 6.2 on libpg_query 16.1 (PostgreSQL 16.1), not the Postgres 17 parser named in the RFC's verification paragraph. Every frozen statement parsed. Muse files were parsed after replacing `{{P}}` with `ns_`; the recorded hashes are of the unsubstituted bytes.

Post-rewrite means class `refused`. Raw refusal means `rewritten` or `refused`. Ignored boilerplate stays in the main denominator. Column and constraint units, and signatures, are not added to the top-level or body rates.

| Tier | n | admitted | canonicalized | rewritten | refused | ignored | raw | post-rewrite |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- |
| Top-level | 354 | 78 | 12 | 55 | 143 | 66 | 198/354 (0.5593) | 143/354 (0.4040) |
| Body | 354 | 85 | 0 | 27 | 242 | 0 | 269/354 (0.7599) | 242/354 (0.6836) |
| Columns and constraints | 548 | 340 | 12 | 22 | 174 | 0 | 196/548 (0.3577) | 174/548 (0.3175) |
| Signatures | 37 | 0 | 1 | 1 | 35 | 0 | 36/37 (0.9730) | 35/37 (0.9459) |

**Stop-rule arithmetic.** Post-rewrite top-level refusals are 143/354. One third of 354 is 118. `143 × 3 = 429 > 354`, so that rate exceeds one third. Post-rewrite body refusals are 242/354. `242 × 3 = 726 > 354`, so that rate exceeds one third. Excluding ignored units, top-level is 143/288 (0.4965), which still exceeds one third. Body has no ignored units.

**Muse `is_member`:** yes, after the registered inline. The body is `exists (select 1 from members where conversation_id = c and user_id = u and left_at is null)`. The primary key is `(conversation_id, user_id)`, so that is a full-key probe plus the residual `left_at is null`. §3.3 names that probe as an admitted rule and says the residual blocks audience inversion. The rubric says this corpus does not by itself require device replication, and no product brief in the frozen directory requires the rule offline. The helper signature is still a refused unit: the family contains `::uuid` and `user_id::text`, so the uuid parameter is not rewritten to `snapback.principal`.

**Astra `clqfa_like_counter`:** yes. The trigger is `after insert or delete` and does `like_count+1` / `like_count-1` with no floor and no other write. `clqfa_likes.post` is the single contributor. That bundle is rewritten to `snapback.count('clqfa_likes', by => 'post')`. Ambiguity: an update of `clqfa_likes.post` is not in the frozen writers and would be maintained by `snapback.count` but not by this trigger.

**Muse `bump_counters`:** no. Deletes use `greatest(like_count - 1, 0)` (and the same floor for reposts and replies). `snapback.count` has no such side effect.

**Muse `enforce_message_windows`:** no. The intervals are `cfg_windows()` JSON, defaulting to 900 and 3600, not fixed intervals. `msg_upd` allows a direct sender `UPDATE`, and there is no edit mutation to hold the `raise` and the `NEW.edited` assignment. `expire_tick` is covered only by the `NEW.purged` bypass.

**Muse `feed`:** no. `union all` does keep original and repost cards separate, but Following admission needs published public sources and immutable mapped columns. There is no `snapback.publish` and no `snapback.immutable`, and `post_upd` lets the author update the row. `tab = 'global'` is not the Following audience. `viewer uuid` is not `auth.uid()`. Continuation is a keyset predicate on `before_ts` / `before_id`, which §3.5 refuses. Removing the CTEs is not equivalence.

Named instances without a behavior-preserving admitted spelling after the registered rewrite: `bump_counters`, `enforce_message_windows`, and `feed`.

Ambiguities that move units, with ids in `summary.md`: `integer` versus §3.1's `bigint` spelling; `varchar(n)` columns versus the argument-typmod rule; `PRIMARY KEY` read as uniqueness; text/uuid foreign keys without `ON DELETE` refused because the reference spelling is `snapback.id`; UUID-specific operations taken at family scope (`::uuid`, `user_id::`); nullable parameters and locals refused for ordering and boolean tests because earlier `IF` narrowing is not tracked across statement nodes; `if not exists` included in the table's top-level class rather than children alone; language-sql bodies counted in the body denominator; no `snapback.immutable` call, so `using (E) with check (E)` is not the single-image alias.
