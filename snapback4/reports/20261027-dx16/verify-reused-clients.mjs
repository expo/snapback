import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
const log=readFileSync('/tmp/dx16-client-scope.log','utf8');
if(!log.includes('-- client files: 10/10; failed 0; tests {"tests":101,"pass":101,"fail":0'))throw Error('Prior 101-test receipt missing');
const files=execFileSync('git',['ls-files','packages/snapback4/src/proof*.ts'],{encoding:'utf8'}).trim().split('\n');
const compile=source=>ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,removeComments:true}}).outputText;
for(const file of files){
 const old=execFileSync('git',['show','c6fd5e6638:snapback4/'+file],{encoding:'utf8'});
 if(compile(old)!==compile(readFileSync(file,'utf8')))throw Error('Proof runtime changed: '+file);
}
console.log('Reuse 10 files / 101 passing proof tests: transpiled runtime unchanged; latest CLI capture tested separately.');
