#!/usr/bin/env python3
"""Publish aggregate C0 calibration, searched capacity and S1 gate evidence."""
import argparse,collections as co,json,statistics as st
from pathlib import Path

def read(p):return json.loads(p.read_text())
def write(p,x):p.write_text(json.dumps(x,indent=2)+'\n')
def aggregate(rows):
    keys=('arm','link','n','k','hold_ms','rate');groups=co.defaultdict(list)
    for r in rows:
        if not r.get('execution_failed'):groups[tuple(r[k] for k in keys)].append(r)
    out=[]
    for key,rr in sorted(groups.items()):
        x=dict(zip(keys,key));x.update(repetitions=len(rr),s1_all=all(r['slo_pass'] for r in rr),mean_ms=[min(r['client_ms']['mean'] for r in rr),max(r['client_ms']['mean'] for r in rr)],intended_mean_ms=[min(r['intended_ms']['mean'] for r in rr),max(r['intended_ms']['mean'] for r in rr)],p50_ms=st.median(r['client_ms']['p50'] for r in rr),p99_ms=max(r['intended_ms']['p99'] for r in rr),error_fraction=max(r['error_fraction'] for r in rr),delivered_per_s=min(r['writes_per_s'] for r in rr),mean_n=st.median(r['mean_batch_n'] for r in rr),syncs_per_batch=st.median(r['syncs_per_batch'] for r in rr),wal_sync_mean_ms=st.median(r['wal_sync_mean_ms'] for r in rr),cpu={role:st.median(r['cpu'][role] for r in rr) for role in ['PG','app','client']},prep_cpu_ms=st.median(r['mean_prep_cpu_ms'] for r in rr),pg_statement_ms_per_batch=st.median(r.get('pg_statement_ms_per_batch',0) for r in rr),pg_cpu_ms_per_batch=st.median(r.get('pg_cpu_ms_per_batch',0) for r in rr))
        out.append(x)
    return out

