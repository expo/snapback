import gzip,json,re,sys
from pathlib import Path

def read(path):
    if path.suffix=='.gz': return json.loads(gzip.decompress(path.read_bytes()))
    if path.exists(): return json.loads(path.read_text())
    return json.loads(gzip.decompress(Path(str(path)+'.gz').read_bytes()))
root=Path(sys.argv[1]); full='--full' in sys.argv
assert (root/'cleanup.json').exists()
trials=0; cells=0; schedules=0; passes=0; unknown=0
for summary in sorted(root.glob('*/summary.json')):
    directory=summary.parent; s=read(summary); cell=read(directory/'cell.json'); cells+=1
    passed=[]; failed=[]
    for rate in s['rates']:
        good=True
        for repeat in range(s['repeats']):
            p=directory/f'rate-{rate}-r{repeat}.json'; r=read(p); trials+=1
            assert r['options']['rate']==rate
            assert r['options']['workload']==cell['workload']
            assert r['options']['workers']==cell['writers']
            assert r['options']['rows']==cell['rows']
            assert r['scheduled']==r['success']+r['error_count']==r['latency']['count']
            assert sum(r['errors'].values())==r['error_count']
            if 'total_errors_including_warmup' in r:
                o=r['options'];cohort=(o['rate']*(o['warmup_ms']+o['duration_ms'])+999)//1000
                assert r['total_scheduled_including_warmup']==cohort
                assert r['total_errors_including_warmup']==cohort-r['total_success_including_warmup']
                assert r['warmup_error_count']==r['total_errors_including_warmup']-r['error_count']>=0
            schedules+=r['scheduled']
            for key in ['latency','dispatch_lag','http_service']:
                h=r[key]
                b=h.get('buckets_ns')
                if b is None: b=read(directory/h['buckets_ns_file'])[h['buckets_ns_key']]
                assert sum(row[1] for row in b)==h['count']==r['scheduled']
                assert h['p50_ms']<=h['p99_ms']<=h['p999_ms']<=h['max_ms']
            expected=r['latency']['p99_ms']<=r['slo_ms'] and r['error_count']/r['scheduled']<=.001
            if 'counter_check' in r:
                if not r['counter_check']['ok']: unknown+=1
                expected=expected and r['counter_check']['ok']
            assert r['slo_pass']==expected
            original=read(directory/f'rate-{rate}-r{repeat}.stdout')
            assert original['scheduled']==r['scheduled'] and original['success']==r['success']
            for key in ['latency','dispatch_lag','http_service']:
                h=r[key]
                b=h.get('buckets_ns')
                if b is None:b=read(directory/h['buckets_ns_file'])[h['buckets_ns_key']]
                assert b==original[key]['buckets_ns']
            good &= r['slo_pass']
        (passed if good else failed).append(rate)
    assert s['highest_passing_offered_per_s']==max(passed,default=None)
    assert s['lowest_failing_offered_per_s']==min(failed,default=None)
    assert s['bracketed']==bool(passed and failed)
    passes+=bool(passed)
if full: assert cells==132 and passes==132
record={'cells':cells,'trials':trials,'scheduled_arrivals':schedules,'cells_with_passing_rate':passes,'unknown_write_outcome_trials':unknown,'checks':'arrival accounting, every repetition, histogram counts and lossless archive, SLO/counter qualification, brackets'}
(root/'audit.json').write_text(json.dumps(record,indent=2)+'\n');print(json.dumps(record))
