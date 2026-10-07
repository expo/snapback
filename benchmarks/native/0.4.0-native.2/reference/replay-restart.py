#!/usr/bin/env python3
"""Live M8 negative control: replay the warm capture at export, retaining originals."""
import argparse,json,sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'driver'))
from run import Driver

class ReplayRestart(Driver):
 def finalize(self):
  if self.fail is None:
   for suffix in ['json','png']:
    (self.out/('restart-actual.'+suffix)).write_bytes((self.out/('restart-pending.'+suffix)).read_bytes())
    (self.out/('restart-pending.'+suffix)).write_bytes((self.out/('warm-pending-2.'+suffix)).read_bytes())
   host=[json.loads(h) for h in self.host_file.read_text().splitlines()]
   warm=next(h['at'] for h in reversed(host) if h.get('file')=='warm-pending-2.json')
   self.host('native-snapshot',file='restart-pending.json',screenshot='restart-pending.png',at=warm)
   (self.out/'actual-observations.jsonl').write_bytes((self.out/'native-observations.jsonl').read_bytes())
   for e in self.events:
    if e['processNonce']==self.launches[-1]['processNonce'] and e['kind']=='screen':e['payload']['rows']=[r for r in e['payload']['rows'] if r['receipt']!='pending']
   self.write('native-observations.jsonl',''.join(json.dumps(e)+'\n' for e in self.events))
  return super().finalize()

if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--config',required=True);p.add_argument('--segment',choices=['m8'],required=True);p.add_argument('--out',required=True);a=p.parse_args()
 result=ReplayRestart(json.loads(Path(a.config).read_text()),a.segment,Path(a.out).resolve()).run()
 sys.exit(1 if result['pass'] is False else 0)
