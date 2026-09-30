#!/usr/bin/env python3
"""Keep attribution and all receipt samples; never copy captured row bodies."""
from pathlib import Path
import collections, json, statistics, sys
report = Path(__file__).resolve().parent
def attribution(capture, direct):
    devices = []
    for requests in sorted(capture.glob('*.requests.jsonl')):
        prefix = str(requests).removesuffix('.requests.jsonl')
        commands = [json.loads(line) for line in requests.read_text().splitlines()]
        profiles = [json.loads(line.removeprefix('NA_PROFILE ')) for line in Path(prefix+'.core.jsonl').read_text().splitlines() if line.startswith('NA_PROFILE ')]
        ipc = [json.loads(line) for line in Path(prefix+'.ipc.jsonl').read_text().splitlines()]
        assert len(commands) == len(profiles) == len(ipc), (len(commands),len(profiles),len(ipc))
        totals = collections.Counter(); calls = collections.Counter(); pages = []
        for command,profile,pipe in zip(commands,profiles,ipc):
            if command['op'] != 'apply': continue
            totals.update(profile['ns']); calls.update(profile['calls'])
            pages.append({'seq':pipe['seq'],'snapshot':command['page'].get('snapshot',False),
                'rows':len(command['page'].get('events',[])), 'more':command['page'].get('more',False),
                'ipcMs':pipe['ms'],'bytes':pipe['bytes'],'profile':profile})
        devices.append({'pid':requests.name.split('.')[0], 'commands':len(commands), 'applyPages':pages,
            'applyPhaseMs':{k:v/1e6 for k,v in totals.items()}, 'applyCalls':dict(calls),
            'allIpcMs':sum(p['ms'] for p in ipc),'applyIpcMs':sum(p['ipcMs'] for p in pages),
            'requestBytes':sum(p['bytes'] for p in ipc),'replyBytes':sum(p['replyBytes'] for p in ipc)})
    replay = [json.loads(line) for line in direct.read_text().splitlines() if line.startswith('{')]
    totals = collections.Counter(); counts = collections.Counter()
    for page in replay:
        if 'profile' in page: totals.update(page['profile']['ns']); counts.update(page['profile']['calls'])
    return {'process':devices, 'js':[json.loads(p.read_text()) for p in sorted(capture.glob('*.js.json'))],
        'direct':{'summary':replay[-1], 'decodeMs':sum(p.get('decodeMs',0) for p in replay),
            'applyPhaseMs':{k:v/1e6 for k,v in totals.items()},'applyCalls':dict(counts)}}
if len(sys.argv)>1:
    print(json.dumps(attribution(Path(sys.argv[1]),Path(sys.argv[2])),indent=2))
else:
    results = []
    for phase in ['before','after']:
        for receipt in sorted((report/phase).glob('*/*/acquire.json')):
            data = json.loads(receipt.read_text()); assert data['passed']
            samples = [{k:r.get(k) for k in ['acquiredMs','firstLocalMs','serverSyncMs']} | {'restartMs':r['restart']['firstLocalMs']} for r in data['runs']]
            results.append({'phase':phase,'condition':receipt.parent.parent.name,'account':receipt.parent.name,
                'samples':samples, 'median':{k:statistics.median(s[k] for s in samples) for k in samples[0]}})
    print(json.dumps(results,indent=2))
