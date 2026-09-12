#!/usr/bin/env python3
"""Read-only collection verification; launches no benchmark, browser or server."""
import pathlib,json,hashlib,gzip,re,sys,urllib.parse
root=pathlib.Path(__file__).resolve().parent
errors=[];findings=[];links=[]
selection=json.loads((root/'collection-selection.json').read_text())
for row in selection['files']:
 f=root/row['path'];raw=f.read_bytes()
 if hashlib.sha256(raw).hexdigest()!=row['publicSha256']:errors.append(row['path']+':public-hash')
 source=gzip.decompress(raw) if row['transform'].startswith('gzip') else raw
 if hashlib.sha256(source).hexdigest()!=row['sourceSha256']:errors.append(row['path']+':source-hash')
for name,row in json.loads((root/'evidence-manifest.json').read_text())['files'].items():
 if hashlib.sha256((root/name).read_bytes()).hexdigest()!=row['sha256']:errors.append(name+':original-seal')
manifest=root/'collection-manifest.json'
if manifest.exists():
 for row in json.loads(manifest.read_text())['publicFiles']:
  if hashlib.sha256((root/row['path']).read_bytes()).hexdigest()!=row['sha256']:errors.append(row['path']+':collection-hash')
rules={
 'private-key':r'-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----',
 'openai-anthropic-key':r'\bsk-(?:ant-)?[A-Za-z0-9_-]{24,}',
 'github-token':r'\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})',
 'aws-access-key':r'\b(?:AKIA|ASIA)[A-Z0-9]{16}\b',
 'google-api-key':r'\bAIza[A-Za-z0-9_-]{30,}',
 'slack-token':r'\bxox[baprs]-[A-Za-z0-9-]{20,}',
 'jwt':r'\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{16,}\b',
 'bearer-value':r'\bBearer[ \t]+[A-Za-z0-9._~-]{24,}',
 'literal-secret-assignment':r'(?i)[\x22\x27](?:access_token|refresh_token|session_token|api_key|client_secret)[\x22\x27]\s*[:=]\s*[\x22\x27]([A-Za-z0-9_./+=~-]{24,})[\x22\x27]'
}
checked=0;decoded_bytes=0
for f in sorted(root.rglob('*')):
 if not f.is_file():continue
 rel=str(f.relative_to(root));parts=f.relative_to(root).parts
 if any(x in {'node_modules','.snapback3','browser-profile','Default','sessions','auth'} for x in parts) or any(x in f.name.lower() for x in ['.sqlite','.db-wal','.db-shm','raw-model','model-stream']):errors.append(rel+':excluded-path')
 raw=f.read_bytes()
 if raw.startswith(b'SQLite format 3'):errors.append(rel+':sqlite-header')
 if f.suffix=='.gz':raw=gzip.decompress(raw)
 checked+=1;decoded_bytes+=len(raw)
 try:text=raw.decode('utf-8')
 except UnicodeDecodeError:errors.append(rel+':unexpected-binary');continue
 for name,pattern in rules.items():
  for match in re.finditer(pattern,text):findings.append({'path':rel,'rule':name,'offset':match.start()})
 if f.suffix=='.md':
  text=re.sub(r'\x60{3}[\s\S]*?\x60{3}','',text)
  for target in re.findall(r'\[[^\]]*\]\(([^)]+)\)',text):
   clean=target.split('#',1)[0]
   if not clean or urllib.parse.urlparse(clean).scheme:continue
   exists=(f.parent/urllib.parse.unquote(clean.strip('<>'))).resolve().exists()
   links.append({'from':rel,'target':target,'exists':exists})
   if not exists:errors.append(rel+':broken-link:'+target)
run=json.loads((root/'run.json').read_text())
assert run['status']=='complete-exact-10000-instrumented'
assert run['verification']['expected']==10000 and run['verification']['missing']==run['verification']['extras']==[]
assert not any(x['sameProcessPresent'] for x in run['stoppedOwnedProcesses'])
report={'status':'pass' if not errors and not findings else 'fail','mode':'read-only verification; no experiment','errors':errors,'secretScan':{'method':'High-confidence credential patterns and excluded-path/SQLite checks, including decompressed source seed; not a guarantee that all conceivable secret formats are recognized.','rules':list(rules),'files':checked,'decodedBytes':decoded_bytes,'findings':findings},'markdownLinks':links,'selectedSourceFiles':len(selection['files']),'originalEvidenceSealVerified':True,'diagnosticModel':'gpt-5.6-sol','diagnosticEffort':'high'}
print(json.dumps(report,indent=2))
sys.exit(0 if report['status']=='pass' else 1)
