// Reproducible census, retaining pre-change sites and current lines separately.
// Each row includes source text so classifications remain reviewable.
const fs=require('fs'),path=require('path'),cp=require('child_process');
const report=__dirname,root=path.resolve(report,'../..');
const ts=require(path.join(root,'node_modules/typescript'));
const base=JSON.parse(fs.readFileSync(path.join(report,'environment.json'),'utf8')).head;
const files=cp.execFileSync('rg',['--files','packages/snapback4/test'],{cwd:root,encoding:'utf8'}).trim().split('\n').filter(f=>/\.(mjs|ts|tsx)$/.test(f));files.push('witness/lib.mjs');
const rows=[];
for(const file of files)for(const version of ['before','after']){
 let source;try{source=version==='before'?cp.execFileSync('git',['show',base+':snapback4/'+file],{cwd:root,encoding:'utf8',stdio:['ignore','pipe','ignore']}):fs.readFileSync(path.join(root,file),'utf8')}catch{continue}
 const sf=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true,/\.tsx$/.test(file)?ts.ScriptKind.TSX:/\.ts$/.test(file)?ts.ScriptKind.TS:ts.ScriptKind.JS);
 function emit(n,kind){let text=n.getText(sf),line=sf.getLineAndCharacterOfPosition(n.getStart()).line+1;rows.push({file,version,line,kind,text:text.replace(/\s+/g,' ').slice(0,1800),...(kind==='loop'?{condition:n.expression?.getText(sf)??n.condition?.getText(sf)??''}:{})});}
 function walk(n){
  if(ts.isPropertyAssignment(n)&&/^(timeout|timeoutMs|drainMilliseconds|closeMilliseconds)$/.test(n.name.getText(sf)))emit(n,'option');
  if(ts.isCallExpression(n)){
   const name=n.expression.getText(sf);
   if(/(?:^|\.)(?:setTimeout|setInterval|delay|sleep|waitForTimeout|until|turns|waitFor|awaitState|withHangGuard|hangBudget|setDefaultTimeout|setDefaultNavigationTimeout|settlesWithin|waitForProofDrain|stopOwnedChild)$/.test(name)||name==='AbortSignal.timeout'||name==='Promise.race')emit(n,'call');
   // Include every assertion: timing variables may have arbitrary names.
   if(/^assert\./.test(name))emit(n,'assertion');
  }
  if((ts.isWhileStatement(n)||ts.isForStatement(n)||ts.isDoStatement(n))&&/await/.test(n.getText(sf)))emit(n,'loop');
  ts.forEachChild(n,walk);
 }
 walk(sf);
 function proxyCalls(n){if(ts.isCallExpression(n)&&/proxy-http-lifecycle\.test\.mjs$/.test(file)&&/\.close$/.test(n.expression.getText(sf))&&n.arguments.length)emit(n,'call');ts.forEachChild(n,proxyCalls);}
 proxyCalls(sf);
 // Embedded HTML/JS and fixture-provider source must not disappear into AST strings.
 source.split('\n').forEach((text,i)=>{if(/(?:Date\.now|performance\.now|setTimeout|timeout:|timeoutMs:|until\(|turns\(|waitForTimeout|--timeout)/.test(text)&&!rows.some(r=>r.file===file&&r.version===version&&r.line===i+1))rows.push({file,version,line:i+1,kind:'text',text:text.trim()});});
}
fs.writeFileSync(path.join(report,'audit-sites.json'),JSON.stringify(rows,null,2)+'\n');
console.log(rows.length,'before/after candidate sites in',files.length,'source files');
