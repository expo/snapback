# Registry metadata and the downloaded tarballs equal the staged, qualified bytes (format-3 stage).
from pathlib import Path
import json,hashlib,base64,subprocess,urllib.request,sys,datetime
root=Path.cwd(); r=root/'reports/20261022-publication-0.4.37'
if sys.argv[1]=='cli':
 directory=root/'target/publication/snapback4-darwin-arm64-0.4.37'
 stage=json.loads((directory/'resume.json').read_text())
 assert stage['format']==3 and [p['name'] for p in stage['platforms']]==['snapback4-darwin-arm64','snapback4-linux-x64'], stage.get('platforms')
 artifacts=stage['platforms']+[stage['client']]
else:
 artifacts=[json.loads((r/'expo-staged.json').read_text())];directory=root/'target/expo-0.4.37'
records=[]
for a in artifacts:
 dist=json.loads(subprocess.check_output(['npm','view',a['name']+'@0.4.37','dist','--json'],text=True))
 assert dist['integrity']==a['integrity'], (a['name'],dist['integrity'],a['integrity'])
 assert dist['tarball'].startswith('https://registry.npmjs.org/')
 data=urllib.request.urlopen(dist['tarball']).read();sri='sha512-'+base64.b64encode(hashlib.sha512(data).digest()).decode()
 assert sri==a['integrity']
 local=directory/a['filename'] if (directory/a['filename']).exists() else Path(a.get('tarball',''))
 assert data==local.read_bytes(), (a['name'], str(local))
 records.append({'package':a['name']+'@0.4.37','bytes':len(data),'integrity':sri,'registryDist':dist,'registryMetadataMatches':True,'downloadedTarballMatches':True})
record={'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'artifacts':records}
(r/('registry-'+sys.argv[1]+'-verified.json')).write_text(json.dumps(record,indent=2)+'\n')
print(json.dumps(record,indent=2))
