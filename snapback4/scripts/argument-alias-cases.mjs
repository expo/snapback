// @ref LLP 3000.000.000#195-argument-aliases-and-review-evidence — old wire names remain value-preserving inputs across hot release and packed CLI paths.
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';

export async function argumentAliasCases({cli,startServe},parent) {
  const cwd=mkdtempSync(join(parent,'argument-alias-cases-'));
  let host;
  try {
    mkdirSync(join(cwd,'snapback'));
    const deployment=join(cwd,'deployment'),schema=join(cwd,'snapback/schema.q');
    const invoke=args=>cli(args,{cwd,timeoutMs:60_000});
    const run=async args=>{const result=await invoke(args);assert.equal(result.code,0,result.stderr+result.stdout);return result;};
    const v1=`use identity guests
table notes:
  body: text 1..500
  public 'argument alias proof'
  insert <- allow
mutation remember(reason: text 1..500, obsolete: text <=20 deprecated):
  return insert notes {body:reason}
query inspect(reason: text 1..500):
  return reason
query fallback(reason: text 1..500 ? default 'default'):
  return reason
query list():
  return notes first 20 by .id
`;
    const v2=v1
      .replace('remember(reason: text 1..500,','remember(explanation: text 1..500 alias reason,')
      .replace('{body:reason}','{body:explanation}')
      .replace('inspect(reason: text 1..500):\n  return reason','inspect(explanation: text 1..500 alias reason):\n  return explanation')
      .replace("fallback(reason: text 1..500 ? default 'default'):\n  return reason","fallback(explanation: text 1..500 ? default 'default' alias reason):\n  return explanation");
    writeFileSync(schema,v1);await run(['deploy',deployment]);
    host=await startServe(deployment,{cwd,timeoutMs:60_000});
    const auth=await (await fetch(host.url+'/auth/guest',{method:'POST',body:'{}',signal:AbortSignal.timeout(30_000)})).json();
    assert.ok(auth.session?.token,JSON.stringify(auth));
    const headers={'content-type':'application/json',authorization:'Bearer '+auth.session.token};
    const post=async(path,args={})=>(await fetch(host.url+path,{method:'POST',headers,body:JSON.stringify({args}),signal:AbortSignal.timeout(30_000)})).json();
    assert.equal((await post('/q/inspect',{reason:'v1 caller'})).data,'v1 caller');
    writeFileSync(schema,v2);
    const preview=JSON.parse((await run(['deploy',deployment,'--check','--json'])).stdout);
    assert.deepEqual(preview.clientCompatibility,[],JSON.stringify(preview));
    await run(['deploy',deployment]);
    assert.equal((await post('/q/inspect',{reason:'old spelling'})).data,'old spelling');
    assert.equal((await post('/q/inspect',{explanation:'canonical spelling'})).data,'canonical spelling');
    for (const values of [{reason:'same',explanation:'same'},{reason:'old',explanation:'new'}]) {
      const denied=await post('/q/inspect',values);
      assert.equal(denied.denied?.code,'E_INPUT',JSON.stringify(denied));
    }
    const duplicateMutation=await post('/m/remember',{reason:'same',explanation:'same'});
    assert.equal(duplicateMutation.denied?.code,'E_INPUT',JSON.stringify(duplicateMutation));
    assert.equal((await post('/q/fallback',{})).data,'default');
    assert.equal((await post('/q/fallback',{reason:null})).data,'default');
    const remembered=await post('/m/remember',{reason:'mapped without loss',obsolete:'ignored'});
    assert.equal(remembered.state,'sent',JSON.stringify(remembered));
    assert.equal((await post('/q/list')).data[0].body,'mapped without loss');
    const metadata=await (await fetch(host.url+'/',{headers,signal:AbortSignal.timeout(30_000)})).json();
    assert.deepEqual(metadata.ops.find(op=>op.name==='inspect').aliases,{reason:'explanation'});
    assert.ok(metadata.device_compatibility.capabilities.includes('argument-alias-v1'),JSON.stringify(metadata.device_compatibility));
    await run(['check']);
    const generated=readFileSync(join(cwd,'snapback/generated/api.ts'),'utf8');
    assert.match(generated,/\{ explanation: string; reason\?: never \} \| \{ explanation\?: never; reason: string \}/);
    const cliOld=JSON.parse((await run(['run','inspect','{"reason":"cli mapped"}','--as','alice','--json'])).stdout);
    assert.equal(cliOld.data,'cli mapped');
    const cliBoth=await invoke(['run','inspect','{"reason":"same","explanation":"same"}','--as','alice','--json']);
    assert.equal(cliBoth.code,1,cliBoth.stderr+cliBoth.stdout);
    assert.match(cliBoth.stderr,/E_INPUT/);
    return {status:'passed',oldQuery:true,oldMutation:true,bothNamesRefused:true,defaultNullPreserved:true,metadataAlias:true,generatedXor:true,cliDecoder:true};
  } finally {
    try {await host?.stop();} finally {rmSync(cwd,{recursive:true,force:true});}
  }
}
