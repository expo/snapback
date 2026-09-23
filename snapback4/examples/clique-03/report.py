import argparse,json,re,pathlib,hashlib

parser=argparse.ArgumentParser(description="Generate or check the Clique review report against retained assertion logs.")
parser.add_argument("--check",action="store_true")
args=parser.parse_args()
root=pathlib.Path(__file__).resolve().parents[2]
evidence=root/"reports/20260923-integration-r1"

def output(path, content):
    if args.check:
        assert path.read_text()==content, f"{path}: report differs from checked evidence"
    else:
        path.write_text(content)
def records(name):
    s=(evidence/f'{name}.log').read_text()
    assert 'test result: ok.' in s or 'ℹ fail 0' in s
    assert not re.search(r'test result: FAILED|ℹ fail [1-9]',s)
    out={}
    for tag,raw in re.findall(r'(CLIQUE_[A-Z_]+) (\{[^\n]*\})',s): out.setdefault(tag,[]).append(json.loads(raw))
    return out
f=records('full');r=records('reduced');c=records('census')
assert len(f['CLIQUE_OK'])==1 and f['CLIQUE_OK'][0]['full'] is True
assert len(r['CLIQUE_OK'])==1 and r['CLIQUE_OK'][0]['full'] is False
one=lambda tag:f[tag][0]
census=c['CLIQUE_CENSUS'][0];negative=c['CLIQUE_CENSUS_NEGATIVE'][0]
seed=one('CLIQUE_SEED');cold=one('CLIQUE_COLD');adopt=one('CLIQUE_ADOPTION');store=one('CLIQUE_STORE');restart=one('CLIQUE_RESTART');transitions=one('CLIQUE_TRANSITIONS');done=one('CLIQUE_OK')
reads={x['reader']:x for x in f['CLIQUE_READ']};writes={x['author']:x for x in f['CLIQUE_WRITE']};ratios=one('CLIQUE_RATIOS');wr=one('CLIQUE_WRITE_RATIO');ordinary=next(x for x in writes if x!='u0900');amp={(x['body_bytes'],x['mode']):x for x in f['CLIQUE_AMPLIFICATION']}
assert wr['celebrity_followers']==900 and wr['ordinary_followers']==5
assert ratios['dense_sparse']==reads['u0500']['p95_ms']/reads['u0005']['p95_ms']
assert ratios['celebrity_sparse']==reads['u0901']['p95_ms']/reads['u0005']['p95_ms']
assert wr['celebrity_ordinary']==writes['u0900']['ack_p95_ms']/writes[ordinary]['ack_p95_ms']
assert max(ratios['dense_sparse'],ratios['celebrity_sparse'],wr['celebrity_ordinary'])<=3
assert all(x['samples']==reads['u0005']['samples'] for x in writes.values())
assert all(restart[x] for x in ['follow_unfollow_queue','intents_survived_process_exit','outbox_empty','posting_predicts'])
assert all(transitions[x] for x in ['duplicate_repost_idempotent','following_after_unrepost','original_removal_preserves_repost','removed_not_trending','recorded_tombstones_gone','unlike_zero'])
assert all(adopt['device_queries'][x]['server_equal'] and restart['device_queries'][x]['server_equal'] for x in ['following','trending','thread'])
assert adopt['server_counts']['posts_checked']==adopt['device_counts']['posts_checked']==seed['replay']['posts']
assert restart['settled_reply_position']==47
assert census['files'][0]['sha256']==hashlib.sha256((root/'examples/clique-03/snapback/schema.q').read_bytes()).hexdigest()
loadtext=[]
for mode in ['reduced','full']:
    data=json.loads((evidence/f'{mode}-load.json').read_text())
    assert data['end']['exit']==0
    assert data['start']['load'][0]<12 or data['start']['wait_s']>=1800
    loadtext.append(f"| {mode.title()} | {data['wait_started']} | {data['start']['wait_s']:.3f} s | "+' / '.join(f'{n:.2f}' for n in data['start']['load'])+' | '+' / '.join(f'{n:.2f}' for n in data['end']['load'])+' |')
rows=[]
def row(name,value):rows.append(f'| {name} | {value} |')
row('Seeding and model construction',f"{seed['elapsed_s']:.3f} s")
row('Entire serial full fixture',f"{done['elapsed_s']:.3f} s")
row('SQLite allocated bytes / physical rows after adoption',f"{store['sqlite_bytes']:,} B / {store['physical_rows']:,}")
row('Prior snapshot: rows / production JSON bytes / acquisition',f"{cold['rows']:,} / {cold['wire_bytes']:,} B / {cold['elapsed_s']:.3f} s")
row('Complete-app snapshot: rows / production JSON bytes / acquisition',f"{adopt['reacquired_rows']:,} / {adopt['reacquired_wire_bytes']:,} B / {adopt['reacquisition_s']:.3f} s")
row('Populated activation / row events',f"{adopt['activation_s']:.3f} s / {adopt['activation_row_events']}")
for who,label in [('u0005','Sparse'),('u0500','Dense'),('u0901','Celebrity reader')]:
    v=reads[who];row(f'Following {label.lower()}: examined / p95',f"{v['metered']['examined']} / {v['p95_ms']:.6f} ms")
