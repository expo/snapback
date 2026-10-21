#!/usr/bin/env python3
"""Derive the advocate comparison from completed cells and committed baselines.
Run with the plotting venv's Python and one argument: the archived cell root.
"""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import sys
from statistics import median

OUT = Path(__file__).resolve().parent
HERE = OUT.parent
sys.path.insert(0, str(HERE / 'scripts'))
import report

FIELDS = ('workload', 'keys', 'rows', 'delay_us', 'writers')
WORKLOADS = [('W1', 'disjoint', 'visible message'), ('W2', 'disjoint', 'newest 20'),
             ('W3', 'disjoint', '32-room inbox'), ('W4', 'disjoint', 'disjoint counters'),
             ('W5', 'same', 'shared counter'), ('W5', 'hot1', '1% shared mix')]

def key(cell):
    return tuple(cell[f] for f in FIELDS)

def value(row):
    return row['summary']['highest_passing_offered_per_s']

def formatted(row):
    n = value(row)
    return f'{n:,}' if n is not None else 'no pass'

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('cells', type=Path)
    args = parser.parse_args()
    cells = args.cells.resolve()
    assert (cells / 'cleanup.json').exists()
    assert not json.loads((cells / 'all-process-cleanup.json').read_text())['still_running']
    subprocess.run([sys.executable, str(HERE / 'scripts/audit.py'), str(cells)], check=True)
    report.main([cells])
    ledgers = [json.loads((p / 'ledger.json').read_text()) for p in
               [HERE / 'results-20261021-raw-pg', HERE / 'results-20261021-supabase', cells]]
    lookups = [{key(r['cell']): r for r in rows} for rows in ledgers]
    expected = {(w, k, 1000000, d, 128 if w in ('W1', 'W2', 'W3') else c)
                for d in (0, 500) for w, k, _ in WORKLOADS
                for c in ([128] if w in ('W1', 'W2', 'W3') else [1,2,4,8,16,32,64,128,256])}
    assert set(lookups[2]) == expected and len(expected) == 60
    effective_configs = []
    for row in ledgers[2]:
        assert row['summary']['bracketed'] and row['summary']['repeats'] == 3
        cell = row['cell']
        target = json.loads((cells / f"{cell['workload'].lower()}-n1000000-d{cell['delay_us']}-c{cell['writers']}-{cell['keys']}" / 'target.json').read_text())
        assert target['pool'] == (32 if cell['workload'] in ('W1','W2','W3') else cell['writers'])
        assert target['listener_connections'] == 1 and target['instances'] == 1
        directory = cells / f"{cell['workload'].lower()}-n1000000-d{cell['delay_us']}-c{cell['writers']}-{cell['keys']}"
        config = (directory / 'effective.conf').read_text()
        actual = int(next(line.split('=', 1)[1].strip() for line in config.splitlines() if line.startswith('db-pool =')))
        assert actual == target['pool']
        effective_configs.append(dict(cell=cell, query_pool=actual, listener=1, sha256=hashlib.sha256(config.encode()).hexdigest()))
    (OUT / 'effective-config-summary.json').write_text(json.dumps(effective_configs, indent=2)+'\n')
    for label, directory in [('read', 'w1-n1000000-d0-c128-disjoint'), ('write-c1', 'w4-n1000000-d0-c1-disjoint'),
                             ('write-c32', 'w4-n1000000-d0-c32-disjoint'), ('write-c256', 'w4-n1000000-d0-c256-disjoint')]:
        shutil.copyfile(cells / directory / 'effective.conf', OUT / f'effective-{label}.conf')
    for name in ('ledger.json', 'ledger.md', 'curves.json', 'audit.json', 'ownership.json',
                 'postgres.txt', 'connection-budget.json', 'storage-1000000.json',
                 'plan-w1.json', 'plan-w2.json', 'plan-w3.json', 'plan-counter.json'):
        shutil.copyfile(cells / name, OUT / name)
    comparisons = []
    for k in sorted(expected):
        comparisons.append({'cell': lookups[2][k]['cell'],
                            **{label: lookup[k] for label, lookup in zip(('raw_pg','first_supabase','advocate'), lookups)}})
    (OUT / 'comparison.json').write_text(json.dumps(comparisons, indent=2)+'\n')
    text = ['# All 60 cells beside the original controls', '',
            'Highest tested passing offered ops/s; every repetition must pass. Raw PG and advocate query pools match: 32 for reads, C for writes. Advocate additionally has one schema-cache listener. First Supabase uses pool 10 throughout and is historical context, not a matched-budget baseline.', '',
            '| Workload / keys / added RTT µs / clients | Raw PG | First Supabase (pool 10) | Advocate (pool 32 or C) |',
            '|---|---:|---:|---:|']
    for row in comparisons:
        c = row['cell']
        text.append(f"| {c['workload']} / {c['keys']} / {c['delay_us']} / {c['writers']} | "+' | '.join(formatted(row[label]) for label in ('raw_pg','first_supabase','advocate'))+' |')
    (OUT / 'comparison.md').write_text('\n'.join(text)+'\n')
    headline = []
    table = ['| Workload (1m messages) | Added RTT | Raw PG (32) | First Supabase (10) | Advocate (32 + listener) |',
             '|---|---:|---:|---:|---:|']
    for w, k, label in WORKLOADS:
        for delay in (0,500):
            ident = (w,k,1000000,delay,128 if w in ('W1','W2','W3') else 32)
            selected = {label: lookup[ident] for label, lookup in zip(('raw_pg','first_supabase','advocate'), lookups)}
            headline.append(dict(workload=w, keys=k, label=label, delay_us=delay, **selected))
            table.append(f"| {w} {label} | {'natural' if delay == 0 else '+0.5 ms'} | "+' | '.join(formatted(selected[label]) for label in ('raw_pg','first_supabase','advocate'))+' |')
    (OUT / 'headlines.json').write_text(json.dumps(headline,indent=2)+'\n')
    (OUT / 'matched-budget.md').write_text('\n'.join(table)+'\n')
    rtts = []
    for delay in (0,500):
        values = [json.loads(p.read_text()) for p in cells.glob(f'*-d{delay}-*/rtt-*.json')]
        rtts.append(dict(added_rtt_us=delay, captures=len(values),
                         p50_median_ms=median(v['p50_us']/1000 for v in values),
                         p99_median_ms=median(v['p99_us']/1000 for v in values),
                         p50_range_ms=[min(v['p50_us']/1000 for v in values),max(v['p50_us']/1000 for v in values)]))
    (OUT / 'rtt-summary.json').write_text(json.dumps(rtts,indent=2)+'\n')
    derivation = {'measurement_source_commit':json.loads((cells/'ownership.json').read_text())['source_commit'],
                  'baseline_sha256':{str(p.relative_to(HERE)):hashlib.sha256(p.read_bytes()).hexdigest()
                      for folder in ('results-20261021-raw-pg','results-20261021-supabase')
                      for p in [HERE/folder/'ledger.json', HERE/folder/'curves.json']},
                  'derivation_sha256':{str(p.relative_to(HERE)):hashlib.sha256(p.read_bytes()).hexdigest()
                      for p in [Path(__file__),HERE/'scripts/report.py',HERE/'scripts/audit.py',HERE/'scripts/plot.py']}}
    (OUT / 'derivation.json').write_text(json.dumps(derivation,indent=2)+'\n')
    subprocess.run([sys.executable,str(HERE/'scripts/plot.py'),str(OUT)],check=True)
    plot_comparison(headline)
    print('\n'.join(table))

