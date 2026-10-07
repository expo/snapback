import json, os, socket, subprocess, tempfile, time, unittest
from pathlib import Path
from urllib.request import Request,urlopen
ROOT=Path(__file__).resolve().parents[1]
# Volta's shim can leave its child alive when the shim is terminated on macOS.
NODE=subprocess.check_output(['node','-p','process.execPath'],text=True).strip()

class BackendRegressions(unittest.TestCase):
 def test_send_idempotency_is_scoped_to_conversation_and_sender(self):
  with tempfile.TemporaryDirectory() as d:
   with socket.socket() as s:s.bind(('127.0.0.1',0));port=s.getsockname()[1]
   p=subprocess.Popen([NODE,str(ROOT/'reference/server.mjs'),d,str(port)],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
   try:
    def api(route,data=None,token=None):
     r=Request('http://127.0.0.1:'+str(port)+route,data=json.dumps(data).encode() if data else None,headers={'Content-Type':'application/json',**({'Authorization':'Bearer '+token} if token else {})})
     with urlopen(r,timeout=2) as response:return json.load(response)
    for _ in range(50):
     try:api('/health');break
     except OSError:time.sleep(.05)
    users={}
    for name in ['alice','bob','eve']:
     auth={'email':name,'password':'test-only'};id=api('/register',auth)['id'];users[name]={'id':id,**api('/login',auth)}
    def convo(a,b):return api('/conversations',{'bob':users[b]['id']},users[a]['token'])['conversationId']
    ab=convo('alice','bob');ee=convo('eve','eve');aa=convo('alice','alice')
    def send(who,where,body):return api('/send',{'messageId':'collision','conversationId':where,'body':body},users[who]['token'])
    self.assertEqual(send('alice',ab,'private')['body'],'private')
    self.assertEqual(send('eve',ee,'own')['body'],'own')
    self.assertEqual(send('alice',aa,'other conversation')['conversationId'],aa)
    self.assertEqual(send('bob',ab,'other sender')['author'],users['bob']['id'])
    self.assertEqual(send('alice',ab,'retry')['body'],'private')
    rows=api('/history?conversationId='+ab,token=users['bob']['token'])['rows']
    self.assertEqual(len(rows),2)
    # Alice's activity neither consumes Eve's asset nor advances Eve's ordering keys.
    assets={}
    for who,where in [('alice',ab),('eve',ee)]:
     asset=api('/assets',{'conversationId':where,'bytes':'cGl4ZWxz','once':True},users[who]['token'])['assetId'];assets[who]=asset
     api('/send',{'conversationId':where,'body':'photo','assetId':asset,'once':True},users[who]['token'])
    api('/asset?conversationId='+ab+'&id='+assets['alice'],token=users['alice']['token'])
    history=api('/history?conversationId='+ee,token=users['eve']['token'])
    self.assertFalse(history['rows'][-1]['consumed'])
    self.assertEqual(api('/asset?conversationId='+ee+'&id='+assets['eve'],token=users['eve']['token'])['bytes'],'cGl4ZWxz')
    # Another once asset in Alice's own conversation is independent too.
    second=api('/assets',{'conversationId':ab,'bytes':'bmV4dA==','once':True},users['alice']['token'])['assetId']
    self.assertEqual(api('/asset?conversationId='+ab+'&id='+second,token=users['alice']['token'])['bytes'],'bmV4dA==')
    for i in range(2):api('/send',{'conversationId':ab,'body':'private'+str(i)},users['alice']['token'])
    own=api('/send',{'conversationId':ee,'body':'next'},users['eve']['token'])
    self.assertEqual(own['orderKey'],[history['rows'][-1]['orderKey'][0]+1])
   finally:p.terminate();p.wait(timeout=5)

 def test_adapter_constructs_exact_bodies_and_oracle_does_not_mutate_store(self):
  with tempfile.TemporaryDirectory() as d:
   store=Path(d)
   with socket.socket() as s:s.bind(('127.0.0.1',0));port=s.getsockname()[1]
   origin='http://127.0.0.1:'+str(port)
   p=subprocess.Popen([NODE,str(ROOT/'reference/server.mjs'),str(store),str(port)],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
   env={**os.environ,'CLIQUE_ALICE_EMAIL':'alice@example.com','CLIQUE_ALICE_PASSWORD':'alice-pass','CLIQUE_BOB_EMAIL':'bob@example.com','CLIQUE_BOB_PASSWORD':'bob-pass'}
   run_id='142ed513-dacc-4219-bf29-3098db534c1c'
   def adapter(mode,value):
    result=subprocess.run([NODE,str(ROOT/'reference/adapter.mjs'),mode],input=json.dumps(value),text=True,capture_output=True,env=env,check=True)
    return json.loads(result.stdout)
   try:
    for _ in range(50):
     try:
      with urlopen(origin+'/health',timeout=2):break
     except OSError:time.sleep(.05)
    fixture=adapter('seed',{'protocol':'clique-native/1','runId':run_id,'origin':origin,'bundleId':'test.reference'})
    self.assertEqual(fixture['queuedBodies'],[run_id+':first',run_id+':second'])
    def api(route,data=None,token=None):
     request=Request(origin+route,data=json.dumps(data).encode() if data else None,headers={'Content-Type':'application/json',**({'Authorization':'Bearer '+token} if token else {})})
     with urlopen(request,timeout=2) as response:return json.load(response)
    alice=api('/login',{'email':env['CLIQUE_ALICE_EMAIL'],'password':env['CLIQUE_ALICE_PASSWORD']})
    for body in fixture['queuedBodies']:api('/send',{'conversationId':fixture['conversationId'],'body':body},alice['token'])
    before=(store/'db.json').read_bytes()
    oracle=adapter('oracle',{'protocol':'clique-native/1','runId':run_id,'origin':origin,'conversationId':fixture['conversationId'],'queuedBodies':fixture['queuedBodies']})
    self.assertEqual((store/'db.json').read_bytes(),before)
    self.assertEqual([row['body'] for row in oracle['rows'] if row['body'] in fixture['queuedBodies']],fixture['queuedBodies'])
   finally:p.terminate();p.wait(timeout=5)

class AssetScopeRegressions(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup);self.store=Path(self.tmp.name)
  with socket.socket() as sock:sock.bind(('127.0.0.1',0));self.port=sock.getsockname()[1]
  self.start();self.addCleanup(self.stop)
  self.users={}
  for who in ['alice','eve']:
   auth={'email':who,'password':'test-only'};id=self.api('/register',auth)['id'];self.users[who]={'id':id,**self.api('/login',auth)}
  self.conversations={who:self.api('/conversations',{'bob':u['id']},who)['conversationId'] for who,u in self.users.items()}
  self.asset=self.api('/assets',{'conversationId':self.conversations['alice'],'bytes':'cGl4ZWxz','once':True},'alice')['assetId']
 def start(self):
  self.p=subprocess.Popen([NODE,str(ROOT/'reference/server.mjs'),str(self.store),str(self.port)],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
  for _ in range(50):
   try:self.api('/health');return
   except OSError:time.sleep(.05)
  raise AssertionError('backend did not start')
 def stop(self):
  if self.p.poll() is None:self.p.terminate();self.p.wait(timeout=5)
 def api(self,route,data=None,who=None):
  token=self.users[who]['token'] if who else None
  req=Request('http://127.0.0.1:'+str(self.port)+route,data=json.dumps(data).encode() if data else None,headers={'Content-Type':'application/json',**({'Authorization':'Bearer '+token} if token else {})})
  with urlopen(req,timeout=2) as response:return json.load(response)
 def test_send_rejects_foreign_and_missing_asset(self):
  from urllib.error import HTTPError
  for asset in [self.asset,'missing']:
   with self.subTest(asset=asset):
    with self.assertRaises(HTTPError) as error:
     self.api('/send',{'conversationId':self.conversations['eve'],'body':'spy','assetId':asset,'once':True},'eve')
    self.assertEqual(error.exception.code,403)
  own=self.api('/send',{'conversationId':self.conversations['eve'],'body':'legitimate'},'eve')
  self.assertEqual(own['orderKey'],[1])
 def test_history_scopes_legacy_foreign_asset_reference(self):
  self.stop();file=self.store/'db.json';db=json.loads(file.read_text())
  db['rows'].append({'messageId':'legacy-foreign','conversationId':self.conversations['eve'],'body':'spy','assetId':self.asset,'once':True,'receiptState':'sent','orderKey':[1],'author':self.users['eve']['id']})
  file.write_text(json.dumps(db));self.start()
  for who in self.users:self.users[who].update(self.api('/login',{'email':who,'password':'test-only'}))
  route='/history?conversationId='+self.conversations['eve']
  before=self.api(route,who='eve')
  self.api('/asset?conversationId='+self.conversations['alice']+'&id='+self.asset,who='alice')
  self.assertEqual(self.api(route,who='eve'),before)
  self.assertFalse(before['rows'][0]['consumed'])