def label(x):return f'{x["n"]}/{x["k"]}/{x["hold_ms"]:g}'
def means(x):return f'{x["mean_ms"][0]:.2f}–{x["mean_ms"][1]:.2f}'
def cpu(x):return '/'.join(f'{x["cpu"][r]:.2f}' for r in ['PG','app','client'])
def main():
    p=argparse.ArgumentParser();p.add_argument('--raw',type=Path,required=True);p.add_argument('--baseline',type=Path,required=True);p.add_argument('--literal',type=Path,required=True);p.add_argument('--diagnostics',type=Path,required=True);p.add_argument('--out',type=Path,required=True);a=p.parse_args();a.out.mkdir(exist_ok=True,parents=True)
    rows=[read(p) for p in a.raw.glob('[AB]/confirmation/*/rate*/r[0-2].json')];confirmation=aggregate(rows)
    assert confirmation and all(x['repetitions']==3 for x in confirmation)
    searches=read(a.raw/'searches.json');screen=[x for x in searches if x['phase']=='screen'];caps=[x for x in searches if x['phase']=='confirmed-capacity'];assert len(screen)==108 and len(caps)==18
    def group(x,rate):return next(g for g in confirmation if all(g[k]==x[k] for k in ['arm','link','n','k','hold_ms']) and g['rate']==rate)
    best=[]
    for arm in ['O1','C','OC']:
        for link in ['A','B']:
            x=max((x for x in caps if x['arm']==arm and x['link']==link),key=lambda x:x['capacity'])
            best.append(dict(**x,metrics=group(x,x['capacity'])))
    gates=[]
    for arm in ['O1','C','OC']:
        for link,rates in [('A',[3200,3805,4525]),('B',[2262,3200])]:
            for rate in rates:
                rr=[x for x in confirmation if x['arm']==arm and x['link']==link and x['rate']==rate]
                x=max(rr,key=lambda x:(x['s1_all'],-x['mean_ms'][1] if x['s1_all'] else x['delivered_per_s'],-x['p99_ms']))
                gates.append(dict(**x,margin_6_4=x['mean_ms'][1]<=6.4,numerical_gate=False,formal_authorization=False))
    for x in gates:
        o=next(g for g in gates if g['arm']=='O1' and g['link']==x['link'] and g['rate']==x['rate'])
        x['ordered_comparator']=x['arm']=='O1' or not o['s1_all'] or x['mean_ms'][1]<=o['mean_ms'][0]-1
        x['numerical_gate']=x['link']=='A' and x['rate']==4525 and x['s1_all'] and x['margin_6_4'] and x['ordered_comparator']
    write(a.out/'capacity.json',dict(best=best,confirmed=caps,screen=screen));write(a.out/'confirmation.json',confirmation);write(a.out/'gate.json',gates)
    refs={('A',2262):(2177,14.99),('A',3200):(2223,14.39),('B',1600):(1600,13.90),('B',2262):(1889,16.94)}
    cal=[];literal=[]
    for x in read(a.baseline/'aggregate.json'):
        rate,mean=refs[x['link'],int(x['rate'])];cal.append(dict(link=x['link'],offered=x['rate'],reference_rate=rate,reference_mean=mean,achieved=x['writes_per_s'],mean=x['client_ms']['mean'],p99=x['intended_ms']['p99'],s1=x['slo_pass'],rate_delta=x['writes_per_s']/rate-1,mean_delta=x['client_ms']['mean']/mean-1,actual_n=x['mean_batch_n']))
    for x in read(a.literal/'aggregate.json'):
        rate,mean=refs[x['link'],int(x['rate'])];literal.append(dict(link=x['link'],offered=x['rate'],achieved=x['writes_per_s'],mean=x['client_ms']['mean'],rate_delta=x['writes_per_s']/rate-1,mean_delta=x['client_ms']['mean']/mean-1))
    assert all(abs(x['rate_delta'])<=.15 and abs(x['mean_delta'])<=.15 for x in cal)
    write(a.out/'calibration.json',dict(product_shape_control=cal,literal_n11_k1=literal,passes=True,literal_passes=False))
    lines=['# C0′ — calibrated write-capacity search','',
    'Experiments only, on `sb4-pg/c0`. No product changes, fetch, push, publication or external service. Current measured preparation is an explicitly labelled **L′ CPU stand-in**. L′ is unbuilt; C-L is omitted because a complete canonical SQL encoder was not implemented. No result here authorizes C or ordered C under the [Accepted RFC](../../../../llp/3000.009.001.000.000.003-concurrent-disjoint-commits.rfc.md#35-stage-c0-the-product-shaped-harness-and-its-gate).','',
    '## Calibration','',
    'A literal N=11, K=1 O1 is not today’s product: it has one slot, provisioned Stage P checks, a typed tail and two flights. The [S1-WA reference](../../scale-controls/results-20261026-s1-write-attribution/README.md) has two pipeline slots, inline checks, the JSON tail and a separate COMMIT: three flights, mean N≈11 under a 32-member cap. The literal calibration failed and is retained below. The separate current-product-shape control restores those protocol and scheduling terms, uses rate-specific joint samples, and matches **all four reference achieved rates and sent means within ±15%**. This protocol correction is disclosed; the literal one-slot arm is not relabelled a calibration success. Its configuration is retained in the three-repetition searches.','',
    '| Link / offered/s | Reference achieved/s / sent mean ms | Control achieved/s / sent mean ms | Rate / mean delta | Actual N | S1 |','|---|---:|---:|---:|---:|---|']
    for x in cal:lines.append(f'| {x["link"]} / {x["offered"]:.0f} | {x["reference_rate"]:.0f} / {x["reference_mean"]:.2f} | {x["achieved"]:.0f} / {x["mean"]:.2f} | {100*x["rate_delta"]:+.1f}% / {100*x["mean_delta"]:+.1f}% | {x["actual_n"]:.2f} | {"pass" if x["s1"] else "fail"} |')
    lines+=['','| Literal N=11, K=1 | Achieved/s | Sent mean ms | Rate / mean delta |','|---|---:|---:|---:|']
    for x in literal:lines.append(f'| {x["link"]} / {x["offered"]:.0f} | {x["achieved"]:.0f} | {x["mean"]:.2f} | {100*x["rate_delta"]:+.1f}% / {100*x["mean_delta"]:+.1f}% |')
    lines+=['','Calibration is one full 10 s/20 s trial per reference rung, matching the native reference’s diagnostic design. It validates achieved rate and sent mean, not complete latency-distribution equality: the B/1,600 control’s intended p99 is 91.81 ms versus the reference’s 18.71 ms. The reference’s three overloaded rungs fail in the control too. A baseline setup attempt started before the sample export receipt was ready; it was retained, stopped, and repeated after export completed.','',
    '## Capacity by arm','',
    'These are highest offered rates passing **all three complete S1 10 s warm-up/20 s measurement repetitions**, bracketed by the next tested failing rate within 5%. The screen and refinement use shorter windows, described below. Means span repetitions; p99/errors are worst, delivery is minimum, and CPU/cost columns are medians. All failed observations remain in the archive.','',
    '| Arm | Link | N/K/h ms | Capacity/s [next fail) | Delivered/s | Sent mean ms | Intended p99 ms | Errors % | Actual N | Sync/batch | PG non-wait statement / CPU ms/batch | Prep CPU ms/batch | CPU PG/app/client |','|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|']
    for x in best:
        m=x['metrics'];lines.append(f'| {x["arm"]} | {x["link"]} | {label(x)} | {x["capacity"]:,} [{x["upper"]:,}) | {m["delivered_per_s"]:.0f} | {means(m)} | {m["p99_ms"]:.2f} | {100*m["error_fraction"]:.3f} | {m["mean_n"]:.2f} | {m["syncs_per_batch"]:.3f} | {m["pg_statement_ms_per_batch"]:.3f} / {m["pg_cpu_ms_per_batch"]:.3f} | {m["prep_cpu_ms"]:.3f} | {cpu(m)} |')
    lines+=['','## Fixed-rung S1 verdicts','',
    'For each arm/rung this selects the strongest fully confirmed configuration among its best two screened configurations and N=11/K=1/h=0. Every row has three full repetitions. S1 requires intended-arrival p99≤100 ms, errors≤0.1%, delivered offered rate and counter equality. The RFC’s A transfer gate additionally needs every sent mean≤6.4 ms, or a separately tested high-end injection pass, and the ordered comparator. No high-end sensitivity is claimed.','',
    '| Arm | Link / offered/s | N/K/h ms | Delivered/s | Sent mean ms | Intended p99 ms | Errors % | S1 3/3 | Mean≤6.4 3/3 |','|---|---|---|---:|---:|---:|---:|---|---|']
    for x in gates:lines.append(f'| {x["arm"]} | {x["link"]} / {x["rate"]:.0f} | {label(x)} | {x["delivered_per_s"]:.0f} | {means(x)} | {x["p99_ms"]:.2f} | {100*x["error_fraction"]:.3f} | {"pass" if x["s1_all"] else "fail"} | {"yes" if x["margin_6_4"] else "no"} |')
    lines+=['','## Recommendation','']
    # Complete measured recommendation below after all arm/rung results exist.
    fine=[x['arm'] for x in gates if x['link']=='A' and x['rate']==3805 and x['s1_all']]
    strict=[x['arm'] for x in gates if x['link']=='A' and x['rate']==4525 and x['s1_all']]
    lines.append(f'A/3,805 passes: {", ".join(fine) or "none"}. A/4,525 passes: {", ".join(strict) or "none"}. These statements use current measured preparation; they assume neither 20–30 µs/member L′ CPU nor a cheaper unimplemented server tail.')
    for x in best:
        if x['link']!='A':continue
        m=x['metrics'];lines.append(f'{x["arm"]}’s strongest A capacity is {x["capacity"]:,}/s at N/K/h={label(x)}. It pays measured PG statement work {m["pg_statement_ms_per_batch"]:.3f} ms/batch, PG process CPU {m["pg_cpu_ms_per_batch"]:.3f} ms/batch and preparation CPU {m["prep_cpu_ms"]:.3f} ms/batch, with sampled PG/app/client CPU {cpu(m)}.')
    lines.append('**Build only L′ on the ordered lane, under the RFC’s freshness protocol, then remeasure; stop C and ordered C at this gate.** B does not require a new reader/recovery protocol. The current-preparation experiment supplies no formal authorization for C/ordered C, even if a finer rung passes. A 3,805 result is not a strict control win without a matched control rerun; 4,525 remains the registered strict-win rung.')
    lines+=['','## Method and limits','',METHOD,'','## Every screened configuration','',
    'One repetition per tested screen rate; N∈{8,16,32}, K∈{1,2,4}, h∈{0,0.6 ms}, all three arms on A and B: 108 configurations. An abandoned configuration has an already-failing upper bound below 0.7×the best capacity yet found for that arm/link; it is not assigned an invented exact capacity. [All capacity summaries](./capacity.json), [three-repetition confirmation aggregates](./confirmation.json), [gate summaries](./gate.json).','']
    for arm in ['O1','C','OC']:
        lines += ['### '+arm,'','| Link | N/K/h ms | Screen capacity/s | Next failed/s | Status |','|---|---|---:|---:|---|']
        for x in sorted((x for x in screen if x['arm']==arm),key=lambda x:(x['link'],x['n'],x['k'],x['hold_ms'])):lines.append(f'| {x["link"]} | {label(x)} | {x["capacity"] if x["capacity"] is not None else "withheld"} | {x["upper"]} | {"abandoned below 70%" if x["abandoned"] else "bracketed within 5%"} |')
        lines+=['']
    diagnostic_rows=[]
    for path in a.diagnostics.glob('[AB]/*/r0.json'):
        x=read(path)
        if not x.get('prefix_hammer'):continue
        samples=read(path.with_suffix('.cpu.json'))
        diagnostic_rows.append(dict(arm=x['arm'],link=x['link'],elapsed_s=samples[-1]['time']-samples[0]['time'],**x['prefix_hammer']))
    witness=read(a.diagnostics/'witness.stdout')
    assert len(diagnostic_rows)==6 and all(x['violations']==0 for x in diagnostic_rows)
    assert witness['tripwire'] and witness['committed_key_beats_void'] and witness['void_after_recorded_backend_kill']
    write(a.out/'diagnostics.json',dict(prefix=diagnostic_rows,witness=witness))
    lines+=['## Diagnostic witnesses','','The prefix hammer runs in the 16,000/s overload smokes, not in capacity trials. Every smoke ends cleanly with counter equality; no statement prefix violation is observed. These are experimental witnesses, not qualification of every product reader/recovery entry point. [Diagnostic aggregate](./diagnostics.json).','','| Arm | Link | Prefix reads | Reader mean / p99 ms | Stale restarts | Violations |','|---|---|---:|---:|---:|---:|']
    for x in sorted(diagnostic_rows,key=lambda x:(x['arm'],x['link'])):
        m=x['reader_ms'];lines.append(f'| {x["arm"]} | {x["link"]} | {m["n"]} | {m["mean"]:.2f} / {m["p99"]:.2f} | {x["stale_restarts"]} | {x["violations"]} |')
    lines+=['','The independently injected stale snapshot raises S4004; settings drift raises S4001, stale ownership S4002 and a wrong tail count S4003 before commit. A committed batch key beats a void; a void follows a recorded backend kill and refuses the late commit.','']
    lines+=['## Verification and custody','','[Verification](./verification.json), [secret scan](./secret-audit.json), and [archive receipt](./archive.json) bind the retained evidence. The 205 interrupted fixed-rung trials remain as **superseded-by-capacity-search**, including their original incorrect late-intended throughput accounting. They are never used to select or pass a new configuration. The interrupted campaign had no living recorded identities at resume; its private runtime was removed after sealing its known secrets. Clean shutdown was not observed for that interrupted run. All new campaign clusters stop through the runner’s normal cleanup.','',
    'The old timeout attempts contain worker panics (owner/settings errors or an invalid SQL column), not evidence of a 120-second overload drain. Startup now checks failed worker joins against a single bounded readiness deadline; the main loop observes maintenance/release worker failure and has a 10-second drain bound. The outer process has warm-up+measurement+15 seconds. Nonzero exits/timeouts write failed trial JSON and stop capacity qualification for diagnosis. Injected startup failures and 16,000/s overloads on all arms/links verify bounded failure, continued counter equality and prefix checks.','',
    'Exact-value secret scans cover both benchmark passwords, sealed campaign credentials, JWT/native tokens and PEM payloads. No raw per-request, per-batch or per-rate trial files enter Git. Raw archive path and SHA-256 are in archive.json. No push, stash or Git configuration change. **PIDs left: none.**','']
    (a.out/'README.md').write_text('\n'.join(lines))
    print(json.dumps(dict(confirmed_configurations=len(caps),confirmation_groups=len(confirmation),a_3805_passes=fine,a_4525_passes=strict)))

