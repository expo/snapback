#!/usr/bin/env python3
"""Mutate retained mini evidence and rebind hashes to test the exported validator."""
import argparse,json,shutil,sys,time,struct
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'driver'))
from evidence import sha,verify_directory
PIXEL_SCALES={'scaled-098-viewonce-pixels':.98,'scaled-090-viewonce-pixels':.9,'scaled-050-viewonce-pixels':.5,
 'scaled-025-viewonce-pixels':.25,'scaled-125-viewonce-pixels':1.25,'scaled-0733-viewonce-pixels':.733}
PIXEL_CONTROLS={**{name:'stale-viewonce-pixels' for name in PIXEL_SCALES},
 'matted-viewonce-pixels':'stale-viewonce-pixels','framed-viewonce-pixels':'stale-viewonce-pixels',
 'clipped-bright-viewonce-pixels':'stale-viewonce-pixels'}
CONTROLS={
 **PIXEL_CONTROLS,
 'pre-reopen-viewonce-load':'viewonce-reloaded-in-cold-process',
 'online-viewonce-load':'viewonce-reloaded-in-cold-process',
 'elsewhere-viewonce-pixels':'stale-viewonce-pixels',
 'bright-viewonce-pixels':'stale-viewonce-pixels',
 'contrast-viewonce-pixels':'stale-viewonce-pixels',
 'invented-video-sample':'video-sample-count-mismatch',
 'extended-video-endpoint':'video-endpoint-uncovered',
 'undecodable-video':'invalid-video',
 'retargeted-viewonce':'viewonce-frame-mismatch',
 'stale-viewonce-pixels':'stale-viewonce-pixels',
 'wrong-prime-pixels':'prime-viewonce-pixel-mismatch',
 'buffered-viewonce-load':'viewonce-reloaded-in-cold-process',
 'async-viewonce-load':'viewonce-reloaded-in-cold-process',
 'old-viewonce-refusal':'viewonce-refusal-missing',
 'sent-native-a05':'receipt-accessibility:read',
 'sent-screen-receipts':'read-render-event',
 'late-native-snapshot':'receipt-native-outside-window',
 'short-duplicate-window':'duplicate-window-too-short',
 'short-duplicate-samples':'duplicate-sample-span-too-short',
 'stale-nonce':'stale-or-unsupported-observation',
 'replayed-events':'observation-sequence-gap-or-replay',
 'missing-video':'evidence-missing:',
 'hash-mismatched-video':'evidence-hash-mismatch:',
 'truncated-video-rebound':'truncated-video-box',
 'wrong-receipts':'server-receipt-state:read',
 'one-wrong-receipt':'server-receipt-state:read',
 'empty-search':'native-conversation-identity',
 'signin-search':'native-conversation-identity',
 'wrong-search-body':'conversation-history-body',
 'search-claim-only':'conversation-screen-missing',
 'wrong-conversation':'screen-conversation',
 'instrument-commit':'instrument-identity-mismatch',
 'instrument-inventory':'instrument-identity-mismatch',
 'driver-source':'driver-source-mismatch',
 'driver-binary':'driver-binary-mismatch',
 'late-read':'receipt-deadline-exceeded',
}

