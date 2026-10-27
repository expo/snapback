import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
const log=readFileSync('/tmp/dx16-final-affected.log','utf8');
for(const message of ['[check-generated-artifacts] ok: review manifests, ignored caches, and committed projections are current','[check-inventories] PASS:','[guide-check] ok — 22 passed, 0 failed, 0 skipped, 0 preconditions','ref-check: ok']){
 if(!log.includes(message))throw Error('Prior root check missing: '+message);
}
const changed=execFileSync('git',['diff','--name-only','ceb35d8526','HEAD'],{encoding:'utf8'}).trim().split('\n').filter(Boolean);
const rootChanges=changed.filter(path=>!path.startsWith('snapback4/')&&!path.startsWith('llp/reviews/')&&path!=='WORKSTREAM-REPORT.md');
if(rootChanges.length)throw Error('Root semantic inputs changed: '+rootChanges);
console.log('Reuse passed root generated/inventory/guide checks: root semantic inputs unchanged. Current product checks run separately.');
