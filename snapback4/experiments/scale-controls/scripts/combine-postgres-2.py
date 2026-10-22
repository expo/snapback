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
    first=root/'raw-final';tail=root/'raw-tail';last=root/'raw-writes';segments=(first,tail,last)
    assert (root/'run-writes.exit').read_text().strip()=='0'
    for s in segments:assert not read(s/'cleanup.json')['still_running']
    assert read(last/'database-cleanup.json')==dict(database_dropped=True,role_dropped=True)
    for s in (tail,last):
        for name in ('local-observer-cleanup.json','wal-observer-cleanup.json'):
            assert not read(s/name)['still_running']
    for name in ('run-tail.exit','run-writes.exit'):
        assert not read(root/(name+'.observer-cleanup.json'))['still_running']
    out.mkdir(exist_ok=False)
    def link(source,name=None):
        (out/(name or source.name)).symlink_to(os.path.relpath(source,out),target_is_directory=source.is_dir())
    chosen=[first/'w1-n1000000-d0-c128-disjoint',first/'w2-n1000000-d0-c128-disjoint']
    chosen += [s.parent for s in sorted(tail.glob('*/summary.json'))]
    chosen += [s.parent for s in sorted(last.glob('*/summary.json'))]
    assert len(chosen)==12 and len({c.name for c in chosen})==12
    for c in chosen:
        assert (c/'summary.json').exists()
        link(c)
    ownerships=[read(s/'ownership.json') for s in segments]
    for key in ('snapback_binary_sha256','binary_sha256'):
        assert len({o[key] for o in ownerships})==1
    events=[]
    for s in segments:events.extend(json.loads(x) for x in (s/'pids.jsonl').read_text().splitlines())
    (out/'pids.jsonl').write_text(''.join(json.dumps(e)+'\n' for e in sorted(events,key=lambda e:e['time'])))
    for name in ('wait-observer.jsonl','db-cpu-observer.jsonl','local-cpu.jsonl','wal-timing.jsonl'):
        with (out/name).open('xb') as dst:
            for s in segments:
                if (s/name).exists():
                    with (s/name).open('rb') as src:shutil.copyfileobj(src,dst)
    for name in ('final-equality.json','database-cleanup.json'):
        link(last/name)
    for name in ('seed.json','seed-equality.json','storage.json','postgres.txt','check.txt','lscpu.txt','disks.txt','filesystem.txt'):
        link(first/name)
    write(out/'ownership.json',dict(**ownerships[-1],segments=ownerships,
        selection='natural W1/W2 from raw-final, seven complete cells from raw-tail, three delayed write cells from raw-writes',
        workload_and_product_semantics_unchanged=True))
    write(out/'cleanup.json',dict(segments=[read(s/'cleanup.json') for s in segments],still_running=[]))
    write(out/'selection.json',[dict(cell=c.name,source=os.path.relpath(c,root)) for c in chosen])
    # Cross-trial gaps expose late increments that a stable-sum witness could
    # otherwise leave between two audited cohorts. The abandoned delayed W4
    # attempt has a separately witnessed physical offset, never a passing trial.
    writes=sorted((c for c in chosen if read(c/'cell.json')['workload'] in ('W4','W5')),
                  key=lambda c:read(c/'probe.before.json')['time'])
    expected=0;probe_increments=0;actual=0;acks=0;unknown=0;trials=0
    discarded=None
    for c in writes:
        if c.parent==last and discarded is None:
            recovered=read(last/'resume-counter.json')['counter_sum']
            interrupted=tail/'w4-n1000000-d500-c32-disjoint'
            partial=read(interrupted/'rate-1600-r0.stdout')
            partial_before=read(interrupted/'rate-1600-r0.before.json')['counters']['sum']
            old=[read(p) for p in sorted(interrupted.glob('rate-3200-r[0-9].json'))]
            completed_delta=sum(x['counter_check']['delta'] for x in old)
            partial_delta=recovered-partial_before
            assert partial_delta>=partial['total_success_including_warmup']
            assert recovered-expected==70+completed_delta+partial_delta
            discarded=dict(probe_increments=70,completed_unqualified_trials=len(old),
                completed_actual_increments=completed_delta,interrupted_trials=1,
                interrupted_actual_increments=partial_delta,
                unknown_outcome_trials=sum(not x['counter_check']['ok'] for x in old)+(partial_delta!=partial['total_success_including_warmup']),
                acknowledged_writes=sum(x['total_success_including_warmup'] for x in old)+partial['total_success_including_warmup'],
                physical_counter_offset=recovered-expected,source='raw-tail delayed W4; drain refused; whole cell rerun')
            expected=recovered
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
    assert probe_increments==500 and discarded is not None
    assert expected==probe_increments+actual+discarded['physical_counter_offset']
    write(out/'whole-write-audit.json',dict(write_trials=trials,probe_increments=probe_increments,
        actual_counter_increments_in_load_cohorts=actual,acknowledged_load_writes_including_warmup=acks,
        unknown_outcome_trials=unknown,last_drained_counter_sum=expected,cross_trial_counter_gaps=0,
        acknowledged_write_losses=0,discarded_write_attempt=discarded,
        caveat='last drained counter image; abandoned delayed W4 physical offset is separately recovered, not qualified'))
    print(json.dumps(dict(cells=len(chosen),write_trials=trials,unknown_outcome_trials=unknown,cross_trial_counter_gaps=0)))


if __name__=='__main__':main()
