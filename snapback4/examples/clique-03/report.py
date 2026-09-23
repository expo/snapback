import argparse
import hashlib
import json
import pathlib
import re

parser = argparse.ArgumentParser(description="Render current checks beside retained full-fixture measurements.")
parser.add_argument("--check", action="store_true")
args = parser.parse_args()
root = pathlib.Path(__file__).resolve().parents[2]
current = root / "reports/20260923-integration-r2"
historical = root / "reports/20260923-integration-r1"


def output(path, content):
    if args.check:
        assert path.read_text() == content, f"{path}: report differs from evidence"
    else:
        path.write_text(content)


def passing(path):
    text = path.read_text()
    assert not re.search(r'test result: FAILED|ℹ (?:fail|skipped|cancelled) [1-9]', text), path
    rust = re.findall(r'test result: ok\. (\d+) passed; 0 failed;', text)
    if rust:
        passed = sum(map(int, rust))
    else:
        assert 'ℹ fail 0' in text, path
        passed = int(re.search(r'ℹ pass (\d+)', text)[1])
    assert passed > 0, path
    return text, passed


def records(path):
    text, _ = passing(path)
    out = {}
    for tag, raw in re.findall(r'(CLIQUE_[A-Z_]+) (\{[^\n]*\})', text):
        out.setdefault(tag, []).append(json.loads(raw))
    return out


def one(records, tag):
    assert len(records[tag]) == 1, tag
    return records[tag][0]


def flags(value, path=()):
    # full is fixture selection metadata. All other booleans are asserted results.
    if isinstance(value, bool):
        if path[-1] != 'full':
            assert value is True, path
    elif isinstance(value, dict):
        for key, child in value.items():
            flags(child, (*path, key))
    elif isinstance(value, list):
        for child in value:
            flags(child, path)


f = records(historical / 'full.log')
r = records(current / 'reduced.log')
c = records(current / 'census.log')
assert one(f, 'CLIQUE_OK')['full'] is True
assert one(r, 'CLIQUE_OK')['full'] is False
flags(r)
seed = one(r, 'CLIQUE_SEED')
adopt = one(r, 'CLIQUE_ADOPTION')
restart = one(r, 'CLIQUE_RESTART')
t = one(r, 'CLIQUE_TRANSITIONS')
a = one(r, 'CLIQUE_ARRIVAL_DAYS')
g = one(r, 'CLIQUE_FOLLOWERS')
done = one(r, 'CLIQUE_OK')
census = one(c, 'CLIQUE_CENSUS')
negative = one(c, 'CLIQUE_CENSUS_NEGATIVE')
load = json.loads((current / 'reduced-load.json').read_text())
assert load['end']['exit'] == 0 and '--test-threads=4' in load['command']
for record, names in [
    (restart, ['posting_predicts', 'follow_unfollow_queue', 'intents_survived_process_exit', 'outbox_empty']),
    (t, ['duplicate_repost_idempotent', 'following_after_unrepost', 'original_removal_preserves_repost',
         'removed_not_trending', 'unlike_zero', 'tombstones_present_before', 'recorded_tombstones_gone']),
    (a, ['post_unchanged', 'arrival_gained_both']), (g, ['edges_equal']),
]:
    assert all(record[name] is True for name in names)
for observation in [adopt, restart]:
    assert all(observation['device_queries'][op]['server_equal'] is True
               for op in ['following', 'trending', 'thread'])
assert all(v['equal_timestamp_cursor'] is True for v in r['CLIQUE_CORRECT'])
assert all(v['oracle'] is True for v in r['CLIQUE_FOLLOWING'])
actual_files = sorted((root / 'examples/clique-03/snapback').rglob('*.q'))
assert census['files'] == [dict(file=str(p.relative_to(root / 'examples/clique-03/snapback')),
                              sha256=hashlib.sha256(p.read_bytes()).hexdigest()) for p in actual_files]
assert negative['rejected'] == len(negative['fixtures']) == len(set(negative['fixtures']))
parser_source = (root / 'crates/snapback4-lang/src/parser.rs').read_text()
kinds = re.findall(r'"([^"]+)"', re.search(r'const TOP_LEVEL:[^=]+=[\s\S]*?\[([\s\S]*?)\];', parser_source)[1])
assert all(f'declaration_{kind}' in negative['fixtures'] for kind in kinds)
assert all(census[key] == 0 for key in ['applicationProjectionTables', 'copiedAttributionFields',
    'verificationClauses', 'repairOrBackfillJobs', 'feedHelperCalls', 'zeroLikeFill', 'projectionWrites',
    'jobs', 'schedules', 'helpers'])
assert g['stored_edges'] == g['model_edges'] == done['edges']
assert g['celebrity_followers'] == 62 and g['ordinary_followers'] == 5
assert adopt['activation_row_events'] == 0 and adopt['generation'] > adopt['old_generation']
assert all(adopt['server_counts'][key] == adopt['device_counts'][key]
           for key in ['posts_checked', 'received_like_groups_checked', 'likes_checked'])
