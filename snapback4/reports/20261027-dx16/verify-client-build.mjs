import{readFileSync}from'node:fs';
import{execFileSync}from'node:child_process';
const log=readFileSync('/tmp/dx16-guide-style4.log','utf8');
if(!log.includes('guide api proof: 1366/3000 tokens')||!log.includes('test result: ok. 131 passed; 0 failed;'))throw Error('SDK build / following guide suite did not pass');
const changed=execFileSync('git',['diff','--name-only','a2c5f5137b','HEAD','--','snapback4/packages/snapback4/src','snapback4/packages/snapback4/scripts','snapback4/packages/snapback4/tsconfig.json','snapback4/packages/snapback4/tsconfig.build.json','snapback4/crates/snapback4/src/verbs/init/social'],{encoding:'utf8'}).trim();
if(changed)throw Error('SDK build inputs changed: '+changed);
console.log('Reuse the successful SDK build before guide 131/131: all SDK/recipe inputs unchanged; avoid touching generated guide mtimes during production compilation.');
