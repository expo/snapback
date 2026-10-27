#!/usr/bin/env python3
"""Compare every classifier decision byte, excluding elapsed time and display paths."""
import argparse,json,pathlib,hashlib,gzip
p=argparse.ArgumentParser();p.add_argument('--identities-only',action='store_true');p.add_argument('--before',required=True);p.add_argument('--after',required=True);p.add_argument('--out',required=True);a=p.parse_args()
def read(path):
 path=pathlib.Path(path);return json.load(gzip.open(path,'rt'))if path.suffix=='.gz'else json.loads(path.read_text())
def verdict(row,identities_only=False):
 out={k:row[k]for k in ['wave','lane','sha256','checkExit','checkFailure','gates','notes','checkFixes','reviews']}
 for mode in ['fresh','afterTest']:
  out[mode]={k:row[mode][k]for k in ['exit','failure','securityRefused','enforcedFixes','reviews','gates','fixes']}
 out['test']={k:row['test'][k]for k in ['exit','failure']}
 out['defaultExits']={mode:row[mode]['exit']for mode in ['defaultCheck','defaultDeploy']}
 if identities_only:
  # Secondary diagnostic only. The default full-payload comparator stays literal.
  def identities(values):
   for value in values:
    witness=value.get('witness')
    if witness is not None:
     assert isinstance(witness.get('id'),str)and len(witness['id'])==64,'stable witness identity required'
     value['witness']={'id':witness['id']}
  import copy
  out=copy.deepcopy(out)
  for name in ['gates','reviews']:identities(out[name])
  for mode in ['fresh','afterTest']:
   for name in ['gates','reviews']:identities(out[mode][name])
 return json.dumps(out,sort_keys=True,separators=(',',':')).encode()
before={(r['wave'],r['lane']):r for r in read(a.before)};after={(r['wave'],r['lane']):r for r in read(a.after)}
# The declared SEC10/11 survey is waves 15,16,18–30 (wave15 has 100 schemas).
before={k:r for k,r in before.items()if k[0]!=17};after={k:r for k,r in after.items()if k[0]!=17}
missing=sorted(before.keys()-after.keys());extra=sorted(after.keys()-before.keys());changes=[]
for key in sorted(before.keys()&after.keys()):
 b,c=verdict(before[key],a.identities_only),verdict(after[key],a.identities_only)
 if b!=c:
  old,new=json.loads(b),json.loads(c);changes.append(dict(wave=key[0],lane=key[1],fields=[k for k in old if old[k]!=new[k]],before=old,after=new))
result=dict(identitiesOnly=a.identities_only,fullPayloadEqualityEstablished=not a.identities_only and not(missing or extra or changes),schemas=len(before),afterSchemas=len(after),missing=missing,extra=extra,changes=changes,identical=not(missing or extra or changes),comparison=('SECONDARY IDENTITY DIAGNOSTIC ONLY: witness payload bodies replaced by their literal product witness IDs; this does not establish full payload equality. 'if a.identities_only else '')+'Canonical JSON bytes of all classifier gates, questions, notes, question/gate witness payloads, decision IDs, FIX identities, command exits and failures. No scalar is scrubbed or normalized. Omitted whole fields: command durations, defaultCheck/defaultDeploy transcripts, deployment summary display lines and output-line counts. Authored counterexamples require the separate witness comparison.',beforeSha256=hashlib.sha256(b'\n'.join(verdict(before[k],a.identities_only)for k in sorted(before))).hexdigest(),afterSha256=hashlib.sha256(b'\n'.join(verdict(after[k],a.identities_only)for k in sorted(after))).hexdigest())
pathlib.Path(a.out).write_text(json.dumps(result,indent=2)+'\n');print(json.dumps({k:v for k,v in result.items()if k!='changes'},indent=2));print('changed schemas',len(changes));raise SystemExit(not result['identical'])
