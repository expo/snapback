import{readFileSync,writeFileSync}from'node:fs';import{execFileSync}from'node:child_process';import{createHash}from'node:crypto';
const l=JSON.parse(readFileSync('/tmp/dx17/evidence/before-11-launch.json')),env={...process.env,npm_config_registry:l.registry};delete env.SNAPBACK4_BIN;
const file='/tmp/dx17/evidence/before-11-verification.json',prior=JSON.parse(readFileSync(file));if(prior.probeServe)throw Error('refuse to overwrite an existing probe measurement');
execFileSync('npm',['install','--ignore-scripts','--no-audit','--no-fund'],{cwd:l.dir,env,stdio:'inherit',timeout:600_000});
const expected=JSON.parse(readFileSync(l.dir+'/.harness/installed-package.json'));const actual=createHash('sha256').update(readFileSync(l.dir+'/node_modules/snapback4-linux-x64/snapback4')).digest('hex');if(actual!==expected.binarySha256)throw Error('restored baseline binary changed');
execFileSync('npm',['run','frontend:proof'],{cwd:l.dir,env,stdio:'inherit',timeout:600_000});
execFileSync(process.execPath,['/tmp/dx17/augment-probe.mjs','before','11'],{env,stdio:'inherit',timeout:600_000});
const data=JSON.parse(readFileSync(file));data.supplementalProbe={reason:'Missing original baseline probe observation, not a red rerun; restored removed dependencies/frontend with identical native binary.',at:new Date().toISOString(),binarySha256:actual};writeFileSync(file,JSON.stringify(data,null,2));
