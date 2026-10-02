// Run from snapback4/. Read declarations without importing/executing test bodies.
import ts from 'typescript';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { fileURLToPath } from 'node:url';
import { fileStallTimeout } from '../../../scripts/run-client-tests.mjs';
process.chdir(fileURLToPath(new URL('../../../', import.meta.url)));
const hangBudget = (work = 1) => 120000 + Math.max(1, work) * 2000;
const files = ['packages/snapback4/test', 'fixtures'].flatMap(dir => readdirSync(dir).filter(f=>f.endsWith('.test.mjs')).sort().map(f=>dir+'/'+f));
const rows=[];
for (const file of files) {
  const text=readFileSync(file,'utf8'), ast=ts.createSourceFile(file,text,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS), variables=new Map(), declarations=[];
  const gather=node=>{
    if(ts.isVariableDeclaration(node)&&ts.isIdentifier(node.name)&&node.initializer) variables.set(node.name.text,node.initializer.getText(ast));
    if(ts.isPropertyAssignment(node)&&node.name.getText(ast)==='timeout') declarations.push(node.initializer.getText(ast));
    if(ts.isCallExpression(node)&&node.expression.getText(ast)==='hangBudget') declarations.push(node.getText(ast));
    if(ts.isCallExpression(node)&&node.expression.getText(ast)==='withHangGuard') declarations.push(`hangBudget(${node.arguments[2]?.getText(ast)??'1'})`);
    ts.forEachChild(node,gather);
  }; gather(ast);
  const globals={hangBudget,process:{env:{}},limit:100};
  if(file.endsWith('ordinary-search-oracle.test.mjs')) {
    const start=text.indexOf('const seeds = process.env.SB4_SEARCH_SEEDS'), end=text.indexOf("for (const host of ['process', 'wasm'])",start);
    globals.oracleWork=runInNewContext(text.slice(start,end)+'\noracleWork',globals);
  }
  const candidates=file.endsWith('unread-range.test.mjs')?JSON.parse(readFileSync('crates/snapback4-device/tests/unread_range/cases.json')).map(c=>({...globals,c})):[globals];
  const evaluate=(expression,context,stack=[])=>{
    for(let i=0;i<20;i++) {
      try{return runInNewContext(expression,context,{timeout:100});}
      catch(error){
        const name=/^(.+) is not defined$/.exec(error.message)?.[1];
        if(!name||!variables.has(name)||stack.includes(name)) throw Error(`${file}: ${expression}: ${error.message}`);
        context[name]=evaluate(variables.get(name),context,[...stack,name]);
      }
    } throw Error(`unresolved guard: ${file}: ${expression}`);
  };
  const guards=[...new Set(declarations)].map(expression=>({expression,ms:Math.max(...candidates.map(c=>evaluate(expression,{...c})))}));
  const largestMs=Math.max(0,...guards.map(g=>g.ms)),stallMs=fileStallTimeout(file,{});
  if(!Number.isFinite(largestMs)||stallMs<Math.max(900000,largestMs+Math.max(60000,Math.ceil(largestMs*.25)))) throw Error(`undercovered guard: ${file}: ${largestMs} / ${stallMs}`);
  rows.push({file,largestMs,stallMs,guards});
}
writeFileSync(new URL('./guards.json',import.meta.url),JSON.stringify(rows,null,2)+'\n');
writeFileSync(new URL('./guards.tsv',import.meta.url),'file\tlargest_declared_guard_ms\tstall_bound_ms\n'+rows.map(r=>`${r.file}\t${r.largestMs}\t${r.stallMs}`).join('\n')+'\n');
console.log(`${rows.length} files: every declared guard plus margin fits its progress-stall bound`);
