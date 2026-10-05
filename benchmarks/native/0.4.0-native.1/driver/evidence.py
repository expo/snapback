"""Independent validators; no app event by itself can grant an assertion."""
import hashlib
import json
import math
import struct
from functools import lru_cache
from pathlib import Path
from urllib.parse import urlparse
from video import decoded_video

VERSION = '0.4.0-native.1'
PROTOCOL = 'clique-native/1'
ASSERTIONS = {'m6': ['m6-a01','m6-a02','m6-a04','m6-a03','m6-a05','m6-a06','m6-a07'], 'm8':['m8-a17','m8-a18']}

def sha(path): return hashlib.sha256(Path(path).read_bytes()).hexdigest()
def body_hash(body): return hashlib.sha256(body.encode()).hexdigest()
def require(test, reason):
    if not test: raise ValueError(reason)

def safe_file(root, name):
    root = Path(root).resolve()
    path = root / name
    require(not Path(name).is_absolute() and '..' not in Path(name).parts and path.resolve().is_relative_to(root), 'evidence-path-escape')
    require(not any(p.is_symlink() for p in [path, *path.parents] if p.is_relative_to(root)), 'evidence-symlink')
    require(path.is_file(), 'evidence-missing:' + name)
    return path

@lru_cache(maxsize=8)
def validator(name):
    import jsonschema
    schema=json.loads((Path(__file__).parent.parent/'schemas'/(name+'.schema.json')).read_text())
    return jsonschema.Draft202012Validator(schema,format_checker=jsonschema.FormatChecker())

def schema_check(name,value):
    import jsonschema
    try:validator(name).validate(value)
    except jsonschema.ValidationError as e:
        raise ValueError('schema-invalid:'+name+':'+'.'.join(map(str,e.absolute_path))) from None

def fixture_valid(f, run_id, bundle, origin):
    schema_check('fixture',f)
    require(f.get('protocol') == PROTOCOL and f.get('runId') == run_id, 'fixture-version-or-nonce')
    require(f.get('bundleId') == bundle and f.get('origin') == origin, 'fixture-build-or-origin')
    for key in ['alice','bob','conversationId','chatValue']:
        require(isinstance(f.get(key), str) and f[key], 'fixture-identity:' + key)
    require(f['alice'] != f['bob'] and f['chatValue'] == 'dm:bob', 'fixture-personas')
    for key in ['history','ordinary','viewOnce','search']:
        require(isinstance(f.get(key),dict) and f[key].get('messageId'), 'fixture-message:' + key)
    require(f['queuedBodies'] == [run_id+':first',run_id+':second'], 'fixture-compose-nonce')
    require(f['search']['messageId'] == f['history']['messageId'] and f['search']['token'] in f['history']['body'], 'fixture-search')

