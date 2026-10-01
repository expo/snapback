"""Only diagnosed client timer / search fixture failures may be superseded."""
import json,re

def check_followup(report):
    records=json.loads((report/'followup-results.json').read_text())
    assert len(records)==5
    for row in records:
        text=(report/(row['name']+'.log')).read_text()
        meta=json.loads((report/(row['name']+'.json')).read_text())
        failures=set(re.findall(r'^\s*✖ (.+?) \([\d.]+ms\)$',text,re.M))
        oracle_failures=re.findall(r'^ORACLE_FAIL host=(\w+) seed=(\d+)$',text,re.M)
        assert oracle_failures==([('process','69')] if row['name']=='heavy-3-final' else []),(row,oracle_failures)
        assert failures <= {'packages/snapback4/test/client-seams.test.mjs', 'ordinary search generated oracle process: 300 seeds'},(row,failures)
        assert row['exit']==meta['exit']==int(bool(failures)),row
        counts=[int(n) for n in re.findall(r'^ℹ fail (\d+)$',text,re.M)]
        cancelled=[int(n) for n in re.findall(r'^ℹ cancelled (\d+)$',text,re.M)]
        assert len(counts)==len(cancelled)==2 and counts[1]==cancelled[1]==0,(row,counts,cancelled)
        assert counts[0]+cancelled[0]==len(failures),(row,counts,cancelled)
        if 'packages/snapback4/test/client-seams.test.mjs' in failures:
            assert "Cannot destructure property 'socket' of 'parser.deref(...)' as it is undefined" in text,row
        if 'ordinary search generated oracle process: 300 seeds' in failures:
            assert 'ORACLE_FAIL host=process seed=69' in text or re.search(r'ordinary search generated oracle process: 300 seeds \(7200\d\d\.',text),row
        if cancelled[0]:assert cancelled[0]==1 and 'ordinary search generated oracle process: 300 seeds' in failures,row
        assert meta['source_manifest']==meta['source_manifest_after'],row
        row['superseded_failures']=sorted(failures)
        row['fail_counts']=counts;row['cancelled_counts']=cancelled
    return records
