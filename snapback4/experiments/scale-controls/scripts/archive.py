#!/usr/bin/env python3
"""Losslessly gzip verbose resource/transport records after a campaign stops.
Per-rate result JSON, cell manifests, summaries and ledger remain plain JSON.
"""
import gzip
import json
import re
from pathlib import Path
import sys

for argument in sys.argv[1:]:
    root=Path(argument)
    assert (root/'cleanup.json').exists(), 'archive only after owned processes stop'
    count=0
    for path in root.rglob('*'):
        if not path.is_file() or path.suffix=='.gz': continue
        if re.fullmatch(r'rate-[0-9]+-r[0-9]+\.json',path.name):
            result=json.loads(path.read_text())
            buckets={key:value['buckets_ns'] for key,value in result.items() if isinstance(value,dict) and 'buckets_ns' in value}
            if buckets:
                name=path.stem+'.histograms.json.gz'
                payload=json.dumps(buckets,separators=(',',':')).encode()
                with (path.parent/name).open('xb') as output:
                    output.write(gzip.compress(payload,compresslevel=9,mtime=0))
                assert gzip.decompress((path.parent/name).read_bytes())==payload
                for key in buckets:
                    del result[key]['buckets_ns']
                    result[key]['buckets_ns_file']=name
                    result[key]['buckets_ns_key']=key
                path.write_text(json.dumps(result,indent=2)+'\n')
                count+=1
            continue
        resource=(path.name.startswith('seed-') and path.suffix=='.txt') or path.name.endswith(('.before.json','.after.json','.resources.json','.waits.txt','.db-cpu.jsonl','.stdout'))
        if resource:
            data=path.read_bytes()
            destination=Path(str(path)+'.gz')
            with destination.open('xb') as output:
                output.write(gzip.compress(data,compresslevel=9,mtime=0))
            assert gzip.decompress(destination.read_bytes())==data
            path.unlink()
            count+=1
        elif path.name.startswith('tunnel-') and path.suffix=='.stderr' and path.stat().st_size==0:
            path.unlink()  # cleanup.json retains every PID/port; no diagnostic lost
    print(root,count,'records losslessly compressed')
