import shlex,json,hashlib,time
from collections import Counter
from pathlib import Path
root=Path('instrument/fixtures'); projected=[json.loads(l) for l in Path('artifacts/fixture/projected.jsonl').read_text().splitlines()]
expected=[];chats={};messages={};verbs=Counter();conversions=Counter();omitted=Counter()
for name in ['starter-m1.log','starter-m2.log','starter-m3.log','scale.log']:
 for line in (root/name).read_text().splitlines():
  if not line or line.startswith('#'):continue
  ts,actor,verb,*args=shlex.split(line)
  if name=='scale.log' and verb in ['follow','post','reply','like','repost']:omitted[verb]+=1;continue
  if verb=='profile-set':args=args[:5];conversions['profile-avatar-omission']+=1
  if verb=='send-media':
   verb='send';quote=[a for a in args if a.startswith('quote=')];args=[args[0],args[1],f'[Projected media {args[2]}: {args[3]}] {args[4]}']+quote;conversions['media-message']+=1
  if verb=='post' and args[1]!='text':args=[args[0],'text',f'[Projected {args[1]}: {args[3]}] {args[2]}'];conversions['media-post']+=1
  expected.append((name,ts,actor,verb,args));verbs[verb]+=1
  if verb in ['group-create','dm-create']:chats[args[0]]={'members':{actor,args[1]},'kind':verb,'messages':[]}
  if verb=='member-add':chats[args[0]]['members'].add(args[1])
  if verb=='send':messages[args[0]]=args;chats[args[1]]['messages'].append(args[0])
actual=[(r['source'],r['time'],r['actor'],r['verb'],r['args']) for r in projected]
assert actual==expected,'Transformed output differs from independent parser'
assert len(actual)==105134 and len(messages)==100015 and len(chats)==1002
assert len(chats['g0001']['members'])==50 and len(chats['g0001']['messages'])==10000
assert all(len(c['messages'])==100 for cid,c in chats.items() if c['kind']=='dm-create' and cid!='d-alice-bob')
for mid,args in messages.items():
 for a in args[3:]:
  if a.startswith('quote='):assert messages[a[6:]][1]==args[1]
scopes={u:{'conversations':sum(u in c['members'] for c in chats.values()),'messages':sum(len(c['messages']) for c in chats.values() if u in c['members'])} for u in ['u0001','u0500','alice','bob','carol']}
assert scopes['u0001']=={'conversations':1000,'messages':100000}
assert scopes['u0500']=={'conversations':100,'messages':10000}
assert len(chats['d-alice-bob']['messages'])==6 and len(chats['g-starter']['messages'])==9
json.dump({'epoch':time.time(),'status':'pass','method':'independent Python shlex parse of frozen inputs, compared every projected actor/time/verb/argument; checked quote membership, entity counts and authorization scopes','actions':len(actual),'verbs':dict(verbs),'converted':dict(conversions),'omitted':dict(omitted),'scopes':scopes},open('artifacts/fixture/independent-verification.json','w'),indent=2)
