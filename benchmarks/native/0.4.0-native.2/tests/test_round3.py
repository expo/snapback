"""Round-3 review reproductions, including exported M8 block deletion coverage."""
import copy, json, tempfile, unittest
from pathlib import Path
from unittest.mock import patch
import test_round1 as r1
import test_round2 as r2
from evidence import ASSERTIONS, body_hash, sha, verify_directory
from run import Driver, Failure


def packet_m8(root):
 m,q,f=r1.packet(root)
 def write(name,value,lines=False):
  (root/name).write_text(''.join(json.dumps(v)+'\n' for v in value) if lines else json.dumps(value))
  m['files'][name]=sha(root/name)
 for name in ['warm-pending-2.json','restart-pending.json']:write(name,json.loads((root/'pending-2.json').read_text()))
 for name in ['warm-pending-2.png','restart-pending.png']:
  (root/name).write_bytes((root/'cold-once.png').read_bytes());m['files'][name]=sha(root/name)
 events=[json.loads(l) for l in (root/'native-observations.jsonl').read_text().splitlines()]
 events[5]['payload']={'route':'conversation','conversationId':f['conversationId'],'rows':[{'messageId':id,'bodyHash':body_hash(body),'receipt':'pending'} for id,body in zip(['q1','q2'],f['queuedBodies'])]}
 write('native-observations.jsonl',events,True)
 host=[json.loads(l) for l in (root/'host.jsonl').read_text().splitlines()]
 for h in host:
  if h.get('kind') in ('app-launch-attempt','app-launch-result') and h.get('attempt')==2:h['phase']='restart'
  if h.get('kind')=='observation-flush-ack' and h.get('flush')==1:h['reason']='pending-process-restart'
 host += [{'kind':'native-snapshot','file':'warm-pending-2.json','at':1.5},{'kind':'native-snapshot','file':'restart-pending.json','at':8}]
 write('host.jsonl',host,True)
 m['segment']='m8';m['launchAttempts'][1]['phase']='restart';m['steps']=[{'step':i,'at':at} for i,at in enumerate([1,1.8,3,9,19],1)]
 d=Driver({},'m8',root/'m8-unused');d.run_id=f['runId']
 for id in ASSERTIONS['m8']:d.receipt(id,True,None)
 write('m8-ios-receipts.jsonl',d.receipts,True)
 (root/'m8-ios-screen.mp4').write_bytes((root/'m6-ios-screen.mp4').read_bytes());m['files']['m8-ios-screen.mp4']=sha(root/'m8-ios-screen.mp4')
 m['assertionEvidence']={id:copy.deepcopy(m['assertionEvidence']['m6-a01']) for id in ASSERTIONS['m8']}
 (root/'m8-ios-run.json').write_text(json.dumps(m))
 return m,q,f


class ExportedM8(unittest.TestCase):
 def test_m8_a17_verification_rejects_replaced_restart_tree(self):
  # Removing the entire `if m8-a17 in passed` block makes this test fail.
  with tempfile.TemporaryDirectory() as tmp:
   root=Path(tmp);m,q,f=packet_m8(root);verify_directory(root,'m8',q)
   tree=json.loads((root/'restart-pending.json').read_text());tree['children'][0]['children'][1]['value']='sent'
   (root/'restart-pending.json').write_text(json.dumps(tree));m['files']['restart-pending.json']=sha(root/'restart-pending.json');(root/'m8-ios-run.json').write_text(json.dumps(m))
   with self.assertRaisesRegex(ValueError,'receipt-accessibility:pending'):verify_directory(root,'m8',q)
 def test_replayed_warm_capture_and_missing_cold_screen_reject(self):
  for control,reason in [('stale-restart-capture','restart-capture-before-relaunch'),('missing-restart-screen','restart-pending-screen-missing')]:
   with self.subTest(control=control),tempfile.TemporaryDirectory() as tmp:
    root=Path(tmp);m,q,f=packet_m8(root);verify_directory(root,'m8',q);r2.controls.mutate(root,control,'m8')
    with self.assertRaisesRegex(ValueError,reason):verify_directory(root,'m8',q)
 def test_restart_capture_after_reconnect_rejects(self):
  with tempfile.TemporaryDirectory() as tmp:
   root=Path(tmp);m,q,f=packet_m8(root)
   host=[json.loads(l) for l in (root/'host.jsonl').read_text().splitlines()]
   host[-1]['at']=10
   (root/'host.jsonl').write_text(''.join(json.dumps(h)+'\n' for h in host));m['files']['host.jsonl']=sha(root/'host.jsonl');(root/'m8-ios-run.json').write_text(json.dumps(m))
   with self.assertRaisesRegex(ValueError,'restart-capture-after-reconnect'):verify_directory(root,'m8',q)