def events_valid(events, f, launches, build):
    require(bool(events), 'missing-observations')
    seen = {}; current = None
    launches = {l['processNonce']: l for l in launches}
    for event in events:
        schema_check('observations',event)
        require(event.get('protocol') == PROTOCOL and event.get('runId') == f['runId'], 'stale-or-unsupported-observation')
        nonce = event.get('processNonce'); require(nonce in launches, 'unrecorded-process-nonce')
        if nonce != current:
            require(nonce not in seen, 'replayed-process-stream'); current = nonce
            seen[nonce] = (0, -1)
        seq, elapsed = seen[nonce]
        require(event.get('sequence') == seq+1, 'observation-sequence-gap-or-replay')
        require(isinstance(event.get('elapsedMs'),(float,int)) and math.isfinite(event['elapsedMs']) and event['elapsedMs'] >= elapsed, 'nonmonotonic-process-time')
        require(isinstance(event.get('receivedAt'),(int,float)) and event['receivedAt'] >= launches[nonce]['at'], 'observation-before-launch')
        seen[nonce] = (event['sequence'], event['elapsedMs'])
        p=event.get('payload',{}); kind=event.get('kind')
        require('pass' not in p, 'app-verdict-forbidden')
        if kind=='ready':
            require(p.get('principal')==f['alice'] and p.get('origin')==f['origin'], 'ready-identity')
            require(p.get('authenticationRestored') is True and p.get('development') is False and p.get('build')==build, 'ready-build-or-authentication')
        elif kind=='screen':
            require(p.get('route') in ['auth','chats','conversation','search'], 'screen-route')
            require(isinstance(p.get('rows'),list), 'screen-rows')
            require(len({r['messageId'] for r in p['rows']})==len(p['rows']), 'duplicate-rendered-row')
        elif kind=='write':
            require(p.get('state') in ['pending','settled','refused'] and isinstance(p.get('ordinal'),int) and p['ordinal']>0, 'write-transition')
            require(p.get('bodyHash') in list(map(body_hash,f['queuedBodies'])), 'write-body-identity')
        elif kind=='media':
            matches=[f[k] for k in ['ordinary','viewOnce'] if f[k]['messageId']==p.get('messageId') and f[k]['assetId']==p.get('assetId')]
            require(len(matches)==1 and p.get('event') in ['load','error','consumed','denied'], 'media-identity-or-event')
            if p['event']=='load': require(p.get('width',0)>0 and p.get('height',0)>0, 'media-decoded-dimensions')
        elif kind=='search':
            require(isinstance(p.get('resultIds'),list) and isinstance(p.get('token'),str), 'search-shape')
        else: raise ValueError('unknown-observation-kind')

def oracle_valid(o,f,ids,receipt=None):
    require(o.get('principal')==f['bob'] and o.get('origin')==f['origin'] and o.get('conversationId')==f['conversationId'], 'oracle-identity')
    require(o.get('complete') is True and isinstance(o.get('rows'),list), 'oracle-incomplete')
    matches=[]
    for body in f['queuedBodies']:
        rows=[r for r in o['rows'] if r.get('body')==body]
        require(len(rows)==1, 'server-occurrence-count:'+str(len(rows)))
        matches.append(rows[0])
    require([r['messageId'] for r in matches]==ids, 'server-message-identity')
    keys=[r.get('orderKey') for r in matches]
    require(all(isinstance(k,list) and k and all(isinstance(x,(int,float,str)) and not isinstance(x,bool) for x in k) for k in keys), 'server-order-missing')
    require(keys[0] < keys[1], 'server-send-order')
    if receipt: require(all(r.get('receiptState')==receipt for r in matches), 'server-receipt-state:'+receipt)
    return matches

def nodes(tree, id=None):
    out=[]
    if id is None or tree.get('id')==id: out.append(tree)
    for child in tree.get('children',[]): out+=nodes(child,id)
    return out

def row(tree, identity):
    found=[n for n in nodes(tree,'sm-convo-bubble') if n.get('value')==identity]
    require(len(found)==1, 'bubble-identity-count:'+identity)
    return found[0]

def pending(tree, bodies, ids=None, receipt='pending'):
    result=[]
    bubbles=nodes(tree,'sm-convo-bubble')
    for index,body in enumerate(bodies):
        found=[n for n in bubbles if any(body==x.get('label') for x in nodes(n))]
        require(len(found)==1, 'visible-body-count:'+body)
        b=found[0]
        if ids: require(b['value']==ids[index], 'visible-message-identity')
        ticks=nodes(b,'sm-convo-receipt')
        require(len(ticks)==1 and ticks[0]['value']==receipt, 'receipt-accessibility:'+receipt)
        require(b.get('hittable') or any(n.get('hittable') for n in nodes(b)), 'bubble-offscreen')
        result.append(b)
    require(all(a['frame']['y']<b['frame']['y'] for a,b in zip(result,result[1:])), 'visible-compose-order')
    return [n['value'] for n in result]

