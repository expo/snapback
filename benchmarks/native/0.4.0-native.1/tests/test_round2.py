"""Round-2 reproductions: bound retained evidence, and exercise real orchestration."""
import copy, importlib.util, json, struct, subprocess, tempfile, unittest
from pathlib import Path
from unittest.mock import patch
import test_round1 as r1
from evidence import verify_directory,sha
from run import Driver,Failure
from video import decoded_video
from remote import unavailable
ROOT=r1.ROOT
spec=importlib.util.spec_from_file_location('controls',ROOT/'reference/artifact-controls.py')
controls=importlib.util.module_from_spec(spec);spec.loader.exec_module(controls)

class RetainedRegressions(unittest.TestCase):
 def test_review_mutations_rebind_and_reject(self):
  with tempfile.TemporaryDirectory() as temp:
   root=Path(temp)
   for control,reason in controls.CONTROLS.items():
    with self.subTest(control=control):
     out=root/control;out.mkdir();m,q,f=r1.packet(out);verify_directory(out,'m6',q)
     controls.mutate(out,control)
     with self.assertRaisesRegex(ValueError,reason):verify_directory(out,'m6',q)
 def test_refusal_mutation_removes_disabled_successful_snapshot(self):
  with tempfile.TemporaryDirectory() as tmp:
   root=Path(tmp);m,q,f=r1.packet(root)
   value=json.loads((root/'cold-once.json').read_text())
   for node in r1.nodes(value,'sm-convo-viewonce'):node.update(enabled=False,value='opened')
   (root/'cold-once.json').write_text(json.dumps(value));m['files']['cold-once.json']=sha(root/'cold-once.json');(root/'m6-ios-run.json').write_text(json.dumps(m))
   verify_directory(root,'m6',q);controls.mutate(root,'old-viewonce-refusal')
   with self.assertRaisesRegex(ValueError,'viewonce-refusal-missing'):verify_directory(root,'m6',q)
 def test_successful_last_search_capture(self):
  with tempfile.TemporaryDirectory() as temp:
   root=Path(temp);m,q,f=r1.packet(root);controls.mutate(root,'search-retry')
   self.assertTrue(all(r['pass'] for r in verify_directory(root,'m6',q)[1]))
 def test_read_screen_committed_before_receipt_window_is_valid(self):
  with tempfile.TemporaryDirectory() as temp:
   root=Path(temp);m,q,f=r1.packet(root)
   events=[json.loads(l) for l in (root/'native-observations.jsonl').read_text().splitlines()]
   events[-1]['receivedAt']=15.5
   (root/'native-observations.jsonl').write_text(''.join(json.dumps(e)+'\n' for e in events))
   m['files']['native-observations.jsonl']=sha(root/'native-observations.jsonl')
   (root/'m6-ios-run.json').write_text(json.dumps(m))
   self.assertTrue(all(r['pass'] for r in verify_directory(root,'m6',q)[1]))
   newer=copy.deepcopy(events[-1]);newer['sequence']+=1;newer['elapsedMs']+=1;newer['receivedAt']=16.6
   for row in newer['payload']['rows']:row['receipt']='sent'
   events.append(newer);(root/'native-observations.jsonl').write_text(''.join(json.dumps(e)+'\n' for e in events))
   m['files']['native-observations.jsonl']=sha(root/'native-observations.jsonl');(root/'m6-ios-run.json').write_text(json.dumps(m))
   with self.assertRaisesRegex(ValueError,'read-render-event'):verify_directory(root,'m6',q)
 def test_missing_decoder_is_unmeasured(self):
  with tempfile.TemporaryDirectory() as temp:
   root=Path(temp);m,q,f=r1.packet(root)
   with patch('video.decoder',side_effect=ValueError('video-decoder-unavailable')):
    with self.assertRaisesRegex(ValueError,'video-decoder-unavailable'):verify_directory(root,'m6',q)
 def test_fixture_is_decodable(self):
  self.assertGreater(decoded_video(ROOT/'tests/fixtures/valid.mp4')['durationSeconds'],0)
 def test_held_terminal_frame_is_decoded_and_covers_endpoint(self):
  info=decoded_video(ROOT/'tests/fixtures/held.mp4')
  self.assertEqual(info['decodedFrames'],1)
  self.assertEqual(info['durationSeconds'],30)
 def test_repeated_presentation_times_decode_every_encoded_sample(self):
  # Two of the ten encoded frames share a PTS; presentation-order readers
  # coalesce them, but the independently decoded sample count must stay ten.
  info=decoded_video(ROOT/'tests/fixtures/repeated-pts.mp4')
  self.assertEqual(info['decodedFrames'],10)
  self.assertEqual(info['durationSeconds'],1)
 def test_darwin_ssh_timeout(self):
  self.assertTrue(unavailable(subprocess.CompletedProcess([],255,'','ssh: connect to host mini port 22: Operation timed out\n')))

