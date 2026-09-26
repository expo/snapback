# Registry metadata and the downloaded tarballs equal the staged, qualified bytes.
from pathlib import Path
import json,hashlib,base64,subprocess,urllib.request,sys,datetime
root=Path.cwd(); r=root/'reports/20260926-publication-0.4.3'
if sys.argv[1]=='cli':
 stage=json.loads((root/'target/publication/snapback4-darwin-arm64-0.4.3/resume.json').read_text())
 artifacts=[stage['platformArtifact'],stage['client']]
 directory=root/'target/publication/snapback4-darwin-arm64-0.4.3'
else:
 artifacts=[json.loads((r/'expo-staged.json').read_text())];directory=root/'target/expo-0.4.3'
records=[]
for a in artifacts:
 dist=json.loads(subprocess.check_output(['npm','view',a['name']+'@0.4.3','dist','--json'],text=True))
 assert dist['integrity']==a['integrity'], (a['name'],dist['integrity'],a['integrity'])
 assert dist['tarball'].startswith('https://registry.npmjs.org/')
 data=urllib.request.urlopen(dist['tarball']).read();sri='sha512-'+base64.b64encode(hashlib.sha512(data).digest()).decode()
 assert sri==a['integrity']; assert data==(directory/a['filename']).read_bytes()
 records.append({'package':a['name']+'@0.4.3','bytes':len(data),'integrity':sri,'registryDist':dist,'registryMetadataMatches':True,'downloadedTarballMatches':True})
record={'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'artifacts':records}
(r/('registry-'+sys.argv[1]+'-verified.json')).write_text(json.dumps(record,indent=2)+'\n')
print(json.dumps(record,indent=2))
