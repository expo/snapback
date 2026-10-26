#!/usr/bin/env python3
"""Aggregate C0′ repetitions; no per-request or per-trial data enters Git."""
import argparse,collections as co,hashlib,json,statistics as st
from pathlib import Path

def read(p):return json.loads(p.read_text())
def write(p,x):p.write_text(json.dumps(x,indent=2)+'\n')
def aggregate(rows):
    keys=('arm','link','n','k','hold_ms','phase');groups=co.defaultdict(list)
    for r in rows:groups[tuple(r[k] for k in keys)].append(r)
    out=[]
    for key,rr in sorted(groups.items()):
        x=dict(zip(keys,key));x.update(delivery_selection_sum=sum(r['writes_per_s'] for r in rr),mean_selection_sum=sum(r['client_ms']['mean'] for r in rr),repetitions=len(rr),s1_all=all(r['slo_pass'] for r in rr),mean_ms=[min(r['client_ms']['mean'] for r in rr),max(r['client_ms']['mean'] for r in rr)],intended_mean_ms=[min(r['intended_ms']['mean'] for r in rr),max(r['intended_ms']['mean'] for r in rr)],p50_ms=st.median(r['client_ms']['p50'] for r in rr),p99_ms=max(r['intended_ms']['p99'] for r in rr),error_fraction=max(r['error_fraction'] for r in rr),delivered_per_s=min(r['writes_per_s'] for r in rr),mean_n=st.median(r['mean_batch_n'] for r in rr),syncs_per_batch=st.median(r['syncs_per_batch'] for r in rr),wal_sync_mean_ms=st.median(r['wal_sync_mean_ms'] for r in rr),cpu={role:st.median(r['cpu'][role] for r in rr) for role in ['PG','app','client']},prep_cpu_ms=st.median(r['mean_prep_cpu_ms'] for r in rr))
        out.append(x)
    return out

