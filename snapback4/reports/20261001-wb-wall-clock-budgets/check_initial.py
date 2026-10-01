"""Check every diagnosed initial failure; only final-byte reruns can supersede it."""
import json,re

ALLOWED = {
    'wasm: pending cut preserves transition before sync publication': 'live-propagation-fallback.test.mjs',
    'process: unknown apply refresh drains after the watermark': 'per-row-publication.test.mjs',
    'closing the last owner during backoff cancels the next stale-response request': 'online-store-order.test.mjs',
    '1,000 per-row useQuery hooks: a relevant write renders revalidating answers with zero loading renders': 'per-row-react.test.mjs',
    'process 1,000 rows: known apply, empty apply, unrelated apply and duplicate hooks': 'per-row-work.test.mjs',
    'stopped full-release restore preserves its recovery point and stays separate from the original': 'release-activation.test.mjs',
    'ordinary search generated oracle wasm: 300 seeds': 'ordinary-search-oracle.test.mjs',
    'dev declares two workers, injects usable secret seats, restarts independently and stops both': 'supervised-workers.test.mjs',
    'unread range wasm: meter-cut': 'unread-range.test.mjs',
    'unread range wasm: short-range-large-window': 'unread-range.test.mjs',
    'unread range wasm: sequence-short-range-large-window': 'unread-range.test.mjs',
    'mutate waits for outbox persistence before the exit transport can see it': 'web-navigation.test.mjs',
    'same-epoch logout tombstone refuses live admission': 'web-admission-review.test.mjs',
    'web admission review: recovery and transport respect the session boundary': 'web-admission-review.test.mjs',
}

def check_initial(report):
    records=json.loads((report/'heavy-results.json').read_text())
    stops={r['name']:r for r in json.loads((report/'superseded-model-stops.json').read_text())}
    late_tests=json.loads((report/'late-tests.json').read_text())
    assert len(records)==5
    for record in records:
        meta=json.loads((report/(record['name']+'.json')).read_text())
        text=(report/(record['name']+'.log')).read_text()
        failures=set(re.findall(r'^\s*✖ (.+?) \([\d.]+ms\)$',text,re.M))
        stopped_model='packages/snapback4/test/app-session-model.test.mjs'
        assert stopped_model in failures,record
        failures.remove(stopped_model)
        oracle_failures=re.findall(r'^ORACLE_FAIL host=(\w+) seed=(\d+)$',text,re.M)
        assert oracle_failures==([('wasm','75')] if record['name']=='heavy-5' else []),(record,oracle_failures)
        counts=[int(n) for n in re.findall(r'^ℹ fail (\d+)$',text,re.M)]
        cancelled=[int(n) for n in re.findall(r'^ℹ cancelled (\d+)$',text,re.M)]
        assert record['name'] in stops and record['exit']==meta['exit'] and meta['exit'] in (1,143,241,-15),record
        assert not failures-set(ALLOWED),(record,failures-set(ALLOWED))
        assert counts==[len(failures),0] and cancelled==[0,1],(record,counts,cancelled)
        for name in failures:
            path='packages/snapback4/test/'+ALLOWED[name]
            assert path in late_tests and path+':' in text,(record,name)
        assert meta['source_manifest']==meta['source_manifest_after'],record
        record['superseded_failures']=sorted(failures)
        record['obsolete_model_stage_stopped']=True
    return records