METHOD='''The host is `expo-build-450b` (OS `expose-builder-pixel-a`), Ryzen 5 3600. PG16.15 is pinned to 0–2,6–8; replay/app/proxy to 3–4,9–10; the open-loop scheduler to 5,11. The existing Unix delayed proxy injects 250 µs/direction on A and 500 µs/direction on B. Private socket-only PG, inherited fsync/full_page_writes settings, 32 clients/cap 32, live affinity/CPU sampling, unrelated-process start checks, before/after RTT and a 25 GiB /home stop are retained. The runtime checks disk once per second as well as at boundaries and sampler ticks.

The √2 ladder is 1,600/2,262/3,200/4,525, extended downward if the first rung fails or upward if the top passes, then geometric bisection until failing/passing≤1.05. The one-repetition screen uses 1 s/4 s. The best two configurations per arm/link plus the literal N=11/K=1/h=0 configuration receive three-repetition 1 s/4 s searches, then three **10 s/20 s** confirmations at their bracket endpoints and the fixed rungs. Long-window failures move the bracket downward; additional full confirmations narrow it back to 5%. Failed trials are retained, never replaced. This is a measured empirical bracket, not a statistical confidence interval.

A slot’s cohort timer starts at SQL confirmation, while its clients are still in release/HTTP. It dispatches at min(N,ceil(32/K)) ready members or expiration of h; N is a cap. Every hold and queue remains in residence. Ordered arms serialize opener+preparation but overlap final SQL; K=4 is the user-requested depth sensitivity. Replies release only through a contiguous prefix, and a client is reused only after continuation and HTTP replay.

O1 uses two flights: fenced opener/head/authority/receipts/facts, then predecessor ticket, exact Stage P typed CAS tail, raising counts and synchronous COMMIT. C uses one fenced warm-fact flight: first-write `_batches`, stored-authority/absence and locked-image validation, deadline check, two-image typed apply, tripwire and synchronous COMMIT; a dedicated connection pays catch-up/prune/renewal work. Ordered C uses two-image reads at D and E’s ordered async-data/synchronous-marker shape. Its marker is co-dispatched with the data COMMIT and sampled completed-before-poll delay is removed; remaining marker cost, flush, checks, encoding and CPU are charged. It needs no holes/voids. Stage P helper bodies and typed generator provenance are [pinned](../src/c0/stage-p-source.json). The typed generator differs from that source only in comments and removal of an unused test fallback.

Joint numerical S1-WA samples retain request HTTP/continuation/callback terms correlated with batch fill/preparation. Inclusive staging CPU plus measured parallel critical wall is replayed as CPU, scaled by actual/source N. HTTP and callback CPU contend on app cores; wall remainders sleep. Actual encode/driver CPU is charged before padding the preparation budget. This is a **current-preparation stand-in**, not a measurement of L′ or its full parallel-worker CPU. The baseline control uses rate-specific samples; candidate arms use the high-rung S sample per link, and E for ordered C. These distributions are not tuned to make a rung pass.

S1 semantics match the native generator: arrivals expire before send after one second; sent requests time out from send. A successful reply with >1-second intended latency still contributes achieved throughput and its complete intended latency. The previous harness wrongly counted it as an error; this explains 0/s at overloaded fixed rungs. Intended p99 still rejects overload. Whole-cohort counter/commit/request equality is separate from measured-arrival SLO accounting.

PG non-wait statement ms/batch is pg_stat_statements execution+planning minus advisory-ticket and COMMIT utility clocks, including maintenance, divided by all batches. It excludes parsing outside those clocks and is not a flush measurement. PG CPU ms/batch is sampled process CPU, also including backgrounds/observer work; both columns expose their different coverage. WAL sync time and sync/batch are whole-cohort private-cluster deltas. App CPU includes the Python controller/observer; CPU columns are logical CPUs, not percentages. Neither server ledger is an assumed formula substituted for measurements.

The W4-only G7.0 fixture retains one million product-codec background message images and one million historical commit rows, unlike S1-WA’s fully seeded maintained-state/history cardinality. It uses native W4 templates, synthetic session facts and static ordinary authority. Validation does not qualify authority changes, full product readers/recovery, W5 dependency misses, takeover or L′ freshness. The absolute-expiry sentinel and fixed authority facts are fixture assumptions. Prefix and void-race witnesses are diagnostic, not product correctness qualification. Arm E’s earlier harness/product transfer failure is why no mean-only or short-screen result authorizes implementation.'''
if __name__=='__main__':main()
