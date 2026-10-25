#!/usr/bin/env python3
"""Bounded G7.0 aggregates. Individual repetitions/traces remain outside Git."""
import argparse
from collections import Counter, defaultdict
import json
from pathlib import Path
from statistics import median


def read(p):return json.loads(p.read_text())
def write(p,v):p.write_text(json.dumps(v,indent=2)+'\n')
def span(v):return dict(min=min(v),median=median(v),max=max(v),mean=sum(v)/len(v))
def groups(raw,kind):
    paths=raw.glob('[AB]/*/r[0-9].json') if kind=='matrix' else raw.glob(kind+'-[AB]/*/r[0-9].json')
    cells=defaultdict(list)
    for p in paths:
        x=read(p);cells[(x['arm'],x['depth'],x['link'],x['n'],x['connections'])].append(x)
    rows=[]
    for (arm,depth,link,n,c),xs in sorted(cells.items()):
        assert all(x['counter_check']['ok'] and x['deadlocks']==0 for x in xs)
        batches=sum(x['total_batches'] for x in xs);syncs=sum(x['wal_after']['wal_sync']-x['wal_before']['wal_sync'] for x in xs)
        rows.append(dict(arm=arm,depth=depth,link=link,n=n,connections=c,active_slots=xs[0]['active_slots'],repetitions=len(xs),warmup_s=xs[0]['warmup_s'],seconds=xs[0]['seconds'],offered_per_s=xs[0]['offered_per_s'],writes_per_s=span([x['writes_per_s'] for x in xs]),latency_mean_ms=span([x['latency_ms']['mean'] for x in xs]),latency_p50_ms=median(x['latency_ms']['p50'] for x in xs),latency_p99_ms=max(x['latency_ms']['p99'] for x in xs),client_mean_ms=span([x['client_service_ms']['mean'] for x in xs]),service_mean_ms=span([x['service_ms']['mean'] for x in xs]),syncs_per_batch=syncs/batches,wal_sync_mean_ms=sum(x['wal_after']['wal_sync_time']-x['wal_before']['wal_sync_time'] for x in xs)/syncs,cpu={k:median(x['cpu'][k] for x in xs) for k in ['PG','app','client']},phase_mean_ms={name:median(x['phases_ms'][i]['mean'] for x in xs) for i,name in enumerate(xs[0]['phase_names'])},errors=sum(x['error_count'] for x in xs),max_error_fraction=max(x['error_count']/(x['latency_ms']['n'] or 1) for x in xs),cohort_writes=sum(x['counter_check']['acknowledged'] for x in xs),slo_all=all(x['error_count']/x['latency_ms']['n']<=.001 and x['latency_ms']['p99']<=100 for x in xs),log_one=xs[0]['log_one'],logs=sum(x['counter_check']['logs'] for x in xs),batches=batches))
    return rows


def controls(raw):
    cells=defaultdict(list)
    for p in raw.glob('supabase-[AB]/rate-*-r[0-9].json'):
        if p.name.count('.')!=1:continue
        t=read(p);prefix=p.with_suffix('');b=read(Path(str(prefix)+'.before.json'));a=read(Path(str(prefix)+'.after.json'))
        ack=t['total_success_including_warmup'];syncs=a['wal']['wal_sync']-b['wal']['wal_sync'];commits=a['database']['xact_commit']-b['database']['xact_commit']
        # Utility query IDs repeat across effective users. Sum rows rather than
        # silently discarding duplicate query IDs in the role-filtered snapshot.
        statement_delta=Counter()
        for v,sign in [(a,1),(b,-1)]:
            for s in v['statements']:statement_delta[s['query']]+=sign*s['calls']
        cells[(p.parent.name[-1],t['options']['rate'])].append(dict(trial=t,syncs=syncs,commits=commits,ack=ack,statement_delta=statement_delta))
    out=[]
    for (link,rate),xs in sorted(cells.items()):
        out.append(dict(link=link,offered_per_s=rate,repetitions=len(xs),passing=sum(x['trial']['slo_pass'] for x in xs),writes_per_s=span([x['trial']['achieved_per_s'] for x in xs]),p50_ms=median(x['trial']['latency']['p50_ms'] for x in xs),p99_ms=max(x['trial']['latency']['p99_ms'] for x in xs),syncs_per_request=sum(x['syncs'] for x in xs)/sum(x['ack'] for x in xs),database_commits_per_request=sum(x['commits'] for x in xs)/sum(x['ack'] for x in xs),cohort_requests=sum(x['ack'] for x in xs),counter_all=all(x['trial']['counter_check']['ok'] for x in xs),request_context_calls_per_request=sum(sum(n for q,n in x['statement_delta'].items() if q.startswith("select set_config('search_path'")) for x in xs)/sum(x['ack'] for x in xs),rpc_calls_per_request=sum(sum(n for q,n in x['statement_delta'].items() if q.startswith('WITH pgrst_source AS')) for x in xs)/sum(x['ack'] for x in xs)))
    return out


