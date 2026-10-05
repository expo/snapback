"""Review reproductions exercise the live driver and the independent exported packet reader."""
import copy, hashlib, json, os, struct, subprocess, sys, tempfile, unittest, uuid
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'driver'))
from evidence import *
from run import Driver,Failure
from remote import unavailable
ROOT=Path(__file__).resolve().parents[1]

def instrument():
    v=json.loads((ROOT/'instrument.manifest.json').read_text())
    return {'commit':(ROOT/'INSTRUMENT_COMMIT').read_text().strip(),'inventorySha256':v['inventorySha256'],'instrumentPin':v['instrumentPin'],'scoredUse':False}

def packet(root):
    from test_evidence import EvidenceTests
    t=EvidenceTests();t.setUp();f=t.f;build=t.build
    qualified={'instrument':instrument(),'driverSourceSha256':sha(ROOT/'driver/run.py'),'driverBinarySha256':'b'*64}
    def write(name,v): (root/name).write_text(json.dumps(v)+'\n')
    def bubble(id,body,y=1,receipt=None):
        return {'id':'sm-convo-bubble','value':id,'hittable':True,'frame':{'y':y},'children':[{'label':body}]+([{'id':'sm-convo-receipt','value':receipt}] if receipt else [])}
    def conversation():return {'id':'sm-conversation','value':'c','children':[bubble('h','needle')]}
    queued={'children':[bubble(id,body,i,'pending') for i,(id,body) in enumerate(zip(['q1','q2'],f['queuedBodies']))]}
    for name in ['pending-2.json','pending-1.json']:write(name,queued)
    final=copy.deepcopy(queued)
    for b in final['children']:b['children'][1]['value']='read'
    write('final-read.json',final);write('cold-history.json',conversation());write('cold-search.json',conversation())
    write('native-fixture.json',f)
    image=(ROOT/'reference/ordinary.png').read_bytes();(root/'ordinary-fixture.png').write_bytes(image);f['ordinary']['sha256']=sha(root/'ordinary-fixture.png');write('native-fixture.json',f)
    (root/'cold-ordinary.png').write_bytes(image)
    frame={'x':0,'y':0,'width':192,'height':128,'screenWidth':192}
    write('cold-ordinary.json',{'frame':{'width':192},'children':[{'id':'sm-media-viewer-image','frame':frame}]})
    from PIL import Image
    (root/'prime-once.png').write_bytes((ROOT/'reference/once.png').read_bytes());(root/'viewonce-fixture.png').write_bytes((root/'prime-once.png').read_bytes());f['viewOnce']['sha256']=sha(root/'viewonce-fixture.png');write('native-fixture.json',f);Image.new('RGB',(192,384),'blue').save(root/'cold-once.png')
    prime=Image.new('RGB',(192,384),'white');prime.paste(Image.open(root/'viewonce-fixture.png'),(0,0));prime.save(root/'prime-once.png')
    write('prime-once.json',{'frame':{'width':192},'children':[{'id':'sm-media-viewer-image','frame':frame}]})
    write('cold-once-attempt.json',{'children':[{'id':'sm-convo-bubble','value':'v','children':[{'id':'sm-convo-viewonce','enabled':True,'value':'unopened'}]}]})
    write('cold-once.json',json.loads((root/'cold-once-attempt.json').read_text()));write('cold-once-pixels.json',{'frame':frame})
    for name in ['server-flush.json','server-final.json']:write(name,t.oracle)
    write('server-window.json',[t.oracle,t.oracle]);write('bob.json',{'screen':[{'conversationId':'c','principal':'b'}],'rows':t.oracle['rows']})
    launches=[{'processNonce':str(uuid.uuid4()),'at':0},{'processNonce':t.process,'at':2}]
    events=[]
    def event(kind,payload,at):
        e={'protocol':PROTOCOL,'runId':f['runId'],'processNonce':t.process,'sequence':len(events)+1,'elapsedMs':len(events),'receivedAt':at,'kind':kind,'payload':payload};events.append(e)
    event('ready',t.events[0]['payload'],3)
    screen={'route':'conversation','conversationId':'c','rows':[{'messageId':'h','bodyHash':body_hash('needle'),'receipt':None}]}
    event('screen',screen,3)
    event('media',{'messageId':'o','assetId':'oa','event':'load','width':192,'height':128,'provenance':None},4)
    event('media',{'messageId':'v','assetId':'va','event':'denied','width':0,'height':0,'provenance':None},5)
    event('search',{'token':'needle','resultIds':['h'],'openedConversationId':'c'},6)
    event('screen',screen,7)
    for i,(id,body) in enumerate(zip(['q1','q2'],f['queuedBodies'])):
        for state in ['pending','settled']:event('write',{'ordinal':i+1,'operationId':id,'messageId':id,'bodyHash':body_hash(body),'state':state},9)
    event('screen',{'route':'conversation','conversationId':'c','rows':[{'messageId':id,'bodyHash':body_hash(body),'receipt':'read'} for id,body in zip(['q1','q2'],f['queuedBodies'])]},16.5)
    (root/'native-observations.jsonl').write_text(''.join(json.dumps(e)+'\n' for e in events))
    host=[{'kind':'native-snapshot','file':'cold-history.json','at':3.5},{'kind':'search-result-tap','at':5.5,'afterSequence':4},{'kind':'native-snapshot','file':'cold-search.json','at':8},{'kind':'viewonce-reopen','at':4.5,'afterSequence':3},{'kind':'native-snapshot','file':'cold-once.json','at':5.1},{'kind':'reconnect-start','at':9.1,'afterSequence':10},{'kind':'duplicate-window-start','at':9.5},{'kind':'oracle-sample','file':'server-window-0.json','at':10},{'kind':'oracle-sample','file':'server-window-1.json','at':15},{'kind':'duplicate-window-end','durationSeconds':5.6,'at':15.1},{'kind':'receipt-window-start','at':16},{'kind':'native-snapshot','file':'final-read.json','at':16.9},{'kind':'oracle-sample','file':'server-final.json','at':17},{'kind':'receipt-window-end','at':18,'durationSeconds':2}]
    (root/'host.jsonl').write_text(''.join(json.dumps(h)+'\n' for h in host))
    (root/'m6-ios-screen.mp4').write_bytes((ROOT/'tests/fixtures/valid.mp4').read_bytes())
    d=Driver({},'m6',root/'unused');d.run_id=f['runId']
    for id in ASSERTIONS['m6']:d.receipt(id,True,None)
    (root/'m6-ios-receipts.jsonl').write_text(''.join(json.dumps(v)+'\n' for v in d.receipts))
    m={'version':VERSION,'protocol':PROTOCOL,'runId':f['runId'],'segment':'m6','qualificationOnly':True,**qualified,'build':build,'installedBefore':build,'installedAfter':build,'simulator':{'udid':'dedicated','runtime':'ios'},'host':{'name':'unit','xcode':'unit'},'backend':{'argv':['server'],'origin':f['origin'],'cwd':'/tmp'},'storeBefore':{},'storeAfter':{},'launches':launches,'prime':{'complete':True},'steps':[{'step':i,'at':i} for i in range(1,9)],'offlineProbes':[{'reachable':False}], 'assertionEvidence':{id:{'files':['native-fixture.json'],'eventSequences':[[t.process,1]],'videoSeconds':1} for id in ASSERTIONS['m6']},'video':{'decodedEndpoints':True,'codec':'h264','durationSeconds':30},'reinstalledDuringMeasurement':False,'failure':None,'cost':{},'files':{p.name:sha(p) for p in root.iterdir() if p.is_file()}}
    write('m6-ios-run.json',m)
    return m,qualified,f