def pixel_match(screenshot, frame, expected):
    from PIL import Image, ImageChops, ImageStat
    image=Image.open(screenshot).convert('RGB'); reference=Image.open(expected).convert('RGB')
    scale=image.width / frame['screenWidth']
    x,y,w,h=[frame[k]*scale for k in ['x','y','width','height']]
    # Contract uses aspect-fit; remove letterboxing using the decoded fixture ratio.
    fit=min(w/reference.width,h/reference.height); fw,fh=reference.width*fit,reference.height*fit
    crop=image.crop((round(x+(w-fw)/2),round(y+(h-fh)/2),round(x+(w+fw)/2),round(y+(h+fh)/2))).resize((96,64))
    diff=ImageStat.Stat(ImageChops.difference(crop,reference.resize((96,64)))).mean
    return sum(diff)/3 < 20, round(sum(diff)/3,3)

def mp4_complete(path):
    data=Path(path).read_bytes();offset=0;boxes=[]
    while offset<len(data):
        require(len(data)-offset>=8,'truncated-video-box')
        size,kind=struct.unpack('>I4s',data[offset:offset+8]);header=8
        if size==1:
            require(len(data)-offset>=16,'truncated-video-size')
            size=struct.unpack('>Q',data[offset+8:offset+16])[0];header=16
        elif size==0:size=len(data)-offset
        require(size>=header and offset+size<=len(data),'truncated-video-box')
        boxes.append(kind);offset+=size
    require(all(kind in boxes for kind in [b'ftyp',b'mdat',b'moov']),'incomplete-video-container')


def snapshot_time(host, name):
    captures=[h['at'] for h in host if h['kind']=='native-snapshot' and h.get('file')==name]
    require(bool(captures), 'snapshot-time-missing:'+name)
    return captures[-1]

def viewonce_frame(tree):
    views=nodes(tree,'sm-media-viewer-image')
    require(len(views)==1,'prime-viewonce-viewer-missing')
    frame={**views[0]['frame'],'screenWidth':tree['frame']['width']}
    require(all(isinstance(frame[k],(int,float)) and math.isfinite(frame[k]) for k in frame),'viewonce-frame-invalid')
    require(frame['width']>0 and frame['height']>0 and frame['screenWidth']>0,'viewonce-frame-invalid')
    return frame

# @ref LLP 0201.000#round-4--sticky-disclosure-and-scaled-pixels — bounded scale search, independent of the cold viewer frame or mat.
def viewonce_pixels(prime, cold, frame, fixture):
    import cv2
    import numpy as np
    from PIL import Image
    require(pixel_match(prime,frame,fixture)[0],'prime-viewonce-pixel-mismatch')
    image=Image.open(prime).convert('RGB');scale=image.width/frame['screenWidth']
    x,y,w,h=[frame[k]*scale for k in ['x','y','width','height']]
    # Match image content, excluding the prime viewer's aspect-fit letterbox.
    with Image.open(fixture) as reference:fw,fh=reference.size
    fit=min(w/fw,h/fh);fw*=fit;fh*=fit
    opened=image.crop((round(x+(w-fw)/2),round(y+(h-fh)/2),round(x+(w+fw)/2),round(y+(h+fh)/2)))
    screen=Image.open(cold).convert('RGB')
    require(screen.size==image.size,'viewonce-screen-size-mismatch')
    # Bound runtime inside the refusal poll. Search all placements at each 1%
    # scale from .25 to 1.25; no cold accessibility frame is trusted as a locator.
    reduction=min(1,480/screen.width)
    screen=np.asarray(screen.resize((round(screen.width*reduction),round(screen.height*reduction)),Image.Resampling.BOX))
    constant=np.var(np.asarray(opened).astype(float),axis=(0,1)).sum()<1
    best=float('inf') if constant else -1.;sizes=set();best_size=None
    def measure(size):
        nonlocal best,best_size
        if size in sizes or min(size)<2 or size[0]>screen.shape[1] or size[1]>screen.shape[0]:return
        sizes.add(size)
        template=np.asarray(opened.resize(size,Image.Resampling.BOX))
        if constant:
            # Correlation is undefined for a spatially constant reference.
            error=max(0,float(cv2.matchTemplate(screen,template,cv2.TM_SQDIFF).min())/template.size)**.5
            if error<best:best=error;best_size=size
        else:
            if np.var(template.astype(float),axis=(0,1)).sum()<1:return
            score=float(cv2.matchTemplate(screen,template,cv2.TM_CCOEFF_NORMED).max())
            if score>best:best=score;best_size=size
    for percent in range(25,126):
        measure((max(1,round(opened.width*reduction*percent/100)),max(1,round(opened.height*reduction*percent/100))))
    if not constant and best_size and best<.99:
        # Refine the best scale for sub-percent rounding and modest aspect
        # changes (e.g. an equal-pixel inset inside the original rectangle).
        width,height=best_size
        dx=max(1,round(width*.01));dy=max(1,round(height*.01))
        for i in range(-4,5):
            for j in range(-4,5):measure((width+i*dx,height+j*dy))
        width,height=best_size
        for i in range(-1,2):
            for j in range(-1,2):measure((width+i,height+j))
    return (best<20,round(best,3)) if constant else (best>=.90,round(best,6))

