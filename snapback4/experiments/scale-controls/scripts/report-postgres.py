#!/usr/bin/env python3
"""Regenerate the blocked S1-PG ledger, ping plot and tiny-probe diagnosis."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
from statistics import median
import subprocess as sp

from run import HERE, BIN
from postgres import SB
from importlib.util import spec_from_file_location, module_from_spec

def read(path):return json.loads(path.read_text())
def write(path,value):path.write_text(json.dumps(value,indent=2)+'\n')
def fmt(value):return 'no pass' if value is None else f'{value:,}'


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('raw',type=Path)
    p.add_argument('out',type=Path)
    args=p.parse_args();root=args.raw;out=args.out;out.mkdir(parents=True,exist_ok=True)
    final=root/'probes-complete'
    assert (root/'probes-complete.exit').read_text().strip()=='0'
    assert read(final/'database-cleanup.json')['database_dropped']
    for stage in ('raw','probes','probes-final','probes-complete'):
        assert not read(root/stage/'cleanup.json')['still_running']
    refusals=[]
    for delay in (0,500):
        # The final diagnostic used a shorter, new proxy path. Its retry of
        # an earlier deployment intent correctly refused the changed socket.
        # Use the original valid +500 admission repro, without hiding the retry.
        stage=final if delay==0 else root/'probes-final'
        for label in ('full','minimal'):
            assert read(stage/f'{label}-deploy-d{delay}.exit.json')['code']==1
            assert 'E_STORE_UNSUPPORTED: maintained-columns is not yet available on Postgres' in (stage/f'{label}-deploy-d{delay}.stderr').read_text()
            refusals.append(dict(delay_us=delay,case=label,stage=stage.name,exit_code=1,
                code='E_STORE_UNSUPPORTED',family='maintained-columns'))
    write(out/'refusals.json',refusals)
    # Source fixtures are copies of the actual probe inputs, not new application forms.
    spec=spec_from_file_location('probes',HERE/'scripts/postgres-probes.py');probes=module_from_spec(spec);spec.loader.exec_module(probes)
    (out/'minimal-repro.q').write_text(probes.MINIMAL)
    (out/'counter-probe.q').write_text(probes.TINY)
    rtt=[]
    for delay in (0,500):
        trials=[read(final/f'ping-d{delay}-r{i}.stdout') for i in range(3)]
        rtt.append(dict(delay_us=delay,trials=trials,p50_ms_median=median(t['p50_ms'] for t in trials),
            p50_ms_range=[min(t['p50_ms'] for t in trials),max(t['p50_ms'] for t in trials)],
            controls_reference_p50_ms=.61 if delay==0 else 1.23))
    write(out/'rtt.json',rtt)
    controls=read(HERE/'results-20261022-fairness/comparison.json')
    sqlite=read(HERE/'results-20261022-snapback-sqlite/ledger.json')
    ledger=[]
    for c in controls:
        cell=c['cell'];s=next(s for s in sqlite if all(s['cell'][k]==cell[k] for k in ('workload','keys')))
        ledger.append(dict(**c,snapback_postgres=dict(status='blocked-before-seed',
            offered_ops_per_s=None,code='E_STORE_UNSUPPORTED',family='maintained-columns',
            seed_rows_required=1000000,seed_rows_written=0,measured_arrivals=None,
            steady_state=None,write_outcome_audit=None),
            snapback_sqlite_natural=s['summary']['highest_passing_offered_per_s']))
    assert len(ledger)==12
    write(out/'ledger.json',ledger)
    table=['| Workload | Link | Snapback PG | Raw PG token | Raw PG no token | Supabase advocate | Convex/PG advocate | Snapback SQLite (natural only) |',
           '|---|---|---|---:|---:|---:|---:|---:|']
    for r in ledger:
        table.append('| '+r['label']+' | '+('natural' if r['cell']['delay_us']==0 else '+0.5 ms')+' | blocked | '+
            ' | '.join(fmt(r['rates'][k]) for k in ('raw-pg','raw-pg-no-token','supabase','convex'))+' | '+fmt(r['snapback_sqlite_natural'])+' |')
    (out/'ledger.md').write_text('\n'.join(table)+'\n')
    write(out/'steady.json',dict(status='unavailable',reason='deploy refused before fixture seeding or load',
        planned_cells=12,completed_cells=0,per_second_observations=None,unknown_write_outcome_trials=None))
    diagnosis=[]
    for delay in (0,500):
        before={r['queryid']:r for r in read(final/f'tiny-d{delay}.before.json')}
        statements=[]
        for row in read(final/f'tiny-d{delay}.after.json'):
            b=before.get(row['queryid'],{})
            delta={k:row[k]-b.get(k,0) for k in ('calls','total_exec_time','rows','wal_bytes')}
            if delta['calls']:statements.append(dict(query=row['query'],**delta))
        sample=read(final/f'tiny-d{delay}.json')
        assert [r['result']['n'] for r in sample['outcomes']]==list(range(11,21))
        renewal=sum(r['calls'] for r in statements if r['query'].startswith('UPDATE _owner SET lease_until'))
        calls=sum(r['calls'] for r in statements)
        assert calls-renewal*5==580  # renewal: START, UPDATE, two SETs, COMMIT.
        def count(prefix):return sum(r['calls'] for r in statements if r['query'].startswith(prefix))
        assert count('START TRANSACTION ISOLATION LEVEL REPEATABLE READ')==90
        assert count('START TRANSACTION ISOLATION LEVEL READ COMMITTED')==10
        assert count('ROLLBACK')==90 and count('COMMIT')==10+renewal
        assert count('SELECT principal, COALESCE(family')==40
        diagnosis.append(dict(delay_us=delay,qualifies_w4=False,fixture='one own counter; guest bearer; no 1M messages',
            measured_mutations=10,warmup_mutations=10,acknowledged_values=list(range(11,21)),
            latency_ms=sample['latencies_ms'],p50_ms=median(sample['latencies_ms']),
            read_only_transactions_per_mutation=9,durable_mutation_transactions_per_mutation=1,
            session_resolutions_per_mutation=4,background_lease_transactions=renewal,
            statements_per_mutation_excluding_renewal=58,
            inferred_warm_synchronous_driver_exchanges_per_mutation=57,
            exchange_caveat='source inference: two SET LOCAL statements share one batch_execute; not a packet trace; cold prepares add exchanges',
            measured_server_statement_exec_ms_per_mutation=sum(r['total_exec_time'] for r in statements)/10,
            commit_wall_ms=None,engine_queue_wait_ms=None,
            timing_caveat='pg_stat_statements utility COMMIT timing does not isolate durable flush; no instrumented product or wire capture',
            statements=statements))
    write(out/'write-diagnosis.json',diagnosis)
    write(out/'qualification.json',dict(status='blocked',planned_cells=12,completed_cells=0,
        timing=dict(warmup_ms=10000,duration_ms=20000,repetitions=3,read_clients=128,write_clients=32),
        product_defect='E_STORE_UNSUPPORTED: maintained-columns is not yet available on Postgres',
        no_fixture_seeded=True,no_matched_load_launched=True,no_headline_rate_or_latency_claim=True,
        tiny_probe=dict(mutational_values_exact=True,mutations_per_link=21,qualifies_w4=False)))
    sources=[HERE/'src/main.rs',HERE/'src/unix.rs',HERE/'src/snapback.rs',HERE/'src/load.rs',
             HERE/'scripts/postgres.py',HERE/'scripts/postgres-probes.py',HERE/'snapback-app/snapback/schema.q']
    ownership=read(final/'ownership.json')
    write(out/'configuration.json',dict(**ownership,
        source_sha256={str(s.relative_to(HERE)):hashlib.sha256(s.read_bytes()).hexdigest() for s in sources},
        build=dict(profile='release',snapback_target='snapback4/target/s1sk',harness_target='scale-controls/target',
            LIBSQLITE3_FLAGS='-USQLITE_ENABLE_MEMORY_MANAGEMENT',product_source_unmodified=True),
        transport=read(root/'raw/transport.json'),proxy_socket=rtt[1]['trials'][0]['socket_dir'],
        durability='unchanged shared PG17.9: fsync/synchronous_commit/full_page_writes on',
        measured_controls='S1-FR matched 10 s/20 s; historical noncontemporaneous controls'))
    for name in ('database-cleanup.json','namespace-audit.json','ownership.json'):
        shutil.copyfile(final/name,out/name)
    shutil.copyfile(root/'raw/postgres.txt',out/'postgres.txt')
    (out/'full-deploy.stderr').write_bytes((final/'full-deploy-d0.stderr').read_bytes())
    (out/'minimal-deploy.stderr').write_bytes((final/'minimal-deploy-d0.stderr').read_bytes())
    # Explicit missing-value matrix; blocked never becomes numeric zero.
    import matplotlib
    matplotlib.use('Agg')
    matplotlib.rcParams['svg.fonttype']='none'
    matplotlib.rcParams['svg.hashsalt']='s1pg-20261022'
    import matplotlib.pyplot as plt
    fig,axes=plt.subplots(1,2,figsize=(12,4.8),gridspec_kw={'width_ratios':[1,1.4]})
    ax=axes[0]
    for x,r in enumerate(rtt):
        ax.scatter([x]*3,[t['p50_ms'] for t in r['trials']],color='#2450a4',label='this Unix/SSH path' if x==0 else None)
        ax.scatter(x,r['controls_reference_p50_ms'],marker='x',s=80,color='#b54628',label='S1-FR reference' if x==0 else None)
    ax.set(xticks=[0,1],xticklabels=['Natural','+0.5 ms'],ylabel='Prepared SELECT 1 p50 (ms)',title='Transport check: 3 × 1,000 queries',ylim=(0,1.5))
    ax.grid(axis='y',alpha=.2);ax.legend(fontsize=8)
    ax=axes[1];ax.axis('off')
    labels=[r['label'].replace('nominal ','') for r in ledger if r['cell']['delay_us']==0]
    tab=ax.table(cellText=[[label,'BLOCKED','BLOCKED'] for label in labels],colLabels=['Required workload','Natural','+0.5 ms'],loc='center',cellLoc='left',colWidths=[.58,.21,.21])
    tab.auto_set_font_size(False);tab.set_fontsize(9);tab.scale(1,2)
    ax.set_title('No eligible W1–W5 measurements\nDeploy refuses maintained-columns')
    fig.tight_layout();fig.savefig(out/'transport-and-status.svg',metadata={'Date':None});plt.close(fig)
    for path in out.glob('*.svg'):
        path.write_text('\n'.join(line.rstrip() for line in path.read_text().splitlines())+'\n')
    print(json.dumps(dict(planned_cells=12,completed_cells=0,rtt_p50_ms=[r['p50_ms_median'] for r in rtt],tiny_counter_p50_ms=[d['p50_ms'] for d in diagnosis])))


if __name__=='__main__':main()
