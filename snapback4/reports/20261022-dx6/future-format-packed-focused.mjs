import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,copyFileSync,rmSync,existsSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {proveDX6FutureStore} from '../../scripts/publication-dx6.mjs';
const parent=resolve(process.argv[2]??'reports/20261022-dx6/qualification-final/day2-compatibility');
const source=join(parent,'deployment/store.sqlite');
const digest=()=>createHash('sha256').update(readFileSync(source)).digest('hex');
const before=digest(),scratch=mkdtempSync(join(parent,'dx6-future-fixture-'));let result;
try {
 const release=join(scratch,'release');mkdirSync(release,{mode:0o700});
 for(const name of ['store.sqlite-owner','current'])copyFileSync(join(parent,'deployment',name),join(release,name));
 const copy=spawnSync('python3',['-c',`import sqlite3,sys
source=sqlite3.connect('file:'+sys.argv[1]+'?mode=ro',uri=True)
copy=sqlite3.connect(sys.argv[2])
try:
 source.backup(copy)
 copy.execute("UPDATE _meta SET value=? WHERE key='version'",('snapback4-release-store-99',))
 copy.commit()
finally:
 copy.close()
 source.close()
`,source,join(release,'store.sqlite')],{encoding:'utf8',timeout:30000});
 assert.equal(copy.error,undefined);assert.equal(copy.signal,null);assert.equal(copy.status,0,'private backup must succeed');
 result=await proveDX6FutureStore(parent,release);
 assert.equal(digest(),before,'retained source must remain byte-identical');
}finally{rmSync(scratch,{recursive:true,force:true});}
assert.equal(existsSync(scratch),false);
const report={...result,installedSDK:JSON.parse(readFileSync(join(parent,'node_modules/snapback4/package.json'))).version,installedPlatform:JSON.parse(readFileSync(join(parent,'node_modules/snapback4-linux-x64/package.json'))).version,sourceStoreUnchanged:true,scratchRemoved:true};
writeFileSync(new URL('./future-format-packed-focused.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
