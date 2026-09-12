import json,time
from pathlib import Path
fields='id conversationId senderId serverTimestamp type text caption mediaReference edited tombstone replyTo reactions ownMessageReceiptState'.split()
report={'at':time.time(),'requiredFields':fields,'personas':[],'coverageFailures':[],'differences':[]}
def canonical(v):
 if isinstance(v,dict):return {k:canonical(x) for k,x in sorted(v.items())}
 if isinstance(v,list):return sorted([canonical(x) for x in v],key=lambda x:json.dumps(x,sort_keys=True))
 return v
for actor in ['alice','bob','carol']:
 pre=json.load(open(f'm7-baseline/pre-m7-{actor}.json'));post=json.load(open(f'm7/post-m7-{actor}.json'))
 counts={k:0 for k in ['rows','visible','edited','tombstones','reactions','mine','ownReceipts','populatedFetched','populatedViewed','quotes']}
 a={m['id']:m for c in pre['conversations'] for m in c['messages']};b={m['id']:m for c in post['conversations'] for m in c['messages']}
 if set(a)!=set(b):report['differences'].append({'actor':actor,'idsPre':list(a),'idsPost':list(b)})
 if pre['principal']!=post['principal']:report['differences'].append({'actor':actor,'principalChanged':True})
 for id,m in a.items():
  for side,row in [('pre',m),('post',b.get(id,{}))]:
   for f in fields:
    if f not in row:report['coverageFailures'].append({'actor':actor,'id':id,'side':side,'field':f})
   for r in row.get('reactions',[]):
    for f in ['id','messageId','conversationId','userId','emoji','mine']:
     if f not in r:report['coverageFailures'].append({'actor':actor,'id':id,'side':side,'reactionField':f})
   receipt=row.get('ownMessageReceiptState')
   if receipt is not None:
    for f in ['serverAccepted','recipientFetched','recipientViewed','watermarks']:
     if f not in receipt:report['coverageFailures'].append({'actor':actor,'id':id,'side':side,'receiptField':f})
    for r in receipt.get('watermarks',[]):
     for f in ['id','conversationId','userId','fetchedThrough','viewedThrough']:
      if f not in r:report['coverageFailures'].append({'actor':actor,'id':id,'side':side,'watermarkField':f})
  for f in fields:
   if canonical(m.get(f))!=canonical(b.get(id,{}).get(f)):report['differences'].append({'actor':actor,'id':id,'field':f,'pre':m.get(f),'post':b.get(id,{}).get(f)})
  counts['rows']+=1;counts['visible']+=not m['tombstone'];counts['edited']+=m['edited'];counts['tombstones']+=m['tombstone'];counts['reactions']+=len(m['reactions']);counts['mine']+=sum(r['mine'] for r in m['reactions']);counts['quotes']+=m['replyTo'] is not None
  if m['ownMessageReceiptState']:
   counts['ownReceipts']+=1;counts['populatedFetched']+=bool(m['ownMessageReceiptState']['recipientFetched']);counts['populatedViewed']+=bool(m['ownMessageReceiptState']['recipientViewed'])
 report['personas'].append({'actor':actor,'counts':counts,'comparedIds':sorted(a),'allRequiredControlsPopulated':all(counts.values())})
report['pass']=not report['coverageFailures'] and not report['differences'] and all(x['allRequiredControlsPopulated'] for x in report['personas'])
Path('m7/snapshot-comparison.json').write_text(json.dumps(report,indent=2));print(json.dumps(report,indent=2))