class DriverRegressions(unittest.TestCase):
 def driver(self):
  tmp=tempfile.TemporaryDirectory();self.addCleanup(tmp.cleanup)
  root=Path(tmp.name);m,q,f=r1.packet(root)
  d=Driver({'oracleArgv':['oracle'],'backendCwd':str(root),'webOrigin':f['origin']},'m6',root/'driver')
  d.f=f;d.ids=['q1','q2'];d.events=[json.loads(l) for l in (root/'native-observations.jsonl').read_text().splitlines()]
  d.launches=m['launches'];d.collect=lambda:None;d.once_after_sequence=3;d.cut=True
  return d,root
 def test_reconnect_executes_flush_duplicate_window_bob_and_all_receipts(self):
  for m6 in [True,False]:
   with self.subTest(m6=m6):
    d,root=self.driver();clock=[100.];restarted=[];commands=[]
    d.start_backend=lambda:restarted.append(True);d.video_started=100;d.begin('m6-a06' if m6 else 'm8-a18')
    def tree(name,pixels):
     screen=copy.deepcopy(d.events[-1]);screen['receivedAt']=clock[0];d.events.append(screen)
     d.host('native-snapshot',file=name+'.json')
     return json.loads((root/'final-read.json').read_text())
    d.tree=tree
    def command(argv,**kw):
     commands.append(argv[0]);return (root/('bob.json' if argv[0]=='node' else 'server-final.json')).read_bytes()
    with patch('run.command',side_effect=command),patch('run.time.time',side_effect=lambda:clock[0]),patch('run.time.monotonic',side_effect=lambda:clock[0]),patch('run.time.sleep',side_effect=lambda t:clock.__setitem__(0,clock[0]+t)):
     d.reconnect(m6)
    self.assertEqual(restarted,[True]);self.assertFalse(d.cut);self.assertIn('node',commands)
    self.assertEqual([r['assertion'] for r in d.receipts],['m6-a06','m6-a05','m6-a07'] if m6 else ['m8-a18'])
    self.assertTrue(all(r['pass'] for r in d.receipts))
    host=[json.loads(l) for l in d.host_file.read_text().splitlines()]
    samples=[e['at'] for e in host if e['kind']=='oracle-sample' and e['file'].startswith('server-window-')]
    self.assertGreaterEqual(samples[-1]-samples[0],5)
    self.assertTrue((d.out/'server-final.json').exists())
 def test_reconnect_detects_load_buffered_during_backend_start(self):
  d,root=self.driver();d.begin('m6-a06')
  def start():
   event=copy.deepcopy(d.events[2]);event['sequence']=12;event['receivedAt']=__import__('time').time();event['payload'].update(messageId='v',assetId='va',provenance='cache');d.events.append(event)
  d.start_backend=start
  with self.assertRaisesRegex(ValueError,'viewonce-reloaded-in-cold-process'):d.reconnect(True)
  self.assertEqual(d.active,'m6-a04')
 def test_wait_cannot_swallow_confidentiality_failure(self):
  d,root=self.driver();calls=[]
  def check():
   calls.append(1);d.once_failure='viewonce-reloaded-in-cold-process';raise Failure(d.once_failure)
  with self.assertRaisesRegex(Failure,'viewonce-reloaded-in-cold-process'):d.wait(check)
  self.assertEqual(calls,[1])
 def test_newest_first_search_scrolls_then_publishes_only_successful_capture(self):
  d,root=self.driver();d.collect=lambda:None;d.type=lambda *a:None;d.video_started=0;d.begin('m6-a03')
  d.events=d.events[:4];d.f['search']['token']='needle'
  sequence=[0];scrolled=[];invalid=[]
  def emit(kind,payload):d.events.append({'kind':kind,'payload':payload,'processNonce':d.launches[-1]['processNonce'],'sequence':d.events[-1]['sequence']+1,'receivedAt':__import__('time').time()})
  screen={'route':'conversation','conversationId':'c','rows':[{'messageId':'h','bodyHash':r1.body_hash('needle'),'receipt':None}]}
  tree=json.loads((root/'cold-search.json').read_text())
  def ui(op,**kw):
   if op=='tap':
    if kw['selector']['id']=='sm-search-result':emit('search',{'token':'needle','resultIds':['h'],'openedConversationId':'c'})
    return {}
   if op=='scroll':scrolled.append(True);emit('screen',screen);return {}
   if op=='tree':
    sequence[0]+=1
    if sequence[0]==1:
     invalid.append(not (d.out/'cold-search.json').exists());return {'tree':{}}
    result=copy.deepcopy(tree)
    if not scrolled:
     for n in r1.nodes(result['children'][0]):n['hittable']=False
    return {'tree':result,'png':''}
   raise AssertionError(op)
  d.ui=ui;d.search_destination()
  self.assertEqual(invalid,[True]);self.assertTrue(scrolled)
  self.assertTrue((d.out/'cold-search.json').exists())
  host=[json.loads(l) for l in d.host_file.read_text().splitlines()]
  self.assertEqual(len([h for h in host if h.get('file')=='cold-search.json']),1)
  self.assertTrue(any(h['kind']=='search-scroll' for h in host))
  self.assertTrue(d.receipts[-1]['pass'])

if __name__=='__main__':unittest.main()