row('Dense/sparse read p95 ratio',f"{ratios['dense_sparse']:.3f}× (asserted ≤ 3×)")
row('Celebrity/sparse read p95 ratio',f"{ratios['celebrity_sparse']:.3f}× (asserted ≤ 3×)")
for who in [ordinary,'u0900']:
    v=writes[who];row(f"Post acknowledgement p95: {who}, {v['followers']} followers",f"{v['ack_p95_ms']:.6f} ms")
row('Celebrity/ordinary write p95 ratio',f"{wr['celebrity_ordinary']:.3f}× (asserted ≤ 3×)")
for width in [500,4000]:
    a,b=amp[width,'parent'],amp[width,'separate']
    ratio=a['stream_wire_bytes']/b['stream_wire_bytes']
    recorded=next(x for x in f['CLIQUE_AMPLIFICATION_RATIO'] if x['body_bytes']==width)
    assert ratio==recorded['parent_separate']
    row(f'{width:,}-byte parent: column / separate stream',f"{a['stream_wire_bytes']:,} / {b['stream_wire_bytes']:,} B ({ratio:.3f}×)")
    row(f'{width:,}-byte parent: column / separate aggregate event',f"{a['aggregate_event_bytes']:,} / {b['aggregate_event_bytes']:,} B")
measurement='\n'.join(rows)
output(evidence/'measurement-table.md', '| Measure | Full-fixture result |\n|---|---:|\n'+measurement+'\n')

# The report body is filled only after both fixture outcomes have passed.
correct=f['CLIQUE_CORRECT'][0];final_correct=f['CLIQUE_CORRECT'][-1]
mechanisms='\n'.join(f'| {label} | {census[key]} |' for key,label in [
('sourceFiles','Quarry files'),('sourceTables','Source tables'),('columns','Columns'),('maintains','Maintains'),('queries','Queries'),('mutations','Mutations'),('helpers','Helpers'),('jobs','Jobs'),('schedules','Schedules'),('applicationProjectionTables','Application projection tables'),('copiedAttributionFields','Copied attribution fields'),('verificationClauses','Verification clauses'),('repairOrBackfillJobs','Repair/backfill declarations'),('feedHelperCalls','Feed helper calls'),('zeroLikeFill','Zero-like fills')])
following='\n'.join(f"| {v['reader']} | {v['rows']:,} | {v['pages']:,} |" for v in f['CLIQUE_FOLLOWING'][:3])
test_rows=[]
for name,label in [
    ('admission','App admission'),('check','CLI app check'),('probe','Focused lifecycle regression'),
    ('affected','Affected engine/compiler tests'),('wire','Production wire encoding regressions'),
    ('census','Census and negative fixtures'),('fence','Published native/WASM refusal'),
    ('reduced','Reduced fixture'),('full','Full fixture, one invocation'),
]:
    log=(evidence/f'{name}.log').read_text()
    if name=='check':
        result=json.loads(log)
        assert result['ok'] is True, result
        test_rows.append(f'| {label} | ok=true | [{name}.log](./20260923-integration-r1/{name}.log) |')
        continue
    rust=re.findall(r'test result: ok\. (\d+) passed; 0 failed;',log)
    assert not re.search(r'test result: FAILED|ℹ fail [1-9]|ℹ skipped [1-9]',log)
    if rust: passed=sum(map(int,rust))
    else:
        assert 'ℹ fail 0' in log
        passed=int(re.search(r'ℹ pass (\d+)',log)[1])
    assert passed>0
    test_rows.append(f'| {label} | {passed} passed | [{name}.log](./20260923-integration-r1/{name}.log) |')

wasm=json.loads((evidence/'historical-wasm.json').read_text())
wasm_rows=[]
for key,label in [('published_0.2.33','Published 0.2.33'),('c842dbaa5','Pre-program c842dbaa5'),('current','Original integration build dced7a791')]:
    v=wasm[key]
    assert v['raw']>v['gzip_n9']>0 and len(v['sha256'])==64
    delta=f"+{wasm['current']['raw']-v['raw']:,} / +{wasm['current']['gzip_n9']-v['gzip_n9']:,}" if key!='current' else '—'
    wasm_rows.append(f"| {label} | {v['raw']:,} | {v['gzip_n9']:,} | {delta} |")
