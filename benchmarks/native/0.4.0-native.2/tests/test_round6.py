"""Round-2 blind-review regressions for writer drain, row parity, and inversion."""
import copy,importlib.util,json,subprocess,sys,tempfile,unittest,uuid
from pathlib import Path
from unittest.mock import Mock,patch

import test_round1 as r1
import test_round2 as r2
from evidence import ASSERTIONS,body_hash,pending,pending_screen_valid,rendered_rows_valid,writer_flush_valid
from run import Driver,Failure,flush_observation_writer

ROOT=Path(__file__).resolve().parents[1]


class WriterFlush(unittest.TestCase):
 def directory(self):
  temporary=tempfile.TemporaryDirectory();self.addCleanup(temporary.cleanup)
  root=Path(temporary.name);run_id='142ed513-dacc-4219-bf29-3098db534c1c';process='00000000-0000-4000-8000-000000000001'
  raw=json.dumps({'processNonce':process},separators=(',',':')).encode()+b'\n'
  (root/'native-observations.jsonl').write_bytes(raw)
  return root,run_id,process,raw

 def test_matching_process_bound_ack_drains_persisted_prefix(self):
  root,run_id,process,raw=self.directory()
  def acknowledge(_):
   request=json.loads((root/'flush-request.json').read_text())
   (root/'flush-ack.json').write_text(json.dumps({**request,'processNonce':process,'eventCount':1,'byteCount':len(raw)}))
  with patch('run.time.sleep',side_effect=acknowledge):request,ack=flush_observation_writer(root,run_id,process,.2)
  self.assertEqual(ack['nonce'],request['nonce']);self.assertEqual(ack['processNonce'],process)

 def test_foreign_process_ack_is_rejected(self):
  root,run_id,process,raw=self.directory()
  def acknowledge(_):
   request=json.loads((root/'flush-request.json').read_text())
   (root/'flush-ack.json').write_text(json.dumps({**request,'processNonce':'foreign','eventCount':1,'byteCount':len(raw)}))
  with patch('run.time.sleep',side_effect=acknowledge),self.assertRaisesRegex(ValueError,'native-writer-flush-process-mismatch'):
   flush_observation_writer(root,run_id,process,.2)

 def test_stale_ack_race_waits_for_current_challenge(self):
  root,run_id,process,raw=self.directory();calls=[]
  def acknowledge(_):
   request=json.loads((root/'flush-request.json').read_text());calls.append(1)
   nonce='00000000-0000-4000-8000-000000000099' if len(calls)==1 else request['nonce']
   (root/'flush-ack.json').write_text(json.dumps({**request,'nonce':nonce,'processNonce':process,'eventCount':1,'byteCount':len(raw)}))
  with patch('run.time.sleep',side_effect=acknowledge):_,ack=flush_observation_writer(root,run_id,process,.2)
  self.assertEqual(len(calls),2);self.assertNotEqual(ack['nonce'],'00000000-0000-4000-8000-000000000099')

 def test_stalled_writer_makes_provisional_m6_a04_unmeasured_without_termination(self):
  temporary=tempfile.TemporaryDirectory();self.addCleanup(temporary.cleanup);fixture=Path(temporary.name)
  m,_,f=r1.packet(fixture)
  d=Driver({'oracleArgv':['oracle'],'backendCwd':str(fixture),'webOrigin':f['origin']},'m6',fixture/'driver')
  d.f=f;d.ids=['q1','q2'];d.events=[json.loads(line) for line in (fixture/'native-observations.jsonl').read_text().splitlines()]
  d.launches=m['observationProcesses'];d.launch_attempts=m['launchAttempts'];d.once_after_sequence=3;d.cut=True
  d.data=fixture/'app';d.run_id=d.f['runId'];d.build=json.loads((fixture/'m6-ios-run.json').read_text())['build']
  d.event_count=len(d.events);d.next_launch=None
  journal=d.data/'Documents/clique-native'/d.run_id/'native-observations.jsonl';journal.parent.mkdir(parents=True)
  journal.write_text(''.join(json.dumps(event)+'\n' for event in d.events))
  d.preflight=lambda:None;d.m6=lambda:None;d.video=object();d.bridge=object();d.app_state=lambda:{'state':'foreground','stateRaw':4,'running':True,'source':'test'}
  d.sim=Mock();d.stop_owned=lambda *args:None;d.stop_startup_capture=lambda:None;d.installed=lambda:{};d.store_identity=lambda:{};d.cleanup=lambda:None
  d.developer_dir='test';d.xcodebuild_path='test';d.simctl_path='test';d.tool_env={};d.runtime='test';d.xcode='test'
  d.c.update(udid='dedicated',bundleId='fixture',backendArgv=['server'],origin='http://localhost',videoCheckArgv=['video-check'])
  d.begin('m6-a04');d.receipt('m6-a04',True,None);d.active=None;d.clock=100
  clock=[100.]
  video=json.dumps({'codec':'h264','durationSeconds':1,'decodedEndpoints':True,'decodedFrames':1}).encode()
  with patch('run.command',return_value=video),patch('run.time.monotonic',side_effect=lambda:clock[0]),patch('run.time.sleep',side_effect=lambda seconds:clock.__setitem__(0,clock[0]+seconds)):
   result=d.run()
  self.assertIsNone(result['pass']);self.assertIn('native-writer-flush-timeout',result['reason'])
  self.assertEqual([receipt['pass'] for receipt in d.receipts if receipt['assertion']=='m6-a04'],[None])
  self.assertFalse(any(call.args and call.args[0]=='terminate' for call in d.sim.call_args_list))

 def test_exported_flush_requires_hashed_process_bound_artifacts(self):
  with tempfile.TemporaryDirectory() as temp:
   root=Path(temp);m,_,_=r1.packet(root);host=[json.loads(line) for line in (root/'host.jsonl').read_text().splitlines()]
   receipts=[json.loads(line) for line in (root/'m6-ios-receipts.jsonl').read_text().splitlines()]
   writer_flush_valid(root,m,host,receipts)
   m['files'].pop('observer-flush-1-ack.json')
   with self.assertRaisesRegex(ValueError,'evidence-unbound:observer-flush-1-ack.json'):writer_flush_valid(root,m,host,receipts)

 def test_mixed_application_failure_cannot_drop_terminal_flush(self):
  with tempfile.TemporaryDirectory() as temp:
   root=Path(temp);m,_,_=r1.packet(root)
   host=[json.loads(line) for line in (root/'host.jsonl').read_text().splitlines()]
   host=[entry for entry in host if entry.get('kind')!='recording-terminal-transition' and not (entry.get('kind')=='observation-flush-ack' and entry.get('reason')=='recording-terminal-transition')]
   receipts=[json.loads(line) for line in (root/'m6-ios-receipts.jsonl').read_text().splitlines()]
   receipts[-1]['pass']=False;receipts[-1]['status']='failed';receipts[-1]['outcomeClass']='application'
   self.assertTrue(next(receipt for receipt in receipts if receipt['assertion']=='m6-a04')['pass'])
   with self.assertRaisesRegex(ValueError,'native-writer-flush-terminations'):writer_flush_valid(root,m,host,receipts)

 def test_dead_process_without_terminal_ack_is_unmeasured(self):
  with tempfile.TemporaryDirectory() as temp:
   root=Path(temp);m,_,_=r1.packet(root)
   complete_host=[json.loads(line) for line in (root/'host.jsonl').read_text().splitlines()]
   host=[entry for entry in complete_host if entry.get('kind')!='recording-terminal-transition' and not (entry.get('kind')=='observation-flush-ack' and entry.get('reason')=='recording-terminal-transition')]
   state={'state':'not-running','stateRaw':1,'running':False,'source':'host-process','processIds':[]}
   m['failure']={'reason':'application-crashed','outcomeClass':'application','appState':state}
   receipts=[json.loads(line) for line in (root/'m6-ios-receipts.jsonl').read_text().splitlines()]
   receipts[-1]['pass']=False;receipts[-1]['status']='failed';receipts[-1]['outcomeClass']='application'
   with self.assertRaisesRegex(ValueError,'native-writer-flush-terminations'):writer_flush_valid(root,m,host,receipts)
   at=max(process['at'] for process in m['observationProcesses'])+1
   failure_host=[{'at':at,'kind':'failure-state',**state},{'at':at+1,'kind':'failure','reason':'application-crashed','outcomeClass':'application','appState':state}]
   host.extend(failure_host)
   with self.assertRaisesRegex(ValueError,'native-writer-flush-terminations'):writer_flush_valid(root,m,host,receipts)
   # A failure-state claim never waives the barrier. Stronger, successfully
   # acknowledged terminal evidence remains valid.
   writer_flush_valid(root,m,[*complete_host,*failure_host],receipts)

 def test_acknowledged_queued_disclosure_is_application_false_then_terminated(self):
  temporary=tempfile.TemporaryDirectory();self.addCleanup(temporary.cleanup);fixture=Path(temporary.name)
  m,_,f=r1.packet(fixture)
  d=Driver({'oracleArgv':['oracle'],'backendCwd':str(fixture),'webOrigin':f['origin']},'m6',fixture/'driver')
  d.f=f;d.ids=['q1','q2'];d.events=[json.loads(line) for line in (fixture/'native-observations.jsonl').read_text().splitlines()]
  d.launches=m['observationProcesses'];d.launch_attempts=m['launchAttempts'];d.once_after_sequence=3;d.cut=False;d.once_guard=True
  d.data=fixture/'app';d.run_id=f['runId'];d.build=m['build'];d.event_count=len(d.events);d.next_launch=None
  directory=d.data/'Documents/clique-native'/d.run_id;directory.mkdir(parents=True)
  journal=directory/'native-observations.jsonl';journal.write_text(''.join(json.dumps(event)+'\n' for event in d.events))
  event=copy.deepcopy(d.events[-1]);event.update(sequence=event['sequence']+1,elapsedMs=event['elapsedMs']+1,kind='media',
    payload={'messageId':f['viewOnce']['messageId'],'assetId':f['viewOnce']['assetId'],'event':'load','width':192,'height':128,'provenance':'cache'})
  d.preflight=lambda:None;d.m6=lambda:None;d.video=object();d.bridge=object();terminated=[]
  d.c.update(udid='dedicated',bundleId='fixture')
  d.app_state=lambda:{'state':'foreground','stateRaw':4,'running':True,'source':'test'}
  d.sim=lambda *args:terminated.append(args);d.stop_owned=lambda *args:None;d.stop_startup_capture=lambda:None;d.finalize=lambda:d.fail
  d.begin('m6-a04');d.receipt('m6-a04',True,None);d.active=None
  published=[]
  def acknowledge(_):
   if published:return
   request=json.loads((directory/'flush-request.json').read_text());published.append(True)
   journal.write_text(journal.read_text()+json.dumps(event)+'\n');raw=journal.read_bytes()
   (directory/'flush-ack.json').write_text(json.dumps({**request,'processNonce':d.launches[-1]['processNonce'],'eventCount':len(raw.splitlines()),'byteCount':len(raw)}))
  with patch('run.time.sleep',side_effect=acknowledge):result=d.run()
  self.assertEqual(result['outcomeClass'],'application',result);self.assertEqual(result['reason'],'viewonce-reloaded-in-cold-process')
  self.assertEqual([receipt['pass'] for receipt in d.receipts if receipt['assertion']=='m6-a04'],[False])
  self.assertTrue(any(args and args[0]=='terminate' for args in terminated))