def crashes(raw):
    rows=[read(p) for p in raw.glob('crash/*/result.json')];cells=defaultdict(list)
    for x in rows:cells[(x['depth'],x['n'],x['connections'])].append(x)
    return dict(trials=len(rows),acknowledged_lost=sum(x['acknowledged_lost'] for x in rows),prefix_failures=sum(not x['prefix_ok'] for x in rows),acknowledged_writes=sum(x['ack_batches']*x['n'] for x in rows),unacknowledged_recovered_writes=sum(x['recovered']['head']-x['ack_batches']*x['n'] for x in rows),old_children_ended=all(x['old_children_ended'] for x in rows),cells=[dict(depth=d,n=n,connections=c,trials=len(xs),links=sorted({x['link'] for x in xs}),lost=sum(x['acknowledged_lost'] for x in xs),prefix_ok=all(x['prefix_ok'] for x in xs)) for (d,n,c),xs in sorted(cells.items())])


def label(x):return 'E1' if x['arm']=='E' and x['depth']==1 else 'E2' if x['arm']=='E' else x['arm']
def config(x):return f"N={x['n']}, c={x['connections']}, active={x['active_slots']}"
def fmt(x):return f'{x:.2f}'
def table(rows):
    lines=['| Arm | Link | N | Conn. / active | Writes/s | Mean ms | p50 ms | p99 ms | Sync/batch | CPU PG/app/client |','|---|---|---:|---:|---:|---:|---:|---:|---:|---|']
    for x in rows:
        cpu='/'.join(f"{x['cpu'][k]:.2f}" for k in ['PG','app','client'])
        lines.append(f"| {label(x)} | {x['link']} | {x['n']} | {x['connections']}/{x['active_slots']} | {x['writes_per_s']['median']:.0f} | {x['latency_mean_ms']['median']:.2f} | {x['latency_p50_ms']:.2f} | {x['latency_p99_ms']:.2f} | {x['syncs_per_batch']:.3f} | {cpu} |")
    return '\n'.join(lines)


