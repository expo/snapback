import pathlib,tarfile,hashlib,json,shutil,subprocess,os
root=pathlib.Path.cwd();dest=root/'target/wd/audited';dest.mkdir(exist_ok=True)
archive=pathlib.Path.home()/'sb4-np/evidence-archive/20261001-nx-export-proves-native/blobs'
rows=[]
for name,sha in [('snapback4','b8fe95888b0535164990b43d9516b84d96df8b3933a1a077cbafd6082a67ffad'),('snapback4-expo','c01c01d6aa4ce537aafce02fa1cdb1e7f92de55765a53084079cf8e626b84191')]:
 src=archive/sha;assert hashlib.sha256(src.read_bytes()).hexdigest()==sha
 (dest/'packages').mkdir(exist_ok=True);out=dest/'packages'/f'{name}-0.4.11.tgz';shutil.copyfile(src,out);rows.append({'name':name,'sha256':sha,'archive':str(src)})
for starter,sha in [('plain','92b6e2289035ce722a1d967d67366dc311d42c39592340a18be3fc3fefeea670'),('social','f6dc740652f2dec946a872c43875aeab8aca6796d76856b257e495b43c123f07')]:
 src=archive/sha;assert hashlib.sha256(src.read_bytes()).hexdigest()==sha
 project=dest/starter;project.mkdir(exist_ok=True)
 with tarfile.open(src) as tar:
  for member in tar.getmembers():
   path=pathlib.PurePosixPath(member.name)
   assert not path.is_absolute() and '..' not in path.parts
   assert not member.issym() and not member.islnk()
  tar.extractall(project)
 rows.append({'name':starter,'sha256':sha,'archive':str(src)})
 env=dict(os.environ,PATH='/Users/ccheever/.volta/tools/image/node/24.18.0/bin:'+os.environ['PATH'])
 with (root/'target/wd'/f'audited-{starter}-install.log').open('w') as log:
  subprocess.run(['npm','ci','--ignore-scripts','--no-audit','--no-fund'],cwd=project,env=env,stdout=log,stderr=log,check=True)
 # Clone only our own completed dependency-download caches, never another lane.
 cache=project/'.snapback4-witness';cache.mkdir(exist_ok=True)
 for folder in ['pods-cache','pods-home']:
  subprocess.run(['cp','-cR',str(root/'target/wd'/starter/'.snapback4-witness'/folder),str(cache/folder)],check=True)
 subprocess.run([str(root/'target/wd/baseline-production'),'check'],cwd=project,check=True)
(root/'reports/20261003-wd-witness-cleanup-deadline/audited-starter-restoration.json').write_text(json.dumps(rows,indent=2)+'\n')