class CleanupState(unittest.TestCase):
 def test_verified_host_absence_ignores_stale_xctest_foreground(self):
  with tempfile.TemporaryDirectory() as temp:
   d=Driver({},'m6',Path(temp)/'driver');d.bridge=Mock();d.runner=None;d.backend=None;d.lease=None
   d.host_app_state=Mock(return_value={'state':'not-running','stateRaw':1,'running':False,'source':'host-process','processIds':[]})
   d.app_state=Mock(return_value={'state':'foreground','stateRaw':4,'running':True,'source':'xctest'})
   d.flush_observations=Mock()
   d.cleanup()
   d.host_app_state.assert_called_once_with();d.app_state.assert_not_called();d.flush_observations.assert_not_called()
   self.assertNotIn('terminate',[call.args[0] for call in d.bridge.send.call_args_list])


class FinalVideo(unittest.TestCase):
 def driver(self,root):
  config={'udid':'dedicated','bundleId':'test.app','backendArgv':['server'],'origin':'http://localhost',
    'backendCwd':'/tmp','videoCheckArgv':['video-check'],'instrument':{},'driverBinarySha256':'b'*64}
  d=Driver(config,'m6',root/'driver');d.cleanup=lambda:None
  return d

 def test_finalizer_derives_measured_endpoint_claim_from_timing(self):
  with tempfile.TemporaryDirectory() as temp:
   d=self.driver(Path(temp));d.video=object()
   path=d.out/'m6-ios-screen.mp4';path.write_bytes((ROOT/'tests/fixtures/valid.mp4').read_bytes())
   for assertion in ASSERTIONS['m6']:d.receipt(assertion,True,None)
   raw={'codec':'h264','durationSeconds':30,'decodedFrames':60}
   with patch('run.command',return_value=json.dumps(raw).encode()),patch('run.verify_directory',return_value=(None,None)):
    status=d.finalize()
   manifest=json.loads((d.out/'m6-ios-run.json').read_text())
   self.assertTrue(status['pass']);self.assertEqual(manifest['video'],{**raw,'decodedEndpoints':True})

 def test_finalizer_retains_uncovered_startup_as_decoded_null(self):
  with tempfile.TemporaryDirectory() as temp:
   d=self.driver(Path(temp));d.startup_video=object();d.launch_attempts=[{'attempt':1}]
   d.set_failure('original-setup','setup')
   path=d.out/'startup-ios-screen.mp4';path.write_bytes((ROOT/'tests/fixtures/valid.mp4').read_bytes());r2.extend_video_endpoint(path)
   raw={'codec':'h264','durationSeconds':60,'decodedFrames':60}
   with patch('run.command',return_value=json.dumps(raw).encode()):status=d.finalize()
   manifest=json.loads((d.out/'m6-ios-run.json').read_text());startup=manifest['startupVideo']
   self.assertIsNone(status['pass']);self.assertEqual(status['reason'],'original-setup')
   self.assertFalse(startup['decodedEndpoints']);self.assertEqual(startup['validationError'],'video-endpoint-uncovered')
   self.assertEqual({key:startup[key] for key in raw},raw)
   self.assertEqual(manifest['failure']['secondaryFailures'][0]['reason'],'invalid-startup-video:video-endpoint-uncovered')

 def test_fault_decoder_mutation_precedes_timing_adjudication(self):
  with tempfile.TemporaryDirectory() as temp:
   d=self.driver(Path(temp));path=d.out/'m6-ios-screen.mp4';path.write_bytes((ROOT/'tests/fixtures/valid.mp4').read_bytes())
   def mutate(argv,**_):
    Path(argv[-1]).write_bytes(b'\x00\x00\x00\x08ftyp\x00\x00\x00\x08mdat\x00\x00\x00\x08moov')
    return json.dumps({'codec':'h264','durationSeconds':3600}).encode()
   with patch('run.command',side_effect=mutate),self.assertRaisesRegex(ValueError,'invalid-video-timing'):
    d.decoded_capture(path)