def viewonce_refusal(tree, events, f, after_sequence):
    once=nodes(row(tree,f['viewOnce']['messageId']),'sm-convo-viewonce')
    # A disabled, opened control is itself a native refusal at the attempted reopen.
    disabled=len(once)==1 and once[0].get('enabled') is False and once[0].get('value')=='opened'
    fresh=any(e['sequence']>after_sequence and e['kind']=='media' and e['payload']['messageId']==f['viewOnce']['messageId'] and e['payload']['event'] in ['denied','consumed'] for e in events)
    require(disabled or fresh,'viewonce-refusal-missing')

def no_viewonce_reload(events,f):
    require(not any(e['kind']=='media' and e['payload']['messageId']==f['viewOnce']['messageId'] and e['payload']['event']=='load' for e in events),'viewonce-reloaded-in-cold-process')

def pending_screen_valid(events,f,ids,captured):
    screens=[e for e in events if e['kind']=='screen' and e['receivedAt']<=captured]
    require(bool(screens),'restart-pending-screen-missing')
    screen=screens[-1]['payload']
    require(screen['route']=='conversation' and screen['conversationId']==f['conversationId'],'restart-pending-screen-conversation')
    rows=screen['rows']
    for id,body in zip(ids,f['queuedBodies']):
        require(sum(r['messageId']==id and r['bodyHash']==body_hash(body) and r['receipt']=='pending' for r in rows)==1,'restart-pending-screen-missing')
    require([r['messageId'] for r in rows if r['messageId'] in ids]==ids,'restart-pending-screen-order')

def read_screen_valid(events,f,ids,captured):
    # A committed read screen may precede Bob's visit; the in-window native snapshot
    # and server sample corroborate that this retained screen state is still current.
    screens=[e for e in events if e['kind']=='screen' and e['receivedAt']<=captured]
    require(bool(screens),'read-render-event')
    p=screens[-1]['payload']
    require(p['route']=='conversation' and p['conversationId']==f['conversationId'] and all(any(r['messageId']==id and r['bodyHash']==body_hash(body) and r['receipt']=='read' for r in p['rows']) for id,body in zip(ids,f['queuedBodies'])),'read-render-event')