def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('raw',type=Path);p.add_argument('out',type=Path);p.add_argument('--native-parts',type=Path,required=True);p.add_argument('--partial',action='store_true');a=p.parse_args();a.out.mkdir(parents=True,exist_ok=True)
    matrix=groups(a.raw,'matrix');long=groups(a.raw,'long');logged=groups(a.raw,'logged');control=controls(a.raw);crash=crashes(a.raw)
    if not a.partial:
        assert len(matrix)==90 and all(x['repetitions']==3 for x in matrix)
        assert len(long)==10 and all(x['repetitions']==3 for x in long)
        assert len(logged)==24 and all(x['repetitions']==3 for x in logged)
        assert crash['trials']==36 and not crash['acknowledged_lost'] and not crash['prefix_failures']
        assert len(control)==3 and all(x['repetitions']==3 for x in control)
        assert not read(a.raw/'cleanup.json')['still_running']
    aggregate=dict(definitions=dict(primary='32 closed-loop clients, fixed N; exact S1 W4 tail; 3 repetitions of 1s warmup/4s measurement',long='32 clients, paced open-loop at 4525/s A or 2262/s B; 10s/20s, 3 repetitions; latency includes intended-time dispatch backlog; client_service_ms starts at client admission',reported='median rate/mean/p50 across repetitions; maximum repetition p99; syncs weighted by batch count; CPU median whole-trial logical CPUs, not physical cores'),matrix=matrix,long=long,logged=logged,control=control,crash=crash)
    write(a.out/'aggregate.json',aggregate)
    native=read(a.native_parts)
    for row in native['rows']:row.pop('source_window',None)
    write(a.out/'native-kh.json',native)
    if a.partial:return
    best={}
    for x in matrix:
        k=(label(x),x['link'])
        if k not in best or x['writes_per_s']['mean']>best[k]['writes_per_s']['mean']:best[k]=x
    verdict=['| Arm | A: open-loop client mean ms | ≤7.07 ms + SLO? | B: open-loop client mean ms | ≤14.15 ms + SLO? |','|---|---:|---|---:|---|']
    for arm in ['serial','S','E1','E2','C']:
        vals=[]
        for link,limit in [('A',7.07),('B',14.15)]:
            x=next(x for x in long if label(x)==arm and x['link']==link);v=x['client_mean_ms'];vals.extend([f"{v['min']:.2f}–{v['max']:.2f}", 'yes' if v['max']<=limit and x['slo_all'] and x['writes_per_s']['min']>=.999*x['offered_per_s'] else 'no'])
        verdict.append('| '+arm+' | '+' | '.join(vals)+' |')
    lines=['# G7.0 — write-pipelining arms on one host','',
        'The experiment measures the real S1 W4 SQL tail with a populated commit index. These are SQL-harness bounds; Quarry execution, HTTP ingress, G5/G6 publication gates and product recovery protocols are not implemented by the arms. No product code changes.','',
        '## Verdict at 32 clients','', '\n'.join(verdict),'',
        'Each range spans the three 10s/20s open-loop confirmations at 4,525/s A or 2,262/s B, using the strongest short-matrix configuration for that arm/link. Client residence includes batching and queueing after admission to the 32-client population; intended-time generator backlog is reported separately below. A yes requires every repetition’s client mean to meet the bound, write p99 ≤100 ms, errors ≤0.1%, and the offered rate to be delivered. This is a SQL-harness result, not a Snapback S1 capacity win. The short saturation matrix alone is insufficient: its serial B estimate does not survive the longer rung confirmation.','',
        'S remains near one WAL sync per batch and misses A. E2 reaches both targets while its best N=16 cells still use roughly one sync per batch: overlapping the next tail with the durable marker flush is the gain. C demonstrates flush sharing at N=8 with four active writers, but its fastest N=16 cells also use roughly one sync per batch.','',
        '## Method and custody','',
        '- Host: expo-build-450b, OS hostname `expose-builder-pixel-a`, Ryzen 5 3600, six physical/twelve logical CPUs. PostgreSQL: `0–2,6–8`; harness writer slots and the existing delayed proxy: `3–4,9–10`; client scheduler: `5,11`.','- PostgreSQL 16.15, inherited `scale-controls/postgresql.conf.delta`: fsync/full_page_writes on, fdatasync, commit_delay 0, 8 GiB shared buffers. S/C are synchronous; E disables synchronous commit only in the batch transaction and acknowledges after its following synchronous marker transaction.','- Link A adds 250 µs/direction; B adds 500 µs/direction through the unchanged one-host Unix proxy. RTT captures bracket each block. The inherited unrelated-process start gate runs before every measured repetition.','- Fixed N=8/16/32, 32 disjoint counter clients. Effective simultaneous batches are `min(depth, connections, 32/N)`. Thus N=32 has one active batch even with additional connections; E1 and serial always have one. All requested nominal connections are actually open.','- Primary matrix: 90 configurations × three 1 s warm-up/4 s measured repetitions. Strongest configurations receive three 10 s/20 s open-loop confirmations at the registered strict-win rung; these are additional trials, not replacements. One-log-row sensitivity covers each N using that N’s strongest primary connection configuration.','- Rates, mean and p50 are medians across repetitions; p99 is the worst repetition. Sync/batch is the summed private-cluster WAL sync delta divided by summed batches over warm-up+measurement+drain. It includes background WAL work; values slightly above one do not imply two batch flushes. CPU columns are sampled logical CPU usage for PG / harness writers+proxy / client over the whole trial; the app column also includes Python controller/sampler overhead.','',
        'The fixture compiles the actual S1 schema and seeds parents/counters plus the first 1,000 messages through `Engine::seed_at`. Immutable background messages use the product’s canonical row and index encoders and binary COPY; eight native seed rows and all their index keys are checked for exact parity. Room/user totals are set to the S1 values. Internal maintained contribution state is not reconstructed for the bulk-loaded background and is never read by W4. The fixture is a W4 SQL image, not a read-workload qualification. It uses synthetic account-session facts and a static owner row; periodic lease traffic and HTTP ingress resolution are absent.','',
        'One million contiguous historical `_commits` rows are retained using an actual seed-commit template; measured sequences/revisions begin above 1,000,000. The 1,000-row evidence window is restored between trials. Only measured rows are removed; `_commits` is vacuumed/analyzed and checkpointed before each trial. An earlier exploratory matrix that emptied the commit table is excluded and retained outside Git.','',
        '## Arm definitions','',
        '- **serial:** six-flight model of the serial G6 SQL shape: owner opener, head lock, composed facts, vector apply/tail, publication witness, separate synchronous COMMIT. The model omits the initial duplicate first-member authority lookup and times its own encode work, not the production committer’s interpreter/closure/receipt work; the archived native phase ledger remains the production baseline.','- **S:** depth two, fused owner/ticket/facts, then predecessor ticket wait and fresh head+revision CAS, vector tail and folded publication; client validates counts before a separate synchronous COMMIT.','- **E1/E2:** fused opener/facts; predecessor ticket wait/CAS and the same vector tail; `COMMIT` with local synchronous_commit off immediately followed in the same message by `BEGIN; SET LOCAL synchronous_commit=on; UPDATE _durable SET n=n+1 WHERE slot=...; COMMIT`. Only the final completion acknowledges the batch. Durable slots are disjoint across writer connections.','- **C:** independent disjoint batches, preassigned ranges, synchronous commit on. The tail’s head CTE becomes a constant range witness and the singleton revision update is omitted. Other tail CTEs and owner key-share remain. It has no visibility/publication protocol.','',
        'S/E use disjoint evidence-pruning ranges and a head/revision CAS. C also uses disjoint pruning ranges, avoiding a shared delete hot spot. Tail counts are checked, with a server-side commit-count assertion before any co-dispatched COMMIT. The original vector SQL, authority/facts and level SQL are imported from product source; no product file is edited. W4 has zero dependent-level flights.','',
        '**Actual S1 W4 emits zero `_log` rows**: counters are `online only`, and templates captured from real `Engine::mutate` invocations contain an empty log vector. The `_log` CTE still executes. The separate sensitivity below adds one log row per write rather than silently changing the primary workload. Unkeyed W4 also has no `_ops` receipt rows or effects.','',
        '## Complete primary matrix','',table(matrix),'',
        '## Open-loop strict-rung confirmations','',
        '| Arm | Link | Configuration | Offered / achieved/s | Intended mean ms range | Client mean ms range | Worst p99 ms | Error fraction max | SLO all three |','|---|---|---|---:|---:|---:|---:|---:|---|']
    for x in long:
        i=x['latency_mean_ms'];c=x['client_mean_ms'];lines.append(f"| {label(x)} | {x['link']} | {config(x)} | {x['offered_per_s']:.0f} / {x['writes_per_s']['median']:.0f} | {i['min']:.2f}–{i['max']:.2f} | {c['min']:.2f}–{c['max']:.2f} | {x['latency_p99_ms']:.2f} | {100*x['max_error_fraction']:.3f}% | {'yes' if x['slo_all'] else 'no'} |")
    lines += ['', 'The 1,000 ms arrival deadline and 100 ms write p99 are retained in these SQL-driver confirmations. Expired arrivals and late confirmations are counted as errors. They exercise the tail and collection/dispatch phasing; they do not include native HTTP/authentication/Quarry costs.','', '## Serial K/H and durability ledger','',
        '| Link | N | Opener ms | Facts ms | Levels ms | Harness encode ms | Apply+tail ms | Publication ms | COMMIT ms | WAL sync ms | Sync/batch |','|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|']
    for x in matrix:
        if x['arm']=='serial' and x['connections']==1:
            ph=x['phase_mean_ms'];values=[ph[k] for k in ['opener_or_fused_facts','facts','levels','K_encode','apply_tail_or_combined_completion','publication','COMMIT']]+[x['wal_sync_mean_ms'],x['syncs_per_batch']]
            lines.append(f"| {x['link']} | {x['n']} | "+' | '.join(f'{v:.3f}' for v in values)+' |')
    lines += ['', 'WAL sync is a component of COMMIT and must not be added to it. The SQL-driver encode span excludes native Quarry interpretation and committer work. The retained native S1 clocks provide the following separate K/H decomposition; this is a new analysis of archived measurements, not a new native trial.','',
        '| Native link/rate | Batches | Cycle ms | Opener flights ms | K outside named phases ms | K outside flights+parallel ms | H external ms | H + intake/admission/encode ms |','|---|---:|---:|---:|---:|---:|---:|---:|']
    for r in read(a.native_parts)['rows']:
        b=r['batch_bins'][0];h=r['http'];values=[b['cycle_ms']['mean'],b['opener_flight_ms']['mean'],b['K_outside_named_phases_ms']['mean'],b['K_residual_wall_ms']['mean'],h['H_external_ms']['mean'],h['H_external_intake_admission_encode_ms']['mean']]
        lines.append(f"| {r['link']} / {r['offered_per_s']} | {b['cycle_ms']['n']} | "+' | '.join(f'{v:.3f}' for v in values)+' |')
    lines += ['', '| Native link/rate | Opener flights ms | Facts ms | Levels ms | Parallel ms | Apply+tail ms | Publication ms | COMMIT ms |', '|---|---:|---:|---:|---:|---:|---:|---:|']
    for r in read(a.native_parts)['rows']:
        b=r['batch_bins'][0]
        values=[b[k]['mean'] for k in ['opener_flight_ms','facts_ms','levels_ms','parallel_ms','apply_tail_ms','publication_ms','COMMIT_ms']]
        lines.append(f"| {r['link']} / {r['offered_per_s']} | "+' | '.join(f'{v:.3f}' for v in values)+' |')
    lines += ['', 'K outside named phases is the additive residual after subtracting measured opener flights and all named phase wall times. The second K column also includes client work inside facts/tail phase wrappers, so it is not additive to those wrappers. Neither is a direct CPU measurement. H external is client-send→server-accept plus server-write-end→client-completion; it excludes generator backlog and server residence. The expanded H column adds measured intake/admission/JSON encode. Uninstrumented glue remains; no assumed RTT is subtracted to manufacture a CPU number. Native source under `snapback4/crates` is unchanged between the diagnosis branch and the G7 base.','',
        '## One log row per write — sensitivity','',table(logged),'', 'With one log row per write, E2 N=16/A reaches 4,320–4,376/s at 7.31–7.41 ms mean, missing A. C N=16/A reaches 4,556–4,636/s at 6.91–7.03 ms, with little headroom. These sensitivity cells have short windows only; they do not receive the longer rung confirmation. The primary A verdict therefore applies specifically to the actual empty-log S1 W4 tail.','',
        '## Arm E crash/restart test','',f"{crash['trials']} seeded random SIGKILL injections, both links, N=8/16/32, depth 1/2 and 1/2/3 connections. Acknowledgements are recorded only after the synchronous marker completes and are synced to an external acknowledgement file. The postmaster is killed; every recorded old child must end before ordinary PostgreSQL crash recovery/restart. No old transaction is allowed to overlap recovery.",'',f"**Acknowledged writes lost: {crash['acknowledged_lost']}. Prefix failures: {crash['prefix_failures']}.** Across the tests, {crash['acknowledged_writes']:,} writes are acknowledged; {crash['unacknowledged_recovered_writes']:,} additional writes recover without an acknowledgement. Every recovered head/revision equals the contiguous benchmark commit count, counters match per-principal commits, and no partial batch exists. Actual online-only logs remain empty.",'',
        'This is process-crash evidence, not power-loss testing. PostgreSQL’s synchronous marker is the durability mechanism; the test does not establish safe reader visibility between the async batch COMMIT and its marker, takeover behavior or an unknown-outcome API. Those remain product-design work.','',
        '| Depth | N | Connections | Crashes | Links | Acknowledged lost | Prefix |','|---:|---:|---:|---:|---|---:|---|']
    for x in crash['cells']:lines.append(f"| {x['depth']} | {x['n']} | {x['connections']} | {x['trials']} | {'/'.join(x['links'])} | {x['lost']} | {'pass' if x['prefix_ok'] else 'FAIL'} |")
    lines += ['', '## Supabase/PostgREST on this host','',
        '| Link | Offered/s | Achieved/s | Passing reps | p50 ms | Worst p99 ms | DB commit delta/ack | Approx. WAL sync/app commit |','|---|---:|---:|---:|---:|---:|---:|---:|']
    for x in control:lines.append(f"| {x['link']} | {x['offered_per_s']} | {x['writes_per_s']['median']:.0f} | {x['passing']}/{x['repetitions']} | {x['p50_ms']:.2f} | {x['p99_ms']:.2f} | {x['database_commits_per_request']:.4f} | {x['syncs_per_request']:.4f} |")
    lines += ['', 'These use the unchanged one-host HTTP generator, 32 clients/pool slots, advocate SQL and PostgREST 14.18 configuration, 1M-message control fixture and 10s/20s/three repetitions. WAL counters cover warm-up+measurement+drain; their publication is asynchronous, so the sync ratios are estimates. Ratios use whole-cohort successful HTTP acknowledgements as denominator; the failed B/3,200 cohort can also have unacknowledged commits. Database transaction statistics are published asynchronously and include observer transactions; the sampled deltas have boundary error and are not an exact transaction count. The separate protocol trace establishes one application transaction per W4 request, so sync/request estimates sync/application-commit at passing rates. At the passing rates, the role-filtered statement witness shows one request-context `set_config` and one RPC statement per acknowledged request. The RPC calls the existing SECURITY DEFINER increment function with its explicit authorization predicate. It updates one counter; it does not write Snapback’s commit/evidence/head tail.','',
        'The observed application sequence is `BEGIN ISOLATION LEVEL READ COMMITTED READ WRITE` → one request-context `set_config` statement → one RPC statement → `COMMIT`. Connection initialization additionally sets UTF8 and the warning level. The separate one-request PostgreSQL protocol observation is recorded in `verification.json`; bind parameter logging is disabled before enabling statement logging, and no performance trial uses statement logging. Utility statement counters are not used as an exact transaction count. Independent durable requests can share a WAL flush, explaining sync/request below one without relaxing synchronous commit.','',
        '## Validation, archive and limits','',
        'All primary and sensitivity trials assert whole-cohort counter/commit equality; S/E also assert head and revision. Deadlock deltas are zero. The crash verifier checks acknowledgement survival, per-counter arithmetic and contiguous recovery after every restart. Affinity, disk and host-start evidence, protocol observations, known-secret scan and stopped-PID audit are summarized in [verification.json](./verification.json). [Bounded aggregates](./aggregate.json), [native K/H definitions and source hashes](./native-kh.json), [archive receipt](./archive.json).','',
        'Raw repetitions, batch clocks, CPU samples, failed setup/smoke/exploratory attempts and source/binary receipts stay outside Git. The archive receipt supplies its SHA-256. No fetch, push, stash, publication, paid resource, Git configuration change or product edit occurs. All private clusters/proxies/clients/controllers stop; **PIDs left: none**.','',
        'Governing context: [G7 §§3–5/8](../../../../llp/3000.009.001.000.000.002-pipelined-group-commit.rfc.md), [controls RFC](../../../../llp/3000.009.001.000.002-beating-the-postgres-controls.rfc.md), [S1 method](../../../../llp/3000.009.001.002-scale-limits-against-postgres-controls.rfc.md), and [native diagnosis](../../scale-controls/results-20261025-s1-diagnosis/README.md). G7 remains a draft. These results measure mechanisms and optimistic SQL bounds; they do not select or qualify a product protocol.','',
        'Reproduce from the repository root (release, lane-owned target; raw destination must be new):','', '```sh','CARGO_TARGET_DIR="$PWD/snapback4/target/g70" cargo build --release \\','  --manifest-path snapback4/experiments/postgres-commit-path/Cargo.toml --bin g70','python3 snapback4/experiments/scale-controls/scripts/g70-onehost.py \\','  --out "$HOME/sb4scale/g70-NEW" --binary snapback4/target/g70/release/g70','```','']
    (a.out/'README.md').write_text('\n'.join(lines))


if __name__=='__main__':main()