class DriverRound3(unittest.TestCase):
 driver=r2.DriverRegressions.driver
 def test_scroll_without_new_screen_event(self):
  d,root=self.driver();d.type=lambda *a:None;d.video_started=0;d.begin('m6-a03');d.events=d.events[:4]
  scrolled=[];tree=json.loads((root/'cold-search.json').read_text())
  def ui(op,**kw):
   if op=='tap' and kw['selector']['id']=='sm-search-result':
    for kind,payload in [('search',{'token':'needle','resultIds':['h'],'openedConversationId':'c'}),('screen',{'route':'conversation','conversationId':'c','rows':[{'messageId':'h','bodyHash':body_hash('needle'),'receipt':None}]})]:
     d.events.append({'kind':kind,'payload':payload,'sequence':d.events[-1]['sequence']+1,'processNonce':d.launches[-1]['processNonce'],'receivedAt':__import__('time').time()})
   if op=='scroll':scrolled.append(True)
   if op=='tree':
    result=copy.deepcopy(tree)
    if not scrolled:
     for n in r1.nodes(result['children'][0]):n['hittable']=False
    return {'tree':result,'png':''}
   return {}
  d.ui=ui;d.search_destination()
  self.assertTrue(scrolled);self.assertTrue(d.receipts[-1]['pass'])
 def test_delayed_refusal_within_bound(self):
  d,root=self.driver();clock=[100.];d.prime={'eventCount':0};d.video_started=100;d.events=d.events[:3]
  d.c['viewOnceImage']=str(root/'viewonce-fixture.png')
  for name in ['prime-once.json','prime-once.png']:(d.out/name).write_bytes((root/name).read_bytes())
  for name in ['terminate','cut_backend','start_recording','launch','navigate','locate','media','step']:
   setattr(d,name,lambda *a,**kw:None)
  d.ui=lambda *a,**kw:{'state':1};d.tap=lambda *a,**kw:None
  def tree(name=None,pixels=False):
   if name=='cold-history':return json.loads((root/'cold-history.json').read_text())
   (d.out/'cold-once.png').write_bytes((root/'cold-once.png').read_bytes())
   return json.loads((root/'cold-once-attempt.json').read_text())
  d.tree=tree
  def collect():
   if clock[0]>=101.5 and len(d.events)==3:d.events.append({'kind':'media','sequence':4,'processNonce':d.launches[-1]['processNonce'],'payload':{'messageId':'v','assetId':'va','event':'denied'}})
  d.collect=collect
  # The real tree normally collects. Keep that asynchronous arrival in this probe.
  original_tree=d.tree
  d.tree=lambda *a,**kw:(collect(),original_tree(*a,**kw))[1]
  def stop():raise StopIteration
  d.search_destination=stop
  with patch('run.time.time',side_effect=lambda:clock[0]),patch('run.time.monotonic',side_effect=lambda:clock[0]),patch('run.time.sleep',side_effect=lambda t:clock.__setitem__(0,clock[0]+t)):
   with self.assertRaises(StopIteration):d.m6()
  self.assertGreaterEqual(clock[0],101.5)
  self.assertTrue(next(r for r in d.receipts if r['assertion']=='m6-a04')['pass'])
 def test_collect_guards_before_reopen_and_after_reconnection(self):
  for offline in [True,False]:
   with self.subTest(offline=offline):
    d,root=self.driver();del d.collect;d.data=root/'app';d.run_id=d.f['runId'];d.build=json.loads((root/'m6-ios-run.json').read_text())['build']
    d.once_guard=True;d.once_after_sequence=100;d.cut=offline;d.event_count=0
    events=copy.deepcopy(d.events);events[1].update(kind='media',payload={'messageId':'v','assetId':'va','event':'load','width':192,'height':128,'provenance':'cache'})
    d.events=[];d.next_launch=None
    journal=d.data/'Documents/clique-native'/d.run_id/'native-observations.jsonl';journal.parent.mkdir(parents=True);journal.write_text(''.join(json.dumps(e)+'\n' for e in events))
    with self.assertRaisesRegex(Failure,'viewonce-reloaded'):d.collect()
    self.assertEqual(d.active,'m6-a04')
 def test_run_drains_load_written_during_process_termination(self):
  d,root=self.driver();del d.collect;d.data=root/'app';d.run_id=d.f['runId'];d.build=json.loads((root/'m6-ios-run.json').read_text())['build']
  d.once_guard=True;d.once_after_sequence=100;d.cut=False;d.event_count=len(d.events);d.next_launch=None
  journal=d.data/'Documents/clique-native'/d.run_id/'native-observations.jsonl';journal.parent.mkdir(parents=True);journal.write_text(''.join(json.dumps(e)+'\n' for e in d.events))
  d.preflight=lambda:None;d.m6=lambda:None;d.video=object();d.bridge=object();d.c.update(udid='dedicated',bundleId='fixture');d.stop_owned=lambda *a:None;d.finalize=lambda:d.fail
  d.app_state=lambda:{'state':'foreground','stateRaw':4,'running':True,'source':'test'}
  # This legacy probe isolates the final post-termination collect. Round 6
  # separately exercises the real native-writer barrier and missing-ack null.
  d.flush_observations=lambda reason,collect_after=True:None
  d.begin('m6-a04');d.receipt('m6-a04',True,None);d.active=None
  def terminate(*args):
   event=copy.deepcopy(d.events[-1]);event.update(sequence=event['sequence']+1,elapsedMs=event['elapsedMs']+1,kind='media',payload={'messageId':'v','assetId':'va','event':'load','width':192,'height':128,'provenance':'cache'})
   with journal.open('a') as file:file.write(json.dumps(event)+'\n')
  d.sim=terminate
  with patch('run.time.sleep',return_value=None):result=d.run()
  self.assertEqual(result,{'reason':'viewonce-reloaded-in-cold-process','outcomeClass':'application'})
  self.assertEqual([r['pass'] for r in d.receipts if r['assertion']=='m6-a04'],[False])
 def test_export_accepts_scroll_without_new_screen(self):
  with tempfile.TemporaryDirectory() as tmp:
   root=Path(tmp);m,q,f=r1.packet(root);r2.controls.mutate(root,'missing-post-scroll-screen')
   verify_directory(root,'m6',q)

if __name__=='__main__':unittest.main()
