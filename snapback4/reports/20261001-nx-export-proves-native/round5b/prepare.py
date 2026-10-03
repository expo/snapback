from pathlib import Path
import subprocess,shutil,tarfile,json,hashlib,os
root=Path('/Users/ccheever/sb4-np/lane-nx/snapback4');work=Path('/Users/ccheever/sb4-np/nx-r5b')
rows=[]
for rev,commit in [('r4','e1adc01ddc'),('r5','adbabda71e')]:
    for starter in ['plain','social']:
        dest=work/f'{rev}-{starter}'
        subprocess.run(['cp','-cR',str(root/'target/nx'/starter),str(dest)],check=True)
        shutil.rmtree(dest/'artifacts')
        # Preserve the exact audited dependency snapshot, including local candidate src.
        for pkg,file in [('snapback4','bin/snapback4.js'),('snapback4-expo','export-ios.mjs')]:
            (dest/'node_modules'/pkg/file).write_bytes(subprocess.check_output(['git','show',f'{commit}:snapback4/packages/{pkg}/{file}'],cwd=root))
        if starter=='plain':
            for pkg in ['snapback4','snapback4-expo']:
                source=dest/'node_modules'/pkg; archive=work/'packages'/rev/(pkg+'-0.4.10.tgz')
                with tarfile.open(archive,'w:gz') as tar:tar.add(source,arcname='package')
                rows.append({'revision':rev,'commit':commit,'name':pkg,'archive':str(archive),'sha256':hashlib.sha256(archive.read_bytes()).hexdigest(),'bytes':archive.stat().st_size,'shape':'Exact existing audited local candidate package tree, including snapback4/src; package.json unchanged.'})
        # Install the archived bytes, not links to a changing checkout.
        for pkg in ['snapback4','snapback4-expo']:
            source=dest/'node_modules'/pkg;shutil.rmtree(source);source.mkdir()
            with tarfile.open(work/'packages'/rev/(pkg+'-0.4.10.tgz')) as tar:
                for entry in tar.getmembers():
                    entry.name=entry.name.removeprefix('package').lstrip('/')
                    if entry.name:tar.extract(entry,source)
        print('prepared',rev,starter,flush=True)
(root/'reports/20261001-nx-export-proves-native/round5b/package-trees.json').write_text(json.dumps(rows,indent=2)+'\n')