def mutate(root,control,segment='m6'):
 m=json.loads((root/f'{segment}-ios-run.json').read_text())
 def write(name,value,lines=False):
  (root/name).write_text(''.join(json.dumps(v)+'\n' for v in value) if lines else json.dumps(value)+'\n');m['files'][name]=sha(root/name)
 def read(name,lines=False):return [json.loads(l) for l in (root/name).read_text().splitlines()] if lines else json.loads((root/name).read_text())
 if control=='invented-video-sample':
  file=root/f'{segment}-ios-screen.mp4';data=bytearray(file.read_bytes())
  def walk(begin,end):
   while begin<end:
    size,kind=struct.unpack_from('>I4s',data,begin);header=8
    if size==1:size=struct.unpack_from('>Q',data,begin+8)[0];header=16
    elif size==0:size=end-begin
    at=begin+header
    if kind==b'stts':
     count=struct.unpack_from('>I',data,at+4)[0];offset=at+8+(count-1)*8;n=struct.unpack_from('>I',data,offset)[0];struct.pack_into('>I',data,offset,n+1)
    if kind in [b'moov',b'trak',b'mdia',b'minf',b'stbl']:walk(at,begin+size)
    begin+=size
  walk(0,len(data));file.write_bytes(data);m['files'][file.name]=sha(file)
 elif control=='extended-video-endpoint':
  file=root/f'{segment}-ios-screen.mp4';data=bytearray(file.read_bytes());movie_scale=[None]
  def walk(begin,end):
   while begin<end:
    size,kind=struct.unpack_from('>I4s',data,begin);header=8
    if size==1:size=struct.unpack_from('>Q',data,begin+8)[0];header=16
    elif size==0:size=end-begin
    at=begin+header
    if kind in [b'mvhd',b'mdhd']:
     version=data[at];offset=at+(20 if version else 12);scale=struct.unpack_from('>I',data,offset)[0];fmt='>Q' if version else '>I';ticks=struct.unpack_from(fmt,data,offset+4)[0]
     struct.pack_into(fmt,data,offset+4,ticks+30*scale)
     if kind==b'mvhd':movie_scale[0]=scale
    elif kind==b'tkhd':
     version=data[at];offset=at+(28 if version else 20);fmt='>Q' if version else '>I';ticks=struct.unpack_from(fmt,data,offset)[0];struct.pack_into(fmt,data,offset,ticks+30*movie_scale[0])
    elif kind==b'elst':
     version=data[at];count=struct.unpack_from('>I',data,at+4)[0];offset=at+8+(count-1)*(20 if version else 12);fmt='>Q' if version else '>I';ticks=struct.unpack_from(fmt,data,offset)[0];struct.pack_into(fmt,data,offset,ticks+30*movie_scale[0])
    if kind in [b'moov',b'trak',b'mdia',b'edts']:walk(at,begin+size)
    begin+=size
  walk(0,len(data));file.write_bytes(data);m['files'][file.name]=sha(file);m['video']['durationSeconds']+=30
 elif control=='undecodable-video':
  file=root/f'{segment}-ios-screen.mp4';file.write_bytes(b''.join(struct.pack('>I4s',8,k) for k in [b'ftyp',b'mdat',b'moov']));m['files'][file.name]=sha(file)
 elif control in PIXEL_CONTROLS or control in ['retargeted-viewonce','stale-viewonce-pixels','wrong-prime-pixels','elsewhere-viewonce-pixels','bright-viewonce-pixels','contrast-viewonce-pixels']:
  from PIL import Image
  if control=='wrong-prime-pixels':
   file=root/'prime-once.png';
   with Image.open(file) as image:size=image.size
   Image.new('RGB',size,'black').save(file);m['files'][file.name]=sha(file)
  else:
   from evidence import viewonce_frame
   frame=viewonce_frame(read('prime-once.json'));prime=Image.open(root/'prime-once.png');cold=Image.open(root/'cold-once.png');scale=prime.width/frame['screenWidth']
   x,y,w,h=[frame[k]*scale for k in ['x','y','width','height']];rect=(round(x),round(y),round(x+w),round(y+h));crop=prime.crop(rect)
   if control=='elsewhere-viewonce-pixels':
    require_space=cold.height>=2*crop.height
    if not require_space:raise ValueError('control-needs-tall-screenshot')
    rect=(0,cold.height-crop.height)
   if control=='bright-viewonce-pixels':crop=crop.point(lambda v:min(255,v+30))
   if control=='contrast-viewonce-pixels':crop=crop.point(lambda v:round(v*.6+45))
   if control=='clipped-bright-viewonce-pixels':crop=crop.point(lambda v:min(255,v+120))
   if control in PIXEL_SCALES:
    crop=crop.resize(tuple(round(v*PIXEL_SCALES[control]) for v in crop.size))
    rect=(0,cold.height-crop.height)
   if control in ['matted-viewonce-pixels','framed-viewonce-pixels']:
    from PIL import ImageOps
    size=crop.size if control=='matted-viewonce-pixels' else (round(crop.width*.8),round(crop.height*1.2))
    mat=Image.new('RGB',size,'white')
    # An 8px inset in the same slot, or aspect-fit within a different frame.
    inner=crop.resize((size[0]-16,size[1]-16)) if control=='matted-viewonce-pixels' else ImageOps.contain(crop,(size[0]-16,size[1]-16))
    mat.paste(inner,((size[0]-inner.width)//2,(size[1]-inner.height)//2));crop=mat
    rect=rect[:2] if control=='matted-viewonce-pixels' else (0,cold.height-crop.height)
   cold.paste(crop,rect);cold.save(root/'cold-once.png');m['files']['cold-once.png']=sha(root/'cold-once.png')
   if control=='retargeted-viewonce':
    value=read('cold-once-pixels.json');value['frame']={**frame,'x':0,'y':0,'width':1,'height':1};write('cold-once-pixels.json',value)
 elif control in ['async-viewonce-load','buffered-viewonce-load','pre-reopen-viewonce-load','online-viewonce-load']:
  events=read('native-observations.jsonl',True);host=read('host.jsonl',True);f=read('native-fixture.json');nonce=m['observationProcesses'][-1]['processNonce']
  cut=next(h for h in host if h['kind']=='reconnect-start');at=next(h['at'] for h in host if h.get('file')=='cold-once.json')
  measured=[e for e in events if e['processNonce']==nonce];target=next(e for e in measured if (e['sequence']>cut['afterSequence'] if control=='buffered-viewonce-load' else at<e['receivedAt'] and e['sequence']<=cut['afterSequence']))
  if control=='pre-reopen-viewonce-load':target=next(e for e in measured if e['kind']=='screen')
  if control=='online-viewonce-load':target=measured[-1]
  event={**target,'kind':'media','payload':{'messageId':f['viewOnce']['messageId'],'assetId':f['viewOnce']['assetId'],'event':'load','width':192,'height':128,'provenance':'cache'}}
  if control=='buffered-viewonce-load':event['receivedAt']=cut['at']-.001
  # Insert an asynchronous decoded cache load after the snapshot, preserving other witnesses.
  for e in measured:
   if e['sequence']>=event['sequence']:e['sequence']+=1
  events.insert(events.index(target),event)
  for h in host:
   if 'afterSequence' in h and h['afterSequence']>=event['sequence']:h['afterSequence']+=1
  for refs in m['assertionEvidence'].values():
   for ref in refs['eventSequences']:
    if ref[0]==nonce and ref[1]>=event['sequence']:ref[1]+=1
  write('native-observations.jsonl',events,True);write('host.jsonl',host,True)
 elif control in ['stale-restart-capture','missing-restart-screen']:
  host=read('host.jsonl',True);events=read('native-observations.jsonl',True)
  if control=='stale-restart-capture':
   write('restart-pending.json',read('warm-pending-2.json'))
   (root/'restart-pending.png').write_bytes((root/'warm-pending-2.png').read_bytes());m['files']['restart-pending.png']=sha(root/'restart-pending.png')
   warm=next(h['at'] for h in reversed(host) if h.get('file')=='warm-pending-2.json')
   for h in host:
    if h.get('file')=='restart-pending.json':h['at']=warm
   write('host.jsonl',host,True)
  for e in events:
   if e['processNonce']==m['observationProcesses'][-1]['processNonce'] and e['kind']=='screen':e['payload']['rows']=[r for r in e['payload']['rows'] if r['receipt']!='pending']
  write('native-observations.jsonl',events,True)
 elif control=='old-viewonce-refusal':
  from evidence import nodes
  for name in ['cold-once-attempt.json','cold-once.json']:
   value=read(name)
   for n in nodes(value,'sm-convo-viewonce'):n['enabled']=True;n['value']='unopened'
   write(name,value)
  events=read('native-observations.jsonl',True);f=read('native-fixture.json');host=read('host.jsonl',True);attempt=next(h for h in host if h['kind']=='viewonce-reopen')
  for e in events:
   if e['kind']=='media' and e['payload']['messageId']==f['viewOnce']['messageId'] and e['payload']['event'] in ['denied','consumed'] and e['receivedAt']>=attempt['at']:e['payload']['event']='error'
  write('native-observations.jsonl',events,True)
 elif control=='sent-native-a05':
  from evidence import nodes
  value=read('final-read.json')
  for n in nodes(value,'sm-convo-receipt'):n['value']='sent'
  write('final-read.json',value)
  receipts=read('m6-ios-receipts.jsonl',True)
  for r in receipts:
   if r['assertion']=='m6-a07':
    r.update({'pass':False,'status':'failed','outcomeClass':'application'});r['details']['reason']='receipt-accessibility:read'
    for timing in r['timings']:timing['pass']=False
  m['failure']={'reason':'receipt-accessibility:read','outcomeClass':'application'};write('m6-ios-receipts.jsonl',receipts,True)
 elif control=='sent-screen-receipts':
  events=read('native-observations.jsonl',True)
  for e in events:
   if e['kind']=='screen':
    for row in e['payload']['rows']:
     if row['receipt']=='read':row['receipt']='sent'
  write('native-observations.jsonl',events,True)
 elif control in ['late-native-snapshot','short-duplicate-window','short-duplicate-samples','missing-post-scroll-screen','search-retry']:
  value=read('host.jsonl',True)
  if control=='late-native-snapshot':
   end=next(h['at'] for h in value if h['kind']=='receipt-window-end')
   for h in value:
    if h.get('file')=='final-read.json':h['at']=end+120
  elif control=='short-duplicate-window':
   start=next(h['at'] for h in value if h['kind']=='duplicate-window-start')
   for h in value:
    if h['kind']=='duplicate-window-end':h['at']=start+.1
  elif control=='short-duplicate-samples':
   start=next(h['at'] for h in value if h['kind']=='duplicate-window-start')
   samples=[h for h in value if h['kind']=='oracle-sample' and h['file'].startswith('server-window-')]
   for i,h in enumerate(samples):h['at']=start+.1*i/len(samples)
  elif control=='missing-post-scroll-screen':
   snapshot=next(h for h in reversed(value) if h.get('file')=='cold-search.json');events=read('native-observations.jsonl',True)
   value.append({'kind':'search-scroll','at':snapshot['at'],'afterSequence':max(e['sequence'] for e in events if e['processNonce']==m['observationProcesses'][-1]['processNonce'] and e['receivedAt']<=snapshot['at'])})
  else:
   tap=next(h['at'] for h in value if h['kind']=='search-result-tap');value.insert(0,{'kind':'native-snapshot','file':'cold-search.json','at':tap+.01})
  write('host.jsonl',value,True)
 elif control in ['stale-nonce','replayed-events','wrong-conversation','search-claim-only']:
  events=read('native-observations.jsonl',True)
  if control=='replayed-events':events.append(events[-1])
  elif control=='stale-nonce':events[-1]['runId']='00000000-0000-4000-8000-000000000000'
  elif control=='wrong-conversation':
   for e in events:
    if e['kind']=='screen' and e['payload']['route']=='conversation':e['payload']['conversationId']='wrong-conversation'
  else:
   host=read('host.jsonl',True);tap=next(h['at'] for h in host if h['kind']=='search-result-tap');end=next(h['at'] for h in host if h.get('file')=='cold-search.json')
   claim=next(e['payload'] for e in events if e['kind']=='search' and e['payload']['openedConversationId'])
   for e in events:
    if e['kind']=='screen' and tap<=e['receivedAt']<=end:e['kind']='search';e['payload']=claim
  write('native-observations.jsonl',events,True)
 elif control in ['wrong-receipts','one-wrong-receipt']:
  value=read('server-final.json');f=read('native-fixture.json')
  for row in value['rows']:
   if row['body'] in f['queuedBodies'][:1 if control=='one-wrong-receipt' else 2]:row['receiptState']='sent'
  write('server-final.json',value)
 elif control in ['empty-search','signin-search','wrong-search-body']:
  value={} if control=='empty-search' else {'id':'sm-auth-email'}
  if control=='wrong-search-body':
   value=read('cold-search.json');f=read('native-fixture.json')
   def change(t):
    if t.get('label')==f['history']['body']:t['label']='unrelated history'
    for child in t.get('children',[]):change(child)
   change(value)
  write('cold-search.json',value)
 elif control.startswith('instrument-'):m['instrument']['commit' if control=='instrument-commit' else 'inventorySha256']='0'*(40 if control=='instrument-commit' else 64)
 elif control.startswith('driver-'):m['driverSourceSha256' if control=='driver-source' else 'driverBinarySha256']='0'*64
 elif control=='late-read':
  value=read('host.jsonl',True);start=next(h['at'] for h in value if h['kind']=='receipt-window-start')
  for h in value:
   if h['kind']=='receipt-window-end':h['at']=start+61;h['durationSeconds']=61
  write('host.jsonl',value,True)
 elif control=='missing-video':(root/f'{segment}-ios-screen.mp4').unlink()
 elif control=='hash-mismatched-video':
  with (root/f'{segment}-ios-screen.mp4').open('ab') as f:f.write(b'broken')
 else:
  file=root/f'{segment}-ios-screen.mp4';file.write_bytes(file.read_bytes()[:64]);m['files'][file.name]=sha(file)
 (root/f'{segment}-ios-run.json').write_text(json.dumps(m,indent=2)+'\n')

def main():
 p=argparse.ArgumentParser();p.add_argument('good');p.add_argument('out');p.add_argument('--segment',default='m6',choices=['m6','m8']);a=p.parse_args()
 good=Path(a.good);out=Path(a.out);out.mkdir(exist_ok=False);verify_directory(good,a.segment)
 results=[]
 controls=CONTROLS if a.segment=='m6' else {**{c:CONTROLS[c] for c in ['wrong-receipts','one-wrong-receipt','late-read']},'stale-restart-capture':'restart-capture-before-relaunch','missing-restart-screen':'restart-pending-screen-missing'}
 for control,expected in controls.items():
  started=time.monotonic();root=out/control;shutil.copytree(good,root);mutate(root,control,a.segment)
  try:verify_directory(root,a.segment);result={'control':control,'rejected':False,'reason':'unexpectedly-accepted'}
  except Exception as e:result={'control':control,'rejected':True,'nativePass':None,'reason':str(e)}
  result.update(expectedReason=expected,matched=result['reason'].startswith(expected),wallSeconds=round(time.monotonic()-started,3),operatorSteps=1)
  results.append(result);print(json.dumps(result),flush=True)
  (root/'SOURCE.json').write_text(json.dumps({'goodDirectory':str(good),'control':control,'result':result},indent=2)+'\n')
 if a.segment=='m6':
  for control in ['search-retry','missing-post-scroll-screen']:
   root=out/control;shutil.copytree(good,root);mutate(root,control);verify_directory(root,'m6')
   results.append({'control':control,'rejected':False,'matched':True,'reason':'successful-last-capture','expectedReason':'successful-last-capture'})
 (out/'results.json').write_text(json.dumps(results,indent=2)+'\n')
 return 0 if all(r['matched'] for r in results) else 1
if __name__=='__main__':sys.exit(main())
