import ts from '../../../node_modules/typescript/lib/typescript.js';
import {readFileSync,writeFileSync} from 'node:fs';
const file='packages/snapback4/src/local.ts', source=readFileSync(file,'utf8');
const config=ts.readConfigFile('packages/snapback4/tsconfig.json',ts.sys.readFile);
const parsed=ts.parseJsonConfigFileContent(config.config,ts.sys,'packages/snapback4');
const program=ts.createProgram(parsed.fileNames,parsed.options),checker=program.getTypeChecker(),tree=program.getSourceFile(file);
const names=new Set(['call','syncRound','probe','onlineEvidence','waitOnlineChange','waitForChange','follow','sendPost','refusePartition','flush','retryFlush','flushOnce','replayOnOpen','listenForExit']);
const nodes=[];function find(n){if(ts.isFunctionDeclaration(n)&&names.has(n.name?.text))nodes.push(n);else ts.forEachChild(n,find)}find(tree);
const inside=n=>nodes.some(s=>n.pos>=s.pos&&n.end<=s.end);
const top=tree.statements.find(s=>ts.isFunctionDeclaration(s)&&s.name?.text==='createLocalClient');
const free=new Map();
function symbol(n){return ts.isShorthandPropertyAssignment(n.parent)?checker.getShorthandAssignmentValueSymbol(n.parent):checker.getSymbolAtLocation(n)}
function isReference(n){return ts.isIdentifier(n)&&!(ts.isPropertyAccessExpression(n.parent)&&n.parent.name===n)&&!(ts.isPropertyAssignment(n.parent)&&n.parent.name===n)&&!(ts.isDeclarationName(n));}
// A declaration's shorthand name is a value reference, not a declaration to move.
function eligible(n){return (isReference(n)||ts.isShorthandPropertyAssignment(n.parent))&&symbol(n)?.declarations?.some(d=>d.getSourceFile()===tree&&d.pos>top.pos&&!inside(d));}
for(const node of nodes){function visit(n){if(eligible(n)){const sym=symbol(n);free.set(sym,n);}ts.forEachChild(n,visit)}visit(node)}
const entries=[...free].map(([sym,n])=>{const decl=sym.valueDeclaration??sym.declarations[0];const type=checker.typeToString(checker.getTypeOfSymbolAtLocation(sym,decl),decl,ts.TypeFormatFlags.NoTruncation|ts.TypeFormatFlags.UseAliasDefinedOutsideCurrentScope);const mutable=ts.isVariableDeclaration(decl)&&!(decl.parent.flags&ts.NodeFlags.Const);return {sym,name:sym.name,type,mutable}}).sort((a,b)=>a.name.localeCompare(b.name));
const extracted=nodes.map(node=>{const edits=[];function visit(n){if(eligible(n)){const e=entries.find(e=>e.sym===symbol(n));if(e)edits.push({start:n.getStart()-node.getFullStart(),end:n.end-node.getFullStart(),text:ts.isShorthandPropertyAssignment(n.parent)?`${e.name}: env.${e.name}`:`env.${e.name}`});}ts.forEachChild(n,visit)}visit(node);let text=node.getFullText();for(const edit of edits.sort((a,b)=>b.start-a.start))text=text.slice(0,edit.start)+edit.text+text.slice(edit.end);return text;}).join('\n');
const imports=tree.statements.filter(ts.isImportDeclaration).map(s=>s.getText()).join('\n');
const output=`// Delivery and sync use the owning client's live state through accessors.\n// No second owner, queue, watermark or cached state is introduced by this split.\n${imports}\nconst PAGE = 10000;\nexport interface LocalRuntimeContext {\n${entries.map(e=>`  ${e.mutable?'':'readonly '}${e.name}: ${e.type};`).join('\n')}\n}\nexport function localRuntime(env: LocalRuntimeContext) {\n${extracted}\n  return { ${[...names].join(', ')} };\n}\n`;
writeFileSync('packages/snapback4/src/local-runtime.ts',output);
let result=source;for(const node of [...nodes].reverse()){const header=node.getText().slice(0,node.body.getStart()-node.getStart()).replace(/^async /,'');const args=node.parameters.map(p=>p.name.getText()).join(', ');const wrapper=`${header}{ return runtime.${node.name.text}(${args}); }`;result=result.slice(0,node.getStart())+wrapper+result.slice(node.end);}
const accessors=entries.map(e=>`    get ${e.name}() { return ${e.name}; }${e.mutable?` , set ${e.name}(value) { ${e.name} = value; }`:''},`).join('\n');
result='import { localRuntime, type LocalRuntimeContext } from "./local-runtime.ts";\n'+result;
result=result.replace('  let custodyEntries: Queued[] = [];',`  const runtime = localRuntime({\n${accessors}\n  } satisfies LocalRuntimeContext);\n  let custodyEntries: Queued[] = [];`);
writeFileSync(file,result);console.log(`split ${nodes.length} functions, ${entries.length} live context fields; local.ts ${result.split('\n').length-1} lines; local-runtime.ts ${output.split('\n').length-1} lines`);