class ArtifactRegressions(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup);self.root=Path(self.temp.name)
        self.m,self.q,self.f=packet(self.root)
        verify_directory(self.root,'m6',self.q)
    def rebind(self,name,v,jsonl=False):
        (self.root/name).write_text(''.join(json.dumps(e)+'\n' for e in v) if jsonl else json.dumps(v)+'\n')
        self.m['files'][name]=sha(self.root/name);self.save()
    def save(self): (self.root/'m6-ios-run.json').write_text(json.dumps(self.m)+'\n')
    def test_flattened_native_conversation_marker(self):
        for name in ['cold-history.json','cold-search.json']:
            tree=json.loads((self.root/name).read_text());children=tree.pop('children')
            self.rebind(name,{'children':[tree,*children]})
        verify_directory(self.root,'m6',self.q)
    def test_wrong_search_conversation_is_behavior(self):
        e=[json.loads(l) for l in (self.root/'native-observations.jsonl').read_text().splitlines()]
        e[5]['payload']['conversationId']='wrong';events_valid(e,self.f,self.m['launches'],self.m['build'])
        self.rebind('native-observations.jsonl',e,True)
        with self.assertRaisesRegex(ValueError,'screen-conversation'):verify_directory(self.root,'m6',self.q)
    def test_wrong_server_receipts_rebound(self):
        o=json.loads((self.root/'server-final.json').read_text())
        for r in o['rows']:r['receiptState']='sent'
        self.rebind('server-final.json',o)
        with self.assertRaisesRegex(ValueError,'server-receipt-state:read'):verify_directory(self.root,'m6',self.q)
    def test_one_wrong_server_receipt_rebound(self):
        o=json.loads((self.root/'server-final.json').read_text());o['rows'][1]['receiptState']='sent';self.rebind('server-final.json',o)
        with self.assertRaisesRegex(ValueError,'server-receipt-state:read'):verify_directory(self.root,'m6',self.q)
    def test_search_empty_and_signin_tree_rebound(self):
        for tree in [{},{'id':'sm-auth-email'}]:
            self.rebind('cold-search.json',tree)
            with self.assertRaisesRegex(ValueError,'native-conversation-identity'):verify_directory(self.root,'m6',self.q)
    def test_search_wrong_body_rebound(self):
        t=json.loads((self.root/'cold-search.json').read_text());t['children'][0]['children'][0]['label']='wrong';self.rebind('cold-search.json',t)
        with self.assertRaisesRegex(ValueError,'conversation-history-body'):verify_directory(self.root,'m6',self.q)
    def test_search_claim_without_fresh_screen(self):
        e=[json.loads(l) for l in (self.root/'native-observations.jsonl').read_text().splitlines()]
        e[5]['kind']='search';e[5]['payload']=e[4]['payload'];self.rebind('native-observations.jsonl',e,True)
        with self.assertRaisesRegex(ValueError,'conversation-screen-missing'):verify_directory(self.root,'m6',self.q)
    def test_wrong_conversation_is_behavior_not_protocol(self):
        e=[json.loads(l) for l in (self.root/'native-observations.jsonl').read_text().splitlines()]
        e[1]['payload']['conversationId']='wrong';events_valid(e,self.f,self.m['launches'],self.m['build'])
        self.rebind('native-observations.jsonl',e,True)
        with self.assertRaisesRegex(ValueError,'screen-conversation'):verify_directory(self.root,'m6',self.q)
    def test_every_provenance_field_is_checked(self):
        original=copy.deepcopy(self.m)
        for field in ['commit','inventorySha256','driverSourceSha256','driverBinarySha256']:
            self.m=copy.deepcopy(original)
            target=self.m['instrument'] if field in self.m['instrument'] else self.m
            target[field]='0'*len(target[field]);self.save()
            with self.assertRaisesRegex(ValueError,'identity-mismatch|source-mismatch|binary-mismatch'):verify_directory(self.root,'m6',self.q)
    def test_late_read_rebound(self):
        h=[json.loads(l) for l in (self.root/'host.jsonl').read_text().splitlines()];h[-1]['at']=90;h[-1]['durationSeconds']=74;self.rebind('host.jsonl',h,True)
        with self.assertRaisesRegex(ValueError,'receipt-deadline'):verify_directory(self.root,'m6',self.q)
    def test_no_fresh_ready_rebound(self):
        e=[json.loads(l) for l in (self.root/'native-observations.jsonl').read_text().splitlines()];e[0]['kind']='screen';e[0]['payload']=e[1]['payload'];self.rebind('native-observations.jsonl',e,True)
        with self.assertRaisesRegex(ValueError,'authentication-restore'):verify_directory(self.root,'m6',self.q)
    def test_server_allocated_message_ids(self):
        e=[json.loads(l) for l in (self.root/'native-observations.jsonl').read_text().splitlines()]
        for ev in e:
            if ev['kind']=='write' and ev['payload']['state']=='settled':ev['payload']['messageId']='server-'+ev['payload']['messageId']
            if ev['kind']=='screen':
                for r in ev['payload']['rows']:
                    if r['messageId'].startswith('q'):r['messageId']='server-'+r['messageId']
        self.rebind('native-observations.jsonl',e,True)
        for name in ['server-flush.json','server-final.json','server-window.json','bob.json']:
            v=json.loads((self.root/name).read_text())
            for o in v if isinstance(v,list) else [v]:
                for row in o['rows']:row['messageId']='server-'+row['messageId']
            self.rebind(name,v)
        v=json.loads((self.root/'final-read.json').read_text())
        for b in v['children']:b['value']='server-'+b['value']
        self.rebind('final-read.json',v);verify_directory(self.root,'m6',self.q)
    def test_overflow_rejects(self):
        self.rebind('overflow.json',{'reason':'observation-journal-overflow'})
        with self.assertRaisesRegex(ValueError,'journal-overflow'):verify_directory(self.root,'m6',self.q)