def provenance_valid(m, qualified=None):
    """The trust anchor comes from the grader's instrument, never the evidence directory."""
    source=Path(__file__).resolve().parent.parent
    inventory=json.loads((source/'instrument.manifest.json').read_text())
    expected={'commit':(source/'INSTRUMENT_COMMIT').read_text().strip(),
              'inventorySha256':sha(source/'INSTRUMENT.sha256'),
              'instrumentPin':inventory['instrumentPin'],'scoredUse':False}
    require(m.get('instrument')==expected,'instrument-identity-mismatch')
    require(expected['inventorySha256']==inventory['inventorySha256'],'instrument-inventory-mismatch')
    lines=''.join(digest+'  '+name+'\n' for name,digest in inventory['files'].items())
    require(lines==(source/'INSTRUMENT.sha256').read_text(),'instrument-inventory-contents')
    for name,digest in inventory['files'].items():
        require(sha(safe_file(source,name))==digest,'instrument-source-drift:'+name)
    require(m.get('driverSourceSha256')==inventory['files']['driver/run.py'],'driver-source-mismatch')
    if qualified is None: qualified=json.loads((source/'QUALIFIED.json').read_text())
    require(qualified['instrument']==expected,'qualification-instrument-mismatch')
    require(m.get('driverBinarySha256')==qualified['driverBinarySha256'],'driver-binary-mismatch')
    require(m.get('driverSourceSha256')==qualified['driverSourceSha256'],'qualification-source-mismatch')

def conversation_valid(tree,events,f,search=False):
    screens=[e for e in events if e['kind']=='screen']
    require(bool(screens),'conversation-screen-missing')
    screen=screens[-1]
    require(screen['payload']['route']=='conversation' and screen['payload']['conversationId']==f['conversationId'],'screen-conversation')
    containers=nodes(tree,'sm-conversation')
    require(len(containers)==1 and containers[0].get('value')==f['conversationId'],'native-conversation-identity')
    # XCTest may flatten a non-accessible RN container into a sibling marker.
    # The unique screen identity, visible row and committed event must still agree.
    b=row(tree,f['history']['messageId'])
    require(any(n.get('label')==f['history']['body'] for n in nodes(b)),'conversation-history-body')
    require(b.get('hittable') or any(n.get('hittable') for n in nodes(b)),'conversation-history-offscreen')
    require(any(r['messageId']==f['history']['messageId'] and r['bodyHash']==body_hash(f['history']['body']) for r in screen['payload']['rows']),'conversation-history-render')
    if search:
        claims=[e for e in events if e['kind']=='search' and e['payload']['token']==f['search']['token'] and f['search']['messageId'] in e['payload']['resultIds'] and e['payload']['openedConversationId']==f['conversationId']]
        require(bool(claims),'search-identity')
        require(screen['processNonce']==claims[-1]['processNonce'] and screen['sequence']>claims[-1]['sequence'],'search-fresh-screen-missing')

def settled_ids(events,f,pending_ids):
    result=[]
    for body,old in zip(f['queuedBodies'],pending_ids):
        intents=[e['payload'] for e in events if e['kind']=='write' and e['payload']['state']=='pending' and e['payload']['messageId']==old and e['payload']['bodyHash']==body_hash(body)]
        require(bool(intents),'pending-write-missing')
        intent=intents[-1]
        writes=[e['payload'] for e in events if e['kind']=='write' and e['payload']['state']=='settled' and e['payload']['bodyHash']==body_hash(body) and e['payload']['ordinal']==intent['ordinal'] and e['payload']['operationId']==intent['operationId']]
        require(bool(writes),'settled-write-missing')
        require(len({w['messageId'] for w in writes})==1,'settled-message-ambiguous')
        result.append(writes[-1]['messageId'])
    require(len(set(result))==2,'settled-message-collision')
    return result

def receipt_window_valid(host):
    starts=[e for e in host if e['kind']=='receipt-window-start']
    ends=[e for e in host if e['kind']=='receipt-window-end']
    require(len(starts)==len(ends)==1,'receipt-window-missing')
    require(0<=ends[0]['at']-starts[0]['at']<=60 and ends[0]['durationSeconds']<=60,'receipt-deadline-exceeded')
    captured=snapshot_time(host,'final-read.json')
    require(starts[0]['at']<=captured<=ends[0]['at'],'receipt-native-outside-window')
    samples=[e for e in host if e['kind']=='oracle-sample' and e['file']=='server-final.json']
    require(bool(samples) and starts[0]['at']<=samples[-1]['at']<=ends[0]['at'],'receipt-oracle-outside-window')

