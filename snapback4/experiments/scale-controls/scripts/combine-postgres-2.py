#!/usr/bin/env python3
"""Select completed PG2 cells across the retained observer interruption."""
import argparse
import json
import os
from pathlib import Path
import shutil


def read(p):return json.loads(p.read_text())
def write(p,v):p.write_text(json.dumps(v,indent=2)+'\n')


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('root',type=Path);p.add_argument('--out',type=Path)
    args=p.parse_args();root=args.root.resolve();out=(args.out or root/'campaign').resolve()
    first=root/'raw-final';tail=root/'raw-tail'
    assert (root/'run-tail.exit').read_text().strip()=='0'
    assert not read(first/'cleanup.json')['still_running']
    assert not read(tail/'cleanup.json')['still_running']
    assert read(tail/'database-cleanup.json')==dict(database_dropped=True,role_dropped=True)
    for name in ('local-observer-cleanup.json','wal-observer-cleanup.json'):
        assert not read(tail/name)['still_running']
    assert not read(root/'run-tail.exit.observer-cleanup.json')['still_running']
    out.mkdir(exist_ok=False)
    def link(source,name=None):
        (out/(name or source.name)).symlink_to(os.path.relpath(source,out),target_is_directory=source.is_dir())
    chosen=[first/'w1-n1000000-d0-c128-disjoint',first/'w2-n1000000-d0-c128-disjoint']
    chosen += [s.parent for s in sorted(tail.glob('*/summary.json'))]
    assert len(chosen)==12 and len({c.name for c in chosen})==12
    for c in chosen:
        assert (c/'summary.json').exists()
        link(c)
    ownerships=[read(s/'ownership.json') for s in (first,tail)]
    for key in ('snapback_binary_sha256','binary_sha256'):
        assert len({o[key] for o in ownerships})==1
    events=[]
    for s in (first,tail):events.extend(json.loads(x) for x in (s/'pids.jsonl').read_text().splitlines())
    (out/'pids.jsonl').write_text(''.join(json.dumps(e)+'\n' for e in sorted(events,key=lambda e:e['time'])))
    for name in ('wait-observer.jsonl','db-cpu-observer.jsonl'):
        with (out/name).open('xb') as dst:
            for s in (first,tail):
                with (s/name).open('rb') as src:shutil.copyfileobj(src,dst)
    for name in ('local-cpu.jsonl','wal-timing.jsonl','final-equality.json','database-cleanup.json'):
        link(tail/name)
    for name in ('seed.json','seed-equality.json','storage.json','postgres.txt','check.txt','lscpu.txt','disks.txt','filesystem.txt'):
        link(first/name)
    write(out/'ownership.json',dict(**ownerships[-1],segments=ownerships,
        selection='natural W1/W2 from raw-final, complete W3 rerun and remaining nine cells from raw-tail',
        workload_and_product_semantics_unchanged=True))
    write(out/'cleanup.json',dict(segments=[read(s/'cleanup.json') for s in (first,tail)],still_running=[]))
    write(out/'selection.json',[dict(cell=c.name,source=os.path.relpath(c,root)) for c in chosen])
    # Cross-trial gaps expose late increments that a stable-sum witness could
    # otherwise leave between two audited cohorts. Only read cells were retried.
    writes=sorted((c for c in chosen if read(c/'cell.json')['workload'] in ('W4','W5')),
                  key=lambda c:read(c/'probe.before.json')['time'])
    expected=0;probe_increments=0;actual=0;acks=0;unknown=0;trials=0
    for c in writes:
        before=read(c/'probe.before.json');after=read(c/'probe.after.json');meta=read(c/'probe.json')
        assert before['counters']['sum']==expected+meta['warmup_operations'],c.name
        expected+=meta['warmup_operations']+meta['operations'];probe_increments+=meta['warmup_operations']+meta['operations']
        assert after['counters']['sum']==expected,c.name
        completed=[]
        for f in c.glob('rate-*-r[0-9].json'):
            pre=f.stem;b=read(c/(pre+'.before.json'));a=read(c/(pre+'.after.json'))
            completed.append((b['time'],f,b,a))
        for _,f,b,a in sorted(completed):
            assert b['counters']['sum']==expected,('counter gap before',f.name)
            r=read(f);check=r['counter_check'];assert a['counters']['sum']-b['counters']['sum']==check['delta']
            assert check['delta']>=check['acknowledged_including_warmup']
            assert check['ok']==(check['delta']==check['acknowledged_including_warmup'])
            expected=a['counters']['sum'];actual+=check['delta'];acks+=check['acknowledged_including_warmup'];unknown+=not check['ok'];trials+=1
    assert probe_increments==500 and expected==probe_increments+actual
    write(out/'whole-write-audit.json',dict(write_trials=trials,probe_increments=probe_increments,
        actual_counter_increments_in_load_cohorts=actual,acknowledged_load_writes_including_warmup=acks,
        unknown_outcome_trials=unknown,last_drained_counter_sum=expected,cross_trial_counter_gaps=0,
        acknowledged_write_losses=0,caveat='last drained counter image, not an operation-id receipt audit; only read cells were interrupted'))
    print(json.dumps(dict(cells=len(chosen),write_trials=trials,unknown_outcome_trials=unknown,cross_trial_counter_gaps=0)))


if __name__=='__main__':main()