class DriverRegressions(unittest.TestCase):
    def driver(self):
        tmp=tempfile.TemporaryDirectory();self.addCleanup(tmp.cleanup)
        return Driver({'udid':'dedicated','bundleId':'test.app','backendArgv':['server'],'origin':'http://localhost','backendCwd':'/tmp','instrument':instrument(),'driverBinarySha256':'b'*64},'m6',Path(tmp.name)/'evidence')
    def test_launch_collects_until_new_process_ready(self):
        d=self.driver();d.launches=[{'processNonce':'prime','at':0}];d.events=[{'kind':'ready','processNonce':'prime','receivedAt':1}]
        polls=[]
        def collect():
            polls.append(1)
            if len(polls)==3:
                d.launches.append({'processNonce':'cold','at':d.next_launch});d.events.append({'kind':'ready','processNonce':'cold','receivedAt':d.next_launch+1})
        d.collect=collect;d.ui=lambda *a,**kw:None
        d.launch();self.assertGreaterEqual(len(polls),3)
    def test_prime_ready_cannot_satisfy_launch(self):
        d=self.driver();d.launches=[{'processNonce':'prime','at':0}];d.events=[{'kind':'ready','processNonce':'prime','receivedAt':1}]
        d.collect=lambda:None;d.ui=lambda *a,**kw:None;d.wait=lambda fn,timeout:fn()
        with self.assertRaisesRegex(ValueError,'authentication-restore'):d.launch()
    def test_finalize_never_publishes_success_before_validation(self):
        d=self.driver();d.cleanup=lambda:None;d.receipt('m6-a01',True,None)
        def reject(*args,**kwargs):
            self.assertFalse((d.out/'m6-ios-run.json').exists());self.assertFalse((d.out/'m6-ios-receipts.jsonl').exists())
            self.assertIn('candidate',kwargs);raise ValueError('incomplete')
        with patch('run.verify_directory',side_effect=reject):status=d.finalize()
        m=json.loads((d.out/'m6-ios-run.json').read_text());rs=[json.loads(l) for l in (d.out/'m6-ios-receipts.jsonl').read_text().splitlines()]
        self.assertIsNone(status['pass']);self.assertEqual(m['failure']['reason'],status['reason'])
        self.assertTrue(all(r['pass'] is None and r['details']['reason']==status['reason'] for r in rs));self.assertIsNone(m['video'])
    def test_overflow_is_instrument_failure(self):
        d=self.driver();d.data=d.out/'container';p=d.data/'Documents/clique-native'/d.run_id;p.mkdir(parents=True);(p/'native-observations.jsonl').touch();(p/'overflow.json').write_text('{}')
        with self.assertRaises(Failure) as raised:d.collect()
        self.assertEqual(raised.exception.kind,'instrument');self.assertEqual(raised.exception.reason,'observation-journal-overflow')
    def test_live_search_rejects_claim_without_destination(self):
        d=self.driver()
        from test_evidence import EvidenceTests
        t=EvidenceTests();t.setUp();d.f=t.f;d.events=[{'sequence':1}]
        claim={'kind':'search','sequence':2,'processNonce':t.process,'payload':{'token':'needle','resultIds':['h'],'openedConversationId':'c'}}
        d.collect=lambda:None;d.type=lambda *a:None;d.wait=lambda fn,*a:fn()
        def tap(id,*args):
            if id=='sm-search-result':d.events.append(claim)
        d.tap=tap;d.tree=lambda *a:{}
        with self.assertRaisesRegex(ValueError,'native-conversation-identity'):d.search_destination()
    def test_unrecorded_video_is_nullable(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);m,q,f=packet(root);m['video']=None;m['prime']={'complete':False};m['steps']=[]
            m['failure']={'reason':'fixture-row-not-found:missing','outcomeClass':'setup'}
            rs=[json.loads(l) for l in (root/'m6-ios-receipts.jsonl').read_text().splitlines()]
            for r in rs:r.update({'pass':None,'status':'skipped','implemented':False,'timings':[],'details':{'selection':'single-native-run','selectedAttempt':None,'reason':m['failure']['reason']},'outcomeClass':'setup'})
            (root/'m6-ios-receipts.jsonl').write_text(''.join(json.dumps(r)+'\n' for r in rs));m['files']['m6-ios-receipts.jsonl']=sha(root/'m6-ios-receipts.jsonl')
            (root/'m6-ios-run.json').write_text(json.dumps(m))
            self.assertEqual(verify_directory(root,'m6',q)[0]['failure']['reason'],'fixture-row-not-found:missing')
    def test_live_final_oracle_rejects_sent_receipts(self):
        d=self.driver()
        from test_evidence import EvidenceTests
        t=EvidenceTests();t.setUp();d.f=t.f;d.ids=['q1','q2'];d.c['oracleArgv']=['oracle']
        for row in t.oracle['rows']:row['receiptState']='sent'
        with patch('run.command',return_value=json.dumps(t.oracle).encode()):
            with self.assertRaisesRegex(ValueError,'server-receipt-state:read'):d.oracle('server-final','read')
    def test_live_cold_history_wrong_conversation_is_application_failure(self):
        d=self.driver()
        from test_evidence import EvidenceTests
        t=EvidenceTests();t.setUp();d.f=t.f;d.prime={'complete':True,'eventCount':0};d.launches=t.launches
        d.events=[{'kind':'screen','processNonce':t.process,'payload':{'route':'conversation','conversationId':'wrong','rows':[]}}]
        for name in ['terminate','cut_backend','start_recording','launch','navigate']:setattr(d,name,lambda:None)
        d.ui=lambda *a,**kw:{'state':1};d.locate=lambda *a:None;d.tree=lambda *a:{}
        with self.assertRaisesRegex(ValueError,'screen-conversation'):d.m6()
        self.assertEqual(d.active,'m6-a01')
    def test_ssh_remote_exit_255_is_not_unavailable(self):
        self.assertFalse(unavailable(subprocess.CompletedProcess([],255,'output','remote crashed')))
        self.assertTrue(unavailable(subprocess.CompletedProcess([],255,'','ssh: connect to host 127.0.0.1 port 1: Connection refused\n')))

if __name__=='__main__':unittest.main()
