"""Read-only wave16 attribution using bakeoff/lib.mjs's exact source buckets.
Usage: python3 analyze.py /home/ccheever/sb4-loop/wave16/apps OUTPUT_DIRECTORY
Line categories are descriptive (formatting and app scope are not controlled).
"""
import sys,json,re,statistics,hashlib
from pathlib import Path
root,out=map(Path,sys.argv[1:]);out.mkdir(parents=True,exist_ok=True)
SKIP=set("node_modules dist .verify-dist logs .checkpoint probe .git .expo .vite test-results playwright-report .cache .scratch .tmp generated _generated .snapback4 deploy android ios web-build .convex coverage fixtures .next build out .turbo .playwright ms-playwright".split())
def walk(root):
 for p in sorted(root.iterdir()):
  if p.is_symlink():continue
  if p.is_dir():
   if p.name not in SKIP and not p.name.startswith('.agent'):yield from walk(p)
  elif re.search(r'\.(ts|tsx|js|jsx|mjs|cjs|q|css|html|vue|svelte)$',p.name) and not p.name.endswith('.d.ts') and p.stat().st_size<=2000000:yield p

def census(lane):
 counts=dict(recipe=0,smoke=0,config=0,client=0,app=0);files=[]
 for f in walk(lane):
  name=f.relative_to(lane).as_posix();top=name.split('/')[0]
  if top in ('snapback','convex') or name.endswith('.q') or re.match(r'^(scripts|tests?|e2e|acceptance|proof|probe-serve)\b',top) or re.search(r'(^|[/.-])(test|spec|acceptance|proof)[^/]*\.[a-z]+$',name,re.I):continue
  lines=[l for l in f.read_text().splitlines() if l.strip()];c=dict.fromkeys(counts,0)
  for l in lines:
   kind='recipe' if name.startswith('recipes/production/') else 'smoke' if name.endswith('native-smoke.ts') else 'config' if re.search(r'(babel|metro|vite)\.config|metro-wasm-transformer|(^|/)index\.(html|js|ts)$',name) else 'client' if name.endswith('client.ts') or re.search(r'\b(matchRead|matchReadList|otherwiseAll|isReady|isPresent|isLoading|isDenied|isFailed|readPresentation|useQuery|usePage|useMutation|useAuth|useViewer|useSignedInViewer|AppProvider|SnapbackProvider|createApp|createClient|useAuthActions|useConvexAuth|useSession|ConvexProvider|AuthProvider)\b|\b(read|result|outcome|auth)\.(data|loading|denied|existence|complete|state|viewer|why)|\b(UseQuery|UsePage|UseMutation|ArgsOf|ResultOf|RowOf)\b',l) else 'app'
   c[kind]+=1;counts[kind]+=1
  files.append(dict(path=name,lines=len(lines),sha256=hashlib.sha256(f.read_bytes()).hexdigest(),categories=c))
 return dict(total=sum(counts.values()),categories=counts,files=files)
pairs=[];friction=[]
for sb in sorted(root.glob('*-snapback-*')):
 cx=next(root.glob(sb.name[:3]+'-convex-*'));a,b=census(sb),census(cx)
 pairs.append(dict(pair=sb.name[:3],slug=sb.name.split('-snapback-')[1],snapback=a,convex=b,delta=a['total']-b['total'],categoryDelta={k:a['categories'][k]-b['categories'][k] for k in a['categories']}))
 for i,line in enumerate((sb/'friction.jsonl').read_text().splitlines(),1):
  r=json.loads(line)
  if r.get('area') not in ('authorization-rules','schema-data','diagnostics','dev-server'):continue
  text=' '.join(str(r.get(k,'')) for k in ('summary','detail','suggested_fix'))
  cluster='completeness/probes' if re.search('N_NEVER_COMPLETE|N_CONDITIONAL_COMPLETE|N_UNREADABLE_PROBE|complet|role-helper',text,re.I) else 'refusal ladder/trace' if re.search('E_RULE|NOT_FOUND|NOT_HOST|NOT_YOUR_SLIP|hidden.*collision',text,re.I) else 'lifecycle/staging/wire' if r['area']=='dev-server' or re.search('enrollment|enrolment|provision',text,re.I) else 'authority modeling/fanout' if re.search('E_STRUCTURAL_FANOUT|cascade|cap |rule.*hop|RULE_HOP|publication|fanout|fan.out|audience|private.*reservation',text,re.I) else 'other advisories' if re.search('N_IMMUTABLE_PATCH|N_MAINTAIN_DELTA',text) else 'syntax/types/schema'
  friction.append(dict(lane=sb.name[:3],line=i,cluster=cluster,**r))
(out/'attribution.json').write_text(json.dumps(pairs,indent=2)+'\n');(out/'friction.json').write_text(json.dumps(friction,indent=2)+'\n')
lines=['# Wave 16 frontend attribution','', 'Exact harness buckets; nonblank source lines, generated code excluded. Every counted file and SHA-256 is in attribution.json. Recipes and native-smoke are starter support. Config includes HTML entry and Metro/Babel/Vite. Client counts include auth wiring, typed operations, read state and hook calls. App is the remaining screen, styling, forms and formatting; it is NOT proof of greater functionality. Dense one-line JSX is counted identically to the harness; no causal savings are claimed for residual lines. These categories are disjoint line census rules in analyze.py, not a model estimate.','', '| Pair | SB | CX | Delta | Recipe | Smoke | Config Δ | Client Δ | App/format Δ |','|---|---:|---:|---:|---:|---:|---:|---:|---:|']
for p in pairs:
 d=p['categoryDelta'];lines.append(f"| {p['pair']} {p['slug']} | {p['snapback']['total']} | {p['convex']['total']} | {p['delta']} | {d['recipe']} | {d['smoke']} | {d['config']} | {d['client']} | {d['app']} |")
lines+=['',f"Medians: SB {statistics.median(p['snapback']['total'] for p in pairs)}, CX {statistics.median(p['convex']['total'] for p in pairs)}. Removing unused recipes alone gives SB {statistics.median(p['snapback']['total']-p['snapback']['categories']['recipe'] for p in pairs)}; this is an attribution counterfactual, not a new bakeoff result.",'','| Friction cluster | Entries | Lanes | Minutes |','|---|---:|---:|---:|']
for key in sorted(set(r['cluster'] for r in friction)):
 rows=[r for r in friction if r['cluster']==key];lines.append(f"| {key} | {len(rows)} | {len(set(r['lane'] for r in rows))} | {sum(r.get('minutes_lost',0) for r in rows)} |")
(out/'ATTRIBUTION.md').write_text('\n'.join(lines)+'\n')
print('\n'.join(lines[-11:]))
