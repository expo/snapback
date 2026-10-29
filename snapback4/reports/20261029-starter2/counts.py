"""Reuse the archived-call parser/classifier from the requested .48 analysis.
Only private parsed output includes sanitized commands; publish aggregate counts.
"""
import os,sys,json,pathlib
sys.path.insert(0,'/home/ccheever/sb4-loop/wave34r3-repro/scripts')
os.environ['OUT']='/tmp/starter2-evidence/parsed'
import parse,calls
out=pathlib.Path(os.environ['OUT']);out.mkdir(exist_ok=True)
rows=[]
for phase in ['before','after','after2']:
 parse.APPS='/tmp/starter2-replay/'+phase
 phase_out=out/phase;phase_out.mkdir(exist_ok=True);parse.OUT=str(phase_out)
 for n in [5,23,36,39,19,32]:
  result=pathlib.Path(f'/tmp/starter2-evidence/{phase}-{n}-result.json')
  if not result.exists():continue
  lane=next(pathlib.Path(parse.APPS).glob(f'{n:03d}-*')).name
  parse.one(lane);d=json.load(open(phase_out/f'{lane}.json'))
  purposes,cycles=calls.lane_calls(d,phase)
  tools=[t for s in d['sessions'] for t in s['tools']]
  rows.append(dict(phase=phase,n=n,calls=sum(s['N'] for s in d['sessions']),input=sum(s['sumC'] for s in d['sessions']),cached=sum(s['cached'] for s in d['sessions']),output=sum(s['out_tok'] for s in d['sessions']),
   maxCallInput=max(s['maxC'] for s in d['sessions']),polls=sum(t['cat'].startswith('poll:') for t in tools),frontendCycles=sum(c['fam']=='frontend' for c in cycles),timeoutCycles=sum(c['cls']=='TimeoutError' for c in cycles),
   browserFailedRuns=sum(not t['cat'].startswith('poll:') and calls.red_of(t) and (t['cat']=='proofs:frontend' or 'TimeoutError' in (t.get('codes') or [])) for t in tools),frontendAttempts=sum(t['cat']=='proofs:frontend' for t in tools),verifyAdopted=any('npm run verify' in t['cmd'] and not t['cat'].startswith('poll:') for t in tools),purposes=dict(purposes),cycles=cycles))
json.dump(rows,open('/tmp/starter2-evidence/counts.json','w'),indent=2)
print([(r['phase'],r['n'],r['calls'],r['polls'],r['frontendCycles']) for r in rows])