class RenderedRows(unittest.TestCase):
 def test_hittable_native_row_missing_from_observation_is_rejected(self):
  tree={'children':[{'id':'sm-convo-bubble','value':'observed','hittable':True,'children':[]},
                    {'id':'sm-convo-bubble','value':'missing','hittable':True,'children':[]}]}
  screen={'kind':'screen','payload':{'rows':[{'messageId':'observed'}]}}
  with self.assertRaisesRegex(ValueError,'screen-row-detached'):rendered_rows_valid(tree,screen)

 def test_inverted_projection_matches_native_visual_order(self):
  rows=[{'messageId':'second','bodyHash':body_hash('run:second'),'receipt':'pending'},
        {'messageId':'first','bodyHash':body_hash('run:first'),'receipt':'pending'}]
  source=f"""import {{reconcileRenderedRows}} from {json.dumps(str(ROOT/'helper/rendered-rows.mjs'))};
const rows=JSON.parse(process.argv[1]);console.log(JSON.stringify(reconcileRenderedRows(rows,rows.map(r=>r.messageId),r=>r.messageId,r=>r,true)));"""
  projected=json.loads(subprocess.check_output(['node','--input-type=module','-e',source,json.dumps(rows)]))
  ids=['first','second'];bodies=['run:first','run:second']
  tree={'children':[{'id':'sm-convo-bubble','value':identity,'hittable':True,'frame':{'y':y},
    'children':[{'label':body},{'id':'sm-convo-receipt','value':'pending','hittable':True}]}
    for identity,body,y in zip(ids,bodies,[100,200])]}
  self.assertEqual(pending(tree,bodies),ids)
  event={'kind':'screen','receivedAt':1,'payload':{'route':'conversation','conversationId':'c','rows':projected}}
  pending_screen_valid([event],{'conversationId':'c','queuedBodies':bodies},ids,2)
  self.assertEqual([row['messageId'] for row in projected],ids)


