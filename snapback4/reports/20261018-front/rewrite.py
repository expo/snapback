"""Reproduce three frontend rewrites without modifying the evidence lanes.
python3 rewrite.py WAVE16_APPS OUTPUT_DIR
Copies only source/proof inputs; no credentials, dependencies, logs or databases.
"""
from pathlib import Path
import sys,re,shutil,json
source,dest=map(Path,sys.argv[1:]);dest.mkdir(parents=True,exist_ok=True)
report=Path(__file__).parent
for num in ['002','026','048']:
 lane=next(source.glob(num+'-snapback-*'));out=dest/lane.name
 def ignore(path,names):return [n for n in names if n in ['node_modules','probe','target','dist','logs','.git','.expo','.snapback4','recipes','artifacts','.runs','deployment','deploy'] or n.startswith('.env') or n.startswith('.agent') or n.endswith(('.sqlite','.sqlite-shm','.sqlite-wal'))]
 shutil.copytree(lane,out,ignore=ignore,dirs_exist_ok=True)
 rel='App.tsx' if num=='026' else 'src/App.tsx';p=out/rel;s=p.read_text();before=sum(bool(l.strip()) for l in s.splitlines())
 if num=='002':
  s=s.replace('usePage, useQuery,','usePage, useQueryResult,').replace('const roleRead = useQuery(api.myRole, {});','const {data: roleRow, why} = useQueryResult(api.myRole, {});')
  a=s.index('    {matchRead(roleRead, {');b=s.index('    })}',a)+len('    })}')
  s=s[:a]+'    {why ? <p role="alert">Not available: {why.message}</p> : roleRow === undefined ? <p>Loading your role…</p> : roleRow === null ? <Register /> : <Home role={roleRow.role as Role} selectedBlock={selectedBlock} onSelectBlock={setSelectedBlock} />}'+s[b:]
  s=s.replace('isReady, matchRead','isReady')
 elif num=='048':
  s=s.replace('usePage, useQuery,','usePage, useQueryResult,').replace('const role = useQuery(api.myRole, {});','const {data: role, why} = useQueryResult(api.myRole, {});')
  a=s.index('    {"denied" in role');b=s.index('  </main>;',a)
  s=s[:a]+'    {why ? <p role="alert">Not available: {why.message}</p> : role === undefined ? <p>Loading your role…</p> : role === null ? <JoinScreen /> : role.role === "engineer" ? <EngineerScreen /> : role.role === "chief" ? <ChiefScreen /> : role.role === "contractor" ? <ContractorScreen /> : <ManagerScreen />}\n'+s[b:]
 else:
  s=s.replace('useQuery, useMutation, matchRead, otherwiseAll','useQueryResult, useMutation').replace('useQuery(', 'useQueryResult(')
  # Existing present callbacks are single-line expressions in this evidence app.
  pattern=r'matchRead\((\w+), \{\s*present: (\w+) => (.*?),?\s*\.\.\.otherwiseAll\(\(\) => (<Text>.*?</Text>)\),?\s*\}\)'
  def rewrite(m):
   name,param,expr,loading=m.groups();expr=expr.rstrip(',')
   expr=re.sub(r'\b'+param+r'\b',name+'.data',expr)
   return f'{name}.why ? <Text accessibilityRole="alert">{{{name}.why.message}}</Text> : {name}.data === undefined ? {loading} : ({expr})'
  s=re.sub(pattern,rewrite,s)
  s=re.sub(r'matchRead\((\w+), \{ present: renderReports, \.\.\.otherwiseAll\(\(\) => <Text>Loading…</Text>\) \}\)',lambda m:f'{m[1]}.why ? <Text accessibilityRole="alert">{{{m[1]}.why.message}}</Text> : {m[1]}.data === undefined ? <Text>Loading…</Text> : renderReports({m[1]}.data)',s)
  assert 'matchRead' not in s,s
 p.write_text(s)
 evidence=report/('rewrite-'+num+'.tsx');evidence.write_text(s)
 print(num,'screen',before,'->',sum(bool(l.strip()) for l in s.splitlines()),'copy',out)
