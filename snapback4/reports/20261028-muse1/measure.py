import json,pathlib,statistics,gzip,os
root=pathlib.Path('/tmp/muse1-evidence'); rows=[]
for p in sorted(root.glob('*-captured.json')):
 d=json.loads(p.read_text());l=d['launch'];m=d['metrics'];key=d['key'];sroot=root/'replay-tx'/f'{key}.json';s=json.loads(sroot.read_text())if sroot.exists()else None
 row=dict(phase=key.rsplit('-',1)[0],idea=l['a']['n'],title=l['a']['title'],model=l['a']['model'],frontend=l['a']['frontend'],version=l['version'],started=l['started'],status=d['r']['status'],report=d['r']['report'],input=m['inputTokens'],calls=m['modelCalls'],wallMinutes=d['r']['wallMs']/60000,modelMinutes=m['modelMinutes'],toolMinutes=m['toolMinutes'],sessionsMissing=m['sessionsMissing'],installed=d['installed'],proofRoute=d.get('proofRoute'),copiesRemoved=d['copiesRemoved'])
 if s:
  row['parsedCalls']=sum(x['N']for x in s['sessions']);row['parsedInput']=sum(x['sumC']for x in s['sessions']);assert row['calls']==row['parsedCalls'] and row['input']==row['parsedInput'],key
  ts=[t for x in s['sessions']for t in x['tools']];row['scaffoldReadTools']=sum('proof-scaffold' in (t['cmd']or'')and t['cat'].startswith('read-') for t in ts);row['scaffoldReadInputCost']=sum(t['cost']or 0 for t in ts if 'proof-scaffold' in (t['cmd']or'')and t['cat'].startswith('read-'))
 rows.append(row)
(root/'measurements.json').write_text(json.dumps(rows,indent=2))
for model in ['muse','codex']:
 rr=[r for r in rows if r['model']==model];print(model)
 for phase in ['v46','v47','branch','compact']:
  rs=[r for r in rr if r['phase']==phase];print(phase,len(rs),'calls',[r['calls']for r in rs],'input',[r['input']for r in rs])
 for idea in sorted({r['idea']for r in rr}):
  rs={r['phase']:r for r in rr if r['idea']==idea};print(idea,' | '.join(f"{p}: {r['calls']} calls {r['input']/1e6:.3f}M {r['wallMinutes']:.1f}min"for p,r in rs.items()))
