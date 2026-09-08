import assert from 'node:assert/strict';
import { writeFileSync, readFileSync, realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';
import { checkPublishedDeclarations } from './published-declaration-consumer.ts';
const project=resolve(process.argv[2]);
const packageRoot=resolve('node_modules/snapback2');
const evidence={typescript:ts.version,packageRoot,public:[],standalone:[],generated:[]};
for(const kind of ['public','standalone']) {
 await checkPublishedDeclarations(kind,{packageRoot,observe(program,diagnostics){
  evidence[kind]={diagnostics:diagnostics.map(d=>({code:d.code,message:ts.flattenDiagnosticMessageText(d.messageText,'\n')})),sourceFiles:program.getSourceFiles().map(f=>f.fileName),skipLibCheck:program.getCompilerOptions().skipLibCheck};
 }});
}
for(const [name,expression] of [['add','result.row'],['merged','result[0]!']]) {
 const file=resolve(project,`type-${name}.ts`);
 const source=`import {api} from 'snapback2/client';
type Result = NonNullable<(typeof api.todos.${name})['__result']>;
declare const result: Result;
const row = ${expression};
const done: boolean = row.done;
// @ts-expect-error Boolean result must reject a number assignment
const wrong: number = row.done;
type IsAny<T> = 0 extends (1 & T) ? true : false;
const rowIsNotAny: IsAny<typeof row> = false;
`;
 writeFileSync(file,source);
 const options={module:ts.ModuleKind.ESNext,moduleResolution:ts.ModuleResolutionKind.Bundler,target:ts.ScriptTarget.ES2022,noEmit:true,strict:true,skipLibCheck:false,types:[],lib:['lib.es2022.d.ts','lib.dom.d.ts']};
 const program=ts.createProgram({rootNames:[file,resolve(project,'.snapback/build/api.d.ts')],options});
 const diagnostics=ts.getPreEmitDiagnostics(program);
 const record={name,skipLibCheck:false,diagnostics:diagnostics.map(d=>({file:d.file?.fileName,code:d.code,message:ts.flattenDiagnosticMessageText(d.messageText,'\n')})),sourceFiles:program.getSourceFiles().map(f=>f.fileName)};
 evidence.generated.push(record);
 writeFileSync('type-evidence.json',JSON.stringify(evidence,null,2)+'\n');
 assert.equal(diagnostics.length,0,JSON.stringify(record.diagnostics));
 const checker=program.getTypeChecker();const sf=program.getSourceFile(file);
 const declarations=sf.statements.filter(ts.isVariableStatement).flatMap(s=>s.declarationList.declarations);
 const row=declarations.find(d=>d.name.getText()==='row');const done=declarations.find(d=>d.name.getText()==='done');const isAny=declarations.find(d=>d.name.getText()==='rowIsNotAny');
 assert.equal(checker.getTypeAtLocation(row.name).flags & ts.TypeFlags.Any,0);
 assert.equal(checker.typeToString(checker.getTypeAtLocation(done.initializer)),'boolean');
 assert.equal(checker.typeToString(checker.getTypeAtLocation(isAny.name)),'false');
 record.preciseBoolean=true;record.rowNotAny=true;record.isAnyFalse=true;
 // Independently remove the expectation and require the actual incompatible-assignment diagnostic.
 const negative=file.replace('.ts','-negative.ts');writeFileSync(negative,source.replace('// @ts-expect-error Boolean result must reject a number assignment\n',''));
 const negativeProgram=ts.createProgram({rootNames:[negative,resolve(project,'.snapback/build/api.d.ts')],options});
 const nd=ts.getPreEmitDiagnostics(negativeProgram);
 record.negativeDiagnostics=nd.map(d=>({code:d.code,message:ts.flattenDiagnosticMessageText(d.messageText,'\n')}));
 assert.equal(nd.length,1,JSON.stringify(record.negativeDiagnostics));assert.equal(nd[0].code,2322);assert.match(record.negativeDiagnostics[0].message,/boolean.*number/);
}
evidence.passed=true;writeFileSync('type-evidence.json',JSON.stringify(evidence,null,2)+'\n');
console.log(JSON.stringify({passed:true,typescript:ts.version,publicFiles:evidence.public.sourceFiles.length,standaloneFiles:evidence.standalone.sourceFiles.length,generated:evidence.generated.map(x=>({name:x.name,files:x.sourceFiles.length,diagnostics:x.diagnostics,negativeDiagnostics:x.negativeDiagnostics,preciseBoolean:x.preciseBoolean,rowNotAny:x.rowNotAny}))}));