class RuntimeProofFlush(unittest.TestCase):
 def test_runtime_flushes_bind_both_processes_and_terminal_stream(self):
  scripts=ROOT/'pilot/scripts';sys.path.insert(0,str(scripts))
  try:
   spec=importlib.util.spec_from_file_location('round6_runtime_proof',scripts/'runtime_proof.py')
   module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
  finally:sys.path.remove(str(scripts))
  with tempfile.TemporaryDirectory() as temp:
   root=Path(temp);run_id=str(uuid.uuid4());processes=[str(uuid.uuid4()),str(uuid.uuid4())]
   lines=[json.dumps({'processNonce':process},separators=(',',':')).encode()+b'\n' for process in processes]
   raw=b''.join(lines);(root/'native-observations.jsonl').write_bytes(raw)
   size=0
   for serial,(process,line) in enumerate(zip(processes,lines),1):
    size+=len(line);request={'protocol':'clique-native-flush/1','runId':run_id,'nonce':str(uuid.uuid4())}
    (root/f'runtime-flush-{serial}-request.json').write_text(json.dumps(request))
    (root/f'runtime-flush-{serial}-ack.json').write_text(json.dumps({**request,'processNonce':process,'eventCount':serial,'byteCount':size}))
   module.validate_flushes(root,{'runId':run_id},processes)
   ack=json.loads((root/'runtime-flush-2-ack.json').read_text());ack['processNonce']=processes[0]
   (root/'runtime-flush-2-ack.json').write_text(json.dumps(ack))
   with self.assertRaisesRegex(RuntimeError,'runtime-proof-flush-process'):module.validate_flushes(root,{'runId':run_id},processes)