def verify_directory(directory, segment, qualified=None, candidate=None):
    root=Path(directory); m=candidate[0] if candidate else json.loads(safe_file(root,f'{segment}-ios-run.json').read_text())
    provenance_valid(m,qualified)
    schema_check('run',m)
    require(m.get('protocol')==PROTOCOL and m.get('version')==VERSION, 'manifest-version')
    for name,digest in m.get('files',{}).items():
        actual=hashlib.sha256(candidate[1].encode()).hexdigest() if candidate and name==f'{segment}-ios-receipts.jsonl' else sha(safe_file(root,name))
        require(actual==digest,'evidence-hash-mismatch:'+name)
    require(not (root/'overflow.json').exists(),'observation-journal-overflow')
    receipt_text=candidate[1] if candidate else safe_file(root,f'{segment}-ios-receipts.jsonl').read_text()
    receipts=[json.loads(x) for x in receipt_text.splitlines()]
    require([r['assertion'] for r in receipts]==ASSERTIONS[segment], 'assertion-set')
    for receipt in receipts: schema_check('receipts',receipt)
    if m.get('failure') and m['failure']['outcomeClass']!='application':
        require(all(r['pass'] is None and r['details']['reason']==m['failure']['reason'] for r in receipts),'unmeasured-receipt-disagreement')
        return m,receipts
    require(any(r['pass'] is False for r in receipts) if m['failure'] else all(r['pass'] is True for r in receipts),'failure-receipt-disagreement')
    for name in [f'{segment}-ios-screen.mp4',f'{segment}-ios-receipts.jsonl','native-observations.jsonl','native-fixture.json','host.jsonl']:
        require(name in m.get('files',{}),'evidence-unbound:'+name)
    mp4_complete(safe_file(root,f'{segment}-ios-screen.mp4'))
    video=decoded_video(safe_file(root,f'{segment}-ios-screen.mp4'))
    require((m.get('video') or {}).get('decodedEndpoints') is True and m['video'].get('codec')==video['codec'] and abs(m['video']['durationSeconds']-video['durationSeconds'])<=.1,'invalid-video-metadata')
    require(m.get('installedBefore')==m.get('installedAfter')==m.get('build'), 'build-changed')
    require(m.get('storeBefore')==m.get('storeAfter'), 'backend-store-changed')
    f=json.loads(safe_file(root,'native-fixture.json').read_text())
    fixture_valid(f,m['runId'],m['build']['bundleId'],m['backend']['origin'])
    raw=safe_file(root,'native-observations.jsonl').read_bytes()
    require(raw.endswith(b'\n'),'truncated-observations')
    events=[json.loads(line) for line in raw.splitlines()]
    events_valid(events,f,m['launches'],m['build'])
    require(m.get('prime',{}).get('complete') is True,'unprimed')
    sequence=m['steps']; expected=list(range(1,9 if segment=='m6' else 6))
    actual=[s['step'] for s in sequence]
    require(actual==expected if m.get('failure') is None else bool(actual) and actual==expected[:len(actual)], 'incomplete-state-sequence')
    require(all(a['at']<=b['at'] for a,b in zip(sequence,sequence[1:])), 'state-sequence-time')
    require(m.get('offlineProbes') and all(not p['reachable'] for p in m['offlineProbes']), 'offline-cut-invalid')
    require(m.get('reinstalledDuringMeasurement') is False, 'reinstall-during-measurement')
    require([r['assertion'] for r in receipts]==ASSERTIONS[segment], 'assertion-set')
    import jsonschema
    schema=json.loads((Path(__file__).parent.parent/'schemas/receipts.schema.json').read_text())
    for receipt in receipts:
        jsonschema.validate(receipt,schema)
        require(receipt['version']==VERSION and receipt['runId']==f['runId'], 'receipt-identity')
        if receipt['pass'] is True:
            refs=m.get('assertionEvidence',{}).get(receipt['assertion'],{})
            require(refs.get('files') and refs.get('eventSequences') and refs.get('videoSeconds') is not None, 'assertion-unbound-evidence')
            require(all(p in m['files'] for p in refs['files']), 'assertion-file-unbound')
            require(all(any([e['processNonce'],e['sequence']]==ref for e in events) for ref in refs['eventSequences']), 'assertion-event-missing')
            require(0<=refs['videoSeconds']<=video['durationSeconds']+2, 'assertion-outside-video')
    host=[json.loads(line) for line in safe_file(root,'host.jsonl').read_text().splitlines()]
    if any(r['pass'] is True and r['assertion'] in ['m6-a06','m6-a07','m8-a18'] for r in receipts):
        window=[e for e in host if e['kind']=='duplicate-window-end']
        starts=[e for e in host if e['kind']=='duplicate-window-start']
        require(len(window)==len(starts)==1 and window[0]['durationSeconds']>=5 and window[0]['at']-starts[0]['at']>=5,'duplicate-window-too-short')
        samples=[e['at'] for e in host if e['kind']=='oracle-sample' and e.get('file','').startswith('server-window-')]
        require(len(samples)>=2 and starts[0]['at']<=samples[0]<=samples[-1]<=window[0]['at'] and samples[-1]-samples[0]>=5,'duplicate-sample-span-too-short')
    recompute_assertions(root,m,receipts,f,events)
    return m,receipts