def plot_comparison(headline):
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt
    plt.rcParams.update({'svg.fonttype':'none','font.size':9})
    fig, axes = plt.subplots(2,3,figsize=(14,7))
    for ax, (w,k,label) in zip(axes.flat, WORKLOADS):
        rows = [r for r in headline if r['workload']==w and r['keys']==k]
        for offset, system, name, color in [(-.25,'raw_pg','Raw PG, pool 32','#145da0'),
                (0,'first_supabase','First Supabase, pool 10','#999999'),
                (.25,'advocate','Advocate, pool 32 + listener','#00876c')]:
            vals = [value(r[system]) for r in rows]
            ax.bar([i+offset for i in range(2)], vals, width=.24, label=name, color=color)
            for i,n in enumerate(vals):
                if n: ax.annotate(f'{n:,}',(i+offset,n),xytext=(0,3),textcoords='offset points',ha='center',fontsize=8)
        ax.set(xticks=[0,1],xticklabels=['natural','+0.5 ms'],yscale='log',title=f'{w}: {label}',ylabel='highest passing offered ops/s')
        ax.set_ylim(bottom=10,top=max(value(r[s]) or 0 for r in rows for s in ('raw_pg','first_supabase','advocate'))*2)
        ax.grid(axis='y',alpha=.2)
    handles, labels = axes.flat[0].get_legend_handles_labels()
    fig.legend(handles,labels,loc='lower center',ncol=3)
    fig.suptitle('1m messages: reads at 128 clients / 32 query connections; writes at C=32\nHistorical pool-10 baseline; 3 repetitions, 2-second windows, shared hosts',fontsize=12)
    fig.tight_layout(rect=(0,.05,1,.92))
    fig.savefig(OUT/'matched-budget.svg',metadata={'Date':None})
    plt.close(fig)
    for p in OUT.glob('*.svg'):
        p.write_text('\n'.join(s.rstrip() for s in p.read_text().splitlines())+'\n')

if __name__ == '__main__':
    main()
