// Measurement-only opt-in adaptation: preserve every assertion and await known async entry calls.
import ts from '../../node_modules/typescript/lib/typescript.js';
import {readFileSync,writeFileSync} from 'node:fs';
const file=process.argv[2],runner=process.argv[3];
const source=readFileSync(file,'utf8');
const ast=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
const imports=ast.statements.filter(ts.isImportDeclaration);
const body=ast.statements.filter(s=>!ts.isImportDeclaration(s));
if(body.some(s=>s.modifiers?.some(m=>m.kind===ts.SyntaxKind.ExportKeyword)))throw Error('exported module is not an entry suite');
const start=imports.length?imports.at(-1).end:0;
if(body.some(s=>s.pos<start && s.end<=start))throw Error('interleaved executable imports need explicit adaptation');
const asyncNames=new Set(body.filter(ts.isFunctionDeclaration).filter(s=>s.modifiers?.some(m=>m.kind===ts.SyntaxKind.AsyncKeyword)).map(s=>s.name?.text));
const edits=[];let awaitedEntries=0;
for(const statement of body) {
 if(!ts.isExpressionStatement(statement))continue;
 let expr=statement.expression;
 while(ts.isCallExpression(expr) && ts.isPropertyAccessExpression(expr.expression) && ['catch','then','finally'].includes(expr.expression.name.text)) expr=expr.expression.expression;
 if(ts.isCallExpression(expr) && ts.isIdentifier(expr.expression) && asyncNames.has(expr.expression.text)) {
  edits.push([statement.getStart(ast),'await ']);awaitedEntries++;
 }
 // An async IIFE is also an explicit entry; await its complete promise chain.
 else if(ts.isCallExpression(expr) && ts.isParenthesizedExpression(expr.expression) && [ts.SyntaxKind.ArrowFunction,ts.SyntaxKind.FunctionExpression].includes(expr.expression.expression.kind) && expr.expression.expression.modifiers?.some(m=>m.kind===ts.SyntaxKind.AsyncKeyword)){
  edits.push([statement.getStart(ast),'await ']);awaitedEntries++;
 }
}
// Keep source line numbers and import order. No authored test/cleanup is removed.
const done=`process.__lat4Done?.();`;
edits.push([start,`;import {runProofSuite as __lat4Suite} from ${JSON.stringify(runner)};await __lat4Suite(async()=>{try{`]);
let output=source;for(const[index,text]of edits.sort((a,b)=>b[0]-a[0]))output=output.slice(0,index)+text+output.slice(index);
output+=`\n}finally{${done}}});\n`;
writeFileSync(file,output);
console.log(JSON.stringify({file,awaitedEntries}));