def recompute_assertions(root,m,receipts,f,events):
    """Recompute observed assertions from independent trees/pixels/server rows, not booleans."""
    passed={r['assertion'] for r in receipts if r['pass'] is True}
    def read(name):
        require(name in m['files'],'evidence-unbound:'+name)
        return json.loads(safe_file(root,name).read_text())
    measured=[e for e in events if e['processNonce']==m['launches'][-1]['processNonce']]
    host=[json.loads(line) for line in safe_file(root,'host.jsonl').read_text().splitlines()]
    if passed.intersection({'m6-a01','m8-a17'}):
        require(len(m['launches'])>=2 and m['launches'][-1]['at']>=m['steps'][1]['at'],'cold-process-missing')
        require(any(e['kind']=='ready' and e['receivedAt']>=m['launches'][-1]['at'] for e in measured),'authentication-restore')
    observed=lambda kind,predicate: any(e['kind']==kind and predicate(e['payload']) for e in measured)
    if 'm6-a01' in passed:
        conversation_valid(read('cold-history.json'),[e for e in measured if e['kind']=='screen' and e['receivedAt']<=snapshot_time(host,'cold-history.json')],f)
    if 'm6-a02' in passed:
        t=read('cold-ordinary.json');view=nodes(t,'sm-media-viewer-image')
        require(len(view)==1,'ordinary-viewer-missing')
        fixture=safe_file(root,'ordinary-fixture.png');require(sha(fixture)==f['ordinary']['sha256'],'ordinary-fixture-mismatch')
        require(pixel_match(safe_file(root,'cold-ordinary.png'),{**view[0]['frame'],'screenWidth':t['frame']['width']},fixture)[0],'ordinary-pixel-mismatch')
        require(observed('media',lambda p:p['messageId']==f['ordinary']['messageId'] and p['event']=='load'),'ordinary-load-missing')
    if 'm6-a04' in passed:
        require(not nodes(read('cold-once.json'),'sm-media-viewer-image'),'stale-viewonce-pixels')
        frame=viewonce_frame(read('prime-once.json'))
        require(read('cold-once-pixels.json')['frame']==frame,'viewonce-frame-mismatch')
        fixture=safe_file(root,'viewonce-fixture.png')
        require('viewonce-fixture.png' in m['files'] and sha(fixture)==f['viewOnce']['sha256'],'viewonce-fixture-mismatch')
        for name in ['prime-once.png','cold-once.png']:require(name in m['files'],'evidence-unbound:'+name)
        require(not viewonce_pixels(safe_file(root,'prime-once.png'),safe_file(root,'cold-once.png'),frame,fixture)[0],'stale-viewonce-pixels')
        attempts=[h for h in host if h['kind']=='viewonce-reopen']
        require(len(attempts)==1,'viewonce-attempt-missing')
        attempt=attempts[0];captured=snapshot_time(host,'cold-once.json')
        require(0<=captured-attempt['at']<=10,'viewonce-refusal-outside-bound')
        viewonce_refusal(read('cold-once.json'),[e for e in measured if attempt['at']<=e['receivedAt']<=captured],f,attempt['afterSequence'])
        no_viewonce_reload(measured,f)
    if 'm6-a03' in passed:
        taps=[e for e in host if e['kind']=='search-result-tap']; require(len(taps)==1,'search-tap-missing')
        captured=snapshot_time(host,'cold-search.json')
        scrolls=[h for h in host if h['kind']=='search-scroll']
        destination_events=[e for e in measured if taps[0]['at']<=e['receivedAt']<=captured and e['sequence']>taps[0]['afterSequence']]
        if scrolls:require(scrolls[-1]['at']<=captured,'search-capture-before-scroll')
        conversation_valid(read('cold-search.json'),destination_events,f,True)
    if 'm6-a05' in passed: pending(read('pending-2.json'),f['queuedBodies'])
    if 'm8-a17' in passed:
        ids=pending(read('warm-pending-2.json'),f['queuedBodies'])
        pending(read('restart-pending.json'),f['queuedBodies'],ids)
        require(len(m['launches'])>=2 and m['launches'][0]['processNonce']!=m['launches'][-1]['processNonce'],'outbox-process-restart-missing')
        captured=snapshot_time(host,'restart-pending.json');launched=m['launches'][-1]['at']
        absent=[h for h in host if h['kind']=='app-absent' and h.get('state')==1 and m['steps'][1]['at']<=h['at']<=launched]
        launches=[h for h in host if h['kind']=='app-launch' and launched<=h['at']<=captured]
        require(bool(absent) and bool(launches) and launched<=captured,'restart-capture-before-relaunch')
        boundaries=[h['at'] for h in host if h['kind']=='reconnect-start']+[s['at'] for s in m['steps'] if s['step']==4]
        require(not boundaries or captured<=min(boundaries),'restart-capture-after-reconnect')
        pending_screen_valid([e for e in measured if e['receivedAt']>=launched],f,ids,captured)
    if passed.intersection({'m6-a06','m6-a07','m8-a18'}):
        ids=pending(read('pending-2.json' if m['segment']=='m6' else 'warm-pending-2.json'),f['queuedBodies'])
        ids=settled_ids(events,f,ids)
        oracle_valid(read('server-flush.json'),f,ids)
        samples=read('server-window.json');require(len(samples)>=2,'duplicate-window-missing')
        for sample in samples:oracle_valid(sample,f,ids)
        # The host timestamps bound the actual polling window; rows never supply their own verdict.
        if passed.intersection({'m6-a07','m8-a18'}):
            bob=read('bob.json')
            require(bob['screen']==[{'conversationId':f['conversationId'],'principal':f['bob']}],'bob-wrong-conversation-or-principal')
            require(all(sum(r['messageId']==id and r['body']==body for r in bob['rows'])==1 for id,body in zip(ids,f['queuedBodies'])),'bob-message-count')

    if passed.intersection({'m6-a05','m6-a07','m8-a18'}):
        ids=settled_ids(events,f,pending(read('pending-2.json' if m['segment']=='m6' else 'warm-pending-2.json'),f['queuedBodies']))
        pending(read('final-read.json'),f['queuedBodies'],ids,'read')
        oracle_valid(read('server-final.json'),f,ids,'read')
        receipt_window_valid(host)
        read_screen_valid(measured,f,ids,snapshot_time(host,'final-read.json'))
