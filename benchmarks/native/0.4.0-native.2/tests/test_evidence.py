import copy
import json
from pathlib import Path
import sys
import tempfile
import unittest
import uuid
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'driver'))
from evidence import *
ROOT=Path(__file__).resolve().parents[1]
class EvidenceTests(unittest.TestCase):
 def setUp(self):
  self.id=str(uuid.uuid4());self.process=str(uuid.uuid4())
  self.f={'protocol':PROTOCOL,'runId':self.id,'bundleId':'test.app','origin':'http://127.0.0.1:49491','alice':'a','bob':'b','conversationId':'c','chatValue':'dm:bob','history':{'messageId':'h','body':'needle'},'search':{'token':'needle','messageId':'h'},'ordinary':{'messageId':'o','assetId':'oa','sha256':'1'*64},'viewOnce':{'messageId':'v','assetId':'va','sha256':'2'*64},'queuedBodies':[self.id+':first',self.id+':second']}
  self.build={'bundleId':'test.app','nativeSha256':'1'*64,'hermesSha256':'2'*64}
  self.events=[{'protocol':PROTOCOL,'runId':self.id,'processNonce':self.process,'sequence':1,'elapsedMs':0,'receivedAt':1,'kind':'ready','payload':{'principal':'a','origin':self.f['origin'],'authenticationRestored':True,'build':self.build,'development':False}}]
  self.launches=[{'processNonce':self.process,'at':0}]
  self.oracle={'principal':'b','origin':self.f['origin'],'conversationId':'c','complete':True,'rows':[{'messageId':id,'body':body,'orderKey':[i],'receiptState':'read'} for i,(id,body) in enumerate(zip(['q1','q2'],self.f['queuedBodies']))]}
 def test_valid_observations_and_oracle(self):
  fixture_valid(self.f,self.id,'test.app',self.f['origin']);events_valid(self.events,self.f,self.launches,self.build);oracle_valid(self.oracle,self.f,['q1','q2'])
 def test_replay_and_stale_nonce(self):
  with self.assertRaisesRegex(ValueError,'sequence'):events_valid(self.events*2,self.f,self.launches,self.build)
  self.events[0]['runId']=str(uuid.uuid4())
  with self.assertRaisesRegex(ValueError,'stale|schema-invalid'):events_valid(self.events,self.f,self.launches,self.build)
 def test_sequence_gap_and_clock(self):
  self.events[0]['sequence']=2
  with self.assertRaisesRegex(ValueError,'gap'):events_valid(self.events,self.f,self.launches,self.build)
  self.events[0]['sequence']=1;self.events[0]['elapsedMs']=float('nan')
  with self.assertRaisesRegex(ValueError,'time'):events_valid(self.events,self.f,self.launches,self.build)
 def test_duplicate_and_reversed_server(self):
  o=copy.deepcopy(self.oracle);o['rows'].append(o['rows'][0])
  with self.assertRaisesRegex(ValueError,'occurrence-count'):oracle_valid(o,self.f,['q1','q2'])
  self.oracle['rows'][0]['orderKey']=[5]
  with self.assertRaisesRegex(ValueError,'send-order'):oracle_valid(self.oracle,self.f,['q1','q2'])
 def test_bob_and_completeness(self):
  for field,value,reason in [('principal','a','identity'),('conversationId','wrong','identity'),('complete',False,'incomplete')]:
   o=copy.deepcopy(self.oracle);o[field]=value
   with self.assertRaisesRegex(ValueError,reason):oracle_valid(o,self.f,['q1','q2'])
 def test_fixture_identity(self):
  self.f['search']['messageId']='wrong'
  with self.assertRaisesRegex(ValueError,'fixture-search'):fixture_valid(self.f,self.id,'test.app',self.f['origin'])
 def test_paths_and_missing_files(self):
  with tempfile.TemporaryDirectory() as d:
   for name in ['../outside','/tmp/outside','missing.mp4']:
    with self.assertRaises(ValueError):safe_file(d,name)
 def test_schemas_refuse_extra_verdict(self):
  import jsonschema
  e=copy.deepcopy(self.events[0]);e['payload']['pass']=True
  with self.assertRaises(jsonschema.ValidationError):jsonschema.validate(e,json.loads((ROOT/'schemas/observations.schema.json').read_text()))
 def test_placeholder_pixels(self):
  from PIL import Image
  with tempfile.TemporaryDirectory() as d:
   f={'x':0,'y':0,'width':192,'height':128,'screenWidth':192}
   image=ROOT/'reference/ordinary.png'
   self.assertTrue(pixel_match(image,f,image)[0])
   fake=Path(d)/'placeholder.png';Image.new('RGB',(192,128),'gray').save(fake)
   self.assertFalse(pixel_match(fake,f,image)[0])
 def test_collapsed_receipt_fails(self):
  def bubble(id,body,y):return {'id':'sm-convo-bubble','value':id,'hittable':True,'frame':{'y':y},'children':[{'id':'','label':body,'children':[]}]}
  tree={'children':[bubble('q1',self.f['queuedBodies'][0],1),bubble('q2',self.f['queuedBodies'][1],2)]}
  with self.assertRaisesRegex(ValueError,'receipt-accessibility'):pending(tree,self.f['queuedBodies'])


class GraderPolicyTests(unittest.TestCase):
 def test_unmeasured_never_becomes_low_score_or_total(self):
  import importlib.util
  spec=importlib.util.spec_from_file_location('policy',ROOT/'driver/grader-policy.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
  p=m.o4_profile(True,{'valid':True,'pass':True},None,True)
  self.assertIsNone(p['score']);self.assertEqual(p['reason'],'native-unmeasured');self.assertFalse(p['overallEligible'])
  self.assertEqual(m.o4_profile(False,None,None,False)['reason'],'m6-not-green')


class PassiveHelperTests(unittest.TestCase):
 def test_malformed_event_is_instrument_error_not_verdict(self):
  t=EvidenceTests();t.setUp();t.events[0]['payload']['unexpected']='secret'
  with self.assertRaisesRegex(ValueError,'schema-invalid:observations:payload') as e:events_valid(t.events,t.f,t.launches,t.build)
  self.assertNotIn('secret',str(e.exception))
if __name__=='__main__':unittest.main()