def main():
    p=argparse.ArgumentParser();p.add_argument('--raw',type=Path,required=True);p.add_argument('--out',type=Path,required=True);a=p.parse_args();a.out.mkdir(exist_ok=True,parents=True)
    trials=[read(p) for glob in ['[AB]/*/r[0-2].json','long-[AB]/*/r[0-2].json'] for p in a.raw.glob(glob)]
    assert len(trials)==978,len(trials)
    agg=aggregate(trials);sweep=[r for r in agg if r['phase']=='sweep'];confirmation=[r for r in agg if r['phase']=='confirmation'];assert len(sweep)==320 and len(confirmation)==6
    assert all(r['repetitions']==3 for r in agg)
    write(a.out/'sweep.json',sweep);write(a.out/'confirmation.json',confirmation)
    gates=[]
    for r in confirmation:
        o=next(x for x in confirmation if x['link']==r['link'] and x['arm']=='O1')
        margin=r['mean_ms'][1]<=6.4
        better=r['arm']=='O1' or not o['s1_all'] or r['mean_ms'][1]<=o['mean_ms'][0]-1.0
        # The formal RFC gate needs measured L′ and its one-flight O1 comparator.
        # User requested the measured current-preparation stand-in and a
        # two-flight O1, so never turn an exploratory pass into authorization.
        gates.append(dict(arm=r['arm'],link=r['link'],s1_all=r['s1_all'],mean_margin_6_4=margin,o1_comparator=better,numerical_a_gate=r['link']=='A' and r['s1_all'] and margin and better,formal_authorization=False,cpu_basis='current preparation distribution; L-prime stand-in',b_capacity_screen=r['link']=='B' and r['s1_all'] and r['mean_ms'][1]<=32/2262*1000))
    write(a.out/'gate.json',gates)
    lines=['# C0′ — product-shaped write harness, current-preparation stand-in','',
    '**Experiments only.** No serving/product change, fetch, push, publication, or managed resource. '+
    'The numerical gate below is separate from RFC authorization: L′ does not exist on this base, '+
    'so current measured preparation is the explicitly requested stand-in. O1 is the requested two-flight ordered arm, '+
    'rather than the RFC’s eventual one-flight comparator. These results authorize no C/ordered-C product implementation.','',
    '## Verdict','',
    '| Arm | Link / offered/s | Best N / K / h ms | Client mean ms, 3 reps | Intended p99 ms, worst | Errors %, worst | Delivered/s, minimum | S1 3/3 | Mean margin ≤6.4 | Gate |',
    '|---|---|---|---:|---:|---:|---:|---|---|---|']
    for r in confirmation:
        g=next(x for x in gates if x['arm']==r['arm'] and x['link']==r['link'])
        verdict=('provisional numerical pass' if g['numerical_a_gate'] else 'no') if r['link']=='A' else ('B capacity screen passes' if g['b_capacity_screen'] else 'no')
        lines.append(f'| {r["arm"]} | {r["link"]} / {4525 if r["link"]=="A" else 2262} | {r["n"]} / {r["k"]} / {r["hold_ms"]} | {r["mean_ms"][0]:.2f}–{r["mean_ms"][1]:.2f} | {r["p99_ms"]:.2f} | {100*r["error_fraction"]:.3f} | {r["delivered_per_s"]:.1f} | {"yes" if r["s1_all"] else "no"} | {"yes" if g["mean_margin_6_4"] else "no"} | {verdict} |')
    lines+=['', 'A’s gate needs an S1 pass at 4,525/s in **every** full confirmation, '+
    'mean ≤6.4 ms in every repetition (or a separate high-end injection pass), and ≥1 ms over O1 or a pass where O1 fails. '+
    'S1 decides: intended-arrival p99 ≤100 ms, errors ≤0.1%, delivered rate and counter equality. '+
    'A mean ≤7.07 ms alone cannot pass. B’s capacity screen uses 2,262/s and mean ≤14.15 ms; it is not permission to build C for A. '+
    'High-end stress is not credited without three measured confirmations. C-L is omitted because no full canonical in-statement encoder was implemented.', '',
    '## Method and provenance','',
    'Host `expo-build-450b` / OS `expose-builder-pixel-a`, Ryzen 5 3600. '+
    'PG16.15 on `0–2,6–8`; app/replay and the existing delayed Unix proxy on `3–4,9–10`; '+
    'open-loop scheduler on `5,11`. Private socket-only cluster, inherited `postgresql.conf.delta`, '+
    'fsync/full_page_writes/synchronous_commit on except ordered C’s data transaction; no commit_delay tuning. '+
    'A adds 250 µs/direction, B 500 µs/direction. The unchanged one-host lifecycle supplies RTT captures, '+
    'a live thread-affinity sampler, PID/birth custody, unrelated-process start gate and cleanup. '+
    '/home’s lane stop is 25 GiB, checked at startup, each repetition, and sampler ticks.', '',
    'The G7.0 fixture retains its million product-codec background message images and million historical `_commits` rows, '+
    'S1 parents/counters and native Engine mutation templates. Its background maintained state remains a W4-only fixture, '+
    'not read-workload qualification. Synthetic account facts and a synthetic owner are private; '+
    'ordinary expiry is very distant, supervisor revision absent. Authority writers, membership-dependent W5 misses, '+
    'reader-pool qualification, takeover and full product recovery are outside this W4 measurement.', '',
    'The complete **320-cell** sweep is N∈{4,8,16,32}, K∈{1,2} for O1 and K∈{1,2,3,4} for C/OC, '+
    'h∈{0,0.3,0.6,1.0 ms}, both links, three repetitions. As in G7.0, screening uses 1 s warm-up / 4 s measured, '+
    'now open-loop at the registered rungs, with 32 clients and cap 32. '+
    'Strongest configuration per arm/link gets three additional **10 s / 20 s** S1 confirmations. '+
    'Selection prefers all-three S1 pass, then highest summed delivery, then lowest mean residence; failures are retained. '+
    'The full sweep is [sweep.json](./sweep.json), confirmations [confirmation.json](./confirmation.json), '+
    'and decisions [gate.json](./gate.json). Screening passes are not full-window gate passes.', '',
    'After a slot confirms, its formation clock starts. The oldest free slot dispatches when min(N,ceil(32/K)) '+
    'members are ready or h expires; N is a cap, not a promise. Idle time, cohort hold, HTTP/release spread and '+
    'all queueing remain inside request residence. All nominal K SQL connections are open. A client becomes available '+
    'only after ordered publication, continuation and HTTP-out replay. The one-second intended-arrival deadline '+
    'counts unsent expiry and late acknowledgements as errors; draining never erases them.', '',
    '## Messages and injected terms','',
    'Stage P’s [source receipt](../src/c0/stage-p-source.json) pins the exact helper bodies and typed-tail generator. '+
    'The typed generator is copied verbatim apart from comments and its unused test-only JSON fallback; '+
    'the harness supplies its data structs. It emits compact typed columns, only present W4 families, '+
    'set-based images, `_commits` and evidence. Canonical tagged image bytes are rebuilt from native templates, '+
    'not jsonb::text. The serving RT5 literal form encodes UTF8 through hex/convert_from. '+
    'Generic plans are forced. Settings and owner functions precede data; timeouts are cleared before COMMIT; '+
    'every tail count is asserted server-side before a co-dispatched COMMIT.', '',
    '- **O1:** first flight begins/fences, takes its own ticket and reads head, authority, receipts and level facts. '+
    'Second flight waits on its predecessor, reads identity, executes the exact Stage P CAS tail with folded publication, '+
    'raises on count mismatch and synchronously commits. K=1 or 2 is ordered depth.',
    '- **C:** one fenced final message on a warm mirror, `_batches` insert first, complete ordinary stored authority equality/absence '+
    'and absolute expiry check, locked image/owner probe, then two-image typed apply with the watermark tripwire and synchronous COMMIT. '+
    'Rows read through GREATEST(dispatch W,durable head); replies publish only through the contiguous confirmed prefix. '+
    'A dedicated maintenance connection performs roughly 10/s synchronous catch-ups/prunes and owner renewal; their WAL syncs are charged.',
    '- **OC (ordered C):** E’s two-flight ordered shape, two-image level reads at D and two-image apply. '+
    'Its asynchronous data COMMIT and synchronous durable-head marker are in the same second message. '+
    'This removes E’s measured extra marker flight (~0.5/1.0 ms A/B) by construction, and subtracts the sampled completed-before-poll '+
    'delay (~0.4–0.5 ms at the cited high-load A rung) from each source continuation sample. '+
    'Remaining marker execution/flush, checks, ticket waiting, images, HTTP and release CPU remain charged. '+
    'No holes/reservations/void maintenance are needed in this lane.', '',
    'Joint numeric batch/request samples come from the cited S1 write-attribution archive: S W4/A 3,200/s, '+
    'S W4/B 2,262/s, and E counterparts for OC, all three repetitions. Diagnostic IDs restart per generator; '+
    'joins are restricted by each trial’s clock interval. Cohort resampling draws one complete source bundle; '+
    'its request HTTP/continuation timings, callback CPU, fill and preparation remain correlated. '+
    'Per-member staging CPU and parallel critical wall scale by actual/source N. '+
    'Nested intent/classification/merge clocks are not added to inclusive staging CPU. '+
    'HTTP worker plus otherwise-unaccounted writer CPU is replayed on app cores, and callback CPU runs inside '+
    'the sampled continuation delay. Current parallel **wall** is deliberately charged as critical CPU; '+
    'this is a current-preparation stand-in, not a measured L′ pool or a claim about its full parallel-worker CPU. '+
    'Actual encode/transport CPU is charged against the staging budget before padding with CPU work; '+
    'it is never replaced by a sleep. HTTP timing remainders sleep after CPU work. '+
    'The app, slots, response workers and proxy contend on the product’s app cores.', '',
    '## Per-arm screening tables','',
    'For each nominal N/K, the table shows the strongest h under the same frozen selection rule. '+
    'Means span three repetitions; p99 and errors are worst, delivery minimum. CPU is median sampled logical CPUs '+
    '(PG/app/client) over warm-up + measurement + drain; app includes the Python observer/controller. '+
    'Sync/batch includes maintenance and background WAL work. Every h, including failures, is in sweep.json.','']
    for arm in ['O1','C','OC']:
      lines+=['### '+arm,'','| Link | N / K | h ms | Actual N | Delivered/s | Client mean ms | Intended p99 ms | Errors % | S1 3/3 | Sync/batch | CPU PG/app/client |','|---|---|---:|---:|---:|---:|---:|---:|---|---:|---|']
      groups=co.defaultdict(list)
      for r in sweep:
        if r['arm']==arm:groups[(r['link'],r['n'],r['k'])].append(r)
      for key,rr in sorted(groups.items()):
        r=max(rr,key=lambda x:(x['s1_all'],x['delivery_selection_sum'],-x['mean_selection_sum']));cpu='/'.join(f'{r["cpu"][x]:.2f}' for x in ['PG','app','client'])
        lines.append(f'| {r["link"]} | {r["n"]} / {r["k"]} | {r["hold_ms"]} | {r["mean_n"]:.2f} | {r["delivered_per_s"]:.0f} | {r["mean_ms"][0]:.2f}–{r["mean_ms"][1]:.2f} | {r["p99_ms"]:.2f} | {r["error_fraction"]*100:.2f} | {"yes" if r["s1_all"] else "no"} | {r["syncs_per_batch"]:.3f} | {cpu} |')
      lines+=['']
    lines+=['## Validation, custody and recommendation','','See [verification.json](./verification.json), [archive.json](./archive.json) and the final recommendation recorded below. '+
    'The prefix hammer runs only in diagnostic smokes, not the capacity matrix. Its success does not qualify all product readers. '+
    'Arm E’s earlier SQL-harness pass (~7.01 ms at 4,525/s) versus product qualification at 1,600/s remains the transfer warning '+
    'behind the RFC margin; this harness result never supersedes the product S1 record.','']
    (a.out/'README.md').write_text('\n'.join(lines))
    print(json.dumps(dict(trials=len(trials),sweep_cells=len(sweep),confirmation_cells=len(confirmation),a_numerical_passes=[g['arm'] for g in gates if g['numerical_a_gate']])))
if __name__=='__main__':main()
