import json,gzip,re,pathlib,collections,hashlib
before=json.load(gzip.open('snapback4/reports/wave15-day5/before.json.gz'));after=json.loads(pathlib.Path('/tmp/day5-survey-results/after.json').read_text())
assert set(before)==set(after)
def lines(s):
 s=re.sub(r'\x1b\[[0-9;]*m','',s)
 s=re.sub(r'/tmp/day5-survey/(before|after)/[^/\s]+','<app>',s)
 s=re.sub(r'\b\d+(?:\.\d+)? ms\b','<ms>',s)
 s=re.sub(r'http://127\.0\.0\.1:\d+','<registry>',s)
 out=[]
 for line in s.splitlines():
  line=line.strip()
  if not line or re.match(r'^(added|removed|changed|audited|up to date|found \d|\d+ packages? |run `npm fund|npm (warn|notice|error)|To address|Run `npm audit|\d+ (low|moderate|high|critical)|\d+ vulnerabilities|\d+ (packages|package) are)',line):continue
  if line.startswith(('https://','npm audit','npm install','npm ERR!')):continue
  # Keep every product line, including multi-line planned paths and command hints.
  out.append(line)
 return out

def why(line,kind,command):
 if 'info: starter:' in line:return 'R2: use a neutral review heading because recognized older starter bytes can be age advice rather than a schema mismatch.'
 if 'src/native-smoke.ts' in line or 'older starter version' in line or "previous schema's sign-in" in line:return 'R2: distinguish recognized older helper bytes from actual identity/schema mismatch; keep application-owned edits unchanged.'
 if 'not saved yet' in line or 'cannot read saved' in line or 'E_IO' in line:return 'R7: absent/empty saved source is unsaved evidence; actual readable-source drift stays a warning.'
 if any(t in line.lower() for t in ['assert.fail','placeholder','todo starter','todo snapshot','digest','sha256','npx']):return 'P14: identify inherited proof/snapshot bytes and weak spawned-tool evidence; no custom-file ownership inferred.'
 if 'legacy' in line or re.search(r'versions/v[12]\.q',line):return 'C8: preserve legacy flat evidence and name differences from saved directory sources.'
 if any(t in line for t in ['package.json','starter.day2','marker','sort','format','script','README','frontend-proof','fixtures/todos','fixtures/test.cases','versions/v1','versions/v2','App.tsx','src/client.ts']):return 'C4 / schema-adapted starter: preview every managed metadata/file mutation; remove only recognized todo proof, fixture and README leftovers; preserve custom files.'
 if 'release' in line or 'rollback' in line:return '#9: group compatibility facts and lead with removed guard/refusal evidence; index internals remain verbose.'
 if command=='upgrade':return 'Upgrade runs the final packed installed check; changed project advice reflects the same DAY5 starter/evidence classification as check.'
 if command=='adapt':return 'Adapt now names all planned managed mutations and files requiring builder review.'
 return 'Final compiler advice reflects DAY5 evidence classification. Full normalized before/after output is retained for inspection.'
rows=[];md=['# Wave 15 DAY5 advice delta','', 'All 50 even-numbered lanes were copied; originals remained read-only. `check`, `init --adapt` preview and `upgrade --to 0.4.31` ran before and after. The after registry served the final DAY5 client/platform pack under the unchanged integration version. Durations, scratch roots and private registry ports are normalized; npm install/funding/audit chatter is omitted. Full command output is retained in before.json.gz and after.json.gz.','']
for lane in sorted(before):
 md+=['## '+lane,'']
 for command in ['check','adapt','upgrade']:
  b=lines(before[lane][command]['output']);a=lines(after[lane][command]['output'])
  gone=list((collections.Counter(b)-collections.Counter(a)).elements());new=list((collections.Counter(a)-collections.Counter(b)).elements())
  row={'lane':lane,'command':command,'beforeCode':before[lane][command]['code'],'afterCode':after[lane][command]['code'],'disappeared':[{'line':x,'why':why(x,'gone',command)} for x in gone],'appeared':[{'line':x,'why':why(x,'new',command)} for x in new]};rows.append(row)
  md+=['### '+command+f" (exit {row['beforeCode']} → {row['afterCode']})",'']
  if not gone and not new:md+=['No advice line changed.',''];continue
  for label,key in [('Disappeared','disappeared'),('Appeared','appeared')]:
   if not row[key]:continue
   md+=[label+':','']
   for entry in row[key]:md+=['- '+json.dumps(entry['line'],ensure_ascii=False)+' — '+entry['why']]
   md+=['']
pathlib.Path('/tmp/day5-advice-delta.json').write_text(json.dumps(rows,indent=2)+'\n');pathlib.Path('/tmp/day5-advice-delta.md').write_text('\n'.join(md)+'\n')
print('lanes',len(before),'command comparisons',len(rows),'changed',sum(bool(r['disappeared'] or r['appeared']) for r in rows))