assert adopt['server_counts']['posts_checked'] == seed['stored']['posts'] == seed['replay']['posts']
assert restart['queued'] == 5 and restart['settled_reply_position'] == 47
assert restart['settled_post_like_count'] > 0
assert len(t['tombstone_ids']) == len(set(t['tombstone_ids'])) == 2
assert t['tombstoned_events'] == ['lifecycle-repost-event', 'rank-003']
assert t['tombstone_table'] == 'feedRemovedEvents'
assert t['purge_chunks'] > 0 and t['purge_job_id'] not in t['jobs_before']
assert t['purge_target'] == 'feedPurgeRemoved' and t['schedule'] == 'feedPurgeRemovedEvery'
assert t['removed_like_refusal'] == t['removed_repost_refusal'] == 'FEED_POST_REMOVED'
assert a['arrival_day'] > a['post_day']
assert a['post_after'] == a['post_before']
assert a['arrival_after'] == [v + 1 for v in a['arrival_before']]
assert a['like_at'] // 86400000 == a['reply_at'] // 86400000 == a['arrival_day']


def measurements(records):
    reads = {v['reader']: v for v in records['CLIQUE_READ']}
    writes = {v['author']: v for v in records['CLIQUE_WRITE']}
    ratios = one(records, 'CLIQUE_RATIOS')
    wr = one(records, 'CLIQUE_WRITE_RATIO')
    ordinary, = (who for who in writes if who != 'u0900')
    assert ratios['dense_sparse'] == reads['u0500']['p95_ms'] / reads['u0005']['p95_ms']
    assert ratios['celebrity_sparse'] == reads['u0901']['p95_ms'] / reads['u0005']['p95_ms']
    assert wr['celebrity_ordinary'] == writes['u0900']['ack_p95_ms'] / writes[ordinary]['ack_p95_ms']
    assert max(ratios['dense_sparse'], ratios['celebrity_sparse'], wr['celebrity_ordinary']) <= 3
    assert all(v['samples'] == 20 and v['warmups'] == 3 for v in [*reads.values(), *writes.values()])
    for who, count in [('u0900', wr['celebrity_followers']), (ordinary, wr['ordinary_followers'])]:
        assert writes[who]['followers'] == count
    amp = {(v['body_bytes'], v['mode']): v for v in records['CLIQUE_AMPLIFICATION']}
    for ratio in records['CLIQUE_AMPLIFICATION_RATIO']:
        width = ratio['body_bytes']
        assert ratio['parent_separate'] == amp[width, 'parent']['stream_wire_bytes'] / amp[width, 'separate']['stream_wire_bytes']
    assert all(v['events'] == 3 for v in amp.values())
    return reads, writes, ratios, wr, amp


_, current_writes, _, current_ratio, _ = measurements(r)
assert current_ratio['celebrity_followers'] == g['celebrity_followers']
assert current_ratio['ordinary_followers'] == g['ordinary_followers']
assert current_writes[g['ordinary']]['followers'] == g['ordinary_followers']
reads, writes, ratios, wr, amp = measurements(f)
rows = []


def row(label, value):
    rows.append(f'| {label} | {value} |')


row('Full fixture elapsed', f"{one(f, 'CLIQUE_OK')['elapsed_s']:.3f} s")
for who, v in reads.items():
    row(f'Following {who}: examined / p95', f"{v['metered']['examined']} / {v['p95_ms']:.6f} ms")
for who, v in writes.items():
    row(f'Post acknowledgement {who} p95', f"{v['ack_p95_ms']:.6f} ms")
row('Dense / sparse read p95', f"{ratios['dense_sparse']:.3f}×")
row('Celebrity-reader / sparse p95', f"{ratios['celebrity_sparse']:.3f}×")
row('Celebrity / ordinary post p95', f"{wr['celebrity_ordinary']:.3f}×")
for width in [500, 4000]:
    row(f'{width:,}-byte parent: column / separate stream',
        f"{amp[width, 'parent']['stream_wire_bytes']:,} / {amp[width, 'separate']['stream_wire_bytes']:,} B")
for tag, label, rows_key, bytes_key in [('CLIQUE_COLD', 'Prior snapshot', 'rows', 'wire_bytes'),
        ('CLIQUE_ADOPTION', 'Complete-app snapshot', 'reacquired_rows', 'reacquired_wire_bytes')]:
    v = one(f, tag)
    row(f'{label}: rows / production JSON bytes', f"{v[rows_key]:,} / {v[bytes_key]:,} B")
historical_table = '| Measure | Round-1 full-fixture measurement |\n|---|---:|\n' + '\n'.join(rows) + '\n'
output(current / 'measurement-table.md', historical_table)
checks = []
for name in ['reduced', 'probe', 'affected', 'wire', 'census', 'fence']:
    _, count = passing(current / f'{name}.log')
    checks.append(f'| {name} | {count} passed | [{name}.log](./20260923-integration-r2/{name}.log) |')