class PassiveJournalControl(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  spec=importlib.util.spec_from_file_location('round6_passive_controls',ROOT/'reference/passive-controls.py')
  cls.module=importlib.util.module_from_spec(spec);spec.loader.exec_module(cls.module)

 def test_expected_flush_rejection_must_be_exact_and_present(self):
  d=Mock();d.flush_observations.side_effect=Failure('native-writer-flush-ack-unpersisted','instrument')
  self.assertEqual(self.module.flush_for_termination(d,'restart','native-writer-flush-ack-unpersisted'),
    {'reason':'native-writer-flush-ack-unpersisted','outcomeClass':'instrument'})
  with self.assertRaisesRegex(Failure,'unexpected-flush-rejection'):
   self.module.flush_for_termination(d,'restart','observer-diagnostic:observation-journal-io')
  d.flush_observations.side_effect=None
  with self.assertRaisesRegex(Failure,'expected-flush-rejection-missing'):
   self.module.flush_for_termination(d,'restart','native-writer-flush-ack-unpersisted')
  d.flush_observations.side_effect=Failure('native-writer-flush-process-mismatch','instrument')
  self.assertEqual(self.module.flush_for_termination(d,'restart','native-writer-flush-process-mismatch'),
    {'reason':'native-writer-flush-process-mismatch','outcomeClass':'instrument'})

 def test_journal_failure_proves_marker_separately_from_unpersisted_ack(self):
  with tempfile.TemporaryDirectory() as temp:
   root=Path(temp);d=Mock();d.data=root;d.out=root/'out';d.out.mkdir();d.run_id=str(uuid.uuid4());d.f={}
   directory=root/'Documents/clique-native'/d.run_id;directory.mkdir(parents=True)
   (directory/'native-observations.jsonl').write_text('{}\n');(directory/'observer-diagnostics.json').write_text('{"reason":"observation-journal-io"}\n')
   d.collect.side_effect=Failure('observer-diagnostic:observation-journal-io','instrument')
   rejection={'reason':'native-writer-flush-ack-unpersisted','outcomeClass':'instrument'}
   with patch.object(self.module.time,'sleep'),patch.object(self.module,'send_and_prove',return_value='message-id'),\
     patch.object(self.module,'prove_restart',return_value=rejection) as restart:
    result=self.module.journal_control(d,'journal-failure')
   self.assertEqual(restart.call_args.args[-1],'native-writer-flush-ack-unpersisted')
   self.assertEqual(result['terminationFlushRejection'],rejection)
   self.assertEqual(result['driverRejection'],{'reason':'observer-diagnostic:observation-journal-io','outcomeClass':'instrument'})

 def test_journal_overflow_binds_foreign_ack_to_separate_overflow_marker(self):
  with tempfile.TemporaryDirectory() as temp:
   root=Path(temp);d=Mock();d.data=root;d.out=root/'out';d.out.mkdir();d.run_id=str(uuid.uuid4());d.f={}
   directory=root/'Documents/clique-native'/d.run_id;directory.mkdir(parents=True)
   journal=directory/'native-observations.jsonl';journal.write_text('{}\n');(directory/'overflow.json').write_text('{}\n')
   d.collect.side_effect=Failure('observation-journal-overflow','instrument')
   rejection={'reason':'native-writer-flush-process-mismatch','outcomeClass':'instrument'}
   with patch.object(self.module,'raw_terminate'),patch.object(self.module,'raw_launch'),\
     patch.object(self.module,'navigate_conversation'),patch.object(self.module,'send_and_prove',return_value='message-id'),\
     patch.object(self.module,'prove_restart',return_value=rejection) as restart:
    result=self.module.journal_control(d,'journal-overflow')
   self.assertGreater(journal.stat().st_size,10000)
   self.assertEqual(restart.call_args.args[-1],'native-writer-flush-process-mismatch')
   self.assertEqual(result['terminationFlushRejection'],rejection)
   self.assertEqual(result['driverRejection'],{'reason':'observation-journal-overflow','outcomeClass':'instrument'})


if __name__=='__main__':unittest.main()
