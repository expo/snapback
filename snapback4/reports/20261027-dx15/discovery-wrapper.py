#!/usr/bin/env python3
import sys,pathlib,re,json
base=pathlib.Path(__file__).parent
args=sys.argv[1:]
if len(args)<2 or args[0]!='guide' or args[1] not in ['production','staging','testing']:raise SystemExit('usage: guide production|staging|testing [--full|--section WORDS]')
name=args[1];full=(base/(name+'.md')).read_text()
if '--section' in args:
 words=' '.join(args[args.index('--section')+1:]).lower();lines=full.splitlines();at=next((i for i,l in enumerate(lines) if l.startswith('##') and words in l.lower()),None)
 if at is None:out='No matching section. Use guide '+name+' --full.'
 else:
  level=len(lines[at])-len(lines[at].lstrip('#'));end=next((i for i in range(at+1,len(lines)) if lines[i].startswith('#') and len(lines[i])-len(lines[i].lstrip('#'))<=level),len(lines));out='\n'.join(lines[at:end])
else:out=full if '--full' in args else (base/(name+'-default.md')).read_text()
print(out)
with (base/'reads.jsonl').open('a') as f:f.write(json.dumps({'command':args,'bytes':len((out+'\n').encode())})+'\n')