report = f'''# Clique 0.3 integration — final review round

`sb4-03/integration` rebased onto `a63c37f7b`. Current correctness evidence is
[the reduced fixture](./20260923-integration-r2/reduced.log). Full-fixture timings
below are retained from [round 1](./20260923-integration-r1/full.log); the full
fixture was not rerun. This round changes verification, with no changes to the
Quarry application or timed operations. New checks at full scale remain unrun.

## Checked observations

- The recursive source census finds {census['sourceTables']} application tables,
  {census['maintains']} maintains, {census['queries']} queries and {census['mutations']}
  mutations. All {negative['rejected']} negative fixtures fail, including every
  one of the parser's {len(kinds)} declaration kinds inserted before `maintain feed`.
  Every table block is pinned. Projection tables, copied fields, verification,
  repair/backfill declarations, feed helpers, zero-like fill and projection writes
  all count zero. The census binds every current Quarry file by digest.
- Before write timing, the engine's complete stored follows set equals the model:
  {g['stored_edges']} edges. Stored rows give `u0900` {g['celebrity_followers']} followers
  and `{g['ordinary']}` {g['ordinary_followers']}. Full mode requires 900 and 5 from
  storage, but that new full-mode check has not run. Round 1's 900/5 labels were
  model-derived and are not presented as new stored-row evidence.
- Activation advances generation {adopt['old_generation']} → {adopt['generation']}
  with {adopt['activation_row_events']} row events. Engine and device maps agree on
  {adopt['server_counts']['posts_checked']} posts and
  {adopt['server_counts']['received_like_groups_checked']} received-like groups.
  Complete device Following, Trending and thread pages equal the engine and model.
- All {restart['queued']} admitted intents match their durable records across a
  process exit. Posting predicts, follow/unfollow queue, and settlement empties
  the outbox. The settled reply is at position {restart['settled_reply_position']};
  the device's stored `sp0001.likeCount` is {restart['settled_post_like_count']}.
  Engine and device rows are checked against the model. The equal-time cursor
  check compares all 45 engine reply ids/timestamps and spans at least three pages.
- Duplicate reposts leave the source and timeline event rows equal. Removing the
  original preserves the delivered repost and excludes the original from Trending.
  Like/repost return `{t['removed_like_refusal']}` on the removed card. Unlike
  reaches stored count zero; Following equals the model after unrepost and purge.
- `{t['tombstone_table']}` contains {len(t['tombstone_ids'])} recorded tombstone ids
  for `{t['tombstoned_events'][0]}` and `{t['tombstoned_events'][1]}` before firing.
  `{t['schedule']}` creates job `{t['purge_job_id']}`, absent from the earlier job
  ids, targeting `{t['purge_target']}`. That exact job executes {t['purge_chunks']}
  chunks, reaches Done, and both stored tombstones are absent afterward.
- Engine daily counters for `{a['author']}` on `{a['post']}` are shown below.
  Each pair is **[received likes, received replies]**. Both contributions arrive
  on day {a['arrival_day']}; the old post-day counters remain equal.

| Engine bucket | Before | After |
|---|---|---|
| Post day {a['post_day']} | {a['post_before']} | {a['post_after']} |
| Arrival day {a['arrival_day']} | {a['arrival_before']} | {a['arrival_after']} |

Final stored source counts match the model: {done['posts']} posts,
{done['likes']} likes, {done['replies']} replies and {done['edges']} follows.

## Retained full-fixture measurements

These local engine/SQLite measurements include production sync JSON encoding.
They exclude HTTP/TLS and browser throughput. Ratios are recomputed from the
retained samples and checked against 3×. No new full-scale validation or
matched-load comparison is inferred from them. Original historical WASM byte
records remain in [round-1 evidence](./20260923-integration-r1/historical-wasm.json);
this report makes no claim about a current WASM build.

{historical_table}
## Current verification

| Check | Result | Evidence |
|---|---:|---|
{chr(10).join(checks)}

The reduced fixture completes in {done['elapsed_s']:.3f} s. Its recorded one-minute
load is {load['start']['load'][0]:.2f} at launch and {load['end']['load'][0]:.2f} at exit;
it is a correctness rerun on the shared host, using `--test-threads=4`.
`report.py --check`
requires passing logs, validates the current booleans, compares daily deltas,
new-job identity, follower evidence and schema digests, recomputes timing ratios,
and compares the rendered report and measurement table byte for byte.

Printed claims changed: `CLIQUE_FOLLOWERS` (new stored-set comparison),
`CLIQUE_WRITE.followers`, `CLIQUE_WRITE_RATIO` follower counts,
`CLIQUE_TRANSITIONS` tombstone presence/new-job/chunk evidence,
`CLIQUE_ARRIVAL_DAYS` engine counts/deltas/timestamps,
`CLIQUE_RESTART.settled_post_like_count`, `CLIQUE_CORRECT.equal_timestamp_cursor`,
`CLIQUE_SEED.stored` and `CLIQUE_OK` source counts. The report now separates
current checks from historical timings and removes unverified process and
current-artifact assertions.
'''
output(root / 'reports/20260923-integration.md', report)
print(('Checked' if args.check else 'Generated') + ' report and measurement table from passing evidence.')
