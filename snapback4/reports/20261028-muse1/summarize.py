import json,statistics,pathlib
root=pathlib.Path('/tmp/muse1-evidence');rows=json.loads((root/'measurements.json').read_text());med=statistics.median
out=['# MUSE1 complete-session measurements','', 'Exact provider totals; all fixed draws retained. `branch` is the rejected opt-in-only candidate; `compact` is the rejected compact-default candidate; `optin` is the explicit-choice fallback. Both candidates include integrated .48 TOK5/GEN1.','', '| Model | Idea | Phase | Calls | Input tokens | Wall min |','|---|---:|---|---:|---:|---:|']
for model,ideas in [('muse',[19,32,26,35]),('codex',[1,14])]:
 for n in ideas:
  for phase in ['v46','v47','branch','compact','optin']:
   rr=[r for r in rows if r['model']==model and r['idea']==n and r['phase']==phase]
   if not rr:continue
   r,=rr;assert r['status']==0 and r['copiesRemoved'] and not r['sessionsMissing'],r
   out.append(f"| {model} | {n:03} | {phase} | {r['calls']} | {r['input']:,} | {r['wallMinutes']:.2f} |")
out+=['','| Model | Phase | N | Median calls | Median input | Median wall min |','|---|---|---:|---:|---:|---:|---:|']
for model in ['muse','codex']:
 for phase in ['v46','v47','branch','compact','optin']:
  a=[r for r in rows if r['model']==model and r['phase']==phase]
  if a:out.append(f"| {model} | {phase} | {len(a)} | {med(r['calls']for r in a):g} | {med(r['input']for r in a):,.0f} | {med(r['wallMinutes']for r in a):.2f} |")
for model,before,count in [('muse','v46',4),('codex','v47',2)]:
 a={r['idea']:r for r in rows if r['model']==model and r['phase']=='optin'};b={r['idea']:r for r in rows if r['model']==model and r['phase']==before}
 out+=['',f'{model} versus {before}: {len(a)}/{count} after draws completed.']
 if len(a)!=count:continue
 for metric in ['calls','input']:
  after=med(r[metric]for r in a.values());base=med(b[n][metric]for n in a);ratios=[a[n][metric]/b[n][metric]for n in a]
  out.append(f'- {metric}: median totals {after:,.1f} / {base:,.1f} = {after/base:.4f}; median paired ratio {med(ratios):.4f}; individual paired ratios '+', '.join(f'{n:03}={a[n][metric]/b[n][metric]:.4f}'for n in sorted(a))+f"; median-total bar {'PASS' if after<=base else 'MISS'}.")
(root/'RESULTS.md').write_text('\n'.join(out)+'\n')