historical=(root/'reports/20260922-f3a-timeline.md').read_text()
comparison_rows=[]
for who,label in [('u0005','5 followed authors'),('u0500','500 followed authors'),('u0901','includes a 901-follower celebrity')]:
    match=re.search(r'\| Following: '+re.escape(label)+r' \| ([0-9.]+) \|', historical)
    assert match, f'missing historical recipe measurement: {label}'
    recipe=float(match[1]); current=reads[who]['p95_ms']; ratio=current/recipe
    assert recipe>0 and current>0
    comparison_rows.append(f"| {who} | {recipe:.4f} | {current:.6f} | {ratio:.3f}× |")
report=f'''# Clique 0.3 integration — review round 1

2026-09-23 · `sb4-03/integration`, changes above `53950e084`, uncommitted.

The strengthened reduced fixture and the single full fixture pass. Every result
below is derived from asserted checks or measured values in the linked
[evidence](./20260923-integration-r1/full.log). The report replaces the original
first-page device claims and hand-built response byte totals. These are local
engine/SQLite measurements, not HTTP/TLS, fsync, browser, or publication throughput.
No absolute-latency envelope against the historical recipe is claimed.

## Review disposition

1. **Production bytes — done.** Both acquisitions and contribution streams use
   the production `SnapshotReply`/`StreamReply` encoders. The snapshot type moved
   unchanged from `serve.rs` into `sync_wire.rs`; the CLI and test share that file.
   Production sequence, acknowledgement and store identity fields are included;
   serde controls omitted empty fields. Request-only metadata is attached only
   after measuring the response. Both existing wire encoding regressions pass.
2. **Restart/adoption — done.** All device cursor pages are compared to the server
   and independent model for Following, Trending and the thread. Each durable
   record matches its admit's id, operation, viewer, arguments, clock, order and
   prediction eligibility. Settlement consumes those durable records. Reply
   {restart['settled_reply_position']} is explicitly read, as are the settled like and
   `sp0001.likeCount` ({restart['settled_post_like_count']}). Complete id→value maps
   validate every post and received-like aggregate in both stores. Unknown ids,
   missing parents and missing nonzero fields fail. The documented implicit-zero
   representation is accepted only for model-zero parents; absent nonzero groups
   are never filled in.
3. **Census — done.** Recurses through every `.q` file, tokenizes strings and
   comments safely, inventories declarations and columns independent of whitespace,
   and rejects any declaration outside the complete allowlist. The complete
   timeline and both daily maintains are pinned, alongside every query and mutation.
   All {negative['rejected']} negative fixtures are rejected, including a nested
   projection file, copied fields, verification, repair/backfill, helper calls,
   helper declarations, schedules, altered timeline, post-day grouping and zero fill.
4. **Celebrity write — done.** Acknowledged posts by `u0900` and `{ordinary}` use
   the same {reads['u0005']['warmups']} warmups and {reads['u0005']['samples']} samples
   as reads. Their actual follower counts are asserted; nearest-rank p95 and all
   reader/write scaling bounds are checked against RFC §8's 3× limit.
5. **Removal/unlike/unrepost — done.** Each unlike checks the source-like,
   maintained-column and received-like models against storage. Following is checked
   after unrepost and after cleanup. Removal and unrepost must produce their
   tombstones before the timeline's own schedule fires; its queued job runs to
   Done and the recorded ids must disappear. Printed flags use those check results.
6. **App corrections — done.** Trending excludes removed posts. Like and repost
   first require an existing card, then refuse removal with `FEED_POST_REMOVED`;
   missing cards use `FEED_APP_NOT_FOUND`. Existing delivered reposts remain readable.
   The independent model has the same admission rules. Both daily maintains use
   **arrival day**, spelled `day(.at)` in the admitted Quarry grammar, replacing
   post-day grouping. A later-day like and reply on `rank-001` are checked across
   the seven-day window, post days, and the empty following day.
7. **Serial reruns/report — done.** Load-gated reduced and full runs completed,
   with one full invocation. Source, checks and results are retained below.

## App and independent oracle

The [app](../examples/clique-03/snapback/schema.q) has
{census['applicationSourceLines']} physical and {census['nonblankNoncommentLines']}
nonblank/noncomment lines. SHA-256:
`{census['files'][0]['sha256']}`.

`receivedLikes` now inherits public sync from likes so the requested adoption
comparison can inspect actual device aggregates. Other received/daily insights
remain online-only. This adds a received-like row to each measured contribution
stream and its nonzero groups to acquisition. Arrival-day grouping also removes
the need to record the post's time on those source rows. The byte changes therefore
include these deliberate schema corrections as well as the encoder correction.

| Census | Checked count |
|---|---:|
{mechanisms}

The fixture version and scale-log digest remain verified against the committed
social-messenger pack. Social operations use the application mutations and fixture
principals/ids. Synthetic arrival time advances in replay order. The fixture's
social cardinalities, named sparse/dense readers, promoted author and repost count
are asserted before adding targeted cases. Messaging, media and profile editing
remain outside this backend's scope. Expected counts and event membership come
from the independent source model, not engine projections.

| Initial Following reader | Checked events | Actual cursor pages |
|---|---:|---:|
{following}

Initial Trending checks {correct['trending_rows']:,} rows across
{correct['trending_pages']:,} pages. Initial insights compare
{correct['count_values_checked']:,} values across {correct['authors_with_four_counts_checked']:,}
authors and {len(correct['days'])} days. Adoption visits
{adopt['server_counts']['posts_checked']:,} posts and
{adopt['server_counts']['received_like_groups_checked']:,} received-like groups in
both stores. Thread continuation reaches {restart['device_queries']['thread']['rows']}
rows across {restart['device_queries']['thread']['pages']} device pages after settlement.
Final model totals, including the targeted arrivals and acknowledged-write samples:
{done['posts']:,} posts, {done['likes']:,} likes, {done['replies']:,} replies and
{done['edges']:,} edges; final Trending has {final_correct['trending_rows']:,} rows.

The two checked tombstone ids are
`{transitions['tombstone_ids'][0]}` and
`{transitions['tombstone_ids'][1]}`. `{transitions['schedule']}` fires and its job
finishes in {transitions['purge_chunks']} chunks before both ids are confirmed absent.

## Updated measurement table

Cargo's repository test profile, in-memory SQLite, serial operations. Seeding
includes compilation, parsing, mutations and model construction; Cargo build time
is excluded. Snapshot byte counts sum compact production JSON envelopes over
1,000-row pages. Acquisition times exclude the subsequent oracle comparisons.
Store allocation includes indexes, partition logs, commits and recorded attribution.

| Measure | Full-fixture result |
|---|---:|
{measurement}

Every measured contribution has {amp[500,'parent']['events']} events: the like,
received-like aggregate, and parent mirror or separate count. Checks require exactly
one relevant aggregate event and no timeline event. The byte ratio is computed
from the encoded totals. This app's three card joins differ from the historical
raw-event recipe; the read tests assert examinations within its recorded envelope,
while the table reports the directly measured scaling ratios.

The [historical raw-event recipe](./20260922-f3a-timeline.md) had fewer joins and
different shared-host load. Its absolute p95 comparisons remain visible below;
they are computed from that report, not treated as a matched-load regression or
as a passing absolute-latency gate. This full run began at one-minute load
{json.loads((evidence/'full-load.json').read_text())['start']['load'][0]:.2f}.

| Reader | Historical recipe p95 ms | This app p95 ms | App / recipe |
|---|---:|---:|---:|
{chr(10).join(comparison_rows)}

The retained original WASM artifacts were re-read and recompressed with Apple
`gzip -n -9`; their byte counts and SHA-256 hashes still match the original report.
These are historical builds, not new builds of this revision. Full hashes are in
[the checked artifact record](./20260923-integration-r1/historical-wasm.json).

| Historical artifact | Raw B | Gzip B | Integration delta raw / gzip B |
|---|---:|---:|---:|
{chr(10).join(wasm_rows)}

Whole-artifact deltas do not independently attribute feature costs.

## Load and verification

[Reduced load samples](./20260923-integration-r1/reduced-load.json) and
[full load samples](./20260923-integration-r1/full-load.json) record every waiting
sample, start and end. Each run started below one-minute load 12 or after at least
30 minutes; no other lane-owned test/build ran during either fixture invocation.

| Fixture | Wait began | Wait | Start load 1/5/15 | End load 1/5/15 |
|---|---|---:|---|---|
{chr(10).join(loadtext)}

| Check | Result | Evidence |
|---|---|---|
{chr(10).join(test_rows)}

The report and its separate measurement table are generated from these logs by
`python3 examples/clique-03/report.py`. Its `--check` mode recomputes the ratios,
requires passing outcomes and compares both rendered files byte for byte; edited
or stale printed values fail. The census also binds the current schema digest.
The reduced fixture completes in {r['CLIQUE_OK'][0]['elapsed_s']:.3f} s.
Node 24.18.0 and Rust 1.97.0 were used. No engine counterexample was found by these
strengthened checks. The original cross-form admission blocker was already resolved
by `dced7a791`; this revision changes no engine semantics.

No commit, push, stash, LLP edit or `scripts/test.sh` invocation was made.
'''
output(root/'reports/20260923-integration.md', report)
print(('Checked' if args.check else 'Generated') + ' report and measurement table from passing evidence.')
